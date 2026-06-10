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
  type ReportDefinition,
  type ReportRunResult,
  type TableDefinition
} from "@studio/shared";

interface NativeDashboardExportOptions {
  filename?: string;
  tablesById?: Record<string, TableDefinition>;
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

function resolveWidgetDisplayMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], reportMode: string) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  if (reportMode === "summary") return "summary";
  if (reportMode === "chart") return "chart";
  return "table";
}

function widgetShowsChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const displayMode = resolveWidgetDisplayMode(widget, report.view.mode);
  return displayMode === "chart" || (displayMode === "table" && report.view.showChartInTable);
}

function widgetShowsRows(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const displayMode = resolveWidgetDisplayMode(widget, report.view.mode);
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
  } else if (sort === "label-asc") {
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

function collapseChartData(data: ChartDatum[]) {
  const grouped = new Map<string, ChartDatum>();
  data
    .filter((datum) => (datum.axis || "primary") === "primary")
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

function deriveSeries(data: ChartDatum[]) {
  const primary = data.filter((datum) => (datum.axis || "primary") === "primary");
  const rawSeries = Array.from(new Set(primary.map((datum) => String(datum.rawSeries || datum.series || ""))));
  if (!rawSeries.length || (rawSeries.length === 1 && rawSeries[0] === "")) {
    return [{ rawSeries: "", label: "Values" }];
  }
  return rawSeries.map((seriesKey) => {
    const match = primary.find((datum) => String(datum.rawSeries || datum.series || "") === seriesKey);
    return { rawSeries: seriesKey, label: match?.series || seriesKey || "Values" };
  });
}

function valueForCategory(data: ChartDatum[], rawLabel: string, rawSeries: string) {
  return data
    .filter((datum) => (datum.axis || "primary") === "primary")
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

function writeCrosstabBlock(sheet: any, crosstab: { columns: string[]; rows: Array<{ label: string; formatted: string[] }> }, startRow: number, startCol: number) {
  const headerRow = sheet.getRow(startRow);
  sheet.getCell(startRow, startCol).value = "";
  crosstab.columns.forEach((col, ci) => {
    const cell = sheet.getCell(startRow, startCol + ci + 1);
    cell.value = col || "(blank)";
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
  });
  void headerRow;
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
  const simpleTypes = ["pie", "donut", "radial-bar", "progress-bar", "gauge", "kpi-card", "big-number-card"].includes(normalizedType);
  const scatterLike = normalizedType === "scatter" || normalizedType === "bubble" || normalizedType === "3d-scatter";
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
  const series = seriesDefinitions.map((definition, index) => {
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
      series
    }
  };
}

function chartKind(source: NativeChartSource) {
  if (source.chartType === "pie" || source.chartType === "3d-pie") return "pie";
  if (source.chartType === "donut" || source.chartType === "3d-donut") return "doughnut";
  if (source.chartType === "line" || source.chartType === "spline" || source.chartType === "line-bar") return "line";
  if (source.chartType === "area" || source.chartType === "area-spline" || source.chartType === "streamgraph") return "area";
  if (source.chartType === "scatter" || source.chartType === "bubble") return "scatter";
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

function pointColorXml(colors: string[] | undefined) {
  return (colors || []).map((color, index) => `<c:dPt><c:idx val="${index}"/>${shapeColorXml(color)}</c:dPt>`).join("");
}

function dataLabelsXml(showValues: boolean, position = "", hiddenIndexes: number[] = []) {
  const hidden = hiddenIndexes.map((index) => `<c:dLbl><c:idx val="${index}"/><c:delete val="1"/></c:dLbl>`).join("");
  return `<c:dLbls>${hidden}${position ? `<c:dLblPos val="${attr(position)}"/>` : ""}<c:showLegendKey val="0"/><c:showVal val="${showValues ? 1 : 0}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>${position === "outEnd" ? "<c:showLeaderLines val=\"1\"/>" : ""}</c:dLbls>`;
}

function categorySeriesXml(source: NativeChartSource) {
  return source.series.map((series, index) => `
    <c:ser>
      <c:idx val="${index}"/><c:order val="${index}"/>
      <c:tx><c:strRef><c:f>${xml(series.nameRef)}</c:f></c:strRef></c:tx>
      ${shapeColorXml(series.color)}
      ${pointColorXml(series.pointColors)}
      <c:cat><c:strRef><c:f>${xml(source.categoryRef)}</c:f></c:strRef></c:cat>
      <c:val><c:numRef><c:f>${xml(series.valuesRef)}</c:f></c:numRef></c:val>
    </c:ser>`).join("");
}

function scatterSeriesXml(source: NativeChartSource) {
  const first = source.series[0];
  if (!first) return "";
  return `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>${xml(first.nameRef)}</c:f></c:strRef></c:tx>${shapeColorXml(first.color)}<c:xVal><c:numRef><c:f>${xml(source.categoryRef)}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xml(first.valuesRef)}</c:f></c:numRef></c:yVal></c:ser>`;
}

function axesXml(catAxisId: number, valAxisId: number, source: NativeChartSource) {
  return `
    <c:catAx><c:axId val="${catAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml(source.xAxisTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
    <c:valAx><c:axId val="${valAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${axisTitleXml(source.yAxisTitle)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorGridlines/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
}

function nativeChartXml(source: NativeChartSource) {
  const kind = chartKind(source);
  const catAxisId = 100000 + source.id * 2;
  const valAxisId = catAxisId + 1;
  const legend = source.showLegend ? `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>` : "";
  let plotXml = "";
  if (kind === "pie" || kind === "doughnut") {
    const tag = kind === "doughnut" ? "doughnutChart" : "pieChart";
    plotXml = `<c:${tag}><c:varyColors val="1"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues, "bestFit", source.hiddenLabelIndexes)}${kind === "doughnut" ? "<c:holeSize val=\"55\"/>" : "<c:firstSliceAng val=\"0\"/>"}</c:${tag}>`;
  } else if (kind === "line" || kind === "area") {
    const tag = kind === "area" ? "areaChart" : "lineChart";
    plotXml = `<c:${tag}><c:grouping val="standard"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:${tag}>${axesXml(catAxisId, valAxisId, source)}`;
  } else if (kind === "scatter") {
    plotXml = `<c:scatterChart><c:scatterStyle val="marker"/>${scatterSeriesXml(source)}${dataLabelsXml(source.showValues)}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:scatterChart>${axesXml(catAxisId, valAxisId, source)}`;
  } else {
    const horizontal = source.originalChartType === "horizontal-bar"
      || source.originalChartType === "horizontal-stacked-bar"
      || (source.chartType === "bar" && source.chartOrientation === "horizontal")
      || (source.chartType === "stacked-bar" && source.chartOrientation === "horizontal");
    const stacked = source.chartType === "stacked-bar" || source.chartType === "stacked-column";
    plotXml = `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${categorySeriesXml(source)}${dataLabelsXml(source.showValues)}${stacked ? "<c:overlap val=\"100\"/>" : ""}<c:axId val="${catAxisId}"/><c:axId val="${valAxisId}"/></c:barChart>${axesXml(catAxisId, valAxisId, source)}`;
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
  const overview = workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames));
  overview.columns = Array.from({ length: 12 }, () => ({ width: 18 }));
  overview.getCell("A1").value = dashboard.name;
  overview.getCell("A1").font = { bold: true, size: 18 };
  overview.getCell("A2").value = dashboard.description || "";
  overview.mergeCells("A2:L2");

  const dataSheetName = safeSheetName("_chart_src", usedNames);
  const dataSheet = workbook.addWorksheet(dataSheetName);
  dataSheet.state = "hidden";
  dataSheet.columns = Array.from({ length: 24 }, () => ({ width: 22 }));
  let dataRow = 1;
  let chartId = 1;
  const chartsBySheet = new Map<string, NativeChartPlacement[]>();

  // Track overview row position
  let overviewRow = 4;

  rendered.tabs.forEach((tab) => {
    // Skip the portal Overview tab — it's navigation-only, not for export
    if (tab.name.trim().toLowerCase() === "overview") return;

    // Write tab header on overview
    overview.getCell(overviewRow, 1).value = tab.name;
    overview.getCell(overviewRow, 1).font = { bold: true, size: 13 };
    overviewRow += 1;

    // Per-tab sheet: sequential layout, no placement math
    const sheet = workbook.addWorksheet(safeSheetName(tab.name, usedNames));
    sheet.columns = Array.from({ length: 12 }, () => ({ width: 18 }));
    sheet.getCell("A1").value = tab.name;
    sheet.getCell("A1").font = { bold: true, size: 18 };
    sheet.getCell("A2").value = dashboard.name;

    const sheetCharts: NativeChartPlacement[] = [];
    let currentRow = 4; // sequential row cursor per tab sheet

    tab.widgets.forEach((widget) => {
      const exportResult = resolveWidgetResult(widget, exportResultsByWidgetId);
      const table = options.tablesById?.[widget.report.sourceTableId];
      const widgetTitle = widget.report.name || widget.widget.title;
      const widgetDisplayMode = resolveWidgetDisplayMode(widget.widget, widget.report.view.mode);
      const isSummaryMode = widgetDisplayMode === "summary";

      // --- Write to per-tab sheet (sequential) ---
      sheet.getCell(currentRow, 1).value = widgetTitle;
      sheet.getCell(currentRow, 1).font = { bold: true, size: 13 };
      currentRow += 1;

      const contentStartRow = currentRow;

      if ((widget.widget.showSummary || isSummaryMode) && exportResult.summary.length) {
        currentRow = writeSummarySheet(sheet, exportResult, currentRow, 1, 12);
      }
      if (isSummaryMode && exportResult.crosstab) {
        currentRow = writeCrosstabBlock(sheet, exportResult.crosstab, currentRow, 1);
      }

      const hasChart = widget.status === "complete" && widgetShowsChart(widget.widget, widget.report) && exportResult.chartData.length > 0;
      if (hasChart) {
        const chartEndRow = currentRow + 22;
        const written = writeHiddenChartData(dataSheet, dataSheetName, dataRow, widget.report, exportResult, table, chartId);
        dataRow = written.nextRow;
        sheetCharts.push({
          chart: written.source,
          fromCol: 0,
          fromRow: contentStartRow - 1,
          toCol: 11,
          toRow: chartEndRow
        });
        currentRow = chartEndRow + 1;
        chartId += 1;
      } else if (widget.status === "complete" && widgetShowsRows(widget.widget, widget.report) && exportResult.rows.length) {
        currentRow = writeRowsSheet(sheet, widget.report, table, exportResult, currentRow, 1);
      }

      currentRow += 2; // small gap between widgets

      // --- Write to overview sheet ---
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
        overviewRow = writeCrosstabBlock(overview, exportResult.crosstab, overviewRow, 2);
        overviewRow += 1;
      } else {
        overviewRow += 1;
      }
    });

    overviewRow += 1; // gap between tabs on overview
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

  if (reportShowsChart(report) && result.chartData.length) {
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
