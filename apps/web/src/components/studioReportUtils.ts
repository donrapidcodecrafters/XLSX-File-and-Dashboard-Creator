import {
  CHART_AGGREGATION_OPTIONS as SHARED_CHART_AGGREGATION_OPTIONS,
  CHART_PERCENT_MODE_OPTIONS,
  CHART_SPECS,
  formatReportCellValue,
  getAllowedAggregations,
  getAllowedPercentModes,
  getChartSpec,
  getDefaultPercentMode,
  getReportFieldLabel,
  normalizeChartAggregation,
  STUDIO_DEFAULT_CHART_COLORS,
  type ChartAggregation,
  type ChartPercentMode,
  type ChartSeriesType,
  type ChartSortMode,
  type ChartType,
  type ChartDatum,
  type ReportDefinition,
  type ReportViewMode,
  type TableDefinition
} from "@studio/shared";
import type { SearchableSelectOption } from "./SearchableSelect";

export const DEFAULT_CHART_COLORS = STUDIO_DEFAULT_CHART_COLORS;

export const REPORT_VIEW_OPTIONS: ReportViewMode[] = ["table", "summary", "chart", "timeline", "calendar", "kanban"];

export const SUPPORTED_CHART_OPTIONS: ChartType[] = Object.keys(CHART_SPECS) as ChartType[];

export const CHART_AGGREGATION_OPTIONS = SHARED_CHART_AGGREGATION_OPTIONS;

export const CHART_SERIES_TYPE_OPTIONS: Array<{ value: ChartSeriesType; label: string }> = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "column", label: "Column" }
];

export const CHART_SORT_OPTIONS: Array<{ value: ChartSortMode; label: string }> = [
  { value: "data-order", label: "Report sort order" },
  { value: "value-desc", label: "Value high to low" },
  { value: "value-asc", label: "Value low to high" },
  { value: "label-asc", label: "Label A to Z" },
  { value: "label-desc", label: "Label Z to A" }
];

export function sortAlphabetically<T>(items: T[], getLabel: (item: T) => string) {
  return [...items].sort((left, right) =>
    getLabel(left).localeCompare(getLabel(right), undefined, { numeric: true, sensitivity: "base" })
  );
}

export function getSortedFieldOptions(table: TableDefinition): SearchableSelectOption[] {
  return sortAlphabetically(table.fields, (field) => field.label || field.id).map((field) => ({
    value: field.id,
    label: field.label,
    keywords: [field.id, field.type]
  }));
}

export function getSortedDashboardFieldOptions(tables: TableDefinition[]): SearchableSelectOption[] {
  return sortAlphabetically(
    tables.flatMap((table) =>
      table.fields.map((field) => ({
        value: field.id,
        label: `${table.name} · ${field.label}`,
        keywords: [table.name, field.label, field.id, field.type]
      }))
    ),
    (option) => option.label
  );
}

function formatFallbackFieldLabel(fieldId: string) {
  const trimmed = String(fieldId || "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return "";
  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFieldLabel(report: ReportDefinition, table: TableDefinition | null | undefined, fieldId: string) {
  const displayLabel = report.displayLabels?.fields?.[fieldId]?.trim();
  if (displayLabel) return displayLabel;
  if (table) {
    const tableLabel = getReportFieldLabel(report, table, fieldId);
    if (tableLabel && tableLabel !== fieldId) return tableLabel;
  }
  return formatFallbackFieldLabel(fieldId);
}

function getChartFieldId(report: ReportDefinition) {
  return report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
}

function isSupportedChartOption(chartType: ChartType) {
  return SUPPORTED_CHART_OPTIONS.includes(chartType);
}

export function formatStudioReportCell(value: unknown, report?: ReportDefinition | null, table?: TableDefinition | null, fieldId?: string) {
  if (report && table && fieldId) {
    return formatReportCellValue(report, table, fieldId, value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

export function reportShowsChart(report: Pick<ReportDefinition, "view">) {
  return report.view.mode === "chart" || (report.view.mode === "table" && report.view.showChartInTable);
}

export function reportShowsSummary(report: Pick<ReportDefinition, "view">) {
  if (typeof report.view.showSummary === "boolean") return report.view.showSummary;
  return report.view.mode === "table" || report.view.mode === "summary" || report.view.mode === "chart";
}

export function reportShowsDetails(report: Pick<ReportDefinition, "view">) {
  if (typeof report.view.showDetails === "boolean") return report.view.showDetails;
  return report.view.mode === "table" || report.view.mode === "timeline" || report.view.mode === "calendar" || report.view.mode === "kanban";
}

export function chartUsesAxes(chartType: ChartType) {
  return Boolean(getChartSpec(chartType).usesAxes);
}

export function chartTypeLabel(chartType: ChartType) {
  return getChartSpec(chartType).label || chartType;
}

export function chartTypeSelectOptions(currentType: ChartType) {
  const supported = SUPPORTED_CHART_OPTIONS.map((chartType) => ({
    value: chartType,
    label: chartTypeLabel(chartType)
  }));
  if (!isSupportedChartOption(currentType)) {
    supported.push({
      value: currentType,
      label: `${chartTypeLabel(currentType)} (legacy)`
    });
  }
  return supported;
}

export function chartSupportsSeries(chartType: ChartType) {
  return Boolean(getChartSpec(chartType).supportsSeries);
}

export function chartSupportsSecondaryAxis(chartType: ChartType) {
  return Boolean(getChartSpec(chartType).supportsSecondaryAxis);
}

export function chartRequiresSeries(chartType: ChartType) {
  return Boolean(getChartSpec(chartType).requiresSeries);
}

export function chartPrimaryFieldLabel(chartType: ChartType) {
  return getChartSpec(chartType).primaryFieldLabel;
}

export function chartSeriesFieldLabel(chartType: ChartType) {
  return getChartSpec(chartType).seriesFieldLabel || "Series field";
}

export function chartValueFieldLabel(chartType: ChartType) {
  return getChartSpec(chartType).valueFieldLabel;
}

export function chartColorKeyLabel(chartType: ChartType) {
  if (!chartUsesAxes(chartType) && !chartSupportsSeries(chartType)) return "Category value";
  return chartSupportsSeries(chartType) ? "Series or category value" : "Category value";
}

export function chartAggregationLabel(aggregation: ChartAggregation) {
  const normalized = normalizeChartAggregation(aggregation);
  return CHART_AGGREGATION_OPTIONS.find((option) => option.value === normalized)?.label || normalized;
}

export function chartAggregationOptions(chartType: ChartType) {
  const allowed = new Set(getAllowedAggregations(chartType).map((value) => normalizeChartAggregation(value)));
  return CHART_AGGREGATION_OPTIONS.filter((option) => allowed.has(option.value));
}

export function chartSupportsPercentAggregation(chartType: ChartType) {
  return getAllowedAggregations(chartType).includes("percent");
}

export function chartPercentModeOptions(chartType: ChartType) {
  const allowed = new Set(getAllowedPercentModes(chartType));
  return CHART_PERCENT_MODE_OPTIONS.filter((option) => allowed.has(option.value));
}

export function normalizeChartPercentMode(chartType: ChartType, mode?: ChartPercentMode | null) {
  const allowed = getAllowedPercentModes(chartType);
  if (mode && allowed.includes(mode)) return mode;
  return getDefaultPercentMode(chartType);
}

export function getChartViewportBounds(chartType: ChartType, datumCount: number, compact = false, requestedHeight = 0) {
  const safeCount = Math.max(1, datumCount || 1);
  if (["pie", "donut", "3d-pie", "3d-donut", "gauge", "solid-gauge", "radial-bar", "progress-bar", "sunburst", "kpi-card", "big-number-card"].includes(chartType)) {
    return {
      minWidth: compact ? 340 : 420,
      minHeight: Math.max(compact ? 220 : 300, requestedHeight || 0)
    };
  }
  if (["horizontal-bar", "horizontal-stacked-bar"].includes(chartType)) {
    return {
      minWidth: compact ? 540 : 760,
      minHeight: Math.max(compact ? 220 : 280, safeCount * (compact ? 28 : 34), requestedHeight || 0)
    };
  }
  if (["line", "line-bar", "area", "spline", "area-spline", "streamgraph", "scatter", "bubble", "radar", "3d-area", "3d-scatter", "candlestick", "pareto", "network-graph"].includes(chartType)) {
    return {
      minWidth: Math.max(compact ? 420 : 640, safeCount * (compact ? 40 : 54)),
      minHeight: Math.max(compact ? 280 : 360, requestedHeight || 0)
    };
  }
  return {
    minWidth: Math.max(compact ? 520 : 760, safeCount * (compact ? 42 : 58)),
    minHeight: Math.max(compact ? 280 : 360, requestedHeight || 0)
  };
}

export function getChartColorKey(datum: ChartDatum) {
  const seriesKey = String(datum.rawSeries || datum.series || "").trim();
  if (seriesKey) return seriesKey;
  return String(datum.rawLabel ?? datum.label ?? "").trim();
}

export function getFieldComparisonOptions(table: TableDefinition, fieldId: string) {
  const selectedField = table.fields.find((field) => field.id === fieldId) || null;
  if (!selectedField) return getSortedFieldOptions(table);
  const compatibleTypes = selectedField.type === "date" || selectedField.type === "datetime"
    ? new Set(["date", "datetime"])
    : selectedField.type === "number" || selectedField.type === "currency"
      ? new Set(["number", "currency"])
      : new Set(["text", "user", "multiselect"]);
  return getSortedFieldOptions({
    ...table,
    fields: table.fields.filter((field) => compatibleTypes.has(field.type))
  });
}

export function getChartAxisLabels(report: ReportDefinition, table: TableDefinition | null | undefined) {
  const xFieldId = getChartFieldId(report);
  const primaryFieldLabel = report.view.chartValueFieldId
    ? getFieldLabel(report, table, report.view.chartValueFieldId)
    : "";
  const secondaryFieldLabel = report.view.chartSecondaryValueFieldId
    ? getFieldLabel(report, table, report.view.chartSecondaryValueFieldId)
    : "";
  return {
    xAxisLabel: report.view.chartXAxisLabel?.trim()
      || (xFieldId ? getFieldLabel(report, table, xFieldId) : ""),
    yAxisLabel: report.view.chartYAxisLabel?.trim()
      || primaryFieldLabel
      || (report.view.chartAggregation === "count" ? "Rows" : ""),
    secondaryYAxisLabel: report.view.chartSecondaryYAxisLabel?.trim()
      || (report.view.chartUseSecondaryAxis
        ? (secondaryFieldLabel || (report.view.chartSecondaryAggregation === "count" ? "Rows" : ""))
        : "")
  };
}
