import { Worker } from "node:worker_threads";
import {
  buildCombinedFilterTree,
  buildDashboardFilters,
  buildDashboardResult,
  buildMergedTableForJoins,
  collectFilterFieldIds,
  createFilterGroup,
  filterHasValue,
  formatMetricValue,
  getDefaultPercentMode,
  getChartLabel,
  getReportDecimalPlaces,
  matchesFilterNode,
  mergeJoinedRows,
  normalizeChartAggregation,
  resolveDashboardWidgetRenderMode,
  runReport,
  type ChartAggregation,
  type DashboardDefinition,
  type DashboardRunResult,
  type DataRow,
  type FieldType,
  type FilterDefinition,
  type FilterGroupDefinition,
  type DataFreshnessInfo,
  type CrosstabResult,
  type JoinInput,
  type ReportDefinition,
  type ReportRunResult,
  type SummaryDatum,
  type SummaryMetric,
  type TableDefinition,
  type WidgetDefinition
} from "@studio/shared";
import { apiConfig } from "../config/env.js";
import { ExecutionCache } from "./execution-cache.js";
import { forEachTableRowBatch, getSourceRecordSummary, loadSourceAttributes, loadTableRows, type SourceRecordSummary } from "./eav-record-store.js";
import { trySqlExecuteDurableReport, trySqlExecuteDurablePageOnly } from "./sql-report-engine.js";
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
  dashboard?: DashboardDefinition;
  reportOverrides?: Record<string, ReportDefinition>;
}

interface ExportProgressCallback {
  (progress: number, message: string): void;
}

const DATE_TOKENS = new Set(["CURRENT_MONTH", "LAST_30_DAYS", "CURRENT_YEAR"]);
const EXECUTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_WIDGET_CONCURRENCY = 1;
const reportCache = new ExecutionCache<ReportRunResult>(EXECUTION_CACHE_TTL_MS, 500);
const reportPageCache = new ExecutionCache<ReportRunResult>(EXECUTION_CACHE_TTL_MS, 1_500);
const dashboardCache = new ExecutionCache<DashboardRunResult>(EXECUTION_CACHE_TTL_MS, 200);

/**
 * Evict all cached report/dashboard results that reference the given source table IDs.
 * Call this immediately after any source is re-imported or refreshed so users
 * see fresh data on the next page load instead of waiting up to 24 hours for TTL expiry.
 */
export function invalidateSourceCaches(...sourceTableIds: string[]) {
  const ids = sourceTableIds.filter(Boolean);
  if (!ids.length) return;
  reportCache.invalidateMatching(...ids);
  reportPageCache.invalidateMatching(...ids);
  dashboardCache.invalidateMatching(...ids);
}

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

function tableSourceIds(table: TableDefinition) {
  return Array.from(new Set([table.id, table.quickbaseTableId || ""].filter(Boolean)));
}

async function getDurableCacheSummary(table: TableDefinition): Promise<SourceRecordSummary | null> {
  return getSourceRecordSummary(tableSourceIds(table));
}

async function getDurableFreshness(table: TableDefinition): Promise<DataFreshnessInfo | null> {
  const local = getCachedFreshness(table.id);
  if (local) return local;
  const summary = await getDurableCacheSummary(table);
  if (!summary || summary.rowCount <= 0) return null;
  return {
    source: "scheduled-cache",
    fetchedAt: summary.refreshedAt || summary.updatedAt || new Date().toISOString()
  };
}

async function hasDurableRows(table: TableDefinition) {
  const summary = await getDurableCacheSummary(table);
  return Boolean(summary && summary.rowCount > 0);
}

function looksLikeQuickbaseTableId(value: string) {
  const trimmed = String(value || "").trim();
  const [, quickbaseTableId = trimmed] = trimmed.split(":");
  return /^[a-z0-9]{8,}$/i.test(quickbaseTableId || trimmed);
}

function shouldUseLiveQuickbase(tableId: string, forceLive = false) {
  if (!forceLive) return false;
  if (!looksLikeQuickbaseTableId(tableId)) return false;
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

function inferFieldType(value: unknown): FieldType {
  if (Array.isArray(value)) return "multiselect";
  if (value === null || value === undefined || value === "") return "text";
  if (typeof value === "number") return "number";
  const text = String(value).trim();
  if (!text) return "text";
  if (Number.isFinite(Number(text))) {
    return text.includes(".") || text.includes(",") || text.startsWith("$") ? "currency" : "number";
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return /t/i.test(text) || /\d:\d/.test(text) ? "datetime" : "date";
  }
  return "text";
}

function inferFieldTypeFromRows(fieldId: string, rows: DataRow[]): FieldType {
  for (const row of rows) {
    const value = row[fieldId];
    if (value === null || value === undefined || value === "") continue;
    return inferFieldType(value);
  }
  return "text";
}

function buildSyntheticTableForReport(report: ReportDefinition, requiredFieldIds: string[] = []): TableDefinition | null {
  const rows = objectStore.getRows(report.sourceTableId);
  const cacheMeta = studioStore.getCacheMeta(report.sourceTableId);
  if (!rows.length && !cacheMeta) return null;
  const fieldIds = Array.from(new Set([
    ...collectReportFieldIds(report, requiredFieldIds.map((fieldId) => ({
      id: `synthetic-${fieldId}`,
      fieldId,
      operator: "equals",
      value: ""
    }))),
    ...requiredFieldIds
  ].filter(Boolean).map(String)));
  return {
    id: report.sourceTableId,
    quickbaseTableId: report.sourceTableId,
    name: report.sourceTableId,
    description: "Synthesized source table definition",
    fields: fieldIds.map((fieldId) => ({
      id: fieldId,
      label: report.displayLabels?.fields?.[fieldId]?.trim() || fieldId,
      type: inferFieldTypeFromRows(fieldId, rows)
    }))
  };
}

function resolveExecutionTableSync(report: ReportDefinition, requiredFieldIds: string[] = []): TableDefinition | null {
  const primary = objectStore.getTable(report.sourceTableId) || buildSyntheticTableForReport(report, requiredFieldIds);
  if (!primary || !report.sourceJoins?.length) return primary;
  const joinTables = report.sourceJoins
    .map((join) => objectStore.getTable(join.sourceTableId))
    .filter((t): t is TableDefinition => Boolean(t));
  return joinTables.length ? buildMergedTableForJoins(primary, report.sourceJoins, joinTables) : primary;
}

async function buildTableFromPostgres(sourceTableId: string): Promise<TableDefinition | null> {
  const summary = await getSourceRecordSummary([sourceTableId]).catch(() => null);
  if (!summary) return null;
  const fields = await loadSourceAttributes(sourceTableId).catch(() => []);
  return {
    id: summary.sourceId,
    name: summary.sourceName || summary.sourceId,
    description: "",
    fields: fields.length ? fields : [],
    quickbaseTableId: "",
    quickbaseProfileId: "",
    quickbaseAppId: ""
  };
}

async function resolveExecutionTable(report: ReportDefinition, extraFilters: FilterDefinition[] = []): Promise<TableDefinition | null> {
  const requiredFieldIds = collectReportFieldIds(report, extraFilters);
  const existing = resolveExecutionTableSync(report, requiredFieldIds);
  if (existing) return existing;
  // Fallback: check Postgres for xlsx/durable sources not yet in the bundle
  const pgTable = await buildTableFromPostgres(report.sourceTableId);
  if (pgTable) return pgTable;
  // Last resort: QB hydration
  await studioStore.hydrateFromQuickbase();
  return resolveExecutionTableSync(report, requiredFieldIds);
}

function collectReportFieldIds(report: ReportDefinition, extraFilters: FilterDefinition[] = []) {
  const view = report.view || {};
  return Array.from(new Set(
    [
      ...(report.selectedFieldIds || []),
      ...collectFilterFieldIds(report.filterTree || createFilterGroup("and", report.filters || [])),
      ...(extraFilters || []).map((filter) => filter.fieldId),
      ...(report.groups || []).map((item) => item.fieldId),
      ...(report.sorts || []).map((item) => item.fieldId),
      ...((report.summaryMetrics || []).map((item) => item.fieldId)),
      view.chartFieldId,
      view.chartSeriesFieldId,
      view.chartValueFieldId,
      view.chartSecondaryValueFieldId,
      view.timelineDateField,
      view.timelineEndField,
      view.calendarDateField,
      view.kanbanField,
      view.titleFieldId
    ].filter(Boolean).map(String)
  ));
}

function getReportFieldDisplayLabel(report: ReportDefinition, table: TableDefinition, fieldId: string) {
  const tableField = table.fields.find((field) => field.id === fieldId);
  return report.displayLabels?.fields?.[fieldId]?.trim() || tableField?.label || fieldId;
}

function collectMissingReportFieldWarnings(report: ReportDefinition, table: TableDefinition, rows: DataRow[] = []) {
  const warnings: string[] = [];
  const knownFieldIds = new Set(table.fields.map((field) => String(field.id)));
  const referencedFieldIds = collectReportFieldIds(report);
  const missingFromDefinition = referencedFieldIds.filter((fieldId) => !knownFieldIds.has(String(fieldId)));
  missingFromDefinition.forEach((fieldId) => {
    // If we have row data available, check whether the field actually exists in the rows before warning.
    // The table.fields metadata may be incomplete (e.g. xlsx imports), but the data itself is correct.
    if (rows.length && rows.some((row) => rowHasField(row, fieldId))) return;
    const label = getReportFieldDisplayLabel(report, table, fieldId);
    warnings.push(`Field "${label}" (${fieldId}) is used by this report but was not found in the source table.`);
  });
  if (rows.length) {
    referencedFieldIds
      .filter((fieldId) => knownFieldIds.has(String(fieldId)))
      .filter((fieldId) => rows.every((row) => !rowHasField(row, fieldId)))
      .forEach((fieldId) => {
        const label = getReportFieldDisplayLabel(report, table, fieldId);
        warnings.push(`Field "${label}" (${fieldId}) is defined in the table but has no data in the source rows.`);
      });
  }
  return Array.from(new Set(warnings));
}

function baseReportWarnings(report: ReportDefinition) {
  return report.selectedFieldIds.length || !report.view.showDetails ? [] : ["This report has no selected fields."];
}

function mergeWarnings(...groups: Array<string[] | undefined>) {
  return Array.from(new Set(groups.flatMap((group) => group || []).filter(Boolean)));
}

function isMissingFieldExecutionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return normalized.includes("unknown field")
    || normalized.includes("field not found")
    || normalized.includes("no such field")
    || normalized.includes("invalid field")
    || normalized.includes("invalid select option");
}

function createMissingFieldWarningResult(
  report: ReportDefinition,
  table: TableDefinition,
  source: DataFreshnessInfo["source"] = "quickbase-live"
) {
  const warnings = mergeWarnings(
    baseReportWarnings(report),
    collectMissingReportFieldWarnings(report, table),
    [`One or more fields used by this report are no longer available from Quickbase. Update the report fields or the Quickbase source report, then refresh again.`]
  );
  return {
    ...createEmptyReportResult(report.id, table.id, "", source),
    warnings
  };
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function rowHasField(row: DataRow, fieldId: string) {
  return Object.prototype.hasOwnProperty.call(row, fieldId);
}

function isInvalidStringLengthError(error: unknown) {
  return error instanceof RangeError && error.message.includes("Invalid string length");
}

function flushExpandedRowsDocument(document: ReturnType<typeof studioStore.getDocument>) {
  try {
    studioStore.flushDocument(document, { markSavedAt: false });
  } catch (error) {
    if (!isInvalidStringLengthError(error)) {
      throw error;
    }
  }
}

async function ensureRowsContainRequiredFields(
  table: TableDefinition,
  rows: DataRow[],
  requiredFieldIds: string[]
) {
  if (!rows.length || !requiredFieldIds.length) return rows;

  const missingFieldIds = Array.from(new Set(requiredFieldIds.filter(Boolean).map(String))).filter((fieldId) => (
    rows.some((row) => !rowHasField(row, fieldId))
  ));
  if (!missingFieldIds.length) return rows;

  const quickbase = getQuickbaseConfigForTable(table);
  if (!quickbase.realmHostname || !quickbase.userToken || !quickbase.appId) {
    return rows;
  }

  const rowsByRecordId = new Map<string, DataRow>();
  rows.forEach((row) => {
    const recordId = String(row.__recordId || "").trim();
    if (recordId) {
      rowsByRecordId.set(recordId, row);
    }
  });
  if (!rowsByRecordId.size) return rows;

  const fieldChunks = chunk(missingFieldIds, 29);
  for (const fieldChunk of fieldChunks) {
    let skip = 0;
    while (true) {
      const page = await fetchQuickbaseTablePage(quickbase, getQuickbaseTableId(table), fieldChunk, {
        top: 1000,
        skip,
        sortBy: [{ fieldId: "3", order: "ASC" }]
      });
      if (!page.rows.length) break;
      page.rows.forEach((row) => {
        const recordId = String(row.__recordId || "").trim();
        if (!recordId) return;
        const existing = rowsByRecordId.get(recordId);
        if (!existing) return;
        fieldChunk.forEach((fieldId) => {
          existing[fieldId] = row[fieldId];
        });
      });
      if (page.rows.length < 1000) break;
      skip += page.rows.length;
    }
  }

  const document = studioStore.getDocument();
  document.bundle.data[table.id] = rows;
  if (table.quickbaseTableId) {
    document.bundle.data[table.quickbaseTableId] = rows;
  }
  flushExpandedRowsDocument(document);
  return rows;
}

async function loadPrimaryRows(
  table: TableDefinition,
  options: { objectId?: string; requiredFieldIds?: string[] } = {}
): Promise<DataRow[]> {
  // 1. In-memory cache — instant after first load
  const existingRows = objectStore.getRows(table.id);
  if (existingRows.length) {
    return ensureRowsContainRequiredFields(table, existingRows, options.requiredFieldIds || []);
  }
  // 2. Load ALL rows from Postgres using batched cursor (no row-count cap)
  const allRows: DataRow[] = [];
  const summary = await forEachTableRowBatch(table, (batch) => { allRows.push(...batch); }).catch(() => null);
  if (summary && allRows.length) {
    // Warm the in-memory cache so subsequent report/dashboard renders in this process are instant
    studioStore.setCachedRowsForTable(table.id, allRows);
    return ensureRowsContainRequiredFields(table, allRows, options.requiredFieldIds || []);
  }
  // 3. QB fallback — only reached when the table has no Postgres rows at all
  const rows = await ensureTableRowsAvailable(table.id, options);
  return ensureRowsContainRequiredFields(table, rows, options.requiredFieldIds || []);
}

async function getExecutionRows(
  table: TableDefinition,
  options: { objectId?: string; requiredFieldIds?: string[] } = {},
  report?: Pick<ReportDefinition, "sourceTableId" | "sourceJoins">
): Promise<DataRow[]> {
  // Always load against the PRIMARY table ID (not the merged table's synthetic ID)
  const primaryTableId = report?.sourceTableId || table.id;
  const primaryTable = objectStore.getTable(primaryTableId) || table;
  const primaryRows = await loadPrimaryRows(primaryTable, options);

  if (!report?.sourceJoins?.length) return primaryRows;

  // Load each secondary source and build join inputs
  const joinInputs: JoinInput[] = [];
  for (const join of report.sourceJoins) {
    const joinTable = objectStore.getTable(join.sourceTableId);
    if (!joinTable) continue;
    const inMemory = objectStore.getRows(join.sourceTableId);
    if (inMemory.length) {
      joinInputs.push({ join, table: joinTable, rows: inMemory });
      continue;
    }
    const durable = await loadTableRows(joinTable, apiConfig.postgres.legacyRowLoadLimit);
    joinInputs.push({ join, table: joinTable, rows: durable });
  }

  return joinInputs.length ? mergeJoinedRows(primaryRows, joinInputs) : primaryRows;
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
  const view = report.view || {} as ReportDefinition["view"];
  return {
    sourceTableId: report.sourceTableId,
    selectedFieldIds: report.selectedFieldIds || [],
    filters: (report.filters || []).map((filter) => [filter.fieldId, filter.operator, filter.value]),
    filterTree: report.filterTree || null,
    groups: (report.groups || []).map((group) => group.fieldId),
    sorts: (report.sorts || []).map((sort) => [sort.fieldId, sort.direction]),
    summaryMetrics: (report.summaryMetrics || []).map((metric) => [metric.fieldId, metric.op, metric.label]),
    view: {
      mode: view.mode,
      showChartInTable: view.showChartInTable,
      showSummary: view.showSummary,
      showDetails: view.showDetails,
      chartType: view.chartType,
      chartOrientation: view.chartOrientation,
      chartFieldId: view.chartFieldId,
      chartSeriesFieldId: view.chartSeriesFieldId,
      chartValueFieldId: view.chartValueFieldId,
      chartAggregation: view.chartAggregation,
      chartSecondaryValueFieldId: view.chartSecondaryValueFieldId,
      chartSecondaryAggregation: view.chartSecondaryAggregation,
      chartUseSecondaryAxis: view.chartUseSecondaryAxis,
      chartSecondarySeriesType: view.chartSecondarySeriesType,
      chartTopN: view.chartTopN,
      chartSort: view.chartSort,
      timelineDateField: view.timelineDateField,
      timelineEndField: view.timelineEndField,
      calendarDateField: view.calendarDateField,
      kanbanField: view.kanbanField,
      titleFieldId: view.titleFieldId
    }
  };
}

function safeExecutionKey(value: unknown, fallback: Record<string, unknown>) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    if (error instanceof RangeError) {
      return JSON.stringify({
        ...fallback,
        cacheKeyFallback: true,
        reason: error.message
      });
    }
    throw error;
  }
}

function cacheKey(report: ReportDefinition, table: TableDefinition, extraFilters: FilterDefinition[]): string {
  return safeExecutionKey({
    reportId: report.id,
    updatedAt: report.updatedAt,
    reportShape: buildReportExecutionShape(report),
    tableVersion: getTableCacheVersion(table),
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  }, {
    reportId: report.id,
    updatedAt: report.updatedAt,
    tableId: table.id,
    tableVersion: getTableCacheVersion(table),
    filterCount: extraFilters.length
  });
}

function pageCacheKey(report: ReportDefinition, table: TableDefinition, extraFilters: FilterDefinition[], options: ExecuteReportOptions): string {
  const normalized = normalizePageOptions(options);
  return safeExecutionKey({
    key: cacheKey(report, table, extraFilters),
    page: normalized.page,
    pageSize: normalized.pageSize,
    includeRows: normalized.includeRows,
    mode: "page-only"
  }, {
    reportId: report.id,
    tableId: table.id,
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
    if (filter.valueSource === "field" && filter.compareFieldId) {
      unsupported.push(filter);
      return;
    }
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
    sharedUserIds: [],
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
      showDetails: false,
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
      chartValueColors: {},
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

// Trim rows to only the fields a report actually references before handing to a Worker.
// Worker threads receive rows via structured clone (full copy), so passing 38-field rows
// when a chart only needs 3 fields wastes 12x memory during serialization.
function slimRowsForWorker(rows: DataRow[], report: ReportDefinition, extraFilters: FilterDefinition[]): DataRow[] {
  const needed = new Set(collectReportFieldIds(report, extraFilters));
  return rows.map((row) => {
    const slim: DataRow = {};
    for (const key of needed) {
      slim[key] = row[key] ?? "";
    }
    if (row.__recordId !== undefined) slim.__recordId = row.__recordId;
    return slim;
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
  const warnings = mergeWarnings(baseReportWarnings(report), collectMissingReportFieldWarnings(report, table, rows));
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

async function executeDurableReportPageOnly(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: ExecuteReportOptions
): Promise<ReportRunResult | null> {
  const normalized = normalizePageOptions(options);
  const { page, pageSize, includeRows, startIndex, endIndexExclusive } = normalized;
  const durableFreshness = await getDurableFreshness(table);
  const fresh = durableFreshness || freshness("local-fallback");

  // Try SQL-native first — supports sorts natively, instant for any dataset size
  const sqlResult = await trySqlExecuteDurablePageOnly(report, table, extraFilters, normalized, fresh);
  if (sqlResult) return sqlResult;

  // Fallback: cursor-based in-memory execution (no sorts supported here)
  if (report.sourceJoins?.length) return null;
  if (report.sorts.length) return null;
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const pageRows: DataRow[] = [];
  const sampleRows: DataRow[] = [];
  let totalRows = 0;
  const summary = await forEachTableRowBatch(table, (rows) => {
    rows.forEach((row) => {
      if (sampleRows.length < 50) sampleRows.push(row);
      if (filterTree && !matchesFilterNode(row, filterTree)) return;
      if (includeRows && totalRows >= startIndex && totalRows < endIndexExclusive) {
        pageRows.push(row);
      }
      totalRows += 1;
    });
  });
  if (!summary) return null;
  return {
    reportId: report.id,
    tableId: table.id,
    totalRows,
    rows: includeRows ? projectRows(report, pageRows) : [],
    summary: [],
    chartData: [],
    warnings: mergeWarnings(baseReportWarnings(report), collectMissingReportFieldWarnings(report, table, sampleRows)),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    hasNextPage: includeRows ? page * pageSize < totalRows : false,
    freshness: fresh
  };
}

async function executeDurableReport(
  report: ReportDefinition,
  table: TableDefinition,
  extraFilters: FilterDefinition[],
  options: ExecuteReportOptions = {}
): Promise<ReportRunResult | null> {
  const normalized = normalizePageOptions(options);
  const { page, pageSize, includeRows, startIndex, endIndexExclusive } = normalized;
  const durableFreshness = await getDurableFreshness(table);
  const fresh = durableFreshness || freshness("local-fallback");

  // Try SQL-native execution first — instant for any dataset size
  const sqlResult = await trySqlExecuteDurableReport(report, table, extraFilters, normalized, fresh);
  if (sqlResult) return sqlResult;

  // Fallback: cursor-based in-memory execution
  if (report.sourceJoins?.length) return null;
  if (includeRows && report.sorts.length) return null;
  const filterTree = getCombinedFilterTree(report, extraFilters);
  const metricSet = report.summaryMetrics.length
    ? report.summaryMetrics
    : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
  const summaryAccumulator = createMetricAccumulator(metricSet);
  const chartGroups = new Map<string, { primary: number[]; secondary: number[] }>();
  const groupFieldId = report.groups[0]?.fieldId;
  const crosstabGroups = groupFieldId ? new Map<string, ReturnType<typeof createMetricAccumulator>>() : null;
  const pageRows: DataRow[] = [];
  const sampleRows: DataRow[] = [];
  let totalRows = 0;
  const summary = await forEachTableRowBatch(table, (rows) => {
    rows.forEach((row) => {
      if (sampleRows.length < 50) sampleRows.push(row);
      if (filterTree && !matchesFilterNode(row, filterTree)) return;
      addMetricRow(summaryAccumulator, row);
      addChartRow(chartGroups, report, row);
      if (crosstabGroups && groupFieldId) {
        const groupValue = String(row[groupFieldId] ?? "");
        if (!crosstabGroups.has(groupValue)) crosstabGroups.set(groupValue, createMetricAccumulator(metricSet));
        addMetricRow(crosstabGroups.get(groupValue)!, row);
      }
      if (includeRows && totalRows >= startIndex && totalRows < endIndexExclusive) {
        pageRows.push(row);
      }
      totalRows += 1;
    });
  });
  if (!summary) return null;
  const decimalPlaces = getReportDecimalPlaces(report);
  const crosstab: CrosstabResult | undefined = crosstabGroups
    ? (() => {
        const sortedKeys = Array.from(crosstabGroups.keys()).sort((a, b) => {
          const numA = parseInt(a, 10);
          const numB = parseInt(b, 10);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.localeCompare(b, undefined, { numeric: true });
        });
        const columns = [...sortedKeys, "Grand Total"];
        const grandAccum = finalizeMetricAccumulator(summaryAccumulator, decimalPlaces);
        const rows = metricSet.map((metric, i) => {
          const values = sortedKeys.map((k) => {
            const acc = finalizeMetricAccumulator(crosstabGroups.get(k)!, decimalPlaces);
            return acc[i]?.numericValue ?? 0;
          });
          const grandTotal = grandAccum[i]?.numericValue ?? 0;
          const allValues = [...values, grandTotal];
          return {
            label: metric.label || metric.op,
            values: allValues,
            formatted: allValues.map((v) => formatMetricValue(v, metric.op, decimalPlaces))
          };
        });
        return { columns, rows };
      })()
    : undefined;
  return {
    reportId: report.id,
    tableId: table.id,
    totalRows,
    rows: includeRows ? projectRows(report, pageRows) : [],
    summary: finalizeMetricAccumulator(summaryAccumulator, decimalPlaces),
    crosstab,
    chartData: buildChartResult(chartGroups, report),
    warnings: mergeWarnings(baseReportWarnings(report), collectMissingReportFieldWarnings(report, table, sampleRows)),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    hasNextPage: includeRows ? page * pageSize < totalRows : false,
    freshness: fresh
  };
}

function aggregateChartValues(values: number[], aggregation: ChartAggregation) {
  const normalizedAggregation = normalizeChartAggregation(aggregation);
  if (normalizedAggregation === "count") return values.length;
  if (!values.length) return 0;
  if (normalizedAggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (normalizedAggregation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (normalizedAggregation === "min") return Math.min(...values);
  if (normalizedAggregation === "percent") return values.reduce((sum, value) => sum + value, 0);
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
  const aggregation = normalizeChartAggregation(report.view.chartAggregation || "count");
  const secondaryEnabled = report.view.chartUseSecondaryAxis && Boolean(report.view.chartSecondaryValueFieldId);
  const secondaryAggregation = normalizeChartAggregation(report.view.chartSecondaryAggregation || "sum");
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
  const percentMode = report.view.chartPercentMode || getDefaultPercentMode(report.view.chartType);
  if (aggregation === "percent") {
    const primaryEntries = Array.from(groupedByCategory.values()).flatMap((entries) => entries.filter((entry) => entry.axis === "primary"));
    const primaryTotal = primaryEntries.reduce((sum, entry) => sum + entry.value, 0) || 1;
    groupedByCategory.forEach((entries) => {
      const groupTotal = entries.filter((entry) => entry.axis === "primary").reduce((sum, entry) => sum + entry.value, 0) || 1;
      entries.forEach((entry) => {
        if (entry.axis !== "primary") return;
        const denominator = percentMode === "percent_of_stack" || percentMode === "percent_of_group" ? groupTotal : primaryTotal;
        entry.value = denominator ? (entry.value / denominator) * 100 : 0;
      });
    });
  }
  if (secondaryEnabled && secondaryAggregation === "percent") {
    const secondaryEntries = Array.from(groupedByCategory.values()).flatMap((entries) => entries.filter((entry) => entry.axis === "secondary"));
    const secondaryTotal = secondaryEntries.reduce((sum, entry) => sum + entry.value, 0) || 1;
    groupedByCategory.forEach((entries) => {
      const groupTotal = entries.filter((entry) => entry.axis === "secondary").reduce((sum, entry) => sum + entry.value, 0) || 1;
      entries.forEach((entry) => {
        if (entry.axis !== "secondary") return;
        const denominator = percentMode === "percent_of_stack" || percentMode === "percent_of_group" ? groupTotal : secondaryTotal;
        entry.value = denominator ? (entry.value / denominator) * 100 : 0;
      });
    });
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
  const aggregation = normalizeChartAggregation(report.view.chartAggregation || "count");
  const valueFieldId = report.view.chartValueFieldId || "";
  const secondaryValueFieldId = report.view.chartUseSecondaryAxis ? (report.view.chartSecondaryValueFieldId || "") : "";
  const secondaryAggregation = normalizeChartAggregation(report.view.chartSecondaryAggregation || "sum");
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
  const requestedFieldIds = collectReportFieldIds(report, extraFilters);
  const warnings = mergeWarnings(baseReportWarnings(report), collectMissingReportFieldWarnings(report, table));
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
  const requestedFieldIds = collectReportFieldIds(report, extraFilters);
  const metricSet = report.summaryMetrics.length
    ? report.summaryMetrics
    : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
  const warnings = mergeWarnings(baseReportWarnings(report), collectMissingReportFieldWarnings(report, table));
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
  const table = await resolveExecutionTable(report, extraFilters);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    return executeQuickbaseReportPage(report, table, extraFilters, options).catch(async (error) => {
      if (isMissingFieldExecutionError(error)) {
        return createMissingFieldWarningResult(report, table);
      }
      const rows = await getExecutionRows(table, { objectId: report.id, requiredFieldIds: collectReportFieldIds(report, extraFilters) }, report);
      const full = runReport(report, table, rows, extraFilters);
      const cachedFreshness = await getDurableFreshness(table);
      return paginateReportResult({
        ...full,
        freshness: cachedFreshness || freshness("local-fallback")
      }, options, "full");
    });
  }

  const full = await reportCache.getOrCreate(cacheKey(report, table, extraFilters), async () => {
    const durable = await executeDurableReport(report, table, extraFilters, options);
    if (durable) return durable;
    const rows = await getExecutionRows(table, { objectId: report.id, requiredFieldIds: collectReportFieldIds(report, extraFilters) }, report);
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows: slimRowsForWorker(rows, report, extraFilters), extraFilters });
    return {
      ...result,
      warnings: mergeWarnings(result.warnings, collectMissingReportFieldWarnings(report, table, rows)),
      freshness: await getDurableFreshness(table) || freshness("local-fallback")
    };
  });
  return paginateReportResult(full, options, "full");
}

function ensureReportView(report: ReportDefinition): ReportDefinition {
  if (report.view) return report;
  return {
    ...report,
    view: {
      mode: "table",
      showChartInTable: false,
      showSummary: false,
      showDetails: false,
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
      chartColors: [],
      chartValueColors: {},
      chartShowLegend: true,
      chartShowValues: true,
      chartXAxisLabel: "",
      chartYAxisLabel: "",
      chartSecondaryYAxisLabel: "",
      timelineDateField: "",
      timelineEndField: "",
      calendarDateField: "",
      kanbanField: "",
      titleFieldId: "",
      chartPercentMode: undefined,
      chartBarDirection: undefined
    } as ReportDefinition["view"]
  };
}

export async function fetchReportPage(report: ReportDefinition, extraFilters: FilterDefinition[] = [], options: ExecuteReportOptions = {}): Promise<ReportRunResult> {
  report = ensureReportView(report);
  const table = await resolveExecutionTable(report, extraFilters);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    return fetchQuickbaseReportPageOnly(report, table, extraFilters, options).catch((error) => {
      if (isMissingFieldExecutionError(error)) {
        return createMissingFieldWarningResult(report, table);
      }
      throw error;
    });
  }

  if (!reportNeedsAggregates(report)) {
    return reportPageCache.getOrCreate(pageCacheKey(report, table, extraFilters, options), async () => {
      const durable = await executeDurableReportPageOnly(report, table, extraFilters, options);
      if (durable) return durable;
      const rows = await getExecutionRows(table, { objectId: report.id, requiredFieldIds: collectReportFieldIds(report, extraFilters) }, report);
      const local = executeLocalReportPageOnly(report, table, rows, extraFilters, options);
      return {
        ...local,
        freshness: await getDurableFreshness(table) || local.freshness
      };
    });
  }

  const full = await reportCache.getOrCreate(cacheKey(report, table, extraFilters), async () => {
    const durable = await executeDurableReport(report, table, extraFilters, options);
    if (durable) return durable;
    const rows = await getExecutionRows(table, { objectId: report.id, requiredFieldIds: collectReportFieldIds(report, extraFilters) }, report);
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows: slimRowsForWorker(rows, report, extraFilters), extraFilters });
    return {
      ...result,
      warnings: mergeWarnings(result.warnings, collectMissingReportFieldWarnings(report, table, rows)),
      freshness: await getDurableFreshness(table) || freshness("local-fallback")
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
  report = ensureReportView(report);
  const table = await resolveExecutionTable(report, extraFilters);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }

  const quickbase = getQuickbaseConfigForTable(table);
  if (shouldUseLiveQuickbase(table.id, options.forceLive) && quickbase.realmHostname && quickbase.userToken && quickbase.appId) {
    try {
      const filterTree = getCombinedFilterTree(report, extraFilters);
      const filters = extractFlatPushdownFilters(filterTree);
      const requestedFieldIds = collectReportFieldIds(report, extraFilters);
      const { where } = buildQuickbaseWhere(filters);
      const sortBy = buildQuickbaseSort(report);
      const metricSet = report.summaryMetrics.length
        ? report.summaryMetrics
        : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
      const warnings = mergeWarnings(baseReportWarnings(report), collectMissingReportFieldWarnings(report, table));
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
    } catch (error) {
      if (isMissingFieldExecutionError(error)) {
        return createMissingFieldWarningResult(report, table);
      }
      throw error;
    }
  }

  onProgress?.(68, "Preparing export data");
  return reportCache.getOrCreate(cacheKey(report, table, extraFilters), async () => {
    const rows = await getExecutionRows(table, { objectId: report.id, requiredFieldIds: collectReportFieldIds(report, extraFilters) }, report);
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows: slimRowsForWorker(rows, report, extraFilters), extraFilters });
    return {
      ...result,
      warnings: mergeWarnings(result.warnings, collectMissingReportFieldWarnings(report, table, rows)),
      freshness: await getDurableFreshness(table) || freshness("local-fallback")
    };
  });
}

export async function fetchAllReportRowsForExport(report: ReportDefinition, extraFilters: FilterDefinition[] = []): Promise<DataRow[]> {
  const result = await fetchReportExportBundle(report, extraFilters);
  return result.rows;
}

export async function executeReport(report: ReportDefinition, extraFilters: FilterDefinition[] = [], options: ExecuteReportOptions = {}): Promise<ReportRunResult> {
  const table = await resolveExecutionTable(report, extraFilters);
  if (!table) {
    throw new Error("Table not found for report " + report.id + ".");
  }
  if (shouldUseLiveQuickbase(table.id, options.forceLive)) {
    if (!reportNeedsAggregates(report)) {
      return fetchQuickbaseReportPageOnly(report, table, extraFilters, options).catch((error) => {
        if (isMissingFieldExecutionError(error)) {
          return createMissingFieldWarningResult(report, table);
        }
        throw error;
      });
    }
    return executeQuickbaseReportPage(report, table, extraFilters, options).catch((error) => {
      if (isMissingFieldExecutionError(error)) {
        return createMissingFieldWarningResult(report, table);
      }
      throw error;
    });
  }

  const key = cacheKey(report, table, extraFilters);
  const full = await reportCache.getOrCreate(key, async () => {
    // Always cache with rows included so later includeRows:true calls don't get empty results.
    // paginateReportResult handles the final includeRows filtering for the caller.
    const durable = await executeDurableReport(report, table, extraFilters, { ...options, includeRows: true });
    if (durable) return durable;
    const rows = await getExecutionRows(table, { objectId: report.id, requiredFieldIds: collectReportFieldIds(report, extraFilters) }, report);
    const result = rows.length <= 1500
      ? runReport(report, table, rows, extraFilters)
      : await runReportWorker({ report, table, rows: slimRowsForWorker(rows, report, extraFilters), extraFilters });
    return {
      ...result,
      warnings: mergeWarnings(result.warnings, collectMissingReportFieldWarnings(report, table, rows)),
      freshness: await getDurableFreshness(table) || freshness("local-fallback")
    };
  });
  return paginateReportResult(full, options, "full");
}

function resolveDashboardWidgetDisplayMode(report: ReportDefinition, widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"]) {
  return resolveDashboardWidgetRenderMode(widget, report.view.mode);
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
  return safeExecutionKey({
    reportId: report.id,
    updatedAt: report.updatedAt,
    reportShape: buildReportExecutionShape(report),
    heavy: widgetNeedsAggregates(report, widget),
    rows: widgetNeedsRows(report, widget),
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  }, {
    reportId: report.id,
    updatedAt: report.updatedAt,
    widgetId: widget.id,
    heavy: widgetNeedsAggregates(report, widget),
    rows: widgetNeedsRows(report, widget),
    filterCount: extraFilters.length
  });
}

function buildDashboardCacheKey(
  dashboard: DashboardDefinition,
  tabsToRender: DashboardDefinition["tabs"],
  runtimeValues: Record<string, string>
) {
  return safeExecutionKey({
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
        const table = resolveExecutionTableSync(report);
        return {
          tabId: tab.id,
          widgetId: widget.id,
          widgetExecution: buildDashboardExecutionKey(report, widget, buildDashboardFilters(dashboard, report.id, runtimeValues, report.sourceTableId)),
          tableVersion: table ? getTableCacheVersion(table) : ""
        };
      })
    )
  }, {
    dashboardId: dashboard.id,
    updatedAt: dashboard.updatedAt,
    tabCount: tabsToRender.length,
    widgetCount: tabsToRender.reduce((sum, tab) => sum + tab.widgets.length, 0),
    runtimeFilterCount: Object.keys(runtimeValues || {}).length
  });
}

async function executeDashboardUncached(
  dashboard: DashboardDefinition,
  tabsToRender: DashboardDefinition["tabs"],
  runtimeValues: Record<string, string>,
  options: ExecuteDashboardOptions = {}
) {
  // Pre-load all unique source tables ONCE before concurrent widget execution.
  // Without this, concurrent widgets that share a source table each try to load
  // all rows simultaneously, causing OOM crashes on large datasets (e.g. 46k rows).
  // After the pre-load, objectStore cache hits are instant for all subsequent widgets.
  const resolveReport = (widget: WidgetDefinition): ReportDefinition | undefined => {
    const fromStore = objectStore.resolveWidgetReport(widget);
    if (fromStore) return fromStore;
    if (options.reportOverrides && widget.reportId && options.reportOverrides[widget.reportId]) {
      return options.reportOverrides[widget.reportId];
    }
    return undefined;
  };

  if (!options.forceLive) {
    const uniqueTableIds = new Set<string>();
    for (const tab of tabsToRender) {
      for (const widget of tab.widgets) {
        const rep = resolveReport(widget);
        if (rep?.sourceTableId) uniqueTableIds.add(rep.sourceTableId);
      }
    }
    for (const tableId of uniqueTableIds) {
      if (!objectStore.getRows(tableId).length) {
        const table = objectStore.getTable(tableId);
        if (table) await loadPrimaryRows(table, { objectId: dashboard.id }).catch(() => null);
      }
    }
  }

  const executionCache = new Map<string, Promise<ReportRunResult>>();
  const widgetJobs = tabsToRender.flatMap((tab) =>
    tab.widgets.map((widget) => ({ tab, widget }))
  );
  const widgetResults = await mapWithConcurrency(
    widgetJobs,
    DASHBOARD_WIDGET_CONCURRENCY,
    async ({ widget }) => {
        const report = resolveReport(widget);
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
                const table = await resolveExecutionTable(report, extraFilters);
                if (!table || !(await hasDurableRows(table))) {
                  await ensureTableRowsAvailable(report.sourceTableId, { objectId: dashboard.id });
                }
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
  const dashboard = options.dashboard?.id === dashboardId
    ? options.dashboard
    : objectStore.getDashboard(dashboardId);
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
