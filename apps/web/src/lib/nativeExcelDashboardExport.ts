import {
  type ChartDatum,
  type ChartOrientation,
  type ChartSortMode,
  type ChartType,
  type DashboardDefinition,
  type DashboardRunResult,
  type DataRow,
  getDashboardWidgetPlacements,
  getReportFieldLabel,
  resolveDashboardWidgetRenderMode,
  type ReportDefinition,
  type ReportRunResult,
  type TableDefinition
} from "@studio/shared";

interface NativeDashboardExportOptions {
  filename?: string;
  tablesById?: Record<string, TableDefinition>;
  /** Include the synthetic dashboard-wide summary sheet. Defaults to true. */
  includeOverviewSheet?: boolean;
}

interface NativeReportExportOptions {
  filename?: string;
}

interface NativeChartSeries {
  label: string;
  rawSeries: string;
  values: number[];
  color: string;
  pointColors?: string[];
  nameRef: string;
  valuesRef: string;
  sizeRef?: string;
}

interface NativeChartSource {
  id: number;
  title: string;
  chartType: ChartType;
  originalChartType: ChartType;
  chartOrientation: ChartOrientation;
  chartSort: ChartSortMode;
  showLegend: boolean;
  showValues: boolean;
  hiddenLabelIndexes: number[];
  xAxisTitle: string;
  yAxisTitle: string;
  categories: string[];
  categoryRef: string;
  series: NativeChartSeries[];
  /** Secondary-axis series for combo charts (line-bar / pareto) and bubble sizing. */
  secondarySeries?: NativeChartSeries[];
  secondaryAxisTitle?: string;
  secondarySeriesType?: "line" | "area" | "bar" | "column";
  /** Denominator for gauge / radial-bar ring fill percentages. */
  maxValue?: number;
}

interface NativeChartPlacement {
  chart: NativeChartSource;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

const CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a", "#4f8fba"];
const CHART_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const DRAWING_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml";
const DRAWING_RELATIONSHIP_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const MAX_NATIVE_CHART_SERIES = 32;

function widgetShowsChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const displayMode = resolveDashboardWidgetRenderMode(widget, report.view.mode);
  return displayMode === "chart" || (displayMode === "table" && report.view.showChartInTable);
}

function widgetShowsRows(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const displayMode = resolveDashboardWidgetRenderMode(widget, report.view.mode);
  return ["table", "timeline", "calendar", "kanban"].includes(displayMode) || widget.showDetails;
}

function safeSheetName(name: string, usedNames: Set<string>) {
  const base = (name || "Sheet").replace(/[\\/*?:[\]]/g, "").trim() || "Sheet";
  let next = base.slice(0, 31);
  let counter = 2;
  while (usedNames.has(next)) {
    const suffix = ` ${counter}`;
    next = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    counter += 1;
  }
  usedNames.add(next);
  return next;
}

function safeFileName(name: string) {
  return (name || "dashboard").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "dashboard";
}

function buildTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
}

function xml(value: string | number | undefined | null) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(value: string | number | undefined | null) {
  return xml(value);
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnName(column: number) {
  let value = column;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - remainder) / 26);
  }
  return name || "A";
}

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function cellRef(sheetName: string, column: number, row: number) {
  return `${quoteSheetName(sheetName)}!$${columnName(column)}$${row}`;
}

function rangeRef(sheetName: string, startColumn: number, startRow: number, endColumn: number, endRow: number) {
  return `${quoteSheetName(sheetName)}!$${columnName(startColumn)}$${startRow}:$${columnName(endColumn)}$${endRow}`;
}

function getPalette(colors?: string[]) {
  const configured = (colors || [])
    .map((color) => color.trim())
    .filter((color) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color));
  return configured.length ? configured : CHART_COLORS;
}

function normalizeHexColor(color: string) {
  const trimmed = color.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    return trimmed.split("").map((part) => `${part}${part}`).join("").toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  return "0D7C66";
}

function colorForDatum(report: ReportDefinition, palette: string[], index: number, datumOrKey: ChartDatum | string) {
  const key = typeof datumOrKey === "string"
    ? datumOrKey.trim()
    : String(datumOrKey.rawSeries || datumOrKey.series || datumOrKey.rawLabel || datumOrKey.label || "").trim();
  const override = key ? String(report.view.chartValueColors?.[key] || "").trim() : "";
  return normalizeHexColor(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(override) ? override : palette[index % palette.length]);
}

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

function normalizeChartType(chartType: ChartType, orientation: ChartOrientation) {
  if (chartType === "horizontal-bar") return "bar";
  if (chartType === "horizontal-stacked-bar") return "stacked-bar";
  if (chartType === "3d-bar") return "bar";
  if (chartType === "3d-stacked-bar") return "stacked-bar";
  if (chartType === "3d-area") return "area";
  if (chartType === "3d-pie") return "pie";
  if (chartType === "3d-donut") return "donut";
  if (chartType === "3d-funnel") return "funnel";
  if (chartType === "spline") return "line";
  if (chartType === "area-spline" || chartType === "streamgraph") return "area";
  if (chartType === "histogram") return "column";
  if (chartType === "pareto") return "line-bar";
  if (chartType === "treemap") return "bar";
  if (chartType === "sunburst") return "donut";
  if (chartType === "solid-gauge") return "gauge";
  if (chartType === "box-plot") return "bullet";
  if (chartType === "column" && orientation === "horizontal") return "bar";
  return chartType;
}

function compareCategory(left: string, right: string) {
  const leftNumeric = Number(left);
  const rightNumeric = Number(right);
  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) return leftNumeric - rightNumeric;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortChartData(data: ChartDatum[], chartType: ChartType, sort: ChartSortMode) {
  const grouped = new Map<string, ChartDatum[]>();
  data.forEach((datum) => {
    const key = String(datum.rawLabel ?? datum.label ?? "");
    grouped.set(key, [...(grouped.get(key) || []), datum]);
  });
  const entries = Array.from(grouped.entries());
  if (["line", "area", "line-bar", "scatter", "bubble"].includes(chartType)) {
    entries.sort((left, right) => compareCategory(left[0], right[0]) * (sort === "label-desc" ? -1 : 1));
  } else if (sort === "data-order") { /* preserve insertion order */ }
  else if (sort === "label-asc") {
    entries.sort((left, right) => compareCategory(left[0], right[0]));
  } else if (sort === "label-desc") {
    entries.sort((left, right) => compareCategory(right[0], left[0]));
  } else {
    entries.sort((left, right) => {
      const leftValue = left[1].filter((item) => (item.axis || "primary") === "primary").reduce((sum, item) => sum + item.value, 0);
      const rightValue = right[1].filter((item) => (item.axis || "primary") === "primary").reduce((sum, item) => sum + item.value, 0);
      return sort === "value-asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }
  return entries.flatMap(([, items]) => items);
}

function collapseChartData(data: ChartDatum[], axis: "primary" | "secondary" = "primary") {
  const grouped = new Map<string, ChartDatum>();
  data
    .filter((datum) => (datum.axis || "primary") === axis)
    .forEach((datum) => {
      const key = String(datum.rawLabel ?? datum.label ?? "");
      const current = grouped.get(key) || { label: datum.label, rawLabel: datum.rawLabel, value: 0 };
      current.value += datum.value;
      grouped.set(key, current);
    });
  return Array.from(grouped.values());
}

function deriveCategories(data: ChartDatum[]) {
  return Array.from(new Set(data.map((datum) => String(datum.rawLabel ?? datum.label ?? "")))).map((rawLabel) => {
    const match = data.find((datum) => String(datum.rawLabel ?? datum.label ?? "") === rawLabel);
    return { rawLabel, label: match?.label || rawLabel };
  });
}

function deriveSeries(data: ChartDatum[], axis: "primary" | "secondary" = "primary") {
  const scoped = data.filter((datum) => (datum.axis || "primary") === axis);
  const rawSeries = Array.from(new Set(scoped.map((datum) => String(datum.rawSeries || datum.series || ""))));
  if (!rawSeries.length || (rawSeries.length === 1 && rawSeries[0] === "")) {
    return [{ rawSeries: "", label: "Values" }];
  }
  return rawSeries.map((seriesKey) => {
    const match = scoped.find((datum) => String(datum.rawSeries || datum.series || "") === seriesKey);
    return { rawSeries: seriesKey, label: match?.series || seriesKey || "Values" };
  });
}

function valueForCategory(data: ChartDatum[], rawLabel: string, rawSeries: string, axis: "primary" | "secondary" = "primary") {
  return data
    .filter((datum) => (datum.axis || "primary") === axis)
    .filter((datum) => String(datum.rawLabel ?? datum.label ?? "") === rawLabel)
    .filter((datum) => String(datum.rawSeries || datum.series || "") === rawSeries)
    .reduce((sum, datum) => sum + datum.value, 0);
}

function getChartFieldId(report: ReportDefinition) {
  return report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
}

function fieldLabel(report: ReportDefinition, table: TableDefinition | undefined, fieldId: string) {
  if (!fieldId) return "";
  if (table) return getReportFieldLabel(report, table, fieldId);
  return report.displayLabels?.fields?.[fieldId] || fieldId;
}

function chartAxisLabels(report: ReportDefinition, table: TableDefinition | undefined) {
  const xFieldId = getChartFieldId(report);
  const primaryFieldLabel = report.view.chartValueFieldId ? fieldLabel(report, table, report.view.chartValueFieldId) : "";
  return {
    xAxisTitle: report.view.chartXAxisLabel?.trim() || (xFieldId ? fieldLabel(report, table, xFieldId) : ""),
    yAxisTitle: report.view.chartYAxisLabel?.trim() || primaryFieldLabel || (report.view.chartAggregation === "count" ? "Rows" : "")
  };
}

function writeRowsSheet(
  sheet: any,
  report: ReportDefinition,
  table: TableDefinition | undefined,
  result: ReportRunResult,
  startRow: number,
  startCol: number
) {
  const headers = report.selectedFieldIds.map((fieldId) => fieldLabel(report, table, fieldId));
  headers.forEach((header, index) => {
    const cell = sheet.getCell(startRow, startCol + index);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
  });
  result.rows.forEach((row: DataRow, rowIndex: number) => {
    report.selectedFieldIds.forEach((fieldId, fieldIndex) => {
      sheet.getCell(startRow + rowIndex + 1, startCol + fieldIndex).value = formatCell(row[fieldId]);
    });
  });
  return startRow + result.rows.length + 2;
}

function isBigNumberChartType(chartType: ChartType) {
  return chartType === "kpi-card" || chartType === "big-number-card";
}

// kpi-card / big-number-card aren't charts in Excel's model at all — the live
// dashboard just shows one large number and a label, so we write that
// directly as styled cells instead of forcing it through the chart-drawing
// path (which would otherwise fall back to an unrelated bar-shaped chart).
function writeBigNumberBlock(sheet: any, report: ReportDefinition, result: ReportRunResult, startRow: number, startCol: number, endCol: number) {
  const datum = result.chartData[0];
  const value = datum ? datum.value : 0;
  const label = (datum && datum.label) || report.view.chartTitle || report.name;
  const palette = getPalette(report.view.chartColors);
  const color = normalizeHexColor(colorForDatum(report, palette, 0, datum || label));
  sheet.mergeCells(startRow, startCol, startRow + 1, endCol);
  const valueCell = sheet.getCell(startRow, startCol);
  valueCell.value = value;
  valueCell.font = { bold: true, size: 28, color: { argb: `FF${color}` } };
  sheet.mergeCells(startRow + 2, startCol, startRow + 2, endCol);
  const labelCell = sheet.getCell(startRow + 2, startCol);
  labelCell.value = label;
  labelCell.font = { size: 12, color: { argb: "FF5B6B60" } };
  return startRow + 4;
}

function writeSummarySheet(sheet: any, result: ReportRunResult, startRow: number, startCol: number, endCol: number) {
  if (!result.summary.length) return startRow;
  let col = startCol;
  result.summary.forEach((item) => {
    if (col > endCol) return;
    sheet.getCell(startRow, col).value = item.value;
    sheet.getCell(startRow, col).font = { bold: true, size: 14 };
    sheet.getCell(startRow + 1, col).value = item.label;
    col += 2;
  });
  return startRow + 3;
}

type CrosstabData = { columns: string[]; rows: Array<{ label: string; formatted: string[] }> };

// Reports have a "pivot orientation" setting (report.view.pivotOrientation) that
// the live dashboard honors — "vertical" transposes the table so categories run
// top-to-bottom as rows instead of left-to-right as columns. Must match here too,
// or a crosstab that reads as a tall list of categories on screen (e.g. an aging
// bucket breakdown) comes out as one wide, hard-to-read row in the export instead.
function crosstabFootprint(crosstab: CrosstabData, orientation: "horizontal" | "vertical") {
  return orientation === "vertical"
    ? { width: 1 + crosstab.rows.length, height: 1 + crosstab.columns.length }
    : { width: 1 + crosstab.columns.length, height: 1 + crosstab.rows.length };
}

function writeCrosstabBlock(
  sheet: any,
  crosstab: CrosstabData,
  startRow: number,
  startCol: number,
  orientation: "horizontal" | "vertical" = "horizontal"
) {
  sheet.getCell(startRow, startCol).value = "";
  if (orientation === "vertical") {
    crosstab.rows.forEach((row, ri) => {
      const cell = sheet.getCell(startRow, startCol + ri + 1);
      cell.value = row.label || "(blank)";
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
    });
    crosstab.columns.forEach((col, ci) => {
      const labelCell = sheet.getCell(startRow + ci + 1, startCol);
      labelCell.value = col || "(blank)";
      labelCell.font = { bold: true };
      crosstab.rows.forEach((row, ri) => {
        sheet.getCell(startRow + ci + 1, startCol + ri + 1).value = row.formatted[ci];
      });
    });
    return startRow + crosstab.columns.length + 2;
  }
  crosstab.columns.forEach((col, ci) => {
    const cell = sheet.getCell(startRow, startCol + ci + 1);
    cell.value = col || "(blank)";
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
  });
  crosstab.rows.forEach((row, ri) => {
    const labelCell = sheet.getCell(startRow + ri + 1, startCol);
    labelCell.value = row.label;
    labelCell.font = { bold: true };
    row.formatted.forEach((val, vi) => {
      sheet.getCell(startRow + ri + 1, startCol + vi + 1).value = val;
    });
  });
  return startRow + crosstab.rows.length + 2;
}

function writeHiddenChartData(
  dataSheet: any,
  dataSheetName: string,
  nextRow: number,
  report: ReportDefinition,
  result: ReportRunResult,
  table: TableDefinition | undefined,
  chartId: number
): { nextRow: number; source: NativeChartSource } {
  const normalizedType = normalizeChartType(report.view.chartType, report.view.chartOrientation);
  const sortedData = sortChartData(result.chartData, normalizedType, report.view.chartSort || "value-desc");
  const palette = getPalette(report.view.chartColors);
  const simpleTypes = [
    "pie", "donut", "radial-bar", "progress-bar", "gauge", "kpi-card", "big-number-card",
    "funnel", "3d-funnel", "waterfall", "bullet"
  ].includes(normalizedType);
  const scatterLike = normalizedType === "scatter" || normalizedType === "bubble" || normalizedType === "3d-scatter";
  const isBubble = normalizedType === "bubble";
  const isCombo = normalizedType === "line-bar";
  const collapsed = collapseChartData(sortedData);
  const derivedSeries = deriveSeries(sortedData);
  const collapseExcessSeries = !simpleTypes && derivedSeries.length > MAX_NATIVE_CHART_SERIES;
  const categories = simpleTypes
    ? collapsed.map((item) => ({ rawLabel: String(item.rawLabel ?? item.label ?? ""), label: item.label }))
    : deriveCategories(sortedData);
  const seriesDefinitions = simpleTypes
    ? [{ rawSeries: "", label: report.view.chartTitle || report.name }]
    : collapseExcessSeries
      ? [{ rawSeries: "", label: "Total" }]
      : derivedSeries;
  const totalValue = collapsed.reduce((sum, item) => sum + item.value, 0);
  const visiblePieLabelIndexes = new Set(
    simpleTypes
      ? collapsed
          .map((item, index) => ({ index, value: item.value }))
          .sort((left, right) => right.value - left.value)
          .filter((item, rank) => rank < 4 || (totalValue > 0 && item.value / totalValue >= 0.035))
          .map((item) => item.index)
      : []
  );
  const headerRow = nextRow;
  const dataStartRow = headerRow + 1;
  dataSheet.getCell(headerRow, 1).value = `${report.name} category`;
  const series: NativeChartSeries[] = seriesDefinitions.map((definition, index) => {
    const column = index + 2;
    const label = definition.label || report.view.chartTitle || report.name;
    dataSheet.getCell(headerRow, column).value = label;
    return {
      label,
      rawSeries: definition.rawSeries,
      values: categories.map((category) => simpleTypes
        ? (collapsed.find((item) => String(item.rawLabel ?? item.label ?? "") === category.rawLabel)?.value || 0)
        : collapseExcessSeries
          ? (collapsed.find((item) => String(item.rawLabel ?? item.label ?? "") === category.rawLabel)?.value || 0)
        : valueForCategory(sortedData, category.rawLabel, definition.rawSeries)),
      color: colorForDatum(report, palette, index, definition.rawSeries || label),
      pointColors: simpleTypes
        ? categories.map((category, categoryIndex) => {
            const datum = collapsed.find((item) => String(item.rawLabel ?? item.label ?? "") === category.rawLabel) || category.label;
            return colorForDatum(report, palette, categoryIndex, datum);
          })
        : undefined,
      nameRef: cellRef(dataSheetName, column, headerRow),
      valuesRef: rangeRef(dataSheetName, column, dataStartRow, column, dataStartRow + Math.max(categories.length - 1, 0))
    };
  });
  categories.forEach((category, rowIndex) => {
    const numericCategory = Number(category.rawLabel);
    dataSheet.getCell(dataStartRow + rowIndex, 1).value = scatterLike
      ? (Number.isFinite(numericCategory) ? numericCategory : rowIndex + 1)
      : (category.label || "Unassigned");
    series.forEach((item, seriesIndex) => {
      dataSheet.getCell(dataStartRow + rowIndex, seriesIndex + 2).value = item.values[rowIndex] || 0;
    });
  });

  let nextCol = series.length + 2;

  // Bubble size: pulled from the secondary-axis field (chartSecondaryValueFieldId),
  // matching what the live dashboard uses to scale bubble radius — falls back to
  // the primary value itself when no secondary field is configured, same as ChartPreview.
  if (isBubble && series.length) {
    const sizeCol = nextCol;
    nextCol += 1;
    dataSheet.getCell(headerRow, sizeCol).value = "Size";
    categories.forEach((category, rowIndex) => {
      const secondaryValue = valueForCategory(sortedData, category.rawLabel, series[0].rawSeries, "secondary");
      dataSheet.getCell(dataStartRow + rowIndex, sizeCol).value = secondaryValue || series[0].values[rowIndex] || 0;
    });
    series[0].sizeRef = rangeRef(dataSheetName, sizeCol, dataStartRow, sizeCol, dataStartRow + Math.max(categories.length - 1, 0));
  }

  // Combo chart (line-bar / pareto): primary series render as bars, secondary-axis
  // series render as report.view.chartSecondarySeriesType on a second value axis —
  // same split the live ChartPreview combo renderer uses.
  let secondarySeries: NativeChartSeries[] | undefined;
  if (isCombo && report.view.chartUseSecondaryAxis) {
    const secondaryDefinitions = deriveSeries(sortedData, "secondary");
    secondarySeries = secondaryDefinitions.map((definition) => {
      const column = nextCol;
      nextCol += 1;
      const label = definition.label || "Secondary";
      dataSheet.getCell(headerRow, column).value = label;
      const values = categories.map((category) => valueForCategory(sortedData, category.rawLabel, definition.rawSeries, "secondary"));
      values.forEach((value, rowIndex) => {
        dataSheet.getCell(dataStartRow + rowIndex, column).value = value || 0;
      });
      return {
        label,
        rawSeries: definition.rawSeries,
        values,
        color: colorForDatum(report, palette, series.length + secondaryDefinitions.indexOf(definition), definition.rawSeries || label),
        nameRef: cellRef(dataSheetName, column, headerRow),
        valuesRef: rangeRef(dataSheetName, column, dataStartRow, column, dataStartRow + Math.max(categories.length - 1, 0))
      };
    });
  }

  const { xAxisTitle, yAxisTitle } = chartAxisLabels(report, table);
  return {
    nextRow: dataStartRow + Math.max(categories.length, 1) + 2,
    source: {
      id: chartId,
      title: report.view.chartTitle || report.name,
      chartType: normalizedType,
      originalChartType: report.view.chartType,
      chartOrientation: report.view.chartOrientation,
      chartSort: report.view.chartSort || "value-desc",
      showLegend: report.view.chartShowLegend !== false,
      showValues: report.view.chartShowValues !== false,
      hiddenLabelIndexes: simpleTypes
        ? categories.map((_, index) => index).filter((index) => !visiblePieLabelIndexes.has(index))
        : [],
      xAxisTitle,
      yAxisTitle,
      categories: categories.map((category) => category.label || "Unassigned"),
      categoryRef: rangeRef(dataSheetName, 1, dataStartRow, 1, dataStartRow + Math.max(categories.length - 1, 0)),
      series,
      secondarySeries,
      secondaryAxisTitle: report.view.chartSecondaryYAxisLabel?.trim() || "",
      secondarySeriesType: report.view.chartSecondarySeriesType || "line",
      maxValue: Math.max(...collapsed.map((item) => item.value), 1)
    }
  };
}

function chartKind(source: NativeChartSource) {
  if (source.chartType === "pie" || source.chartType === "3d-pie") return "pie";
  if (source.chartType === "donut" || source.chartType === "3d-donut") return "doughnut";
  if (source.chartType === "line-bar") return "combo";
  if (source.chartType === "line" || source.chartType === "spline") return "line";
  if (source.chartType === "area" || source.chartType === "area-spline" || source.chartType === "streamgraph") return "area";
  if (source.chartType === "radar") return "radar";
  if (source.chartType === "bubble") return "bubble";
  if (source.chartType === "scatter" || source.chartType === "3d-scatter") return "scatter";
  if (source.chartType === "funnel" || source.chartType === "3d-funnel" || source.chartType === "sankey") return "funnel";
  if (source.chartType === "waterfall") return "waterfall";
  if (source.chartType === "gauge" || source.chartType === "solid-gauge") return "gauge";
  if (source.chartType === "radial-bar") return "radialBar";
  if (source.chartType === "progress-bar" || source.chartType === "bullet" || source.chartType === "box-plot") return "bulletBar";
  return "bar";
}

function chartTitleXml(title: string) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function axisTitleXml(title: string) {
  if (!title) return "";
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100" b="1"/><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function shapeColorXml(color: string) {
  return `<c:spPr><a:solidFill><a:srgbClr val="${attr(color)}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${attr(color)}"/></a:solidFill></a:ln></c:spPr>`;
}

function noFillSpPrXml() {
  return `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>`;
}

function pointColorXml(colors: string[] | undefined) {
  return (colors || []).map((color, index) => `<c:dPt><c:idx val="${index}"/>${shapeColorXml(color)}</c:dPt>`).join("");
}

function dataLabelsXml(showValues: boolean, position = "", hiddenIndexes: number[] = [], numFmt = "") {
  const hidden = hiddenIndexes.map((index) => `<c:dLbl><c:idx val="${index}"/><c:delete val="1"/></c:dLbl>`).join("");
  const fmt = numFmt ? `<c:numFmt formatCode="${attr(numFmt)}" sourceLinked="0"/>` : "";
  return `<c:dLbls>${hidden}${fmt}${position ? `<c:dLblPos val="${attr(position)}"/>` : ""}<c:showLegendKey val="0"/><c:showVal val="${showValues ? 1 : 0}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>${position === "outEnd" ? "<c:showLeaderLines val=\"1\"/>" : ""}</c:dLbls>`;
}

function noLabelsXml() {
  return `<c:dLbls><c:delete val="1"/></c:dLbls>`;
}

function numLitXml(values: number[]) {
  const pts = values.map((value, index) => `<c:pt idx="${index}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`).join("");
  return `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numLit>`;
}

function strLitXml(values: string[]) {
  const pts = values.map((value, index) => `<c:pt idx="${index}"><c:v>${xml(value)}</c:v></c:pt>`).join("");
  return `<c:strLit><c:ptCount val="${values.length}"/>${pts}</c:strLit>`;
}

function seriesXml(series: NativeChartSeries[], categoryRef: string, startIndex = 0, opts: { smooth?: boolean } = {}) {
  return series.map((entry, offset) => `
    <c:ser>
      <c:idx val="${startIndex + offset}"/><c:order val="${startIndex + offset}"/>
      <c:tx><c:strRef><c:f>${xml(entry.nameRef)}</c:f></c:strRef></c:tx>
      ${shapeColorXml(entry.color)}
      ${pointColorXml(entry.pointColors)}
      <c:cat><c:strRef><c:f>${xml(categoryRef)}</c:f></c:strRef></c:cat>
      <c:val><c:numRef><c:f>${xml(entry.valuesRef)}</c:f></c:numRef></c:val>
      ${opts.smooth ? "<c:smooth val=\"1\"/>" : ""}
    </c:ser>`).join("");
}

function categorySeriesXml(source: NativeChartSource) {
  const smooth = source.chartType === "spline";
  return seriesXml(source.series, source.categoryRef, 0, { smooth });
}

function scatterSeriesXml(source: NativeChartSource) {
  const first = source.series[0];
  if (!first) return "";
  return `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${xml(first.nameRef)}</c:f></c:strRef></c:tx>${shapeColorXml(first.color)}<c:xVal><c:numRef><c:f>${xml(source.categoryRef)}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xml(first.valuesRef)}</c:f></c:numRef></c:yVal></c:ser>`;
}

function bubbleSeriesXml(source: NativeChartSource) {
  const first = source.series[0];
  if (!first) return "";
  return `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${xml(first.nameRef)}</c:f></c:strRef></c:tx>${shapeColorXml(first.color)}<c:xVal><c:numRef><c:f>${xml(source.categoryRef)}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xml(first.valuesRef)}</c:f></c:numRef></c:yVal><c:bubbleSize><c:numRef><c:f>${xml(first.sizeRef || first.valuesRef)}</c:f></c:numRef></c:bubbleSize><c:bubble3D val="0"/></c:ser>`;
}

function axesXml(catAxisId: number, valAxisId: number, source: NativeChartSource, opts: { reverseCategories?: boolean; hideValueAxis?: boolean } = {}) {
  const catOrientation = opts.reverseCategories ? "maxMin" : "minMax";
  const valAxis = opts.hideValueAxis
    ? `<c:valAx><c:axId val="${valAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="${catAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
    : `<c:valAx><c:axId val="${valAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${axisTitleXml(source.yAxisTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  return `
    <c:catAx><c:axId val="${catAxisId}"/><c:scaling><c:orientation val="${catOrientation}"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml(source.xAxisTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
    ${valAxis}`;
}

function comboAxesXml(catAxisId: number, valAxisId: number, valAxisId2: number, source: NativeChartSource) {
  return `
    <c:catAx><c:axId val="${catAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml(source.xAxisTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
    <c:valAx><c:axId val="${valAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${axisTitleXml(source.yAxisTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>
    <c:valAx><c:axId val="${valAxisId2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="r"/>${axisTitleXml(source.secondaryAxisTitle || "")}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxisId}"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>`;
}

function nativeChartXml(source: NativeChartSource) {
  const kind = chartKind(source);
  const catAxisId = 100000 + source.id * 2;
  const valAxisId = catAxisId + 1;
  // Gauge/radial-bar/funnel/waterfall/bullet are all built from synthetic
  // helper series (invisible offsets, remainder slices) that would make a
  // traditional legend confusing, so they render without one regardless of
  // the report's legend setting — matching how the live dashboard shows
  // these as labeled rows/rings rather than a chart-style legend box.
  const suppressLegend = ["gauge", "radialBar", "funnel", "waterfall", "bulletBar"].includes(kind);
  const legend = source.showLegend && !suppressLegend ? `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>` : "";
  let plotXml = "";
  if (kind === "pie" || kind === "doughnut") {
    const tag = kind === "doughnut" ? "doughnutChart" : "pieChart";
    plotXml = `<c:${tag}><c:varyColors val="1"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues, "bestFit", source.hiddenLabelIndexes)}${kind === "doughnut" ? "<c:holeSize val=\"55\"/>" : "<c:firstSliceAng val=\"0\"/>"}</c:${tag}>`;
  } else if (kind === "line" || kind === "area") {
    const tag = kind === "area" ? "areaChart" : "lineChart";
    const grouping = kind === "area" && source.chartType === "streamgraph" ? "stacked" : "standard";
    plotXml = `<c:${tag}><c:grouping val="${grouping}"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:${tag}>${axesXml(catAxisId, valAxisId, source)}`;
  } else if (kind === "radar") {
    plotXml = `<c:radarChart><c:radarStyle val="standard"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:radarChart>${axesXml(catAxisId, valAxisId, source)}`;
  } else if (kind === "scatter") {
    plotXml = `<c:scatterChart><c:scatterStyle val="marker"/>${scatterSeriesXml(source)}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:scatterChart>${axesXml(catAxisId, valAxisId, source)}`;
  } else if (kind === "bubble") {
    plotXml = `<c:bubbleChart><c:varyColors val="0"/>${bubbleSeriesXml(source)}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:bubbleChart>${axesXml(catAxisId, valAxisId, source)}`;
  } else if (kind === "combo") {
    const valAxisId2 = catAxisId + 2;
    const secType = source.secondarySeriesType || "line";
    const secTag = secType === "area" ? "areaChart" : secType === "bar" || secType === "column" ? "barChart" : "lineChart";
    const secondary = source.secondarySeries || [];
    const barPlot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${seriesXml(source.series, source.categoryRef, 0)}${dataLabelsXml(source.showValues, "outEnd")}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:barChart>`;
    const secondaryGrouping = secTag === "barChart" ? `<c:barDir val="col"/><c:grouping val="clustered"/>` : `<c:grouping val="standard"/>`;
    const secPlot = secondary.length
      ? `<c:${secTag}>${secondaryGrouping}<c:varyColors val="0"/>${seriesXml(secondary, source.categoryRef, source.series.length, { smooth: false })}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId2}"/></c:${secTag}>`
      : "";
    plotXml = barPlot + secPlot + comboAxesXml(catAxisId, valAxisId, valAxisId2, source);
  } else if (kind === "funnel") {
    const primary = source.series[0];
    const values = primary?.values || [];
    const max = source.maxValue || Math.max(...values, 1);
    const offset = values.map((value) => Math.max(0, (max - value) / 2));
    const offsetSer = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Offset</c:v></c:tx>${noFillSpPrXml()}${noLabelsXml()}<c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat><c:val>${numLitXml(offset)}</c:val></c:ser>`;
    const valueSer = `<c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:v>${xml(source.title)}</c:v></c:tx>${shapeColorXml(primary?.color || CHART_COLORS[0])}${pointColorXml(primary?.pointColors)}${dataLabelsXml(source.showValues, "ctr")}<c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${xml(primary?.valuesRef || "")}</c:f></c:numRef></c:val></c:ser>`;
    plotXml = `<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${offsetSer}${valueSer}<c:overlap val="100"/><c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:barChart>${axesXml(catAxisId, valAxisId, source, { reverseCategories: true, hideValueAxis: true })}`;
  } else if (kind === "waterfall") {
    const primary = source.series[0];
    const values = primary?.values || [];
    let running = 0;
    const bases: number[] = [];
    const magnitudes: number[] = [];
    values.forEach((value) => {
      const before = running;
      const after = running + value;
      bases.push(Math.min(before, after));
      magnitudes.push(Math.abs(value));
      running = after;
    });
    const baseSer = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Base</c:v></c:tx>${noFillSpPrXml()}${noLabelsXml()}<c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat><c:val>${numLitXml(bases)}</c:val></c:ser>`;
    const deltaSer = `<c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:v>${xml(source.title)}</c:v></c:tx>${shapeColorXml(primary?.color || CHART_COLORS[0])}${pointColorXml(primary?.pointColors)}${dataLabelsXml(source.showValues, "ctr")}<c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat><c:val>${numLitXml(magnitudes)}</c:val></c:ser>`;
    plotXml = `<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${baseSer}${deltaSer}<c:overlap val="100"/><c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:barChart>${axesXml(catAxisId, valAxisId, source, { reverseCategories: true, hideValueAxis: true })}`;
  } else if (kind === "bulletBar") {
    const primary = source.series[0];
    const values = (primary?.values || []).map((value) => Math.max(0, Math.min(100, value)));
    const remainder = values.map((value) => 100 - value);
    const valueSer = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(source.title)}</c:v></c:tx>${shapeColorXml(primary?.color || CHART_COLORS[0])}${pointColorXml(primary?.pointColors)}${dataLabelsXml(source.showValues, "ctr", [], "0\"%\"")}<c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat><c:val>${numLitXml(values)}</c:val></c:ser>`;
    const remainderSer = `<c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:v>Remaining</c:v></c:tx>${shapeColorXml("E7EAE3")}${noLabelsXml()}<c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat><c:val>${numLitXml(remainder)}</c:val></c:ser>`;
    plotXml = `<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>${valueSer}${remainderSer}<c:overlap val="100"/><c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:barChart>${axesXml(catAxisId, valAxisId, source, { reverseCategories: true, hideValueAxis: true })}`;
  } else if (kind === "gauge") {
    const value = source.series[0]?.values?.[0] || 0;
    const max = source.maxValue || Math.max(value, 1);
    const remainder = Math.max(0, max - value);
    const color = source.series[0]?.color || CHART_COLORS[0];
    const ser = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(source.title)}</c:v></c:tx>${shapeColorXml(color)}<c:dPt><c:idx val="1"/>${shapeColorXml("E3E7DF")}</c:dPt><c:dPt><c:idx val="2"/>${noFillSpPrXml()}</c:dPt>${noLabelsXml()}<c:cat>${strLitXml([source.title, "Remaining", "(hidden)"])}</c:cat><c:val>${numLitXml([value, remainder, max])}</c:val></c:ser>`;
    plotXml = `<c:doughnutChart><c:varyColors val="0"/>${ser}<c:firstSliceAng val="270"/><c:holeSize val="70"/></c:doughnutChart>`;
  } else if (kind === "radialBar") {
    const cats = source.categories.slice(0, 5);
    const primary = source.series[0];
    const max = source.maxValue || Math.max(...(primary?.values || []), 1);
    const ringSeries = cats.map((cat, index) => {
      const value = primary?.values?.[index] || 0;
      const remainder = Math.max(0, max - value);
      const color = primary?.pointColors?.[index] || CHART_COLORS[index % CHART_COLORS.length];
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xml(cat)}</c:v></c:tx>${shapeColorXml(color)}<c:dPt><c:idx val="1"/>${shapeColorXml("EEF1EC")}</c:dPt>${noLabelsXml()}<c:cat>${strLitXml([cat, "Remaining"])}</c:cat><c:val>${numLitXml([value, remainder])}</c:val></c:ser>`;
    }).join("");
    plotXml = `<c:doughnutChart><c:varyColors val="0"/>${ringSeries}<c:firstSliceAng val="0"/><c:holeSize val="20"/></c:doughnutChart>`;
  } else {
    const horizontal = source.originalChartType === "horizontal-bar"
      || source.originalChartType === "horizontal-stacked-bar"
      || (source.chartType === "bar" && source.chartOrientation === "horizontal")
      || (source.chartType === "stacked-bar" && source.chartOrientation === "horizontal");
    const stacked = source.chartType === "stacked-bar" || source.chartType === "stacked-column";
    const barLabelPos = stacked ? "ctr" : "outEnd";
    plotXml = `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues, barLabelPos)}${stacked ? "<c:overlap val=\"100\"/>" : ""}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:barChart>${axesXml(catAxisId, valAxisId, source)}`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>
  <c:chart>${chartTitleXml(source.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plotXml}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>
  <c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
</c:chartSpace>`;
}

function drawingXml(charts: NativeChartPlacement[]) {
  const anchors = charts.map((placement, index) => `
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${placement.fromCol}</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${placement.fromRow}</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${placement.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${placement.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Native Chart ${placement.chart.id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

function drawingRelsXml(charts: NativeChartPlacement[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((placement, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${placement.chart.id}.xml"/>`).join("")}</Relationships>`;
}

function nextRelationshipId(relsXml: string) {
  const ids = Array.from(relsXml.matchAll(/Id="rId(\d+)"/g)).map((match) => Number(match[1]));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

function addRelationship(relsXml: string | null, id: string, type: string, target: string) {
  const relationship = `<Relationship Id="${attr(id)}" Type="${attr(type)}" Target="${attr(target)}"/>`;
  if (!relsXml) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`;
  }
  return relsXml.replace("</Relationships>", `${relationship}</Relationships>`);
}

function addWorksheetDrawing(sheetXml: string, relationshipId: string) {
  let next = sheetXml;
  if (!/\sxmlns:r=/.test(next)) {
    next = next.replace("<worksheet ", "<worksheet xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ");
  }
  if (next.includes("<drawing ")) {
    return next.replace(/<drawing[^>]+\/>/, `<drawing r:id="${attr(relationshipId)}"/>`);
  }
  return next.replace("</worksheet>", `<drawing r:id="${attr(relationshipId)}"/></worksheet>`);
}

function addContentTypeOverride(contentTypesXml: string, partName: string, contentType: string) {
  if (contentTypesXml.includes(`PartName="${partName}"`)) return contentTypesXml;
  return contentTypesXml.replace("</Types>", `<Override PartName="${attr(partName)}" ContentType="${attr(contentType)}"/></Types>`);
}

async function getWorkbookSheetPaths(zip: any) {
  const workbookXml = await zipText(zip, "xl/workbook.xml");
  const workbookRelsXml = await zipText(zip, "xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  Array.from(workbookRelsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)).forEach((match) => {
    rels.set(match[1], match[2]);
  });
  const paths = new Map<string, string>();
  Array.from(workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g)).forEach((match) => {
    const name = decodeXml(match[1]);
    const target = rels.get(match[2]) || "";
    paths.set(name, workbookTargetPath(target));
  });
  return paths;
}

async function zipText(zip: any, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Workbook package is missing ${path}.`);
  return file.async("string");
}

function workbookTargetPath(target: string) {
  const cleaned = target.replace(/^\//, "");
  return cleaned.startsWith("xl/") ? cleaned : `xl/${cleaned}`;
}

async function injectNativeCharts(workbookBlob: Blob, chartsBySheet: Map<string, NativeChartPlacement[]>) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await workbookBlob.arrayBuffer());
  const sheetPaths = await getWorkbookSheetPaths(zip);
  let contentTypesXml = await zipText(zip, "[Content_Types].xml");
  let drawingIndex = 1;
  for (const [sheetName, placements] of chartsBySheet.entries()) {
    if (!placements.length) continue;
    const sheetPath = sheetPaths.get(sheetName);
    if (!sheetPath) continue;
    const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
    const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
    zip.file(drawingPath, drawingXml(placements));
    zip.file(drawingRelsPath, drawingRelsXml(placements));
    contentTypesXml = addContentTypeOverride(contentTypesXml, `/xl/drawings/drawing${drawingIndex}.xml`, DRAWING_CONTENT_TYPE);
    placements.forEach((placement) => {
      zip.file(`xl/charts/chart${placement.chart.id}.xml`, nativeChartXml(placement.chart));
      contentTypesXml = addContentTypeOverride(contentTypesXml, `/xl/charts/chart${placement.chart.id}.xml`, CHART_CONTENT_TYPE);
    });
    const relsPath = sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
    const currentRelsFile = zip.file(relsPath);
    const currentRels = currentRelsFile ? await currentRelsFile.async("string") : null;
    const relationshipId = nextRelationshipId(currentRels || "");
    zip.file(relsPath, addRelationship(
      currentRels,
      relationshipId,
      DRAWING_RELATIONSHIP_TYPE,
      `../drawings/drawing${drawingIndex}.xml`
    ));
    const sheetXml = await zipText(zip, sheetPath);
    zip.file(sheetPath, addWorksheetDrawing(sheetXml, relationshipId));
    drawingIndex += 1;
  }
  zip.file("[Content_Types].xml", contentTypesXml);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function resolveWidgetResult(
  widget: DashboardRunResult["tabs"][number]["widgets"][number],
  exportResultsByWidgetId?: Record<string, ReportRunResult>
) {
  const exported = exportResultsByWidgetId?.[widget.widgetId];
  if (!exported) return widget.result;
  return {
    ...exported,
    rows: exported.rows.length ? exported.rows : widget.result.rows,
    summary: exported.summary.length ? exported.summary : widget.result.summary,
    chartData: exported.chartData.length ? exported.chartData : widget.result.chartData,
    warnings: exported.warnings.length ? exported.warnings : widget.result.warnings,
    totalRows: exported.totalRows || widget.result.totalRows,
    crosstab: exported.crosstab || widget.result.crosstab
  };
}

export async function exportDashboardNativeChartWorkbook(
  dashboard: DashboardDefinition,
  rendered: DashboardRunResult,
  exportResultsByWidgetId?: Record<string, ReportRunResult>,
  options: NativeDashboardExportOptions = {}
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  // Overview sheet: shows summary metrics and charts for every widget
  const includeOverviewSheet = options.includeOverviewSheet !== false;
  const overview = includeOverviewSheet ? workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames)) : null;
  if (overview) {
    overview.columns = Array.from({ length: 12 }, () => ({ width: 18 }));
    overview.getCell("A1").value = dashboard.name;
    overview.getCell("A1").font = { bold: true, size: 18 };
    overview.getCell("A2").value = dashboard.description || "";
    overview.mergeCells("A2:L2");
  }

  const dataSheetName = safeSheetName("_chart_src", usedNames);
  const dataSheet = workbook.addWorksheet(dataSheetName);
  dataSheet.state = "hidden";
  dataSheet.columns = Array.from({ length: 24 }, () => ({ width: 22 }));
  let dataRow = 1;
  let chartId = 1;
  const chartsBySheet = new Map<string, NativeChartPlacement[]>();

  // Track overview row position
  let overviewRow = 4;
  const WIDGET_GAP_COLS = 2;
  const DEFAULT_CHART_WIDTH = 12;

  rendered.tabs.forEach((tab) => {
    // Write tab header on overview
    if (overview) {
      overview.getCell(overviewRow, 1).value = tab.name;
      overview.getCell(overviewRow, 1).font = { bold: true, size: 13 };
      overviewRow += 1;
    }

    const sheet = workbook.addWorksheet(safeSheetName(tab.name, usedNames));
    // Column widths can't be predicted up front — widgets placed side-by-side
    // may need dozens of columns for a wide crosstab — so provision generously.
    sheet.columns = Array.from({ length: 80 }, () => ({ width: 16 }));
    sheet.getCell("A1").value = tab.name;
    sheet.getCell("A1").font = { bold: true, size: 18 };
    sheet.getCell("A2").value = dashboard.name;

    const sheetCharts: NativeChartPlacement[] = [];
    let currentRow = 4;

    // Widgets placed on the same on-screen dashboard row are kept side-by-side
    // here too, matching the live layout — but each widget's column span is
    // sized from its ACTUAL content (crosstab column count, honoring pivot
    // orientation) rather than its on-screen grid width, with a fixed gap
    // between widgets. A crosstab's column count is driven by distinct field
    // values, not layout, so trusting the narrow on-screen grid width let a
    // wide crosstab overflow straight into the next widget's columns.
    const dashboardTabDef = dashboard.tabs.find((t) => t.id === tab.id);
    const placementsMap = dashboardTabDef
      ? new Map(getDashboardWidgetPlacements(dashboardTabDef).map((p) => [p.widgetId, p]))
      : new Map<string, ReturnType<typeof getDashboardWidgetPlacements>[number]>();

    const placed = tab.widgets
      .flatMap((w) => {
        const p = placementsMap.get(w.widgetId);
        return p ? [{ widget: w, placement: p }] : [];
      })
      .sort((a, b) =>
        a.placement.startRow !== b.placement.startRow
          ? a.placement.startRow - b.placement.startRow
          : a.placement.startCol - b.placement.startCol
      );
    const unplacedWidgets = tab.widgets.filter((w) => !placementsMap.has(w.widgetId));

    const rowGroups: (typeof placed)[] = [];
    let groupMaxEndRow = -1;
    let curGroup: typeof placed = [];
    for (const item of placed) {
      if (curGroup.length === 0 || item.placement.startRow <= groupMaxEndRow) {
        curGroup.push(item);
        groupMaxEndRow = Math.max(groupMaxEndRow, item.placement.endRow);
      } else {
        rowGroups.push(curGroup);
        curGroup = [item];
        groupMaxEndRow = item.placement.endRow;
      }
    }
    if (curGroup.length) rowGroups.push(curGroup);
    for (const w of unplacedWidgets) {
      rowGroups.push([{ widget: w, placement: { widgetId: w.widgetId, startCol: 1, endCol: 12, startRow: 0, endRow: 0 } as any }]);
    }

    for (const group of rowGroups) {
      const groupStartRow = currentRow;
      let groupEndRow = currentRow;
      let cursorCol = 1;

      for (const { widget } of group) {
        const exportResult = resolveWidgetResult(widget, exportResultsByWidgetId);
        const table = options.tablesById?.[widget.report.sourceTableId];
        const widgetTitle = widget.report.name || widget.widget.title;
        const widgetDisplayMode = resolveDashboardWidgetRenderMode(widget.widget, widget.report.view.mode);
        const isSummaryMode = widgetDisplayMode === "summary";
        const orientation: "horizontal" | "vertical" = widget.report.view.pivotOrientation === "vertical" ? "vertical" : "horizontal";
        const hasChart = widget.status === "complete" && widgetShowsChart(widget.widget, widget.report) && exportResult.chartData.length > 0;

        let widgetWidth = 6;
        if (isSummaryMode && exportResult.crosstab) {
          widgetWidth = Math.max(widgetWidth, crosstabFootprint(exportResult.crosstab, orientation).width);
        }
        if ((widget.widget.showSummary || isSummaryMode) && exportResult.summary.length) {
          widgetWidth = Math.max(widgetWidth, Math.min(exportResult.summary.length, 6) * 2);
        }
        if (hasChart) {
          widgetWidth = Math.max(widgetWidth, isBigNumberChartType(widget.report.view.chartType) ? 6 : DEFAULT_CHART_WIDTH);
        } else if (widget.status === "complete" && widgetShowsRows(widget.widget, widget.report) && exportResult.rows.length) {
          widgetWidth = Math.max(widgetWidth, Math.min(Math.max(widget.report.selectedFieldIds.length, 1), 20));
        }

        const titleCol = cursorCol;
        const toCol = titleCol + widgetWidth - 1;
        let widgetCursor = groupStartRow;

        sheet.getCell(widgetCursor, titleCol).value = widgetTitle;
        sheet.getCell(widgetCursor, titleCol).font = { bold: true, size: 13 };
        widgetCursor += 1;

        const contentStartRow = widgetCursor;

        if ((widget.widget.showSummary || isSummaryMode) && exportResult.summary.length) {
          widgetCursor = writeSummarySheet(sheet, exportResult, widgetCursor, titleCol, toCol);
        }
        if (isSummaryMode && exportResult.crosstab) {
          widgetCursor = writeCrosstabBlock(sheet, exportResult.crosstab, widgetCursor, titleCol, orientation);
        }

        if (hasChart && isBigNumberChartType(widget.report.view.chartType)) {
          widgetCursor = writeBigNumberBlock(sheet, widget.report, exportResult, contentStartRow, titleCol, toCol);
        } else if (hasChart) {
          const chartEndRow = contentStartRow + 22;
          const written = writeHiddenChartData(dataSheet, dataSheetName, dataRow, widget.report, exportResult, table, chartId);
          dataRow = written.nextRow;
          sheetCharts.push({
            chart: written.source,
            fromCol: titleCol - 1,
            fromRow: contentStartRow - 1,
            toCol,
            toRow: chartEndRow
          });
          widgetCursor = Math.max(widgetCursor, chartEndRow + 1);
          chartId += 1;
        } else if (widget.status === "complete" && widgetShowsRows(widget.widget, widget.report) && exportResult.rows.length) {
          widgetCursor = writeRowsSheet(sheet, widget.report, table, exportResult, widgetCursor, titleCol);
        }

        groupEndRow = Math.max(groupEndRow, widgetCursor);
        cursorCol = titleCol + widgetWidth + WIDGET_GAP_COLS;

        // --- Write to overview sheet ---
        if (overview) {
          overview.getCell(overviewRow, 1).value = widgetTitle;
          overview.getCell(overviewRow, 1).font = { bold: false };
          overviewRow += 1;
          if ((widget.widget.showSummary || isSummaryMode) && exportResult.summary.length) {
            let col = 2;
            exportResult.summary.forEach((item) => {
              if (col > 12) return;
              overview.getCell(overviewRow, col).value = item.value;
              overview.getCell(overviewRow, col).font = { bold: true, size: 13 };
              overview.getCell(overviewRow + 1, col).value = item.label;
              col += 2;
            });
            overviewRow += 3;
          } else if (isSummaryMode && exportResult.crosstab) {
            overviewRow = writeCrosstabBlock(overview, exportResult.crosstab, overviewRow, 2, orientation);
            overviewRow += 1;
          } else {
            overviewRow += 1;
          }
        }
      }

      currentRow = groupEndRow + 2;
    }

    if (overview) overviewRow += 1; // gap between tabs on overview
    chartsBySheet.set(sheet.name, sheetCharts);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return injectNativeCharts(blob, chartsBySheet);
}

export function buildDashboardExportFilename(name: string) {
  return `${safeFileName(name)} ${buildTimestamp()}.xlsx`;
}

export async function exportReportNativeChartWorkbook(
  report: ReportDefinition,
  table: TableDefinition | undefined,
  result: ReportRunResult,
  options: NativeReportExportOptions = {}
) {
  void options;
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(safeSheetName(report.name || "Report", usedNames));
  sheet.columns = Array.from({ length: 12 }, () => ({ width: 14 }));
  sheet.getCell("A1").value = report.name;
  sheet.getCell("A1").font = { bold: true, size: 18 };
  sheet.getCell("A2").value = `${report.description || ""}`.trim() || "";
  sheet.mergeCells("A2:L2");
  sheet.getCell("A4").value = `${result.totalRows.toLocaleString()} rows`;
  sheet.getCell("A4").font = { bold: true };
  sheet.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
  sheet.mergeCells("A4:L4");

  const dataSheetName = safeSheetName("_native_chart_data", usedNames);
  const dataSheet = workbook.addWorksheet(dataSheetName);
  dataSheet.state = "hidden";
  dataSheet.columns = Array.from({ length: 24 }, () => ({ width: 22 }));
  const chartsBySheet = new Map<string, NativeChartPlacement[]>();
  const sheetCharts: NativeChartPlacement[] = [];
  let contentRow = 6;

  if (reportShowsSummary(report) && result.summary.length) {
    contentRow = writeSummarySheet(sheet, result, contentRow, 1, 12) + 1;
  }

  if (reportShowsChart(report) && result.chartData.length && isBigNumberChartType(report.view.chartType)) {
    contentRow = writeBigNumberBlock(sheet, report, result, contentRow, 1, 12) + 1;
  } else if (reportShowsChart(report) && result.chartData.length) {
    const written = writeHiddenChartData(dataSheet, dataSheetName, 1, report, result, table, 1);
    sheetCharts.push({
      chart: written.source,
      fromCol: 0,
      fromRow: contentRow - 1,
      toCol: 12,
      toRow: contentRow + 22
    });
    contentRow += 25;
  }

  if (reportShowsRows(report) && result.rows.length) {
    writeRowsSheet(sheet, report, table, result, contentRow, 1);
  }

  chartsBySheet.set(sheet.name, sheetCharts);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return injectNativeCharts(blob, chartsBySheet);
}

function reportShowsChart(report: ReportDefinition) {
  return report.view.mode === "chart" || (report.view.mode === "table" && report.view.showChartInTable);
}

function reportShowsSummary(report: ReportDefinition) {
  if (typeof report.view.showSummary === "boolean") return report.view.showSummary;
  return report.view.mode === "table" || report.view.mode === "summary" || report.view.mode === "chart";
}

function reportShowsRows(report: ReportDefinition) {
  if (typeof report.view.showDetails === "boolean") return report.view.showDetails;
  return report.view.mode === "table" || report.view.mode === "timeline" || report.view.mode === "calendar" || report.view.mode === "kanban";
}

export function buildNativeReportExportFilename(name: string) {
  return `${safeFileName(name)} native charts dev ${buildTimestamp()}.xlsx`;
}
