import { Worker } from "node:worker_threads";
import {
  buildCombinedFilterTree,
  buildDashboardFilters,
  buildDashboardResult,
  collectFilterFieldIds,
  createFilterGroup,
  filterHasValue,
  formatMetricValue,
  getChartLabel,
  getReportDecimalPlaces,
  matchesFilterNode,
  runReport,
  type ChartAggregation,
  type DashboardRunResult,
  type DataRow,
  type FilterDefinition,
  type FilterGroupDefinition,
  type DataFreshnessInfo,
  type ReportDefinition,
  type ReportRunResult,
  type SummaryDatum,
  type SummaryMetric,
  type TableDefinition
} from "@studio/shared";
import { ExecutionCache } from "./execution-cache.js";
import { objectStore } from "./object-store.js";
import { fetchQuickbaseTablePage } from "./quickbase-storage.js";
import { studioStore } from "./studio-store.js";

interface WorkerRequest {
  report: ReportDefinition;
  table: TableDefinition;
  rows: DataRow[];
  extraFilters: FilterDefinition[];
}

interface ExecuteReportOptions {
  page?: number;
  pageSize?: number;
  includeRows?: boolean;
  forceLive?: boolean;
}

interface ExecuteDashboardOptions {
  activeTabId?: string;
  forceLive?: boolean;
}

interface ExportProgressCallback {
  (progress: number, message: string): void;
}

const DATE_TOKENS = new Set(["CURRENT_MONTH", "LAST_30_DAYS", "CURRENT_YEAR"]);
const cache = new ExecutionCache<ReportRunResult>(20_000);

function freshness(source: DataFreshnessInfo["source"]): DataFreshnessInfo {
  return {
    source,
    fetchedAt: new Date().toISOString()
  };
}

function getCachedFreshness(tableId: string): DataFreshnessInfo | null {
  const document = studioStore.getDocument();
  const status = document.sync.refreshStatus;
  if (!status.cachedTableIds.includes(tableId) || !status.lastSuccessAt) {
    return null;
  }
  return {
    source: "scheduled-cache",
    fetchedAt: status.lastSuccessAt
  };
}

function shouldUseLiveQuickbase(tableId: string, forceLive = false) {
  if (forceLive) return true;
  const quickbase = studioStore.getDocument().quickbase;
  if (!quickbase.realmHostname || !quickbase.userToken || !quickbase.appId) return false;
  return !getCachedFreshness(tableId);
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function collectReportFieldIds(report: ReportDefinition) {
  return Array.from(new Set(
    [
      ...(report.selectedFieldIds || []),
      ...collectFilterFieldIds(report.filterTree || createFilterGroup("and", report.filters || [])),
      ...(report.groups || []).map((item) => item.fieldId),
      ...(report.sorts || []).map((item) => item.fieldId),
      ...((report.summaryMetrics || []).map((item) => item.fieldId)),
      report.view.chartFieldId,
      report.view.chartValueFieldId,
      report.view.timelineDateField,
      report.view.timelineEndField,
      report.view.calendarDateField,
      report.view.kanbanField,
      report.view.titleFieldId
    ].filter(Boolean).map(String)
  ));
}

function cacheKey(report: ReportDefinition, extraFilters: FilterDefinition[], options: ExecuteReportOptions): string {
  return JSON.stringify({
    reportId: report.id,
    updatedAt: report.updatedAt,
    page: options.page || 1,
    pageSize: options.pageSize || 100,
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  });
}

function reportNeedsAggregates(report: ReportDefinition) {
  if (report.summaryMetrics.length) return true;
  if (report.view.mode === "summary" || report.view.mode === "chart") return true;
  if (report.view.mode === "table" && report.view.showChartInTable) return true;
  return false;
}

function runReportWorker(payload: WorkerRequest): Promise<ReportRunResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/report.worker.js", import.meta.url), {
      workerData: payload
    });
    worker.once("message", (message: ReportRunResult) => resolve(message));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error("Report worker exited with code " + code));
    });
  });
}

function normalizePageOptions(options: ExecuteReportOptions) {
  const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 100, 1000));
  const page = Math.max(1, Number(options.page) || 1);
  return {
    page,
    pageSize,
    includeRows: options.includeRows !== false,
    startIndex: (page - 1) * pageSize,
    endIndexExclusive: page * pageSize
  };
}

function getCombinedFilterTree(report: ReportDefinition, extraFilters: FilterDefinition[]) {
  return buildCombinedFilterTree(report, extraFilters);
}

function isFilterGroupNode(condition: FilterGroupDefinition["conditions"][number]): condition is FilterGroupDefinition {
  return "type" in condition && condition.type === "group";
}

function isPushdownSafeTree(group: FilterGroupDefinition | null): group is FilterGroupDefinition {
  if (!group) return false;
  if (group.join !== "and") return false;
  return group.conditions.every((condition) => {
    if (isFilterGroupNode(condition)) return false;
    if (!filterHasValue(condition)) return false;
    if (DATE_TOKENS.has(String(condition.value || ""))) return false;
    return ["equals", "contains", "gt", "gte", "lt", "lte"].includes(condition.operator);
  });
}

function extractFlatPushdownFilters(group: FilterGroupDefinition | null): FilterDefinition[] {
  if (!isPushdownSafeTree(group)) return [];
  return group.conditions.filter((condition): condition is FilterDefinition => !isFilterGroupNode(condition));
}

function buildQuickbaseWhere(filters: FilterDefinition[]) {
  const operatorMap: Record<string, string> = {
    equals: "EX",
    contains: "CT",
    gt: "GT",
    gte: "GTE",
    lt: "LT",
    lte: "LTE"
  };
  const pushdown: Array<{ fid: string; value: unknown; operator?: string }> = [];
  const unsupported: FilterDefinition[] = [];
  filters.forEach((filter) => {
    if (DATE_TOKENS.has(String(filter.value || ""))) {
      unsupported.push(filter);
      return;
    }
    const operator = operatorMap[filter.operator];
    if (!operator) {
      unsupported.push(filter);
      return;
    }
    pushdown.push({
      fid: filter.fieldId,
      value: filter.value,
      operator
    });
  });
  const where = pushdown
    .map((clause) => `{'${clause.fid}'.${clause.operator}.'${String(clause.value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'}`)
    .join("AND");
  return { where, unsupportedFilters: unsupported };
}

function buildQuickbaseSort(report: ReportDefinition) {
  return (report.sorts || []).filter((item) => item.fieldId).map((item) => ({
    fieldId: item.fieldId,
    order: item.direction === "desc" ? "DESC" as const : "ASC" as const
  }));
}

function summarizeRows(rows: DataRow[], metrics: SummaryMetric[], decimalPlaces: number): SummaryDatum[] {
  return metrics.map((metric) => {
    let numericValue = 0;
    if (metric.op === "count") {
      numericValue = rows.length;
    } else {
      const values = rows.map((row) => asNumber(row[metric.fieldId]));
      if (metric.op === "sum") numericValue = values.reduce((sum, value) => sum + value, 0);
      if (metric.op === "avg") numericValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      if (metric.op === "min") numericValue = values.length ? Math.min(...values) : 0;
      if (metric.op === "max") numericValue = values.length ? Math.max(...values) : 0;
    }
    const formattedValue = formatMetricValue(numericValue, metric.op, decimalPlaces);
    return {
      label: metric.label,
      value: formattedValue,
      numericValue
    };
  });
}

function createMetricAccumulator(metrics: SummaryMetric[]) {
  return metrics.map((metric) => ({
    metric,
    count: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY
  }));
}

function addMetricRow(accumulator: ReturnType<typeof createMetricAccumulator>, row: DataRow) {
  accumulator.forEach((entry) => {
    if (entry.metric.op === "count") {
      entry.count += 1;
      return;
    }
    const value = asNumber(row[entry.metric.fieldId]);
    entry.count += 1;
    entry.sum += value;
    entry.min = Math.min(entry.min, value);
    entry.max = Math.max(entry.max, value);
  });
}

function finalizeMetricAccumulator(accumulator: ReturnType<typeof createMetricAccumulator>, decimalPlaces: number): SummaryDatum[] {
  return accumulator.map((entry) => {
    let numericValue = 0;
    if (entry.metric.op === "count") numericValue = entry.count;
    if (entry.metric.op === "sum") numericValue = entry.sum;
    if (entry.metric.op === "avg") numericValue = entry.count ? entry.sum / entry.count : 0;
    if (entry.metric.op === "min") numericValue = entry.count ? entry.min : 0;
    if (entry.metric.op === "max") numericValue = entry.count ? entry.max : 0;
    const formattedValue = formatMetricValue(numericValue, entry.metric.op, decimalPlaces);
    return {
      label: entry.metric.label,
      value: formattedValue,
      numericValue
    };
  });
}

function projectRows(report: ReportDefinition, rows: DataRow[]) {
  const titleField = report.view.titleFieldId || report.selectedFieldIds[0] || "";
  return rows.map((row) => {
    const next: DataRow = {};
    for (const fieldId of report.selectedFieldIds) {
      next[fieldId] = row[fieldId] ?? "";
    }
    return {
      ...(titleField ? { __title: next[titleField] ?? "" } : {}),
      ...next
    };
  });
}

function aggregateChartValues(values: number[], aggregation: ChartAggregation) {
  if (aggregation === "count") return values.length;
  if (!values.length) return 0;
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "min") return Math.min(...values);
  return Math.max(...values);
}

function buildChartResult(chartGroups: Map<string, number[]>, report: ReportDefinition) {
  const aggregation = report.view.chartAggregation || "count";
  const rows = Array.from(chartGroups.entries()).map(([label, values]) => ({
    label: getChartLabel(report, label),
    value: aggregateChartValues(values, aggregation)
  }));
  const sort = report.view.chartSort || "value-desc";
  if (sort === "value-asc") rows.sort((left, right) => left.value - right.value);
  else if (sort === "label-asc") rows.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  else if (sort === "label-desc") rows.sort((left, right) => right.label.localeCompare(left.label, undefined, { numeric: true }));
  else rows.sort((left, right) => right.value - left.value);
  const topN = Math.max(0, Number(report.view.chartTopN) || 0);
  return topN ? rows.slice(0, topN) : rows;
}

function addChartRow(chartGroups: Map<string, number[]>, report: ReportDefinition, row: DataRow) {
  const chartField = report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
  if (!chartField) return;
  const key = String(row[chartField] ?? "Unassigned");
  const aggregation = report.view.chartAggregation || "count";
  const valueFieldId = report.view.chartValueFieldId || "";
  const next = chartGroups.get(key) || [];
  next.push(aggregation === "count" ? 1 : asNumber(row[valueFieldId]));
  chartGroups.set(key, next);
}

async function fetchQuickbaseReportPageOnly(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: ExecuteReportOptions
): Promise<ReportRunResult> {
  const quickbase = studioStore.getDocument().quickbase;
  const { page, pageSize, includeRows, startIndex } = normalizePageOptions(options);
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const filters = extractFlatPushdownFilters(filterTree);
  const requestedFieldIds = collectReportFieldIds(report);
  const warnings = report.selectedFieldIds.length ? [] : ["This report has no selected fields."];
  const { where } = buildQuickbaseWhere(filters);
  const sortBy = buildQuickbaseSort(report);

  if (filterTree && !filters.length) {
    const batchSize = 500;
    let skip = 0;
    let totalRows = 0;
    const pageRows: DataRow[] = [];
    while (true) {
      const batch = await fetchQuickbaseTablePage(quickbase, table.id, requestedFieldIds, {
        top: batchSize,
        skip,
        sortBy
      });
      if (!batch.rows.length) break;
      batch.rows.forEach((row) => {
        if (filterTree && !matchesFilterNode(row, filterTree)) {
          return;
        }
        if (includeRows && totalRows >= startIndex && totalRows < startIndex + pageSize) {
          pageRows.push(row);
        }
        totalRows += 1;
      });
      if (batch.rows.length < batchSize) break;
      skip += batchSize;
    }
    return {
      reportId: report.id,
      tableId: table.id,
      totalRows,
      rows: includeRows ? projectRows(report, pageRows) : [],
      summary: [],
      chartData: [],
      warnings,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      hasNextPage: page * pageSize < totalRows
    };
  }

  const pageResult = await fetchQuickbaseTablePage(quickbase, table.id, requestedFieldIds, {
    top: pageSize,
    skip: startIndex,
    where,
    sortBy
  });
  const totalRows = pageResult.totalRecords ?? pageResult.rows.length;
  return {
    reportId: report.id,
    tableId: table.id,
    totalRows,
    rows: projectRows(report, pageResult.rows),
    summary: [],
    chartData: [],
    warnings,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    hasNextPage: page * pageSize < totalRows,
    freshness: freshness("quickbase-live")
  };
}

async function executeQuickbaseReportPage(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: ExecuteReportOptions
): Promise<ReportRunResult> {
  const quickbase = studioStore.getDocument().quickbase;
  const { page, pageSize, includeRows, startIndex, endIndexExclusive } = normalizePageOptions(options);
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const filters = extractFlatPushdownFilters(filterTree);
  const requestedFieldIds = collectReportFieldIds(report);
  const metricSet = report.summaryMetrics.length
    ? report.summaryMetrics
    : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
  const warnings = report.selectedFieldIds.length ? [] : ["This report has no selected fields."];
  const { where } = buildQuickbaseWhere(filters);
  const sortBy = buildQuickbaseSort(report);

  if (!filterTree || (filters.length && isPushdownSafeTree(filterTree))) {
    const pageResult = includeRows
      ? await fetchQuickbaseTablePage(quickbase, table.id, requestedFieldIds, {
          top: pageSize,
          skip: startIndex,
          where,
          sortBy
        })
      : null;

    const summaryAccumulator = createMetricAccumulator(metricSet);
    const batchSize = 500;
    let scanSkip = 0;
    let scannedRows = 0;
    const chartGroups = new Map<string, number[]>();
    while (true) {
      const batch = await fetchQuickbaseTablePage(quickbase, table.id, requestedFieldIds, {
        top: batchSize,
        skip: scanSkip,
        where,
        sortBy
      });
      if (!batch.rows.length) break;
      batch.rows.forEach((row) => {
        scannedRows += 1;
        addMetricRow(summaryAccumulator, row);
        addChartRow(chartGroups, report, row);
      });
      if (batch.rows.length < batchSize) break;
      scanSkip += batchSize;
    }

    const totalRows = pageResult?.totalRecords ?? scannedRows;
    return {
      reportId: report.id,
      tableId: table.id,
      totalRows,
      rows: includeRows && pageResult ? projectRows(report, pageResult.rows) : [],
      summary: finalizeMetricAccumulator(summaryAccumulator, getReportDecimalPlaces(report)),
      chartData: buildChartResult(chartGroups, report),
      warnings,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      hasNextPage: includeRows ? page * pageSize < totalRows : false,
      freshness: freshness("quickbase-live")
    };
  }

  const batchSize = 500;
  let skip = 0;
  let totalRows = 0;
  const pageRows: DataRow[] = [];
  const chartGroups = new Map<string, number[]>();
  const summaryAccumulator = createMetricAccumulator(metricSet);
  while (true) {
    const batch = await fetchQuickbaseTablePage(quickbase, table.id, requestedFieldIds, {
      top: batchSize,
      skip,
      where,
      sortBy
    });
    if (!batch.rows.length) break;
    batch.rows.forEach((row) => {
      if (filterTree && !matchesFilterNode(row, filterTree)) {
        return;
      }
      addMetricRow(summaryAccumulator, row);
      addChartRow(chartGroups, report, row);
      if (includeRows && totalRows >= startIndex && totalRows < endIndexExclusive) {
        pageRows.push(row);
      }
      totalRows += 1;
    });
    if (batch.rows.length < batchSize) break;
    skip += batchSize;
  }

  return {
    reportId: report.id,
    tableId: table.id,
    totalRows,
    rows: includeRows ? projectRows(report, pageRows) : [],
    summary: finalizeMetricAccumulator(summaryAccumulator, getReportDecimalPlaces(report)),
    chartData: buildChartResult(chartGroups, report),
    warnings,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    hasNextPage: includeRows ? page * pageSize < totalRows : false,
    freshness: freshness("quickbase-live")
  };
}

export async function executeReportPage(report: ReportDefinition, extraFilters: FilterDefinition[] = [], options: ExecuteReportOptions = {}): Promise<ReportRunResult> {
  const table = objectStore.getTable(report.sourceTableId);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    return executeQuickbaseReportPage(report, table, extraFilters, options).catch(async () => {
      const rows = objectStore.getRows(table.id);
      const full = runReport(report, table, rows, extraFilters);
      const { page, pageSize, startIndex, endIndexExclusive } = normalizePageOptions(options);
      const cachedFreshness = getCachedFreshness(table.id);
      return {
        ...full,
        rows: full.rows.slice(startIndex, endIndexExclusive),
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(full.totalRows / pageSize)),
        hasNextPage: page * pageSize < full.totalRows,
        freshness: cachedFreshness || freshness("local-fallback")
      };
    });
  }

  const rows = objectStore.getRows(table.id);
  const full = runReport(report, table, rows, extraFilters);
  const { page, pageSize, startIndex, endIndexExclusive } = normalizePageOptions(options);
  const cachedFreshness = getCachedFreshness(table.id);
  return {
    ...full,
    rows: full.rows.slice(startIndex, endIndexExclusive),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(full.totalRows / pageSize)),
    hasNextPage: page * pageSize < full.totalRows,
    freshness: cachedFreshness || freshness("local-fallback")
  };
}

export async function fetchReportPage(report: ReportDefinition, extraFilters: FilterDefinition[] = [], options: ExecuteReportOptions = {}): Promise<ReportRunResult> {
  const table = objectStore.getTable(report.sourceTableId);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    return fetchQuickbaseReportPageOnly(report, table, extraFilters, options);
  }

  const full = runReport(report, table, objectStore.getRows(table.id), extraFilters);
  const { page, pageSize, startIndex, endIndexExclusive } = normalizePageOptions(options);
  const cachedFreshness = getCachedFreshness(table.id);
  return {
    ...full,
    rows: full.rows.slice(startIndex, endIndexExclusive),
    summary: [],
    chartData: [],
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(full.totalRows / pageSize)),
    hasNextPage: page * pageSize < full.totalRows,
    freshness: cachedFreshness || freshness("local-fallback")
  };
}

export async function fetchReportExportBundle(
  report: ReportDefinition,
  extraFilters: FilterDefinition[] = [],
  onProgress?: ExportProgressCallback
): Promise<ReportRunResult> {
  const table = objectStore.getTable(report.sourceTableId);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  const quickbase = studioStore.getDocument().quickbase;
  if (quickbase.realmHostname && quickbase.userToken && quickbase.appId) {
    const filterTree = getCombinedFilterTree(report, extraFilters);
    const filters = extractFlatPushdownFilters(filterTree);
    const requestedFieldIds = collectReportFieldIds(report);
    const { where } = buildQuickbaseWhere(filters);
    const sortBy = buildQuickbaseSort(report);
    const metricSet = report.summaryMetrics.length
      ? report.summaryMetrics
      : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
    const warnings = report.selectedFieldIds.length ? [] : ["This report has no selected fields."];
    const batchSize = 1000;
    let skip = 0;
    const rows: DataRow[] = [];
    const summaryAccumulator = createMetricAccumulator(metricSet);
    const chartGroups = new Map<string, number[]>();
    let processed = 0;
    let expectedTotal = 0;

    while (true) {
      const batch = await fetchQuickbaseTablePage(quickbase, table.id, requestedFieldIds, {
        top: batchSize,
        skip,
        where,
        sortBy
      });
      if (!batch.rows.length) break;
      expectedTotal = Math.max(expectedTotal, batch.totalRecords ?? 0);
      batch.rows.forEach((row) => {
        if (filterTree && !isPushdownSafeTree(filterTree) && !matchesFilterNode(row, filterTree)) return;
        rows.push(row);
        addMetricRow(summaryAccumulator, row);
        addChartRow(chartGroups, report, row);
        processed += 1;
      });
      if (onProgress) {
        const ratio = expectedTotal > 0 ? Math.min(1, processed / expectedTotal) : Math.min(1, processed / Math.max(batchSize, processed));
        onProgress(10 + Math.round(ratio * 58), `Loading rows (${processed.toLocaleString()})`);
      }
      if (batch.rows.length < batchSize) break;
      skip += batch.rows.length;
    }
    return {
      reportId: report.id,
      tableId: table.id,
      totalRows: rows.length,
      rows: projectRows(report, rows),
      summary: finalizeMetricAccumulator(summaryAccumulator, getReportDecimalPlaces(report)),
      chartData: buildChartResult(chartGroups, report),
      warnings
    };
  }

  onProgress?.(68, "Preparing export data");
  return {
    ...runReport(report, table, objectStore.getRows(table.id), extraFilters),
    freshness: getCachedFreshness(table.id) || freshness("local-fallback")
  };
}

export async function fetchAllReportRowsForExport(report: ReportDefinition, extraFilters: FilterDefinition[] = []): Promise<DataRow[]> {
  const result = await fetchReportExportBundle(report, extraFilters);
  return result.rows;
}

export async function executeReport(report: ReportDefinition, extraFilters: FilterDefinition[] = [], options: ExecuteReportOptions = {}): Promise<ReportRunResult> {
  const table = objectStore.getTable(report.sourceTableId);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }
  if (!reportNeedsAggregates(report)) {
    return fetchReportPage(report, extraFilters, options);
  }
  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    return executeQuickbaseReportPage(report, table, extraFilters, options);
  }

  const key = cacheKey(report, extraFilters, options);
  return cache.getOrCreate(key, async () => {
    const rows = objectStore.getRows(table.id);
    const cachedFreshness = getCachedFreshness(table.id);
    if (rows.length <= 1500) {
      const full = runReport(report, table, rows, extraFilters);
      const { page, pageSize, startIndex, endIndexExclusive } = normalizePageOptions(options);
      return {
        ...full,
        rows: full.rows.slice(startIndex, endIndexExclusive),
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(full.totalRows / pageSize)),
        hasNextPage: page * pageSize < full.totalRows,
        freshness: cachedFreshness || freshness("local-fallback")
      };
    }

    const full = await runReportWorker({ report, table, rows, extraFilters });
    const { page, pageSize, startIndex, endIndexExclusive } = normalizePageOptions(options);
    return {
      ...full,
      rows: full.rows.slice(startIndex, endIndexExclusive),
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(full.totalRows / pageSize)),
      hasNextPage: page * pageSize < full.totalRows,
      freshness: cachedFreshness || freshness("local-fallback")
    };
  });
}

function resolveDashboardWidgetDisplayMode(report: ReportDefinition, widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"]) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  if (report.view.mode === "summary") return "summary";
  if (report.view.mode === "chart") return "chart";
  return "table";
}

function widgetNeedsAggregates(report: ReportDefinition, widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"]) {
  const displayMode = resolveDashboardWidgetDisplayMode(report, widget);
  const needsChart = displayMode === "chart" || (displayMode === "table" && report.view.showChartInTable);
  return widget.showSummary || displayMode === "summary" || needsChart;
}

function widgetNeedsRows(report: ReportDefinition, widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"]) {
  const displayMode = resolveDashboardWidgetDisplayMode(report, widget);
  return displayMode === "table" || widget.showDetails;
}

function buildDashboardExecutionKey(report: ReportDefinition, widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], extraFilters: FilterDefinition[]) {
  return JSON.stringify({
    reportId: report.id,
    updatedAt: report.updatedAt,
    heavy: widgetNeedsAggregates(report, widget),
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  });
}

export async function executeDashboard(
  dashboardId: string,
  runtimeValues: Record<string, string>,
  options: ExecuteDashboardOptions = {}
): Promise<DashboardRunResult> {
  const dashboard = objectStore.getDashboard(dashboardId);
  if (!dashboard) {
    throw new Error("Dashboard not found.");
  }

  const tabsToRender = options.activeTabId
    ? dashboard.tabs.filter((tab) => tab.id === options.activeTabId)
    : dashboard.tabs;
  const executionCache = new Map<string, Promise<ReportRunResult>>();
  const widgetResults = await Promise.all(
    tabsToRender.flatMap((tab) =>
      tab.widgets.map(async (widget) => {
        const report = objectStore.resolveWidgetReport(widget);
        if (!report) {
          throw new Error("Widget report not found for " + widget.id + ".");
        }
        const extraFilters = buildDashboardFilters(dashboard, report.id, runtimeValues);
        const executionKey = buildDashboardExecutionKey(report, widget, extraFilters);
        let pending = executionCache.get(executionKey);
        if (!pending) {
          pending = widgetNeedsAggregates(report, widget)
            ? executeReport(report, extraFilters, { page: 1, pageSize: 100, includeRows: widgetNeedsRows(report, widget), forceLive: options.forceLive })
            : fetchReportPage(report, extraFilters, { page: 1, pageSize: 100, forceLive: options.forceLive });
          executionCache.set(executionKey, pending);
        }
        const result = await pending;
        return {
          widgetId: widget.id,
          widget,
          report,
          result
        };
      })
    )
  );

  const built = buildDashboardResult(dashboard, widgetResults);
  const dashboardSource = widgetResults.every((widget) => widget.result.freshness?.source === "quickbase-live")
    ? "quickbase-live"
    : widgetResults.every((widget) => widget.result.freshness?.source === "scheduled-cache")
      ? "scheduled-cache"
      : "local-fallback";
  return {
    ...built,
    freshness: freshness(dashboardSource)
  };
}
