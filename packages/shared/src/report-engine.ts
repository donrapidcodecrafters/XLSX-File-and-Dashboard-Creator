import type {
  ChartDatum,
  DashboardDefinition,
  DashboardRunResult,
  DashboardWidgetResult,
  DataRow,
  FieldDefinition,
  FilterDefinition,
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

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
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

function matchesFilter(row: DataRow, filter: FilterDefinition): boolean {
  const raw = row[filter.fieldId];
  const expected = String(filter.value ?? "");
  if (!expected) return true;
  if (DATE_TOKENS.has(expected)) {
    return matchesDateToken(raw, expected);
  }
  const candidates = asArray(raw).map((value) => String(value ?? ""));
  if (filter.operator === "contains") {
    return candidates.some((value) => value.toLowerCase().includes(expected.toLowerCase()));
  }
  if (filter.operator === "gt") return asNumber(raw) > asNumber(expected);
  if (filter.operator === "gte") return asNumber(raw) >= asNumber(expected);
  if (filter.operator === "lt") return asNumber(raw) < asNumber(expected);
  if (filter.operator === "lte") return asNumber(raw) <= asNumber(expected);
  return candidates.some((value) => value === expected);
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

function summarize(rows: DataRow[], metrics: SummaryMetric[]): SummaryDatum[] {
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
    const formattedValue = metric.op === "avg"
      ? numericValue.toFixed(1)
      : Number.isInteger(numericValue)
        ? String(numericValue)
        : numericValue.toFixed(2);
    return {
      label: metric.label,
      value: formattedValue,
      numericValue
    };
  });
}

function chartRows(rows: DataRow[], fieldId: string): ChartDatum[] {
  if (!fieldId) return [];
  const groups = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[fieldId] ?? "Unassigned");
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

export function runReport(
  report: ReportDefinition,
  table: TableDefinition,
  rows: DataRow[],
  extraFilters: FilterDefinition[] = []
): ReportRunResult {
  const filters = [...report.filters, ...extraFilters].filter((filter) => Boolean(filter.value));
  const filtered = rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
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
  const chartField = report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
  const warnings = report.selectedFieldIds.length ? [] : ["This report has no selected fields."];
  const titleField = report.view.titleFieldId || report.selectedFieldIds[0] || "";
  const normalizedRows = projected.map((row) => ({
    ...(titleField ? { __title: row[titleField] ?? "" } : {}),
    ...row
  }));

  return {
    reportId: report.id,
    tableId: table.id,
    totalRows: normalizedRows.length,
    rows: normalizedRows,
    summary: summarize(sorted, metricSet),
    chartData: chartRows(sorted, chartField),
    warnings
  };
}

export function buildDashboardFilters(
  dashboard: DashboardDefinition,
  reportId: string,
  runtimeValues: Record<string, string>
): FilterDefinition[] {
  return dashboard.runtimeFilters
    .filter((filter) => {
      if (filter.mode === "global") return true;
      return filter.targetReportIds.includes(reportId);
    })
    .map((filter) => ({
      id: "runtime-" + filter.id,
      fieldId: filter.fieldId,
      operator: "equals" as const,
      value: runtimeValues[filter.id] ?? filter.defaultValue ?? ""
    }))
    .filter((filter) => Boolean(filter.value));
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
