import ExcelJS from "exceljs";
import type { Stream } from "node:stream";
import {
  buildDashboardFilters,
  filterNeedsValue,
  formatNumericValue,
  formatReportCellValue,
  getDashboardWidgetPlacements,
  getReportDecimalPlaces,
  getReportFieldLabel,
  type ChartDatum,
  type DashboardDefinition,
  type DashboardRunResult,
  type FilterDefinition,
  type FilterOperator,
  type ReportDefinition,
  type ReportRunResult,
  type SummaryDatum,
  type TableDefinition
} from "@studio/shared";

interface ExportProgressCallback {
  (progress: number, message: string): void;
}

const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: "equals",
  "not-equals": "does not equal",
  contains: "contains",
  "not-contains": "does not contain",
  blank: "is blank",
  "not-blank": "is not blank",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  on: "is on",
  "on-or-after": "is on or after",
  "on-or-before": "is on or before"
};

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

function safeFileName(name: string, fallback: string) {
  const next = (name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return next || fallback;
}

function buildFileTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function sheetHyperlink(sheetName: string) {
  return `#'${sheetName.replace(/'/g, "''")}'!A1`;
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

function getTableFieldLabel(table: TableDefinition | undefined, fieldId: string) {
  return table?.fields.find((field) => field.id === fieldId)?.label || fieldId;
}

function formatFilterValue(value: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "(blank)";
}

function describeReportFilter(report: ReportDefinition, table: TableDefinition, filter: FilterDefinition) {
  const fieldLabel = getReportFieldLabel(report, table, filter.fieldId);
  const operatorLabel = FILTER_OPERATOR_LABELS[filter.operator] || filter.operator;
  const compareFieldLabel = filter.valueSource === "field" && filter.compareFieldId
    ? getReportFieldLabel(report, table, filter.compareFieldId)
    : "";
  return filterNeedsValue(filter.operator)
    ? `${fieldLabel} ${operatorLabel} ${compareFieldLabel ? `value from ${compareFieldLabel}` : formatFilterValue(filter.value)}`
    : `${fieldLabel} ${operatorLabel}`;
}

function describeRuntimeFilter(
  dashboard: DashboardDefinition,
  filter: DashboardDefinition["runtimeFilters"][number],
  tablesById: Record<string, TableDefinition>,
  runtimeValues: Record<string, string>
) {
  const fieldLabel = Object.values(tablesById)
    .map((table) => getTableFieldLabel(table, filter.fieldId))
    .find((label) => label !== filter.fieldId) || filter.fieldId;
  const currentValue = runtimeValues[filter.id] ?? filter.defaultValue ?? "";
  const scope = filter.mode === "global"
    ? "all cards"
    : filter.targetReportIds.length
      ? `${filter.targetReportIds.length} selected report${filter.targetReportIds.length === 1 ? "" : "s"}`
      : "selected reports";
  const compareFieldLabel = filter.valueSource === "field" && filter.compareFieldId
    ? Object.values(tablesById)
        .map((table) => getTableFieldLabel(table, filter.compareFieldId || ""))
        .find((label) => label !== filter.compareFieldId) || filter.compareFieldId
    : "";
  const operatorLabel = FILTER_OPERATOR_LABELS[filter.operator] || filter.operator;
  return `${filter.label || filter.id}: ${fieldLabel} ${operatorLabel} ${compareFieldLabel ? `value from ${compareFieldLabel}` : formatFilterValue(currentValue)} (${scope})`;
}

function writeOverviewHeader(sheet: ExcelJS.Worksheet, title: string, description: string) {
  sheet.columns = [
    { width: 24 },
    { width: 24 },
    { width: 24 },
    { width: 24 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 20 }
  ];
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.mergeCells("A1:H1");
  sheet.mergeCells("A2:H2");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { size: 18, bold: true };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getCell("A2").value = description;
  sheet.getCell("A2").alignment = { wrapText: true };
}

function writeMetadataRows(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  items: Array<{ label: string; value: string | number }>
) {
  let row = startRow;
  items.forEach((item) => {
    sheet.getCell(`A${row}`).value = item.label;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
    sheet.mergeCells(`B${row}:D${row}`);
    sheet.getCell(`B${row}`).value = item.value;
    sheet.getCell(`B${row}`).alignment = { wrapText: true };
    row += 1;
  });
  return row;
}

function writeLinkRows(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  links: Array<{ label: string; sheetName: string }>
) {
  let row = startRow;
  sheet.getCell(`A${row}`).value = title;
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
  row += 1;
  if (!links.length) {
    sheet.getCell(`A${row}`).value = "None";
    return row + 2;
  }
  links.forEach((link) => {
    sheet.getCell(`A${row}`).value = {
      text: link.label,
      hyperlink: sheetHyperlink(link.sheetName)
    };
    sheet.getCell(`A${row}`).font = { color: { argb: "FF1F5AA6" }, underline: true };
    row += 1;
  });
  return row + 1;
}

function writeTextListSection(sheet: ExcelJS.Worksheet, startRow: number, title: string, items: string[], emptyText = "None") {
  let row = startRow;
  sheet.getCell(`A${row}`).value = title;
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F1" } };
  row += 1;
  if (!items.length) {
    sheet.getCell(`A${row}`).value = emptyText;
    return row + 2;
  }
  items.forEach((item) => {
    sheet.getCell(`A${row}`).value = `• ${item}`;
    sheet.getCell(`A${row}`).alignment = { wrapText: true };
    row += 1;
  });
  return row + 1;
}

function writeWarningSection(sheet: ExcelJS.Worksheet, startRow: number, warnings: string[]) {
  if (!warnings.length) return startRow;
  let row = startRow;
  sheet.getCell(`A${row}`).value = "Warnings";
  sheet.getCell(`A${row}`).font = { bold: true, color: { argb: "FF8A4B08" } };
  row += 1;
  warnings.forEach((warning) => {
    sheet.getCell(`A${row}`).value = `• ${warning}`;
    sheet.getCell(`A${row}`).alignment = { wrapText: true };
    sheet.getCell(`A${row}`).font = { color: { argb: "FF8A4B08" } };
    row += 1;
  });
  return row + 1;
}

function reportShowsChart(report: ReportDefinition) {
  return report.view.mode === "chart" || (report.view.mode === "table" && report.view.showChartInTable);
}

function reportShowsSummary(report: ReportDefinition) {
  if (typeof report.view.showSummary === "boolean") return report.view.showSummary;
  return report.view.mode === "table" || report.view.mode === "summary" || report.view.mode === "chart";
}

function reportShowsDetails(report: ReportDefinition) {
  if (typeof report.view.showDetails === "boolean") return report.view.showDetails;
  return report.view.mode === "table" || report.view.mode === "timeline" || report.view.mode === "calendar" || report.view.mode === "kanban";
}

function widgetDisplayMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  if (report.view.mode === "summary") return "summary";
  if (report.view.mode === "chart") return "chart";
  return "table";
}

function widgetShowsChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const displayMode = widgetDisplayMode(widget, report);
  return displayMode === "chart" || (displayMode === "table" && report.view.showChartInTable);
}

function widgetShowsDetails(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  return widgetDisplayMode(widget, report) === "table" || widget.showDetails;
}

function widgetNeedsSeparateDetailSheet(
  widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"],
  report: ReportDefinition
) {
  return widgetDisplayMode(widget, report) !== "table" && widget.showDetails;
}

function resolveWidgetExportResult(
  widget: DashboardRunResult["tabs"][number]["widgets"][number],
  exportResultsByReportId: Record<string, ReportRunResult>
) {
  const exported = exportResultsByReportId[widget.report.id];
  if (!exported) return widget.result;
  return {
    ...exported,
    rows: exported.rows.length ? exported.rows : widget.result.rows,
    summary: exported.summary.length ? exported.summary : widget.result.summary,
    chartData: exported.chartData.length ? exported.chartData : widget.result.chartData,
    warnings: exported.warnings.length ? exported.warnings : widget.result.warnings,
    totalRows: exported.totalRows || widget.result.totalRows
  };
}

function writeSummaryRows(sheet: ExcelJS.Worksheet, report: ReportDefinition, result: ReportRunResult, startRow = 1, includeSummary = true) {
  let row = startRow;
  if (includeSummary) {
    sheet.getCell(`A${row}`).value = "Metric";
    sheet.getCell(`B${row}`).value = "Value";
    sheet.getRow(row).font = { bold: true };
    row += 1;
    result.summary.forEach((item) => {
      sheet.getCell(`A${row}`).value = item.label;
      sheet.getCell(`B${row}`).value = item.value;
      row += 1;
    });
    if (!result.summary.length) {
      sheet.getCell(`A${row}`).value = "Rows";
      sheet.getCell(`B${row}`).value = result.totalRows;
      row += 1;
    }
    row += 1;
  }
  return row;
}

function writeDataSheet(
  sheet: ExcelJS.Worksheet,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  onProgress?: ExportProgressCallback,
  progressRange?: { start: number; end: number; label: string }
) {
  const headers = report.selectedFieldIds.map((fieldId) => getReportFieldLabel(report, table, fieldId));
  sheet.columns = headers.map((header, index) => ({
    header,
    key: report.selectedFieldIds[index],
    width: Math.min(32, Math.max(16, header.length + 4))
  }));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, report.selectedFieldIds.length) }
  };
  const total = Math.max(result.rows.length, 1);
  const widths = headers.map((header) => Math.min(42, Math.max(16, header.length + 4)));
  result.rows.forEach((row, index) => {
    const formattedValues = Object.fromEntries(
      report.selectedFieldIds.map((fieldId) => [fieldId, formatReportCellValue(report, table, fieldId, row[fieldId])])
    );
    sheet.addRow(formattedValues);
    report.selectedFieldIds.forEach((fieldId, fieldIndex) => {
      widths[fieldIndex] = Math.min(60, Math.max(widths[fieldIndex], String(formattedValues[fieldId] ?? "").length + 3));
    });
    if (onProgress && progressRange && (index === 0 || (index + 1) % 500 === 0 || index + 1 === total)) {
      const ratio = (index + 1) / total;
      const progress = progressRange.start + Math.round((progressRange.end - progressRange.start) * ratio);
      onProgress(progress, `${progressRange.label} (${(index + 1).toLocaleString()} / ${total.toLocaleString()})`);
    }
  });
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

const DEFAULT_CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a"];

function isHexColor(value: string) {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value || "").trim());
}

function getChartPalette(report: ReportDefinition) {
  const configured = (report.view.chartColors || [])
    .map((color) => String(color || "").trim())
    .filter((color) => isHexColor(color));
  return configured.length ? configured : DEFAULT_CHART_COLORS;
}

function getChartColorOverride(report: ReportDefinition, palette: string[], index: number, datumOrKey: ChartDatum | string) {
  const key = typeof datumOrKey === "string"
    ? String(datumOrKey || "").trim()
    : String(datumOrKey.rawSeries || datumOrKey.series || datumOrKey.rawLabel || datumOrKey.label || "").trim();
  const override = key ? String(report.view.chartValueColors?.[key] || "").trim() : "";
  return isHexColor(override) ? override : palette[index % palette.length];
}

function withAlpha(color: string, alpha: string) {
  const normalized = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return `${normalized}${alpha}`;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const expanded = `#${normalized.slice(1).split("").map((character) => `${character}${character}`).join("")}`;
    return `${expanded}${alpha}`;
  }
  return normalized;
}

function collapseChartData(data: ChartDatum[], axis: "primary" | "secondary" = "primary") {
  const grouped = new Map<string, ChartDatum>();
  data
    .filter((datum) => (datum.axis || "primary") === axis)
    .forEach((datum) => {
      const key = String(datum.rawLabel ?? datum.label ?? "");
      const current = grouped.get(key) || {
        label: datum.label,
        rawLabel: datum.rawLabel,
        value: 0,
        axis
      };
      current.value += datum.value;
      grouped.set(key, current);
    });
  return Array.from(grouped.values());
}

function deriveCategories(data: ChartDatum[]) {
  return Array.from(new Set(data.map((datum) => String(datum.rawLabel ?? datum.label ?? "")))).map((rawLabel) => {
    const match = data.find((datum) => String(datum.rawLabel ?? datum.label ?? "") === rawLabel);
    return {
      rawLabel,
      label: match?.label || rawLabel
    };
  });
}

function deriveSeries(data: ChartDatum[], axis: "primary" | "secondary" = "primary") {
  const filtered = data.filter((datum) => (datum.axis || "primary") === axis);
  if (!filtered.length) return [];
  const rawSeries = Array.from(new Set(filtered.map((datum) => String(datum.rawSeries || datum.series || ""))));
  if (!rawSeries.length || (rawSeries.length === 1 && rawSeries[0] === "")) {
    return [{
      rawSeries: "",
      label: axis === "secondary" ? "Secondary" : "Values"
    }];
  }
  return rawSeries.map((seriesKey) => {
    const match = filtered.find((datum) => String(datum.rawSeries || datum.series || "") === seriesKey);
    return {
      rawSeries: seriesKey,
      label: match?.series || seriesKey || (axis === "secondary" ? "Secondary" : "Values")
    };
  });
}

function valueForCategory(data: ChartDatum[], rawLabel: string, rawSeries: string, axis: "primary" | "secondary" = "primary") {
  return data
    .filter((datum) => (datum.axis || "primary") === axis)
    .filter((datum) => String(datum.rawLabel ?? datum.label ?? "") === rawLabel)
    .filter((datum) => String(datum.rawSeries || datum.series || "") === rawSeries)
    .reduce((sum, datum) => sum + datum.value, 0);
}

function chartLabelNumericValue(rawLabel: string, index: number) {
  const trimmed = String(rawLabel || "").trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const dateValue = Date.parse(trimmed);
  if (Number.isFinite(dateValue)) return index + 1;
  return index + 1;
}

function quickChartType(chartType: ReportDefinition["view"]["chartType"]) {
  if (chartType === "pie" || chartType === "3d-pie") return "pie";
  if (chartType === "donut" || chartType === "3d-donut") return "doughnut";
  if (chartType === "gauge" || chartType === "radial-bar" || chartType === "progress-bar") return "doughnut";
  if (chartType === "line" || chartType === "spline" || chartType === "line-bar") return "line";
  if (chartType === "area" || chartType === "area-spline" || chartType === "streamgraph" || chartType === "3d-area") return "line";
  if (chartType === "radar") return "radar";
  if (chartType === "scatter" || chartType === "3d-scatter") return "scatter";
  if (chartType === "bubble") return "bubble";
  return "bar";
}

function isHorizontalChart(report: ReportDefinition) {
  return report.view.chartType === "horizontal-bar"
    || report.view.chartType === "horizontal-stacked-bar"
    || (report.view.chartType === "bar" && report.view.chartOrientation === "horizontal");
}

function isStackedChart(chartType: ReportDefinition["view"]["chartType"]) {
  return chartType === "stacked-bar" || chartType === "horizontal-stacked-bar" || chartType === "stacked-column" || chartType === "3d-stacked-bar";
}

function isAreaChart(chartType: ReportDefinition["view"]["chartType"]) {
  return chartType === "area" || chartType === "area-spline" || chartType === "streamgraph" || chartType === "3d-area";
}

function buildChartData(report: ReportDefinition, data: ChartDatum[]) {
  const palette = getChartPalette(report);
  const type = quickChartType(report.view.chartType);
  const horizontal = isHorizontalChart(report);
  const stacked = isStackedChart(report.view.chartType);
  const primaryItems = data.filter((datum) => (datum.axis || "primary") === "primary");
  const secondaryItems = data.filter((datum) => (datum.axis || "primary") === "secondary");
  const hasSecondaryAxis = secondaryItems.length > 0;

  if (type === "pie" || type === "doughnut") {
    const collapsed = collapseChartData(data, "primary");
    return {
      chartType: type,
      horizontal,
      stacked: false,
      hasSecondaryAxis: false,
      data: {
        labels: collapsed.map((item) => item.label),
        datasets: [{
          label: report.view.chartTitle || report.name,
          data: collapsed.map((item) => item.value),
          backgroundColor: collapsed.map((item, index) => getChartColorOverride(report, palette, index, item)),
          borderColor: "#ffffff",
          borderWidth: 2
        }]
      }
    };
  }

  if (type === "radar") {
    const categories = deriveCategories(primaryItems);
    const primarySeries = deriveSeries(primaryItems, "primary");
    return {
      chartType: type,
      horizontal,
      stacked: false,
      hasSecondaryAxis: false,
      data: {
        labels: categories.map((category) => category.label),
        datasets: primarySeries.map((series, seriesIndex) => {
          const color = getChartColorOverride(report, palette, seriesIndex, series.rawSeries || series.label);
          return {
            label: primarySeries.length === 1 && !series.rawSeries ? (report.view.chartTitle || report.name) : series.label,
            data: categories.map((category) => valueForCategory(data, category.rawLabel, series.rawSeries, "primary")),
            borderColor: color,
            backgroundColor: withAlpha(color, "33"),
            pointBackgroundColor: color,
            borderWidth: 3,
            fill: true
          };
        })
      }
    };
  }

  if (type === "scatter" || type === "bubble") {
    const categories = deriveCategories(primaryItems);
    const primarySeries = deriveSeries(primaryItems, "primary");
    const secondaryMax = Math.max(...secondaryItems.map((item) => item.value), ...primaryItems.map((item) => item.value), 1);
    return {
      chartType: type,
      horizontal: false,
      stacked: false,
      hasSecondaryAxis: false,
      data: {
        datasets: primarySeries.map((series, seriesIndex) => {
          const color = getChartColorOverride(report, palette, seriesIndex, series.rawSeries || series.label);
          const points = categories.flatMap((category, categoryIndex) => {
            const primaryMatch = primaryItems.find((item) =>
              String(item.rawLabel ?? item.label ?? "") === category.rawLabel
              && String(item.rawSeries || item.series || "") === series.rawSeries
            );
            if (!primaryMatch) return [];
            const secondaryMatch = secondaryItems.find((item) =>
              String(item.rawLabel ?? item.label ?? "") === category.rawLabel
              && String(item.rawSeries || item.series || "") === series.rawSeries
            );
            return [{
              x: chartLabelNumericValue(category.rawLabel, categoryIndex),
              y: primaryMatch.value,
              ...(type === "bubble"
                ? { r: 8 + Math.min(18, Math.round(((secondaryMatch?.value ?? primaryMatch.value) / secondaryMax) * 18)) }
                : {})
            }];
          });
          return {
            label: primarySeries.length === 1 && !series.rawSeries ? (report.view.chartTitle || report.name) : series.label,
            data: points,
            backgroundColor: type === "bubble" ? withAlpha(color, "aa") : color,
            borderColor: color,
            pointBackgroundColor: color
          };
        }).filter((dataset) => dataset.data.length)
      }
    };
  }

  const categories = deriveCategories(primaryItems.length ? primaryItems : data);
  const primarySeries = deriveSeries(primaryItems, "primary");
  const secondarySeries = deriveSeries(secondaryItems, "secondary");
  const primaryAxisId = horizontal ? "x" : "y";
  const secondaryAxisId = horizontal ? "x1" : "y1";
  const primaryAxisKey = horizontal ? "xAxisID" : "yAxisID";
  const secondaryAxisKey = horizontal ? "xAxisID" : "yAxisID";
  const datasets = [
    ...primarySeries.map((series, seriesIndex) => {
      const color = getChartColorOverride(report, palette, seriesIndex, series.rawSeries || series.label);
      const isLineLike = type === "line";
      const singleSeriesCategoryColors = primarySeries.length === 1 && !series.rawSeries
        ? categories.map((category, categoryIndex) => {
            const matchingDatum = primaryItems.find((datum) => String(datum.rawLabel ?? datum.label ?? "") === category.rawLabel) || category.label;
            return getChartColorOverride(report, palette, categoryIndex, matchingDatum);
          })
        : null;
      return {
        label: primarySeries.length === 1 && !series.rawSeries ? (report.view.chartTitle || report.name) : series.label,
        data: categories.map((category) => valueForCategory(data, category.rawLabel, series.rawSeries, "primary")),
        backgroundColor: isLineLike ? withAlpha(color, "33") : (singleSeriesCategoryColors || color),
        borderColor: singleSeriesCategoryColors || color,
        pointBackgroundColor: singleSeriesCategoryColors || color,
        borderWidth: isLineLike ? 3 : 1,
        fill: isLineLike ? isAreaChart(report.view.chartType) : false,
        tension: report.view.chartType === "spline" || report.view.chartType === "area-spline" ? 0.35 : 0,
        [primaryAxisKey]: primaryAxisId,
        stack: stacked ? "primary" : undefined
      };
    }),
    ...secondarySeries.map((series, seriesIndex) => {
      const color = getChartColorOverride(report, palette, primarySeries.length + seriesIndex, series.rawSeries || series.label);
      const secondaryType = report.view.chartSecondarySeriesType === "bar" || report.view.chartSecondarySeriesType === "column"
        ? "bar"
        : "line";
      return {
        type: secondaryType,
        label: `${series.label} (secondary)`,
        data: categories.map((category) => valueForCategory(data, category.rawLabel, series.rawSeries, "secondary")),
        backgroundColor: secondaryType === "line" ? withAlpha(color, "22") : withAlpha(color, "aa"),
        borderColor: color,
        pointBackgroundColor: color,
        borderWidth: secondaryType === "line" ? 3 : 1,
        fill: report.view.chartSecondarySeriesType === "area",
        borderDash: secondaryType === "line" ? [8, 5] : undefined,
        tension: report.view.chartSecondarySeriesType === "area" ? 0.25 : 0,
        [secondaryAxisKey]: secondaryAxisId
      };
    })
  ];

  return {
    chartType: type,
    horizontal,
    stacked,
    hasSecondaryAxis,
    data: {
      labels: categories.map((category) => category.label),
      datasets
    }
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getChartImageSizing(report: ReportDefinition, chartData: ChartDatum[]) {
  const labels = chartData.map((item) => String(item.label || ""));
  const maxLabelLength = labels.reduce((max, label) => Math.max(max, label.length), 0);
  const count = Math.max(chartData.length, 1);
  const horizontal = report.view.chartType === "horizontal-bar"
    || report.view.chartType === "horizontal-stacked-bar"
    || (report.view.chartType === "bar" && report.view.chartOrientation === "horizontal");
  const circular = ["pie", "donut", "3d-pie", "3d-donut", "gauge", "radial-bar", "progress-bar"].includes(report.view.chartType);
  if (circular) {
    const renderWidth = clamp(1800 + Math.max(0, count - 8) * 44 + Math.max(0, maxLabelLength - 10) * 18, 1800, 3200);
    const renderHeight = clamp(1300 + Math.max(0, count - 8) * 28, 1300, 2600);
    return {
      renderWidth,
      renderHeight,
      embedWidth: clamp(Math.round(renderWidth * 0.8), 1300, 2400),
      embedHeight: clamp(Math.round(renderHeight * 0.8), 960, 1900)
    };
  }
  if (horizontal) {
    const renderWidth = clamp(2200 + Math.max(0, maxLabelLength - 14) * 18, 2200, 4000);
    const renderHeight = clamp(980 + count * 40, 980, 4200);
    return {
      renderWidth,
      renderHeight,
      embedWidth: clamp(Math.round(renderWidth * 0.84), 1500, 3000),
      embedHeight: clamp(Math.round(renderHeight * 0.78), 760, 3200)
    };
  }
  const renderWidth = clamp(2200 + count * 96 + Math.max(0, maxLabelLength - 10) * 34, 2200, 5000);
  const renderHeight = clamp(1400 + Math.max(0, maxLabelLength - 16) * 22, 1400, 3000);
  return {
    renderWidth,
    renderHeight,
    embedWidth: clamp(Math.round(renderWidth * 0.84), 1500, 3400),
    embedHeight: clamp(Math.round(renderHeight * 0.82), 980, 2400)
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseToChartImage(response: Response, sizing: ReturnType<typeof getChartImageSizing>) {
  if (!response.ok) return null;
  return {
    base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
    width: sizing.embedWidth,
    height: sizing.embedHeight
  };
}

async function fetchChartImageByPost(config: unknown, sizing: ReturnType<typeof getChartImageSizing>) {
  const response = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "image/png"
    },
    body: JSON.stringify({
      width: sizing.renderWidth,
      height: sizing.renderHeight,
      backgroundColor: "white",
      devicePixelRatio: 3,
      format: "png",
      version: "4",
      chart: config
    })
  }).catch(() => null);
  if (!response) return null;
  return responseToChartImage(response, sizing);
}

async function fetchChartImageByGet(config: unknown, sizing: ReturnType<typeof getChartImageSizing>) {
  const params = new URLSearchParams({
    width: String(sizing.renderWidth),
    height: String(sizing.renderHeight),
    backgroundColor: "white",
    devicePixelRatio: "3",
    format: "png",
    version: "4",
    c: JSON.stringify(config)
  });
  const response = await fetch(`https://quickchart.io/chart?${params.toString()}`, {
    headers: {
      "Accept": "image/png"
    }
  }).catch(() => null);
  if (!response) return null;
  return responseToChartImage(response, sizing);
}

async function fetchChartImage(config: unknown, sizing: ReturnType<typeof getChartImageSizing>) {
  for (const waitMs of [0, 250, 750]) {
    if (waitMs) await delay(waitMs);
    const postImage = await fetchChartImageByPost(config, sizing);
    if (postImage) return postImage;
  }
  return fetchChartImageByGet(config, sizing);
}

async function renderChartImage(report: ReportDefinition, subtitle: string, chartData: ChartDatum[], summary: SummaryDatum[]) {
  if (!chartData.length) return null;
  const builtChart = buildChartData(report, chartData);
  const chartType = builtChart.chartType;
  const sizing = getChartImageSizing(report, chartData);
  const horizontal = builtChart.horizontal;
  const categoryAxisKey = horizontal ? "y" : "x";
  const valueAxisKey = horizontal ? "x" : "y";
  const secondaryValueAxisKey = horizontal ? "x1" : "y1";
  const isScatterLike = chartType === "scatter" || chartType === "bubble";
  const scales = chartType === "pie" || chartType === "doughnut" || chartType === "radar"
    ? undefined
    : isScatterLike
      ? {
        x: {
          type: "linear" as const,
          ticks: {
            font: { size: 16, weight: "600" as const }
          },
          title: {
            display: Boolean(report.view.chartXAxisLabel),
            text: report.view.chartXAxisLabel,
            font: { size: 18, weight: "700" as const }
          }
        },
        y: {
          ticks: {
            font: { size: 16, weight: "600" as const }
          },
          title: {
            display: Boolean(report.view.chartYAxisLabel),
            text: report.view.chartYAxisLabel,
            font: { size: 18, weight: "700" as const }
          }
        }
      }
      : {
        [categoryAxisKey]: {
          ticks: {
            autoSkip: false,
            maxRotation: horizontal ? 0 : 60,
            minRotation: horizontal ? 0 : 45,
            font: { size: horizontal ? 16 : 15, weight: "600" as const }
          },
          stacked: builtChart.stacked,
          title: {
            display: Boolean(horizontal ? report.view.chartYAxisLabel : report.view.chartXAxisLabel),
            text: horizontal ? report.view.chartYAxisLabel : report.view.chartXAxisLabel,
            font: { size: 18, weight: "700" as const }
          }
        },
        [valueAxisKey]: {
          ticks: {
            font: { size: 16, weight: "600" as const }
          },
          stacked: builtChart.stacked,
          title: {
            display: Boolean(horizontal ? report.view.chartXAxisLabel : report.view.chartYAxisLabel),
            text: horizontal ? report.view.chartXAxisLabel : report.view.chartYAxisLabel,
            font: { size: 18, weight: "700" as const }
          }
        },
        ...(builtChart.hasSecondaryAxis ? {
          [secondaryValueAxisKey]: {
            position: horizontal ? "top" as const : "right" as const,
            grid: { drawOnChartArea: false },
            ticks: {
              font: { size: 16, weight: "600" as const }
            },
            title: {
              display: Boolean(report.view.chartSecondaryYAxisLabel),
              text: report.view.chartSecondaryYAxisLabel,
              font: { size: 18, weight: "700" as const }
            }
          }
        } : {})
      };
  const config = {
    type: chartType,
    data: builtChart.data,
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: horizontal ? ("y" as const) : ("x" as const),
      layout: {
        padding: {
          bottom: horizontal ? 36 : Math.min(320, 82 + Math.max(0, Math.max(...chartData.map((item) => String(item.label || "").length), 0) - 10) * 12),
          left: horizontal ? Math.min(360, 120 + Math.max(...chartData.map((item) => String(item.label || "").length), 0) * 7) : 42,
          right: 42,
          top: 36
        }
      },
      plugins: {
        legend: {
          display: report.view.chartShowLegend !== false,
          position: "bottom" as const,
          labels: {
            boxWidth: 22,
            boxHeight: 22,
            padding: 22,
            font: { size: 18, weight: "600" as const }
          }
        },
        title: {
          display: true,
          text: report.view.chartTitle || report.name,
          font: { size: 30, weight: "700" as const },
          padding: { bottom: 12 }
        },
        subtitle: {
          display: true,
          text: subtitle,
          font: { size: 18 },
          padding: { bottom: 18 }
        }
      },
      scales
    }
  };
  const primary = await fetchChartImage(config, sizing);
  if (primary) return primary;
  const fallbackConfig = {
    type: chartType,
    data: builtChart.data,
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: horizontal ? ("y" as const) : ("x" as const),
      layout: {
        padding: {
          top: 28,
          right: 28,
          bottom: horizontal ? 30 : 96,
          left: horizontal ? 140 : 30
        }
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom" as const,
          labels: {
            boxWidth: 20,
            padding: 18,
            font: { size: 16, weight: "600" as const }
          }
        },
        title: {
          display: true,
          text: report.view.chartTitle || report.name,
          font: { size: 24, weight: "700" as const }
        }
      },
      scales
    }
  };
  return fetchChartImage(fallbackConfig, sizing);
}

async function addChartImage(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  report: ReportDefinition,
  subtitle: string,
  result: ReportRunResult
) {
  const image = await renderChartImage(report, subtitle, result.chartData, result.summary);
  if (!image) return false;
  const imageId = workbook.addImage({ base64: image.base64, extension: "png" });
  sheet.addImage(imageId, { tl: { col: 3, row: 1 }, ext: { width: image.width, height: image.height } });
  return true;
}

function setDashboardLayoutColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns = Array.from({ length: 12 }, () => ({ width: 14 }));
}

function mergeRowRange(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number) {
  if (endCol > startCol) {
    sheet.mergeCells(row, startCol, row, endCol);
  }
}

function layoutDashboardWidgets(
  dashboard: DashboardDefinition,
  tabId: string,
  widgets: DashboardRunResult["tabs"][number]["widgets"]
) {
  const dashboardTab = dashboard.tabs.find((tab) => tab.id === tabId);
  if (!dashboardTab) return [];
  const placementsById = new Map(
    getDashboardWidgetPlacements(dashboardTab).map((placement) => [placement.widgetId, placement])
  );
  return widgets
    .map((widget) => {
      const placement = placementsById.get(widget.widgetId);
      if (!placement) return null;
      return {
        widget,
        startCol: placement.startCol,
        endCol: placement.endCol,
        startRow: ((placement.startRow - 1) * 7) + 1,
        endRow: (((placement.endRow - placement.startRow + 1) * 7) + ((placement.startRow - 1) * 7)) - 1
      };
    })
    .filter((placement): placement is {
      widget: DashboardRunResult["tabs"][number]["widgets"][number];
      startCol: number;
      endCol: number;
      startRow: number;
      endRow: number;
    } => Boolean(placement));
}

function writeWidgetTitle(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number, title: string, subtitle: string) {
  mergeRowRange(sheet, row, startCol, endCol);
  const titleCell = sheet.getCell(row, startCol);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: "middle" };
  if (subtitle) {
    mergeRowRange(sheet, row + 1, startCol, endCol);
    const subtitleCell = sheet.getCell(row + 1, startCol);
    subtitleCell.value = subtitle;
    subtitleCell.font = { italic: true, color: { argb: "FF56685E" } };
  }
}

function writeWidgetMessageBlock(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number, message: string) {
  mergeRowRange(sheet, row, startCol, endCol);
  const cell = sheet.getCell(row, startCol);
  cell.value = message;
  cell.alignment = { wrapText: true, vertical: "middle" };
  cell.font = { italic: true, color: { argb: "FF8A4B08" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF8E8D7" }
  };
  return row + 2;
}

function writeWidgetWarningsBlock(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number, warnings: string[]) {
  if (!warnings.length) return row;
  mergeRowRange(sheet, row, startCol, endCol);
  const titleCell = sheet.getCell(row, startCol);
  titleCell.value = "Warnings";
  titleCell.font = { bold: true, color: { argb: "FF8A4B08" } };
  row += 1;
  warnings.forEach((warning) => {
    mergeRowRange(sheet, row, startCol, endCol);
    const cell = sheet.getCell(row, startCol);
    cell.value = `• ${warning}`;
    cell.alignment = { wrapText: true, vertical: "middle" };
    cell.font = { color: { argb: "FF8A4B08" } };
    row += 1;
  });
  return row + 1;
}

function writeWidgetSummaryBlock(
  sheet: ExcelJS.Worksheet,
  result: ReportRunResult,
  startRow: number,
  startCol: number,
  endCol: number
) {
  let row = startRow;
  mergeRowRange(sheet, row, startCol, endCol);
  sheet.getCell(row, startCol).value = "Summary";
  sheet.getCell(row, startCol).font = { bold: true };
  row += 1;
  const summaryItems = result.summary.length
    ? result.summary
    : [{ label: "Rows", value: String(result.totalRows), numericValue: result.totalRows }];
  summaryItems.slice(0, 10).forEach((item) => {
    mergeRowRange(sheet, row, startCol, endCol - 2 >= startCol ? endCol - 2 : startCol);
    const valueCol = endCol - 1 >= startCol ? endCol - 1 : endCol;
    if (valueCol > startCol) {
      sheet.mergeCells(row, valueCol, row, endCol);
    }
    sheet.getCell(row, startCol).value = item.label;
    sheet.getCell(row, valueCol).value = item.value;
    row += 1;
  });
  return row;
}

function writeWidgetFullTableBlock(
  sheet: ExcelJS.Worksheet,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  startRow: number,
  startCol: number
) {
  const headersRow = startRow;
  const headers = report.selectedFieldIds.map((fieldId) => getReportFieldLabel(report, table, fieldId));
  const widths = headers.map((header) => Math.min(42, Math.max(16, header.length + 4)));
  headers.forEach((header, index) => {
    const cell = sheet.getCell(headersRow, startCol + index);
    cell.value = header;
    cell.font = { bold: true };
  });
  result.rows.forEach((dataRow, rowIndex) => {
    report.selectedFieldIds.forEach((fieldId, fieldIndex) => {
      const formatted = formatReportCellValue(report, table, fieldId, dataRow[fieldId]);
      sheet.getCell(headersRow + 1 + rowIndex, startCol + fieldIndex).value = formatted;
      widths[fieldIndex] = Math.min(60, Math.max(widths[fieldIndex], String(formatted ?? "").length + 3));
    });
  });
  widths.forEach((width, index) => {
    sheet.getColumn(startCol + index).width = width;
  });
  sheet.views = [{ state: "frozen", ySplit: headersRow }];
  sheet.autoFilter = {
    from: { row: headersRow, column: startCol },
    to: { row: headersRow, column: startCol + Math.max(0, report.selectedFieldIds.length - 1) }
  };
  return headersRow + 1 + result.rows.length;
}

function writeDetailSheet(
  sheet: ExcelJS.Worksheet,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  filterDescriptions: string[]
) {
  writeOverviewHeader(sheet, report.name, report.description || table.name);
  let row = writeMetadataRows(sheet, 4, [
    { label: "Source table", value: table.name },
    { label: "Rows exported", value: result.totalRows },
    { label: "View mode", value: report.view.mode }
  ]);
  row = writeTextListSection(sheet, row + 1, "Applied filters", filterDescriptions, "No filters applied");
  row = writeWarningSection(sheet, row, result.warnings || []);
  const headersRow = row + 1;
  sheet.views = [{ state: "frozen", ySplit: headersRow }];
  const headers = report.selectedFieldIds.map((fieldId) => getReportFieldLabel(report, table, fieldId));
  const widths = headers.map((header) => Math.min(42, Math.max(16, header.length + 4)));
  headers.forEach((header, index) => {
    const cell = sheet.getCell(headersRow, index + 1);
    cell.value = header;
    cell.font = { bold: true };
  });
  result.rows.forEach((dataRow, rowIndex) => {
    report.selectedFieldIds.forEach((fieldId, fieldIndex) => {
      const formatted = formatReportCellValue(report, table, fieldId, dataRow[fieldId]);
      sheet.getCell(headersRow + 1 + rowIndex, fieldIndex + 1).value = formatted;
      widths[fieldIndex] = Math.min(60, Math.max(widths[fieldIndex], String(formatted ?? "").length + 3));
    });
  });
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = widths[index];
  });
}

async function writeDashboardTabSheet(
  workbook: ExcelJS.Workbook,
  dashboard: DashboardDefinition,
  sheet: ExcelJS.Worksheet,
  tab: DashboardRunResult["tabs"][number],
  tablesById: Record<string, TableDefinition>,
  exportResultsByReportId: Record<string, ReportRunResult>,
  detailSheetNames: Record<string, string>,
  onProgress?: ExportProgressCallback
) {
  const singleWidgetPlacement = tab.widgets.length === 1
    ? layoutDashboardWidgets(dashboard, tab.id, tab.widgets)[0]
    : null;
  if (singleWidgetPlacement) {
    const widget = singleWidgetPlacement.widget;
    const exportResult = resolveWidgetExportResult(widget, exportResultsByReportId);
    const table = tablesById[widget.report.sourceTableId];
    if (widget.status === "failed") {
      writeOverviewHeader(sheet, widget.widget.title || widget.report.name, widget.error || widget.message || "Widget failed to load.");
      writeWidgetMessageBlock(sheet, 4, 1, 10, widget.error || widget.message || "Widget failed to load.");
      onProgress?.(74, `Writing ${tab.name}`);
      return;
    }
    if (table && widgetDisplayMode(widget.widget, widget.report) === "table") {
      writeOverviewHeader(sheet, widget.widget.title || widget.report.name, widget.report.name !== widget.widget.title ? widget.report.name : table.name);
      let row = writeMetadataRows(sheet, 4, [
        { label: "Rows exported", value: exportResult.totalRows },
        { label: "View mode", value: "table" }
      ]);
      row = writeWarningSection(sheet, row + 1, exportResult.warnings || []);
      writeWidgetFullTableBlock(sheet, widget.report, table, exportResult, row + 1, 1);
      onProgress?.(74, `Writing ${tab.name}`);
      return;
    }
  }

  setDashboardLayoutColumns(sheet);
  const placements = layoutDashboardWidgets(dashboard, tab.id, tab.widgets);
  for (const placement of placements) {
    const { widget, startCol, endCol, startRow, endRow } = placement;
    const exportResult = resolveWidgetExportResult(widget, exportResultsByReportId);
    const table = tablesById[widget.report.sourceTableId];
    writeWidgetTitle(sheet, startRow, startCol, endCol, widget.widget.title || widget.report.name, widget.report.name !== widget.widget.title ? widget.report.name : "");
    if (widget.status === "failed") {
      writeWidgetMessageBlock(sheet, startRow + 3, startCol, endCol, widget.error || widget.message || "Widget failed to load.");
      continue;
    }
    if (!table) {
      writeWidgetMessageBlock(sheet, startRow + 3, startCol, endCol, "Source table unavailable for this widget.");
      continue;
    }
    let contentRow = startRow + 3;
    if (widget.widget.showSummary) {
      contentRow = writeWidgetSummaryBlock(sheet, exportResult, contentRow, startCol, endCol) + 1;
    }
    if (widgetShowsChart(widget.widget, widget.report)) {
      const image = await renderChartImage(widget.report, tab.name, exportResult.chartData, exportResult.summary);
      if (image) {
        const imageId = workbook.addImage({ base64: image.base64, extension: "png" });
        sheet.addImage(imageId, {
          tl: { col: startCol - 1 + 0.1, row: contentRow - 1 + 0.1 },
          ext: {
            width: Math.max(Math.max(420, (endCol - startCol + 1) * 124), Math.min(image.width, (endCol - startCol + 1) * 220)),
            height: Math.max(340, Math.min(image.height, 860))
          }
        });
        contentRow += 18;
      } else {
        contentRow = writeWidgetMessageBlock(sheet, contentRow, startCol, endCol, "Chart image unavailable for this widget.");
      }
    }
    if (widgetShowsDetails(widget.widget, widget.report) && widgetDisplayMode(widget.widget, widget.report) === "table") {
      writeWidgetFullTableBlock(
        sheet,
        widget.report,
        table,
        exportResult,
        Math.min(contentRow, endRow - 10),
        startCol
      );
    } else if (widgetNeedsSeparateDetailSheet(widget.widget, widget.report) && detailSheetNames[widget.widgetId]) {
      writeWidgetMessageBlock(
        sheet,
        Math.min(contentRow, endRow - 4),
        startCol,
        endCol,
        `Row details exported on "${detailSheetNames[widget.widgetId]}".`
      );
    }
  }
  onProgress?.(74, `Writing ${tab.name}`);
}

export async function streamReportWorkbook(
  output: Stream,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  onProgress?: ExportProgressCallback,
  exportFilters: FilterDefinition[] = []
) {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const includeSummary = reportShowsSummary(report) && result.summary.length > 0;
  const includeChart = reportShowsChart(report);
  const includeDetails = reportShowsDetails(report);
  const overviewSheet = workbook.addWorksheet(safeSheetName(`${report.name} Overview`, usedNames));
  const linkedSheets: Array<{ label: string; sheetName: string }> = [];

  writeOverviewHeader(overviewSheet, report.name, report.description || table.name);
  let overviewRow = writeMetadataRows(overviewSheet, 4, [
    { label: "Generated", value: formatTimestamp(workbook.created) },
    { label: "Source table", value: table.name },
    { label: "Rows exported", value: result.totalRows },
    {
      label: "Workbook content",
      value: [
        includeSummary ? "summary" : "",
        includeChart ? "chart" : "",
        includeDetails ? "detail rows" : ""
      ].filter(Boolean).join(", ") || "metadata only"
    }
  ]);
  overviewRow = writeTextListSection(
    overviewSheet,
    overviewRow + 1,
    "Saved report filters",
    report.filters.map((filter) => describeReportFilter(report, table, filter)),
    "No saved report filters"
  );
  overviewRow = writeTextListSection(
    overviewSheet,
    overviewRow,
    "Export-only filters",
    exportFilters.map((filter) => describeReportFilter(report, table, filter)),
    "No export-only filters"
  );
  overviewRow = writeWarningSection(overviewSheet, overviewRow, result.warnings || []);

  if (includeDetails) {
    const dataSheet = workbook.addWorksheet(safeSheetName(`${report.name} Data`, usedNames));
    linkedSheets.push({ label: `${dataSheet.name} sheet`, sheetName: dataSheet.name });
    writeDataSheet(dataSheet, report, table, result, onProgress, {
      start: 80,
      end: 98,
      label: "Writing data sheet"
    });
  }

  if (includeSummary || includeChart) {
    const summarySheet = workbook.addWorksheet(safeSheetName(`${report.name} Summary`, usedNames));
    linkedSheets.push({ label: `${summarySheet.name} sheet`, sheetName: summarySheet.name });
    summarySheet.getCell("A1").value = report.name;
    summarySheet.getCell("A1").font = { size: 18, bold: true };
    summarySheet.getCell("A2").value = report.description || table.name;
    const chartRow = writeSummaryRows(summarySheet, report, result, 4, includeSummary);
    writeWarningSection(summarySheet, Math.max(chartRow, 4), result.warnings || []);
    if (includeChart) {
      onProgress?.(76, "Rendering chart image");
      await addChartImage(workbook, summarySheet, report, table.name, result);
      if (!includeSummary) {
        summarySheet.getCell(`A${chartRow}`).value = "Chart only";
      }
    }
  }

  writeLinkRows(overviewSheet, overviewRow, "Workbook sheets", linkedSheets);

  await workbook.xlsx.write(output);
  onProgress?.(100, "Export ready");
}

export async function streamDashboardWorkbook(
  output: Stream,
  dashboard: DashboardDefinition,
  rendered: DashboardRunResult,
  exportResultsByReportId: Record<string, ReportRunResult>,
  tablesById: Record<string, TableDefinition>,
  onProgress?: ExportProgressCallback,
  runtimeFilters: Record<string, string> = {}
) {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const overview = workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames));
  writeOverviewHeader(overview, dashboard.name, dashboard.description || "Dashboard export");
  let overviewRow = writeMetadataRows(overview, 4, [
    { label: "Generated", value: formatTimestamp(workbook.created) },
    { label: "Tabs exported", value: rendered.tabs.length },
    {
      label: "Cards exported",
      value: rendered.tabs.reduce((sum, tab) => sum + tab.widgets.length, 0)
    }
  ]);
  overviewRow = writeTextListSection(
    overview,
    overviewRow + 1,
    "Runtime filters",
    dashboard.runtimeFilters.map((filter) => describeRuntimeFilter(dashboard, filter, tablesById, runtimeFilters)),
    "No dashboard runtime filters"
  );
  overview.getCell(`A${overviewRow}`).value = "Tab";
  overview.getCell(`B${overviewRow}`).value = "Card";
  overview.getCell(`C${overviewRow}`).value = "Report";
  overview.getCell(`D${overviewRow}`).value = "Status";
  overview.getCell(`E${overviewRow}`).value = "Rows";
  overview.getCell(`F${overviewRow}`).value = "Sheet";
  overview.getCell(`G${overviewRow}`).value = "Applied filters";
  overview.getCell(`H${overviewRow}`).value = "Exported content";
  overview.getRow(overviewRow).font = { bold: true };
  overviewRow += 1;
  onProgress?.(74, "Writing dashboard overview");

  const detailSheetNames: Record<string, string> = {};
  const tabSheetNamesById: Record<string, string> = {};

  rendered.tabs.forEach((tab) => {
    const tabSheet = workbook.addWorksheet(safeSheetName(tab.name, usedNames));
    tabSheetNamesById[tab.id] = tabSheet.name;
  });

  rendered.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      if (widget.status === "failed") return;
      const table = tablesById[widget.report.sourceTableId];
      const exportResult = resolveWidgetExportResult(widget, exportResultsByReportId);
      if (!widgetNeedsSeparateDetailSheet(widget.widget, widget.report)) return;
      if (!table || !exportResult.rows.length) return;
      const detailSheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name} Data`, usedNames));
      detailSheetNames[widget.widgetId] = detailSheet.name;
      const widgetFilters = buildDashboardFilters(dashboard, widget.report.id, runtimeFilters, widget.report.sourceTableId);
      const filterDescriptions = [
        ...widget.report.filters.map((filter) => describeReportFilter(widget.report, table, filter)),
        ...widgetFilters.map((filter) => describeReportFilter(widget.report, table, filter))
      ];
      writeDetailSheet(detailSheet, widget.report, table, exportResult, filterDescriptions);
    });
  });

  rendered.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const table = tablesById[widget.report.sourceTableId];
      const exportResult = resolveWidgetExportResult(widget, exportResultsByReportId);
      const runtimeWidgetFilters = table
        ? buildDashboardFilters(dashboard, widget.report.id, runtimeFilters, widget.report.sourceTableId).map((filter) => describeReportFilter(widget.report, table, filter))
        : [];
      const savedFilters = table
        ? widget.report.filters.map((filter) => describeReportFilter(widget.report, table, filter))
        : [];
      const filterSummary = [...savedFilters, ...runtimeWidgetFilters].join("; ") || "No filters";
      const parts = widget.status === "failed"
        ? [`failed: ${widget.error || widget.message || "Widget load failed"}`]
        : [
            widget.widget.showSummary ? "summary" : "",
            widgetShowsChart(widget.widget, widget.report) ? "chart" : "",
            widgetDisplayMode(widget.widget, widget.report) === "table" ? "table rows" : "",
            detailSheetNames[widget.widgetId] ? "detail sheet" : ""
          ].filter(Boolean);
      overview.getCell(`A${overviewRow}`).value = tab.name;
      overview.getCell(`B${overviewRow}`).value = widget.widget.title || widget.report.name;
      overview.getCell(`C${overviewRow}`).value = widget.report.name;
      overview.getCell(`D${overviewRow}`).value = widget.status === "failed" ? (widget.error || widget.message || "Failed") : "Ready";
      overview.getCell(`E${overviewRow}`).value = exportResult.totalRows;
      if (detailSheetNames[widget.widgetId]) {
        overview.getCell(`F${overviewRow}`).value = {
          text: detailSheetNames[widget.widgetId],
          hyperlink: sheetHyperlink(detailSheetNames[widget.widgetId])
        };
        overview.getCell(`F${overviewRow}`).font = { color: { argb: "FF1F5AA6" }, underline: true };
      } else {
        const sheetName = tabSheetNamesById[tab.id] || "";
        overview.getCell(`F${overviewRow}`).value = sheetName ? {
          text: sheetName,
          hyperlink: sheetHyperlink(sheetName)
        } : "";
        if (sheetName) {
          overview.getCell(`F${overviewRow}`).font = { color: { argb: "FF1F5AA6" }, underline: true };
        }
      }
      overview.getCell(`G${overviewRow}`).value = filterSummary;
      overview.getCell(`H${overviewRow}`).value = parts.join(", ") || "skipped";
      overview.getRow(overviewRow).alignment = { vertical: "top", wrapText: true };
      overviewRow += 1;
    });
  });
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((index) => {
    const widths = [18, 24, 26, 18, 12, 28, 44, 20];
    overview.getColumn(index).width = widths[index - 1];
  });

  for (const tab of rendered.tabs) {
    const sheetName = tabSheetNamesById[tab.id];
    const sheet = sheetName ? workbook.getWorksheet(sheetName) : undefined;
    if (!sheet) continue;
    sheet.getCell("A1").value = tab.name;
    sheet.getCell("A1").font = { size: 18, bold: true };
    sheet.getCell("A2").value = dashboard.name;
    await writeDashboardTabSheet(workbook, dashboard, sheet, tab, tablesById, exportResultsByReportId, detailSheetNames, onProgress);
  }

  await workbook.xlsx.write(output);
  onProgress?.(100, "Export ready");
}

export function buildReportFileName(report: ReportDefinition) {
  return `${safeFileName(report.name, report.id)} ${buildFileTimestamp(new Date())}.xlsx`;
}

export function buildDashboardFileName(dashboard: DashboardDefinition) {
  return `${safeFileName(dashboard.name, dashboard.id)} ${buildFileTimestamp(new Date())}.xlsx`;
}
