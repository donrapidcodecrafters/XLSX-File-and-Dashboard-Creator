import type {
  ChartDatum,
  ChartSortMode,
  DashboardDefinition,
  DashboardRunResult,
  DashboardWidgetResult,
  ChartAggregation,
  DataRow,
  FieldDefinition,
  FilterDefinition,
  FilterGroupDefinition,
  FilterJoinOperator,
  FilterNodeDefinition,
  FilterOperator,
  ReportDefinition,
  ReportRunResult,
  SummaryDatum,
  SummaryMetric,
  TableDefinition
} from "./models.js";

const DATE_TOKENS = new Set(["CURRENT_MONTH", "LAST_30_DAYS", "CURRENT_YEAR"]);

function getField(table: TableDefinition, fieldId: string): FieldDefinition | undefined {
  return table.fields.find((field) => field.id === fieldId);
}

export function getReportDecimalPlaces(report: Pick<ReportDefinition, "view">): number {
  const value = Number(report.view.decimalPlaces);
  if (!Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(6, Math.round(value)));
}

export function formatNumericValue(value: number, decimalPlaces = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  }).format(safe);
}

export function formatMetricValue(value: number, metricOp: SummaryMetric["op"], decimalPlaces = 2): string {
  if (metricOp === "count") return formatNumericValue(value, 0);
  return formatNumericValue(value, decimalPlaces);
}

export function formatReportCellValue(
  report: Pick<ReportDefinition, "view">,
  table: TableDefinition,
  fieldId: string,
  value: unknown
): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "";
  const field = getField(table, fieldId);
  if (field && (field.type === "number" || field.type === "currency")) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return formatNumericValue(numeric, getReportDecimalPlaces(report));
    }
  }
  return String(value);
}

function isFilterGroup(node: FilterNodeDefinition): node is FilterGroupDefinition {
  return (node as FilterGroupDefinition).type === "group";
}

export function getReportFieldLabel(report: ReportDefinition, table: TableDefinition, fieldId: string): string {
  return report.displayLabels?.fields?.[fieldId]?.trim() || getField(table, fieldId)?.label || fieldId;
}

export function getChartLabel(report: ReportDefinition, label: string): string {
  return report.displayLabels?.chartValues?.[label]?.trim() || label;
}

export function filterNeedsValue(operator: FilterOperator): boolean {
  return operator !== "blank" && operator !== "not-blank";
}

export function filterHasValue(filter: FilterDefinition): boolean {
  if (!filterNeedsValue(filter.operator)) return true;
  if (filter.valueSource === "field") return Boolean(String(filter.compareFieldId ?? "").trim());
  return Boolean(String(filter.value ?? "").trim());
}

export function createFilterGroup(join: FilterJoinOperator = "and", conditions: FilterNodeDefinition[] = []): FilterGroupDefinition {
  return {
    id: `filter-group-${Math.random().toString(36).slice(2, 10)}`,
    type: "group",
    join,
    conditions
  };
}

export function createFilterRule(fieldId = "", operator: FilterOperator = "equals", value = ""): FilterDefinition {
  return {
    id: `filter-${Math.random().toString(36).slice(2, 10)}`,
    fieldId,
    operator,
    value,
    valueSource: "literal",
    compareFieldId: ""
  };
}

export function normalizeFilterTree(report: Pick<ReportDefinition, "filters" | "filterTree">): FilterGroupDefinition {
  if (report.filterTree && report.filterTree.type === "group") {
    return report.filterTree;
  }
  return createFilterGroup("and", report.filters || []);
}

export function collectFilterFieldIds(node: FilterNodeDefinition | null | undefined): string[] {
  if (!node) return [];
  if (isFilterGroup(node)) {
    return Array.from(new Set(node.conditions.flatMap((condition) => collectFilterFieldIds(condition))));
  }
  return Array.from(new Set([node.fieldId, node.valueSource === "field" ? node.compareFieldId || "" : ""].filter(Boolean)));
}

export function buildCombinedFilterTree(report: Pick<ReportDefinition, "filters" | "filterTree">, extraFilters: FilterDefinition[] = []): FilterGroupDefinition | null {
  const baseTree = normalizeFilterTree(report);
  const extraTree = extraFilters.length ? createFilterGroup("and", extraFilters) : null;
  const baseHasConditions = baseTree.conditions.length > 0;
  if (!baseHasConditions && !extraTree) return null;
  if (!baseHasConditions) return extraTree;
  if (!extraTree) return baseTree;
  return createFilterGroup("and", [baseTree, extraTree]);
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
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
  const text = String(value ?? "").trim();
  return text;
}

function isDateLike(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  return parseDateValue(value) !== null;
}

function normalizedFilterText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function looksNumeric(value: unknown): boolean {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  return Number.isFinite(Number(value));
}

function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function compareTemporalValues(raw: unknown, expected: unknown) {
  const leftDate = parseDateValue(raw);
  const rightDate = parseDateValue(expected);
  if (leftDate && rightDate) {
    return {
      exact: startOfUtcDay(leftDate) - startOfUtcDay(rightDate),
      precise: leftDate.getTime() - rightDate.getTime()
    };
  }
  return null;
}

function matchesDateToken(value: unknown, token: string): boolean {
  const date = parseDateValue(value);
  if (!date) return false;
  const now = new Date("2026-01-15T12:00:00.000Z");
  if (token === "CURRENT_MONTH") {
    return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
  }
  if (token === "LAST_30_DAYS") {
    const floor = new Date(now);
    floor.setUTCDate(now.getUTCDate() - 30);
    return date >= floor && date <= now;
  }
  if (token === "CURRENT_YEAR") {
    return date.getUTCFullYear() === now.getUTCFullYear();
  }
  return false;
}

export function matchesFilter(row: DataRow, filter: FilterDefinition): boolean {
  const raw = row[filter.fieldId];
  const compareFieldId = String(filter.compareFieldId || "").trim();
  const usesFieldValue = filter.valueSource === "field" && Boolean(compareFieldId);
  const expectedRaw = usesFieldValue ? row[compareFieldId] : filter.value;
  const expected = String(expectedRaw ?? "");
  const candidates = asArray(raw).map((value) => String(value ?? ""));
  const expectedCandidates = asArray(expectedRaw).map((value) => String(value ?? ""));
  const normalizedCandidates = asArray(raw).map((value) => normalizedFilterText(value));
  const normalizedExpectedCandidates = expectedCandidates.map((value) => normalizedFilterText(value)).filter(Boolean);
  const normalizedExpected = normalizedFilterText(expected);
  const isBlank = candidates.length === 0 || candidates.every((value) => !String(value).trim());
  if (filter.operator === "blank") return isBlank;
  if (filter.operator === "not-blank") return !isBlank;
  if (!usesFieldValue && !expected) return true;
  if (!usesFieldValue && DATE_TOKENS.has(expected)) {
    return matchesDateToken(raw, expected);
  }
  if (filter.operator === "contains") {
    return normalizedCandidates.some((value) =>
      (normalizedExpectedCandidates.length ? normalizedExpectedCandidates : [normalizedExpected])
        .some((expectedValue) => value.includes(expectedValue))
    );
  }
  if (filter.operator === "not-contains") {
    return normalizedCandidates.every((value) =>
      (normalizedExpectedCandidates.length ? normalizedExpectedCandidates : [normalizedExpected])
        .every((expectedValue) => !value.includes(expectedValue))
    );
  }
  const temporalComparison = compareTemporalValues(raw, expected);
  if (filter.operator === "on") {
    return temporalComparison ? temporalComparison.exact === 0 : normalizedCandidates.some((value) => value === normalizedExpected);
  }
  if (filter.operator === "on-or-after") {
    return temporalComparison ? temporalComparison.exact >= 0 : asNumber(raw) >= asNumber(expected);
  }
  if (filter.operator === "on-or-before") {
    return temporalComparison ? temporalComparison.exact <= 0 : asNumber(raw) <= asNumber(expected);
  }
  if (filter.operator === "gt") return temporalComparison ? temporalComparison.precise > 0 : asNumber(raw) > asNumber(expected);
  if (filter.operator === "gte") return temporalComparison ? temporalComparison.precise >= 0 : asNumber(raw) >= asNumber(expected);
  if (filter.operator === "lt") return temporalComparison ? temporalComparison.precise < 0 : asNumber(raw) < asNumber(expected);
  if (filter.operator === "lte") return temporalComparison ? temporalComparison.precise <= 0 : asNumber(raw) <= asNumber(expected);
  if (looksNumeric(raw) && looksNumeric(expected)) {
    const numericExpected = asNumber(expected);
    if (filter.operator === "not-equals") return asArray(raw).every((value) => asNumber(value) !== numericExpected);
    return asArray(raw).some((value) => asNumber(value) === numericExpected);
  }
  if (isDateLike(raw) && isDateLike(expected)) {
    if (filter.operator === "not-equals") return asArray(raw).every((value) => compareTemporalValues(value, expected)?.exact !== 0);
    return asArray(raw).some((value) => compareTemporalValues(value, expected)?.exact === 0);
  }
  if (filter.operator === "not-equals") {
    return normalizedCandidates.every((value) =>
      (normalizedExpectedCandidates.length ? normalizedExpectedCandidates : [normalizedExpected]).every((expectedValue) => value !== expectedValue)
    );
  }
  return normalizedCandidates.some((value) =>
    (normalizedExpectedCandidates.length ? normalizedExpectedCandidates : [normalizedExpected]).some((expectedValue) => value === expectedValue)
  );
}

export function matchesFilterNode(row: DataRow, node: FilterNodeDefinition): boolean {
  if (isFilterGroup(node)) {
    const activeConditions = node.conditions.filter((condition) => {
      if (isFilterGroup(condition)) return condition.conditions.length > 0;
      return filterHasValue(condition);
    });
    if (!activeConditions.length) return true;
    return node.join === "or"
      ? activeConditions.some((condition) => matchesFilterNode(row, condition))
      : activeConditions.every((condition) => matchesFilterNode(row, condition));
  }
  return matchesFilter(row, node);
}

function sortRows(rows: DataRow[], sorts: ReportDefinition["sorts"]): DataRow[] {
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

function summarize(rows: DataRow[], metrics: SummaryMetric[], decimalPlaces: number): SummaryDatum[] {
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

function aggregateValues(values: number[], aggregation: ChartAggregation): number {
  if (aggregation === "count") return values.length;
  if (!values.length) return 0;
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "min") return Math.min(...values);
  return Math.max(...values);
}

function sortChartData(data: ChartDatum[], sort: ChartSortMode) {
  const next = [...data];
  if (sort === "value-asc") return next.sort((left, right) => left.value - right.value);
  if (sort === "label-asc") return next.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  if (sort === "label-desc") return next.sort((left, right) => right.label.localeCompare(left.label, undefined, { numeric: true }));
  return next.sort((left, right) => right.value - left.value);
}

function categorySortValue(entries: ChartDatum[]) {
  return entries
    .filter((entry) => (entry.axis || "primary") === "primary")
    .reduce((sum, entry) => sum + entry.value, 0);
}

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

function chartRows(rows: DataRow[], report: ReportDefinition): ChartDatum[] {
  const fieldId = report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
  if (!fieldId) return [];
  const seriesFieldId = report.view.chartSeriesFieldId || "";
  const valueFieldId = report.view.chartValueFieldId || "";
  const aggregation = report.view.chartAggregation || "count";
  const secondaryValueFieldId = report.view.chartUseSecondaryAxis ? (report.view.chartSecondaryValueFieldId || "") : "";
  const secondaryAggregation = report.view.chartSecondaryAggregation || "sum";
  const groups = new Map<string, { primary: number[]; secondary: number[] }>();
  for (const row of rows) {
    const categoryKey = normalizeChartGroupValue(row[fieldId]);
    const seriesKey = seriesFieldId ? normalizeChartGroupValue(row[seriesFieldId]) : "";
    const key = `${categoryKey}::${seriesKey}`;
    const current = groups.get(key) || { primary: [], secondary: [] };
    current.primary.push(aggregation === "count" ? 1 : asNumber(row[valueFieldId]));
    if (secondaryValueFieldId) {
      current.secondary.push(secondaryAggregation === "count" ? 1 : asNumber(row[secondaryValueFieldId]));
    }
    groups.set(key, current);
  }
  const groupedByCategory = new Map<string, ChartDatum[]>();
  for (const [key, values] of groups.entries()) {
    const [rawLabel, rawSeries = ""] = key.split("::");
    const entries = groupedByCategory.get(rawLabel) || [];
    entries.push({
      label: getChartLabel(report, rawLabel),
      rawLabel,
      value: aggregateValues(values.primary, aggregation),
      series: rawSeries ? getChartLabel(report, rawSeries) : undefined,
      rawSeries: rawSeries || undefined,
      axis: "primary"
    });
    if (secondaryValueFieldId) {
      entries.push({
        label: getChartLabel(report, rawLabel),
        rawLabel,
        value: aggregateValues(values.secondary, secondaryAggregation),
        series: rawSeries ? getChartLabel(report, rawSeries) : undefined,
        rawSeries: rawSeries || undefined,
        axis: "secondary"
      });
    }
    groupedByCategory.set(rawLabel, entries);
  }
  const sortedCategories = Array.from(groupedByCategory.entries());
  const sort = report.view.chartSort || "value-desc";
  if (isContinuousChartType(report)) {
    const descending = sort === "label-desc";
    const ordered = sortedCategories
      .filter(([rawLabel]) => String(rawLabel ?? "").trim())
      .sort((left, right) => compareChartCategories(report, left[0], right[0]) * (descending ? -1 : 1));
    const topN = Math.max(0, Number(report.view.chartTopN) || 0);
    const trimmed = topN
      ? (descending ? ordered.slice(0, topN) : ordered.slice(-topN))
      : ordered;
    return trimmed.flatMap(([, entries]) => entries);
  }
  if (sort === "value-asc") sortedCategories.sort((left, right) => categorySortValue(left[1]) - categorySortValue(right[1]));
  else if (sort === "label-asc") sortedCategories.sort((left, right) => getChartLabel(report, left[0]).localeCompare(getChartLabel(report, right[0]), undefined, { numeric: true }));
  else if (sort === "label-desc") sortedCategories.sort((left, right) => getChartLabel(report, right[0]).localeCompare(getChartLabel(report, left[0]), undefined, { numeric: true }));
  else sortedCategories.sort((left, right) => categorySortValue(right[1]) - categorySortValue(left[1]));
  const topN = Math.max(0, Number(report.view.chartTopN) || 0);
  const trimmed = topN ? sortedCategories.slice(0, topN) : sortedCategories;
  return trimmed.flatMap(([, entries]) => entries);
}

export function runReport(
  report: ReportDefinition,
  table: TableDefinition,
  rows: DataRow[],
  extraFilters: FilterDefinition[] = []
): ReportRunResult {
  const filterTree = buildCombinedFilterTree(report, extraFilters);
  const filtered = filterTree ? rows.filter((row) => matchesFilterNode(row, filterTree)) : rows;
  const sorted = sortRows(filtered, report.sorts);
  const projected = sorted.map((row) => {
    const next: DataRow = {};
    for (const fieldId of report.selectedFieldIds) {
      next[fieldId] = row[fieldId] ?? "";
    }
    return next;
  });
  const metricSet = report.summaryMetrics.length
    ? report.summaryMetrics
    : [{ id: "default-count", fieldId: report.selectedFieldIds[0] || "recordId", op: "count" as const, label: "Rows" }];
  const warnings = report.selectedFieldIds.length || !report.view.showDetails ? [] : ["This report has no selected fields."];
  const titleField = report.view.titleFieldId || report.selectedFieldIds[0] || "";
  const normalizedRows = projected.map((row) => ({
    ...(row.__recordId ? { __recordId: row.__recordId } : {}),
    ...(titleField ? { __title: row[titleField] ?? "" } : {}),
    ...row
  }));

  return {
    reportId: report.id,
    tableId: table.id,
    totalRows: normalizedRows.length,
    rows: normalizedRows,
    summary: summarize(sorted, metricSet, getReportDecimalPlaces(report)),
    chartData: chartRows(sorted, report),
    warnings
  };
}

export function buildDashboardFilters(
  dashboard: DashboardDefinition,
  reportId: string,
  runtimeValues: Record<string, string>,
  reportSourceTableId = ""
): FilterDefinition[] {
  return dashboard.runtimeFilters
    .filter((filter) => {
      if (filter.sourceTableId && reportSourceTableId && filter.sourceTableId !== reportSourceTableId) return false;
      if (filter.mode === "global") return true;
      return filter.targetReportIds.includes(reportId);
    })
    .map((filter) => ({
      id: "runtime-" + filter.id,
      fieldId: filter.fieldId,
      operator: filter.operator || "equals",
      value: runtimeValues[filter.id] ?? filter.defaultValue ?? "",
      valueSource: filter.valueSource || "literal",
      compareFieldId: filter.compareFieldId || ""
    }))
    .filter((filter) => filterHasValue(filter));
}

export function buildDashboardResult(
  dashboard: DashboardDefinition,
  widgets: DashboardWidgetResult[]
): DashboardRunResult {
  const widgetMap = new Map(widgets.map((widget) => [widget.widgetId, widget]));
  return {
    dashboard,
    tabs: dashboard.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      widgets: tab.widgets
        .map((widget) => widgetMap.get(widget.id))
        .filter((widget): widget is DashboardWidgetResult => Boolean(widget))
    }))
  };
}
