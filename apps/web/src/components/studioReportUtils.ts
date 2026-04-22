import {
  formatReportCellValue,
  getReportFieldLabel,
  STUDIO_DEFAULT_CHART_COLORS,
  type ChartAggregation,
  type ChartSeriesType,
  type ChartSortMode,
  type ChartType,
  type ReportDefinition,
  type ReportViewMode,
  type TableDefinition
} from "@studio/shared";

export const DEFAULT_CHART_COLORS = STUDIO_DEFAULT_CHART_COLORS;

export const REPORT_VIEW_OPTIONS: ReportViewMode[] = ["table", "summary", "chart", "timeline", "calendar", "kanban"];

export const SUPPORTED_CHART_OPTIONS: ChartType[] = [
  "bar",
  "horizontal-bar",
  "stacked-bar",
  "horizontal-stacked-bar",
  "column",
  "stacked-column",
  "line",
  "line-bar",
  "area",
  "spline",
  "area-spline",
  "streamgraph",
  "pie",
  "donut",
  "funnel",
  "scatter",
  "bubble",
  "gauge",
  "heatmap",
  "waterfall",
  "progress-bar",
  "radial-bar",
  "variwide-bar",
  "bullet",
  "radar",
  "3d-bar",
  "3d-stacked-bar",
  "3d-area",
  "3d-pie",
  "3d-donut",
  "3d-funnel",
  "3d-scatter"
];

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: "Bar",
  "horizontal-bar": "Horizontal bar",
  "stacked-bar": "Stacked bar",
  "horizontal-stacked-bar": "Horizontal stacked bar",
  column: "Column",
  "stacked-column": "Stacked column",
  line: "Line",
  "line-bar": "Line and bar combo",
  area: "Area",
  spline: "Spline",
  "area-spline": "Area spline",
  streamgraph: "Streamgraph",
  pie: "Pie",
  donut: "Doughnut",
  funnel: "Funnel",
  scatter: "Scatter",
  bubble: "Bubble",
  gauge: "Gauge",
  "progress-bar": "Progress bar",
  bullet: "Bullet",
  waterfall: "Waterfall",
  "radial-bar": "Radial bar",
  "variwide-bar": "Variwide bar",
  heatmap: "Heatmap",
  radar: "Radar",
  "3d-bar": "3D bar",
  "3d-stacked-bar": "3D stacked bar",
  "3d-area": "3D area",
  "3d-pie": "3D pie",
  "3d-donut": "3D doughnut",
  "3d-funnel": "3D funnel",
  "3d-scatter": "3D scatter"
};

export const CHART_AGGREGATION_OPTIONS: ChartAggregation[] = ["count", "sum", "avg", "min", "max"];

export const CHART_SERIES_TYPE_OPTIONS: Array<{ value: ChartSeriesType; label: string }> = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "column", label: "Column" }
];

export const CHART_SORT_OPTIONS: Array<{ value: ChartSortMode; label: string }> = [
  { value: "value-desc", label: "Value high to low" },
  { value: "value-asc", label: "Value low to high" },
  { value: "label-asc", label: "Label A to Z" },
  { value: "label-desc", label: "Label Z to A" }
];

function getFieldLabel(report: ReportDefinition, table: TableDefinition | null | undefined, fieldId: string) {
  return table ? getReportFieldLabel(report, table, fieldId) : fieldId;
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
  return [
    "bar",
    "horizontal-bar",
    "column",
    "stacked-bar",
    "horizontal-stacked-bar",
    "stacked-column",
    "line",
    "line-bar",
    "area",
    "spline",
    "area-spline",
    "streamgraph",
    "scatter",
    "bubble",
    "waterfall",
    "variwide-bar",
    "bullet",
    "progress-bar",
    "3d-bar",
    "3d-stacked-bar",
    "3d-area",
    "3d-scatter"
  ].includes(chartType);
}

export function chartTypeLabel(chartType: ChartType) {
  return CHART_TYPE_LABELS[chartType] || chartType;
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
  return [
    "bar",
    "horizontal-bar",
    "column",
    "stacked-bar",
    "horizontal-stacked-bar",
    "stacked-column",
    "line",
    "line-bar",
    "area",
    "spline",
    "area-spline",
    "streamgraph",
    "heatmap",
    "radar",
    "3d-bar",
    "3d-stacked-bar",
    "3d-area"
  ].includes(chartType);
}

export function chartSupportsSecondaryAxis(chartType: ChartType) {
  return [
    "line",
    "area",
    "spline",
    "area-spline",
    "line-bar",
    "streamgraph",
    "bullet",
    "3d-area"
  ].includes(chartType);
}

export function chartValueFieldLabel(chartType: ChartType) {
  if (chartType === "scatter") return "Y axis field";
  if (chartType === "bubble") return "Y axis field";
  if (chartType === "gauge") return "Gauge value field";
  if (chartType === "heatmap") return "Cell value field";
  if (chartType === "waterfall") return "Step change field";
  if (chartType === "variwide-bar") return "Width/value field";
  if (chartType === "progress-bar" || chartType === "radial-bar") return "Percent/value field";
  if (chartType === "bullet") return "Actual value field";
  if (chartType === "funnel") return "Stage value field";
  return "Primary Y axis field";
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
