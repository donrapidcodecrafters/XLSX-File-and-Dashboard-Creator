import type { ChartAggregation, ChartPercentMode, ChartType } from "./models.js";

export interface ChartAggregationOption {
  value: ChartAggregation;
  label: string;
}

export interface ChartPercentModeOption {
  value: ChartPercentMode;
  label: string;
}

export interface ChartSpec {
  type: ChartType;
  label: string;
  primaryFieldLabel: string;
  valueFieldLabel: string;
  seriesFieldLabel?: string;
  supportsSeries?: boolean;
  requiresSeries?: boolean;
  usesAxes?: boolean;
  supportsSecondaryAxis?: boolean;
  allowedAggregations: ChartAggregation[];
  defaultPercentMode?: ChartPercentMode;
  allowedPercentModes?: ChartPercentMode[];
}

export const CHART_AGGREGATION_OPTIONS: ChartAggregationOption[] = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "percent", label: "Percent" }
];

export const CHART_PERCENT_MODE_OPTIONS: ChartPercentModeOption[] = [
  { value: "percent_of_total", label: "Percent of total" },
  { value: "percent_of_group", label: "Percent of group" },
  { value: "percent_of_stack", label: "Percent of stack" },
  { value: "percent_of_previous", label: "Percent of previous" },
  { value: "range_progress", label: "Range progress" },
  { value: "target_ratio", label: "Value vs target" },
  { value: "category_max_ratio", label: "Value vs category max" },
  { value: "width_percent", label: "Width percent" },
  { value: "value_percent", label: "Value percent" },
  { value: "cumulative_percent_of_total", label: "Cumulative percent of total" }
];

const TOTAL = ["count", "sum", "average", "min", "max", "percent"] satisfies ChartAggregation[];
const STACKED = ["count", "sum", "average", "min", "max", "percent"] satisfies ChartAggregation[];
const NUMERIC_ONLY = ["count", "sum", "average", "min", "max"] satisfies ChartAggregation[];

export const CHART_SPECS: Record<ChartType, ChartSpec> = {
  bar: { type: "bar", label: "Bar", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "horizontal-bar": { type: "horizontal-bar", label: "Horizontal bar", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "stacked-bar": { type: "stacked-bar", label: "Stacked bar", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, requiresSeries: true, usesAxes: true, allowedAggregations: STACKED, defaultPercentMode: "percent_of_stack", allowedPercentModes: ["percent_of_stack"] },
  "horizontal-stacked-bar": { type: "horizontal-stacked-bar", label: "Horizontal stacked bar", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", seriesFieldLabel: "Series field", supportsSeries: true, requiresSeries: true, usesAxes: true, allowedAggregations: STACKED, defaultPercentMode: "percent_of_stack", allowedPercentModes: ["percent_of_stack"] },
  column: { type: "column", label: "Column", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "stacked-column": { type: "stacked-column", label: "Stacked column", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, requiresSeries: true, usesAxes: true, allowedAggregations: STACKED, defaultPercentMode: "percent_of_stack", allowedPercentModes: ["percent_of_stack"] },
  line: { type: "line", label: "Line", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "line-bar": { type: "line-bar", label: "Line and bar combo", primaryFieldLabel: "X axis field", valueFieldLabel: "Primary value field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  area: { type: "area", label: "Area", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total", "percent_of_stack"] },
  spline: { type: "spline", label: "Spline", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "area-spline": { type: "area-spline", label: "Area spline", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total", "percent_of_stack"] },
  streamgraph: { type: "streamgraph", label: "Streamgraph", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, requiresSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_stack", allowedPercentModes: ["percent_of_stack"] },
  pie: { type: "pie", label: "Pie", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  donut: { type: "donut", label: "Doughnut", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  funnel: { type: "funnel", label: "Funnel", primaryFieldLabel: "Stage field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total", "percent_of_previous"] },
  scatter: { type: "scatter", label: "Scatter", primaryFieldLabel: "X numeric field", valueFieldLabel: "Y numeric field", usesAxes: true, allowedAggregations: [] },
  bubble: { type: "bubble", label: "Bubble", primaryFieldLabel: "X numeric field", valueFieldLabel: "Y numeric field", usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: [] },
  gauge: { type: "gauge", label: "Gauge", primaryFieldLabel: "Value field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "range_progress", allowedPercentModes: ["range_progress"] },
  "solid-gauge": { type: "solid-gauge", label: "Solid gauge", primaryFieldLabel: "Value field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "range_progress", allowedPercentModes: ["range_progress"] },
  "progress-bar": { type: "progress-bar", label: "Progress bar", primaryFieldLabel: "Value field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "range_progress", allowedPercentModes: ["range_progress"] },
  "radial-bar": { type: "radial-bar", label: "Radial bar", primaryFieldLabel: "Value field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "range_progress", allowedPercentModes: ["range_progress"] },
  bullet: { type: "bullet", label: "Bullet", primaryFieldLabel: "Category field", valueFieldLabel: "Actual value field", usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "target_ratio", allowedPercentModes: ["target_ratio"] },
  heatmap: { type: "heatmap", label: "Heatmap", primaryFieldLabel: "X axis field", valueFieldLabel: "Value field", seriesFieldLabel: "Y axis field", supportsSeries: true, requiresSeries: true, usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  waterfall: { type: "waterfall", label: "Waterfall", primaryFieldLabel: "X axis field", valueFieldLabel: "Value field", usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "variwide-bar": { type: "variwide-bar", label: "Variwide bar", primaryFieldLabel: "X axis field", valueFieldLabel: "Value field", seriesFieldLabel: "Width field", supportsSeries: true, usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "value_percent", allowedPercentModes: ["width_percent", "value_percent"] },
  radar: { type: "radar", label: "Radar", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: false, allowedAggregations: TOTAL, defaultPercentMode: "category_max_ratio", allowedPercentModes: ["category_max_ratio"] },
  treemap: { type: "treemap", label: "Treemap", primaryFieldLabel: "Hierarchy field", valueFieldLabel: "Value field", seriesFieldLabel: "Parent/hierarchy field", supportsSeries: true, usesAxes: false, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  sunburst: { type: "sunburst", label: "Sunburst", primaryFieldLabel: "Hierarchy field", valueFieldLabel: "Value field", seriesFieldLabel: "Parent/hierarchy field", supportsSeries: true, usesAxes: false, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "box-plot": { type: "box-plot", label: "Box plot", primaryFieldLabel: "Category field", valueFieldLabel: "Distribution field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, allowedAggregations: [] },
  candlestick: { type: "candlestick", label: "Candlestick", primaryFieldLabel: "Category or date field", valueFieldLabel: "Close field", seriesFieldLabel: "Open / High / Low fields", supportsSeries: true, usesAxes: true, allowedAggregations: [] },
  histogram: { type: "histogram", label: "Histogram", primaryFieldLabel: "Numeric field", valueFieldLabel: "Bin count", usesAxes: true, allowedAggregations: ["count"] },
  pareto: { type: "pareto", label: "Pareto", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "cumulative_percent_of_total", allowedPercentModes: ["cumulative_percent_of_total"] },
  map: { type: "map", label: "Map", primaryFieldLabel: "Location field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  sankey: { type: "sankey", label: "Sankey", primaryFieldLabel: "Source field", valueFieldLabel: "Value field", seriesFieldLabel: "Target field", supportsSeries: true, requiresSeries: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "network-graph": { type: "network-graph", label: "Network graph", primaryFieldLabel: "Node id field", valueFieldLabel: "Connection value field", seriesFieldLabel: "Connection target field", supportsSeries: true, requiresSeries: true, allowedAggregations: [] },
  "kpi-card": { type: "kpi-card", label: "KPI card", primaryFieldLabel: "Value field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "big-number-card": { type: "big-number-card", label: "Big number card", primaryFieldLabel: "Value field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "3d-bar": { type: "3d-bar", label: "3D bar", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "3d-stacked-bar": { type: "3d-stacked-bar", label: "3D stacked bar", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, requiresSeries: true, usesAxes: true, allowedAggregations: STACKED, defaultPercentMode: "percent_of_stack", allowedPercentModes: ["percent_of_stack"] },
  "3d-area": { type: "3d-area", label: "3D area", primaryFieldLabel: "X axis field", valueFieldLabel: "Y axis field", seriesFieldLabel: "Series field", supportsSeries: true, usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total", "percent_of_stack"] },
  "3d-pie": { type: "3d-pie", label: "3D pie", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "3d-donut": { type: "3d-donut", label: "3D doughnut", primaryFieldLabel: "Category field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total"] },
  "3d-funnel": { type: "3d-funnel", label: "3D funnel", primaryFieldLabel: "Stage field", valueFieldLabel: "Value field", allowedAggregations: TOTAL, defaultPercentMode: "percent_of_total", allowedPercentModes: ["percent_of_total", "percent_of_previous"] },
  "3d-scatter": { type: "3d-scatter", label: "3D scatter", primaryFieldLabel: "X numeric field", valueFieldLabel: "Y numeric field", usesAxes: true, supportsSecondaryAxis: true, allowedAggregations: [] }
};

export function normalizeChartAggregation(aggregation: ChartAggregation | string | null | undefined): ChartAggregation {
  if (aggregation === "avg") return "average";
  if (aggregation === "average" || aggregation === "count" || aggregation === "sum" || aggregation === "min" || aggregation === "max" || aggregation === "percent") {
    return aggregation;
  }
  return "count";
}

export function getChartSpec(chartType: ChartType): ChartSpec {
  return CHART_SPECS[chartType] || CHART_SPECS.bar;
}

export function getAllowedAggregations(chartType: ChartType): ChartAggregation[] {
  return getChartSpec(chartType).allowedAggregations;
}

export function getAllowedPercentModes(chartType: ChartType): ChartPercentMode[] {
  return getChartSpec(chartType).allowedPercentModes || [];
}

export function getDefaultPercentMode(chartType: ChartType): ChartPercentMode | undefined {
  return getChartSpec(chartType).defaultPercentMode;
}
