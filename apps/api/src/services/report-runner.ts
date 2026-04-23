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
  type DashboardDefinition,
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
import { ensureTableRowsAvailable } from "./refresh-cache.js";
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
const EXECUTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_WIDGET_CONCURRENCY = 2;
const reportCache = new ExecutionCache<ReportRunResult>(EXECUTION_CACHE_TTL_MS, 500);
const reportPageCache = new ExecutionCache<ReportRunResult>(EXECUTION_CACHE_TTL_MS, 1_500);
const dashboardCache = new ExecutionCache<DashboardRunResult>(EXECUTION_CACHE_TTL_MS, 200);

function freshness(source: DataFreshnessInfo["source"]): DataFreshnessInfo {
  return {
    source,
    fetchedAt: new Date().toISOString()
  };
}

function getCachedFreshness(tableId: string): DataFreshnessInfo | null {
  const document = studioStore.getDocument();
  const table = objectStore.getTable(tableId);
  const cacheKeys = Array.from(new Set([tableId, table?.id || "", table?.quickbaseTableId || ""].filter(Boolean)));
  const freshKey = cacheKeys.find((key) => studioStore.isCacheFresh(key)) || "";
  const directMeta = freshKey ? studioStore.getCacheMeta(freshKey) : null;
  if (directMeta && freshKey) {
    return {
      source: "scheduled-cache",
      fetchedAt: directMeta.cachedAt
    };
  }
  const profileId = table?.quickbaseProfileId || "";
  if (profileId) {
    const profileStatus = document.quickbaseProfiles.find((item) => item.id === profileId)?.refreshStatus;
    if (profileStatus?.cachedTableIds.some((cachedTableId) => cacheKeys.includes(cachedTableId)) && profileStatus.lastSuccessAt && freshKey) {
      return {
        source: "scheduled-cache",
        fetchedAt: profileStatus.lastSuccessAt
      };
    }
  }
  const status = document.sync.refreshStatus;
  if (status.cachedTableIds.some((cachedTableId) => cacheKeys.includes(cachedTableId)) && status.lastSuccessAt && freshKey) {
    return {
      source: "scheduled-cache",
      fetchedAt: status.lastSuccessAt
    };
  }
  return null;
}

function shouldUseLiveQuickbase(tableId: string, forceLive = false) {
  if (!forceLive) return false;
  const quickbase = studioStore.getDocument().quickbase;
  return Boolean(quickbase.realmHostname && quickbase.userToken && quickbase.appId && tableId);
}

function getQuickbaseConfigForTable(table: TableDefinition) {
  const document = studioStore.getDocument();
  const profileId = table.quickbaseProfileId || "";
  const profile = profileId ? document.quickbaseProfiles.find((item) => item.id === profileId) : null;
  return profile?.quickbase || document.quickbase;
}

function getQuickbaseTableId(table: TableDefinition) {
  return table.quickbaseTableId || table.id;
}

async function getExecutionRows(table: TableDefinition, options: { objectId?: string } = {}) {
  const existingRows = objectStore.getRows(table.id);
  if (existingRows.length) return existingRows;
  return ensureTableRowsAvailable(table.id, options);
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeChartGroupValue(value: unknown): string {
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    return normalized.join(", ");
  }
  return String(value ?? "").trim();
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
      report.view.chartSeriesFieldId,
      report.view.chartValueFieldId,
      report.view.chartSecondaryValueFieldId,
      report.view.timelineDateField,
      report.view.timelineEndField,
      report.view.calendarDateField,
      report.view.kanbanField,
      report.view.titleFieldId
    ].filter(Boolean).map(String)
  ));
}

function getTableCacheVersion(table: TableDefinition): string {
  const keys = Array.from(new Set([table.id, table.quickbaseTableId || ""].filter(Boolean)));
  for (const key of keys) {
    const meta = studioStore.getCacheMeta(key);
    if (meta) {
      return `${key}:${meta.cachedAt}:${meta.rowCount}`;
    }
  }
  return `rows:${objectStore.getRows(table.id).length}`;
}

function buildReportExecutionShape(report: ReportDefinition) {
  return {
    sourceTableId: report.sourceTableId,
    selectedFieldIds: report.selectedFieldIds || [],
    filters: (report.filters || []).map((filter) => [filter.fieldId, filter.operator, filter.value]),
    filterTree: report.filterTree || null,
    groups: (report.groups || []).map((group) => group.fieldId),
    sorts: (report.sorts || []).map((sort) => [sort.fieldId, sort.direction]),
    summaryMetrics: (report.summaryMetrics || []).map((metric) => [metric.fieldId, metric.op, metric.label]),
    view: {
      mode: report.view.mode,
      showChartInTable: report.view.showChartInTable,
      showSummary: report.view.showSummary,
      showDetails: report.view.showDetails,
      chartType: report.view.chartType,
      chartOrientation: report.view.chartOrientation,
      chartFieldId: report.view.chartFieldId,
      chartSeriesFieldId: report.view.chartSeriesFieldId,
      chartValueFieldId: report.view.chartValueFieldId,
      chartAggregation: report.view.chartAggregation,
      chartSecondaryValueFieldId: report.view.chartSecondaryValueFieldId,
      chartSecondaryAggregation: report.view.chartSecondaryAggregation,
      chartUseSecondaryAxis: report.view.chartUseSecondaryAxis,
      chartSecondarySeriesType: report.view.chartSecondarySeriesType,
      chartTopN: report.view.chartTopN,
      chartSort: report.view.chartSort,
      timelineDateField: report.view.timelineDateField,
      timelineEndField: report.view.timelineEndField,
      calendarDateField: report.view.calendarDateField,
      kanbanField: report.view.kanbanField,
      titleFieldId: report.view.titleFieldId
    }
  };
}

function cacheKey(report: ReportDefinition, table: TableDefinition, extraFilters: FilterDefinition[]): string {
  return JSON.stringify({
    reportId: report.id,
    updatedAt: report.updatedAt,
    reportShape: buildReportExecutionShape(report),
    tableVersion: getTableCacheVersion(table),
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  });
}

function pageCacheKey(report: ReportDefinition, table: TableDefinition, extraFilters: FilterDefinition[], options: ExecuteReportOptions): string {
  const normalized = normalizePageOptions(options);
  return JSON.stringify({
    key: cacheKey(report, table, extraFilters),
    page: normalized.page,
    pageSize: normalized.pageSize,
    includeRows: normalized.includeRows,
    mode: "page-only"
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

function paginateReportResult(
  full: ReportRunResult,
  options: ExecuteReportOptions,
  mode: "full" | "page-only" = "full"
): ReportRunResult {
  const { page, pageSize, includeRows, startIndex, endIndexExclusive } = normalizePageOptions(options);
  return {
    ...full,
    rows: includeRows ? full.rows.slice(startIndex, endIndexExclusive) : [],
    summary: mode === "page-only" ? [] : full.summary,
    chartData: mode === "page-only" ? [] : full.chartData,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(full.totalRows / pageSize)),
    hasNextPage: includeRows ? page * pageSize < full.totalRows : false
  };
}

function sortLocalRows(rows: DataRow[], sorts: ReportDefinition["sorts"]): DataRow[] {
  if (!sorts.length) return rows;
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const leftValue = left[sort.fieldId];
      const rightValue = right[sort.fieldId];
      const leftText = String(Array.isArray(leftValue) ? leftValue.join(", ") : leftValue ?? "");
      const rightText = String(Array.isArray(rightValue) ? rightValue.join(", ") : rightValue ?? "");
      if (leftText === rightText) continue;
      const direction = sort.direction === "desc" ? -1 : 1;
      return leftText.localeCompare(rightText, undefined, { numeric: true }) * direction;
    }
    return 0;
  });
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
    return ["equals", "on", "contains", "gt", "gte", "lt", "lte", "on-or-after", "on-or-before"].includes(condition.operator);
  });
}

function extractFlatPushdownFilters(group: FilterGroupDefinition | null): FilterDefinition[] {
  if (!isPushdownSafeTree(group)) return [];
  return group.conditions.filter((condition): condition is FilterDefinition => !isFilterGroupNode(condition));
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
  return results;
}

function buildQuickbaseWhere(filters: FilterDefinition[]) {
  const operatorMap: Record<string, string> = {
    equals: "EX",
    on: "EX",
    contains: "CT",
    gt: "GT",
    "on-or-after": "GTE",
    gte: "GTE",
    lt: "LT",
    "on-or-before": "LTE",
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

function createEmptyReportResult(reportId: string, tableId: string, warning: string, source: DataFreshnessInfo["source"] = "local-fallback"): ReportRunResult {
  return {
    reportId,
    tableId,
    totalRows: 0,
    rows: [],
    summary: [],
    chartData: [],
    warnings: warning ? [warning] : [],
    page: 1,
    pageSize: 100,
    totalPages: 1,
    hasNextPage: false,
    freshness: freshness(source)
  };
}

function createFallbackWidgetReport(widget: DashboardDefinition["tabs"][number]["widgets"][number], message: string): ReportDefinition {
  return {
    id: widget.reportId || `${widget.id}-missing-report`,
    type: "report",
    schemaVersion: 1,
    name: widget.title || "Unavailable report",
    description: message,
    folder: "Unavailable",
    category: "Unavailable",
    tags: [],
    scope: "global",
    ownerUserId: "",
    updatedAt: new Date().toISOString(),
    sourceTableId: "",
    sourceReportOverrides: {},
    selectedFieldIds: [],
    filters: [],
    filterTree: createFilterGroup("and", []),
    groups: [],
    sorts: [],
    summaryMetrics: [],
    view: {
      mode: "table",
      showChartInTable: false,
      showSummary: false,
      showDetails: true,
      chartTitle: "",
      decimalPlaces: 2,
      chartType: "bar",
      chartOrientation: "vertical",
      chartFieldId: "",
      chartSeriesFieldId: "",
      chartValueFieldId: "",
      chartAggregation: "count",
      chartSecondaryValueFieldId: "",
      chartSecondaryAggregation: "sum",
      chartUseSecondaryAxis: false,
      chartSecondarySeriesType: "line",
      chartTopN: 12,
      chartSort: "value-desc",
      chartColors: ["#0d7c66"],
      chartShowLegend: false,
      chartShowValues: false,
      chartXAxisLabel: "",
      chartYAxisLabel: "",
      chartSecondaryYAxisLabel: "",
      timelineDateField: "",
      timelineEndField: "",
      calendarDateField: "",
      kanbanField: "",
      titleFieldId: ""
    },
    displayLabels: { fields: {}, chartValues: {} }
  };
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
      ...(row.__recordId ? { __recordId: row.__recordId } : {}),
      ...(titleField ? { __title: next[titleField] ?? "" } : {}),
      ...next
    };
  });
}

function executeLocalReportPageOnly(
  report: ReportDefinition,
  table: TableDefinition,
  rows: DataRow[],
  extraFilters: FilterDefinition[],
  options: ExecuteReportOptions
): ReportRunResult {
  const { page, pageSize, includeRows, startIndex, endIndexExclusive } = normalizePageOptions(options);
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const filtered = filterTree ? rows.filter((row) => matchesFilterNode(row, filterTree)) : rows;
  const sorted = sortLocalRows(filtered, report.sorts);
  const warnings = report.selectedFieldIds.length || !report.view.showDetails ? [] : ["This report has no selected fields."];
  return {
    reportId: report.id,
    tableId: table.id,
    totalRows: sorted.length,
    rows: includeRows ? projectRows(report, sorted.slice(startIndex, endIndexExclusive)) : [],
    summary: [],
    chartData: [],
    warnings,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)),
    hasNextPage: includeRows ? page * pageSize < sorted.length : false,
    freshness: getCachedFreshness(table.id) || freshness("local-fallback")
  };
}

function aggregateChartValues(values: number[], aggregation: ChartAggregation) {
  if (aggregation === "count") return values.length;
  if (!values.length) return 0;
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "min") return Math.min(...values);
  return Math.max(...values);
}

type BuiltChartDatum = {
  label: string;
  rawLabel: string;
  value: number;
  series?: string;
  rawSeries?: string;
  axis: "primary" | "secondary";
};

function isContinuousChartType(report: ReportDefinition) {
  return report.view.chartType === "line"
    || report.view.chartType === "area"
    || report.view.chartType === "line-bar"
    || report.view.chartType === "spline"
    || report.view.chartType === "area-spline"
    || report.view.chartType === "streamgraph"
    || report.view.chartType === "scatter"
    || report.view.chartType === "bubble"
    || report.view.chartType === "3d-scatter";
}

function compareChartCategories(report: ReportDefinition, left: string, right: string) {
  const leftRaw = String(left ?? "").trim();
  const rightRaw = String(right ?? "").trim();
  const leftLabel = getChartLabel(report, left);
  const rightLabel = getChartLabel(report, right);
  const leftTime = Date.parse(leftRaw) || Date.parse(leftLabel);
  const rightTime = Date.parse(rightRaw) || Date.parse(rightLabel);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }
  return (leftRaw || leftLabel).localeCompare((rightRaw || rightLabel), undefined, { numeric: true });
}

function buildChartResult(chartGroups: Map<string, { primary: number[]; secondary: number[] }>, report: ReportDefinition) {
  const aggregation = report.view.chartAggregation || "count";
  const secondaryEnabled = report.view.chartUseSecondaryAxis && Boolean(report.view.chartSecondaryValueFieldId);
  const secondaryAggregation = report.view.chartSecondaryAggregation || "sum";
  const groupedByCategory = new Map<string, BuiltChartDatum[]>();
  for (const [key, values] of chartGroups.entries()) {
    const [rawLabel, rawSeries = ""] = key.split("::");
    const entries = groupedByCategory.get(rawLabel) || [];
    entries.push({
      label: getChartLabel(report, rawLabel),
      rawLabel,
      value: aggregateChartValues(values.primary, aggregation),
      series: rawSeries ? getChartLabel(report, rawSeries) : undefined,
      rawSeries: rawSeries || undefined,
      axis: "primary"
    });
    if (secondaryEnabled) {
      entries.push({
        label: getChartLabel(report, rawLabel),
        rawLabel,
        value: aggregateChartValues(values.secondary, secondaryAggregation),
        series: rawSeries ? getChartLabel(report, rawSeries) : undefined,
        rawSeries: rawSeries || undefined,
        axis: "secondary"
      });
    }
    groupedByCategory.set(rawLabel, entries);
  }
  const rows = Array.from(groupedByCategory.entries());
  const sort = report.view.chartSort || "value-desc";
  const categoryValue = (entries: BuiltChartDatum[]) =>
    entries.filter((entry) => entry.axis === "primary").reduce((sum, entry) => sum + entry.value, 0);
  if (isContinuousChartType(report)) {
    const descending = sort === "label-desc";
    const ordered = rows
      .filter(([rawLabel]) => String(rawLabel ?? "").trim())
      .sort((left, right) => compareChartCategories(report, left[0], right[0]) * (descending ? -1 : 1));
    const topN = Math.max(0, Number(report.view.chartTopN) || 0);
    const trimmed = topN
      ? (descending ? ordered.slice(0, topN) : ordered.slice(-topN))
      : ordered;
    return trimmed.flatMap(([, entries]) => entries);
  }
  if (sort === "value-asc") rows.sort((left, right) => categoryValue(left[1]) - categoryValue(right[1]));
  else if (sort === "label-asc") rows.sort((left, right) => getChartLabel(report, left[0]).localeCompare(getChartLabel(report, right[0]), undefined, { numeric: true }));
  else if (sort === "label-desc") rows.sort((left, right) => getChartLabel(report, right[0]).localeCompare(getChartLabel(report, left[0]), undefined, { numeric: true }));
  else rows.sort((left, right) => categoryValue(right[1]) - categoryValue(left[1]));
  const topN = Math.max(0, Number(report.view.chartTopN) || 0);
  const trimmed = topN ? rows.slice(0, topN) : rows;
  return trimmed.flatMap(([, entries]) => entries);
}

function addChartRow(chartGroups: Map<string, { primary: number[]; secondary: number[] }>, report: ReportDefinition, row: DataRow) {
  const chartField = report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
  if (!chartField) return;
  const seriesField = report.view.chartSeriesFieldId || "";
  const key = `${normalizeChartGroupValue(row[chartField])}::${seriesField ? normalizeChartGroupValue(row[seriesField]) : ""}`;
  const aggregation = report.view.chartAggregation || "count";
  const valueFieldId = report.view.chartValueFieldId || "";
  const secondaryValueFieldId = report.view.chartUseSecondaryAxis ? (report.view.chartSecondaryValueFieldId || "") : "";
  const secondaryAggregation = report.view.chartSecondaryAggregation || "sum";
  const next = chartGroups.get(key) || { primary: [], secondary: [] };
  next.primary.push(aggregation === "count" ? 1 : asNumber(row[valueFieldId]));
  if (secondaryValueFieldId) {
    next.secondary.push(secondaryAggregation === "count" ? 1 : asNumber(row[secondaryValueFieldId]));
  }
  chartGroups.set(key, next);
}

async function fetchQuickbaseReportPageOnly(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: ExecuteReportOptions
): Promise<ReportRunResult> {
  const tableQuickbase = getQuickbaseConfigForTable(table);
  const { page, pageSize, includeRows, startIndex } = normalizePageOptions(options);
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const filters = extractFlatPushdownFilters(filterTree);
  const requestedFieldIds = collectReportFieldIds(report);
  const warnings = report.selectedFieldIds.length || !report.view.showDetails ? [] : ["This report has no selected fields."];
  const { where } = buildQuickbaseWhere(filters);
  const sortBy = buildQuickbaseSort(report);

  if (filterTree && !filters.length) {
    const batchSize = 500;
    let skip = 0;
    let totalRows = 0;
    const pageRows: DataRow[] = [];
    while (true) {
      const batch = await fetchQuickbaseTablePage(tableQuickbase, getQuickbaseTableId(table), requestedFieldIds, {
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

  const pageResult = await fetchQuickbaseTablePage(tableQuickbase, getQuickbaseTableId(table), requestedFieldIds, {
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
  const tableQuickbase = getQuickbaseConfigForTable(table);
  const { page, pageSize, includeRows, startIndex, endIndexExclusive } = normalizePageOptions(options);
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const filters = extractFlatPushdownFilters(filterTree);
  const requestedFieldIds = collectReportFieldIds(report);
  const metricSet = report.summaryMetrics.length
    ? report.summaryMetrics
    : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
  const warnings = report.selectedFieldIds.length || !report.view.showDetails ? [] : ["This report has no selected fields."];
  const { where } = buildQuickbaseWhere(filters);
  const sortBy = buildQuickbaseSort(report);

  if (!filterTree || (filters.length && isPushdownSafeTree(filterTree))) {
    const pageResult = includeRows
      ? await fetchQuickbaseTablePage(tableQuickbase, getQuickbaseTableId(table), requestedFieldIds, {
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
    const chartGroups = new Map<string, { primary: number[]; secondary: number[] }>();
    while (true) {
      const batch = await fetchQuickbaseTablePage(tableQuickbase, getQuickbaseTableId(table), requestedFieldIds, {
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
  const chartGroups = new Map<string, { primary: number[]; secondary: number[] }>();
  const summaryAccumulator = createMetricAccumulator(metricSet);
  while (true) {
    const batch = await fetchQuickbaseTablePage(tableQuickbase, getQuickbaseTableId(table), requestedFieldIds, {
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
      const cachedFreshness = getCachedFreshness(table.id);
      return paginateReportResult({
        ...full,
        freshness: cachedFreshness || freshness("local-fallback")
      }, options, "full");
    });
  }

  const full = await reportCache.getOrCreate(cacheKey(report, table, extraFilters), async () => {
    const rows = await getExecutionRows(table, { objectId: report.id });
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows, extraFilters });
    return {
      ...result,
      freshness: getCachedFreshness(table.id) || freshness("local-fallback")
    };
  });
  return paginateReportResult(full, options, "full");
}

export async function fetchReportPage(report: ReportDefinition, extraFilters: FilterDefinition[] = [], options: ExecuteReportOptions = {}): Promise<ReportRunResult> {
  const table = objectStore.getTable(report.sourceTableId);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    return fetchQuickbaseReportPageOnly(report, table, extraFilters, options);
  }

  if (!reportNeedsAggregates(report)) {
    return reportPageCache.getOrCreate(pageCacheKey(report, table, extraFilters, options), async () => {
      const rows = await getExecutionRows(table, { objectId: report.id });
      return executeLocalReportPageOnly(report, table, rows, extraFilters, options);
    });
  }

  const full = await reportCache.getOrCreate(cacheKey(report, table, extraFilters), async () => {
    const rows = await getExecutionRows(table, { objectId: report.id });
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows, extraFilters });
    return {
      ...result,
      freshness: getCachedFreshness(table.id) || freshness("local-fallback")
    };
  });
  return paginateReportResult(full, options, "page-only");
}

export async function fetchReportExportBundle(
  report: ReportDefinition,
  extraFilters: FilterDefinition[] = [],
  onProgress?: ExportProgressCallback,
  options: ExecuteReportOptions = {}
): Promise<ReportRunResult> {
  const table = objectStore.getTable(report.sourceTableId);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  const quickbase = getQuickbaseConfigForTable(table);
  if (shouldUseLiveQuickbase(table.id, options.forceLive) && quickbase.realmHostname && quickbase.userToken && quickbase.appId) {
    const filterTree = getCombinedFilterTree(report, extraFilters);
    const filters = extractFlatPushdownFilters(filterTree);
    const requestedFieldIds = collectReportFieldIds(report);
    const { where } = buildQuickbaseWhere(filters);
    const sortBy = buildQuickbaseSort(report);
    const metricSet = report.summaryMetrics.length
      ? report.summaryMetrics
      : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
    const warnings = report.selectedFieldIds.length || !report.view.showDetails ? [] : ["This report has no selected fields."];
    const batchSize = 1000;
    let skip = 0;
    const rows: DataRow[] = [];
    const summaryAccumulator = createMetricAccumulator(metricSet);
    const chartGroups = new Map<string, { primary: number[]; secondary: number[] }>();
    let processed = 0;
    let expectedTotal = 0;

    while (true) {
      const batch = await fetchQuickbaseTablePage(quickbase, getQuickbaseTableId(table), requestedFieldIds, {
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
  return reportCache.getOrCreate(cacheKey(report, table, extraFilters), async () => {
    const rows = await getExecutionRows(table, { objectId: report.id });
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows, extraFilters });
    return {
      ...result,
      freshness: getCachedFreshness(table.id) || freshness("local-fallback")
    };
  });
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
  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    if (!reportNeedsAggregates(report)) {
      return fetchQuickbaseReportPageOnly(report, table, extraFilters, options);
    }
    return executeQuickbaseReportPage(report, table, extraFilters, options);
  }

  const key = cacheKey(report, table, extraFilters);
  const full = await reportCache.getOrCreate(key, async () => {
    const rows = await getExecutionRows(table, { objectId: report.id });
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows, extraFilters });
    return {
      ...result,
      freshness: getCachedFreshness(table.id) || freshness("local-fallback")
    };
  });
  return paginateReportResult(full, options, "full");
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
    reportShape: buildReportExecutionShape(report),
    heavy: widgetNeedsAggregates(report, widget),
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  });
}

function buildDashboardCacheKey(
  dashboard: DashboardDefinition,
  tabsToRender: DashboardDefinition["tabs"],
  runtimeValues: Record<string, string>
) {
  return JSON.stringify({
    dashboardId: dashboard.id,
    updatedAt: dashboard.updatedAt,
    runtimeFilters: Object.entries(runtimeValues || {})
      .filter(([, value]) => Boolean(value))
      .sort(([left], [right]) => left.localeCompare(right)),
    widgets: tabsToRender.flatMap((tab) =>
      tab.widgets.map((widget) => {
        const report = objectStore.resolveWidgetReport(widget);
        if (!report) {
          return {
            tabId: tab.id,
            widgetId: widget.id,
            missingReport: true
          };
        }
        const table = objectStore.getTable(report.sourceTableId);
        return {
          tabId: tab.id,
          widgetId: widget.id,
          widgetExecution: buildDashboardExecutionKey(report, widget, buildDashboardFilters(dashboard, report.id, runtimeValues, report.sourceTableId)),
          tableVersion: table ? getTableCacheVersion(table) : ""
        };
      })
    )
  });
}

async function executeDashboardUncached(
  dashboard: DashboardDefinition,
  tabsToRender: DashboardDefinition["tabs"],
  runtimeValues: Record<string, string>,
  options: ExecuteDashboardOptions = {}
) {
  const executionCache = new Map<string, Promise<ReportRunResult>>();
  const widgetJobs = tabsToRender.flatMap((tab) =>
    tab.widgets.map((widget) => ({ tab, widget }))
  );
  const widgetResults = await mapWithConcurrency(
    widgetJobs,
    DASHBOARD_WIDGET_CONCURRENCY,
    async ({ widget }) => {
        const report = objectStore.resolveWidgetReport(widget);
        if (!report) {
          const message = "Widget report not found.";
          const fallbackReport = createFallbackWidgetReport(widget, message);
          return {
            widgetId: widget.id,
            widget,
            report: fallbackReport,
            result: createEmptyReportResult(fallbackReport.id, fallbackReport.sourceTableId, message),
            status: "failed" as const,
            message,
            error: message
          };
        }
        const extraFilters = buildDashboardFilters(dashboard, report.id, runtimeValues, report.sourceTableId);
        const executionKey = buildDashboardExecutionKey(report, widget, extraFilters);
        try {
          let pending = executionCache.get(executionKey);
          if (!pending) {
            pending = (async () => {
              if (!options.forceLive && !objectStore.getRows(report.sourceTableId).length) {
                await ensureTableRowsAvailable(report.sourceTableId, { objectId: dashboard.id });
              }
              return widgetNeedsAggregates(report, widget)
                ? executeReport(report, extraFilters, { page: 1, pageSize: 100, includeRows: widgetNeedsRows(report, widget), forceLive: options.forceLive })
                : fetchReportPage(report, extraFilters, { page: 1, pageSize: 100, forceLive: options.forceLive });
            })();
            executionCache.set(executionKey, pending);
          }
          const result = await pending;
          return {
            widgetId: widget.id,
            widget,
            report,
            result,
            status: "complete" as const,
            message: result.totalRows ? `${result.totalRows} row${result.totalRows === 1 ? "" : "s"}` : "No rows returned"
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Widget failed to load.";
          return {
            widgetId: widget.id,
            widget,
            report,
            result: createEmptyReportResult(report.id, report.sourceTableId, message),
            status: "failed" as const,
            message,
            error: message
          };
        }
      }
  );

  const built = buildDashboardResult(dashboard, widgetResults);
  const successfulWidgets = widgetResults.filter((widget) => widget.status === "complete");
  const dashboardSource = successfulWidgets.length && successfulWidgets.every((widget) => widget.result.freshness?.source === "quickbase-live")
    ? "quickbase-live"
    : successfulWidgets.length && successfulWidgets.every((widget) => widget.result.freshness?.source === "scheduled-cache")
      ? "scheduled-cache"
      : "local-fallback";
  return {
    ...built,
    freshness: freshness(dashboardSource)
  };
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
  if (options.forceLive) {
    return executeDashboardUncached(dashboard, tabsToRender, runtimeValues, options);
  }
  return dashboardCache.getOrCreate(
    buildDashboardCacheKey(dashboard, tabsToRender, runtimeValues),
    () => executeDashboardUncached(dashboard, tabsToRender, runtimeValues, options)
  );
}
