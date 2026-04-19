import ExcelJS from "exceljs";
import type { Stream } from "node:stream";
import { formatNumericValue, formatReportCellValue, getReportDecimalPlaces, getReportFieldLabel, type ChartDatum, type DashboardDefinition, type DashboardRunResult, type ReportDefinition, type ReportRunResult, type SummaryDatum, type TableDefinition } from "@studio/shared";

interface ExportProgressCallback {
  (progress: number, message: string): void;
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

function safeFileName(name: string, fallback: string) {
  const next = (name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return next || fallback;
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
  const total = Math.max(result.rows.length, 1);
  result.rows.forEach((row, index) => {
    sheet.addRow(Object.fromEntries(
      report.selectedFieldIds.map((fieldId) => [fieldId, formatReportCellValue(report, table, fieldId, row[fieldId])])
    ));
    if (onProgress && progressRange && (index === 0 || (index + 1) % 500 === 0 || index + 1 === total)) {
      const ratio = (index + 1) / total;
      const progress = progressRange.start + Math.round((progressRange.end - progressRange.start) * ratio);
      onProgress(progress, `${progressRange.label} (${(index + 1).toLocaleString()} / ${total.toLocaleString()})`);
    }
  });
}

function quickChartType(chartType: ReportDefinition["view"]["chartType"]) {
  if (chartType === "pie" || chartType === "3d-pie") return "pie";
  if (chartType === "donut" || chartType === "3d-donut") return "doughnut";
  if (chartType === "line" || chartType === "spline" || chartType === "line-bar") return "line";
  if (chartType === "area" || chartType === "area-spline" || chartType === "streamgraph" || chartType === "3d-area") return "line";
  if (chartType === "radar") return "radar";
  if (chartType === "scatter" || chartType === "3d-scatter") return "scatter";
  if (chartType === "bubble") return "bubble";
  return "bar";
}

function chartDataset(data: ChartDatum[], report: ReportDefinition) {
  const horizontal = report.view.chartType === "horizontal-bar" || report.view.chartType === "horizontal-stacked-bar" || (report.view.chartType === "bar" && report.view.chartOrientation === "horizontal");
  const type = quickChartType(report.view.chartType);
  if (type === "scatter") {
    return {
      datasets: [{
        label: report.view.chartTitle || report.name,
        data: data.map((item, index) => ({ x: index + 1, y: item.value })),
        backgroundColor: "#0d7c66"
      }]
    };
  }
  if (type === "bubble") {
    return {
      datasets: [{
        label: report.view.chartTitle || report.name,
        data: data.map((item, index) => ({ x: index + 1, y: item.value, r: 8 + Math.min(18, Math.round(item.value / 5 || 1)) })),
        backgroundColor: "rgba(13,124,102,0.65)"
      }]
    };
  }
  return {
    labels: data.map((item) => item.label),
    datasets: [{
      label: report.view.chartTitle || report.name,
      data: data.map((item) => item.value),
      backgroundColor: ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a"],
      borderColor: "#0d7c66",
      fill: type === "line" ? (report.view.chartType === "area" || report.view.chartType === "area-spline" || report.view.chartType === "streamgraph") : undefined
    }],
    indexAxis: horizontal ? ("y" as const) : ("x" as const)
  };
}

async function renderChartImage(report: ReportDefinition, subtitle: string, chartData: ChartDatum[], summary: SummaryDatum[]) {
  if (!chartData.length) return null;
  const chartType = quickChartType(report.view.chartType);
  const config = {
    type: chartType,
    data: chartDataset(chartData.slice(0, 16), report),
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: report.view.chartShowLegend !== false },
        title: {
          display: true,
          text: report.view.chartTitle || report.name
        },
        subtitle: {
          display: true,
          text: subtitle
        }
      },
      scales: chartType === "pie" || chartType === "doughnut" || chartType === "radar" ? undefined : {
        x: {
          title: {
            display: Boolean(report.view.chartXAxisLabel),
            text: report.view.chartXAxisLabel
          }
        },
        y: {
          title: {
            display: Boolean(report.view.chartYAxisLabel),
            text: report.view.chartYAxisLabel
          }
        }
      }
    }
  };
  const response = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      width: 1200,
      height: 720,
      backgroundColor: "white",
      devicePixelRatio: 2,
      format: "png",
      chart: config
    })
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer()).toString("base64");
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
  const imageId = workbook.addImage({ base64: image, extension: "png" });
  sheet.addImage(imageId, { tl: { col: 3, row: 1 }, ext: { width: 760, height: 460 } });
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

function layoutDashboardWidgets(widgets: DashboardRunResult["tabs"][number]["widgets"]) {
  const placements: Array<{
    widget: DashboardRunResult["tabs"][number]["widgets"][number];
    startCol: number;
    endCol: number;
    startRow: number;
    endRow: number;
  }> = [];
  let currentCol = 1;
  let currentRow = 1;
  let rowHeight = 0;

  widgets.forEach((widget) => {
    const width = Math.max(1, Math.min(12, Math.round(widget.widget.layout.w || 6)));
    const height = Math.max(6, Math.round((widget.widget.layout.h || 4) * 6));
    if (currentCol + width - 1 > 12) {
      currentRow += rowHeight + 1;
      currentCol = 1;
      rowHeight = 0;
    }
    const startCol = currentCol;
    const endCol = Math.min(12, startCol + width - 1);
    const startRow = currentRow;
    const endRow = startRow + height - 1;
    placements.push({ widget, startCol, endCol, startRow, endRow });
    currentCol = endCol + 1;
    rowHeight = Math.max(rowHeight, height);
  });

  return placements;
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

function writeWidgetDataPreviewBlock(
  sheet: ExcelJS.Worksheet,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  startRow: number,
  startCol: number,
  endCol: number,
  dataSheetName: string | null
) {
  let row = startRow;
  mergeRowRange(sheet, row, startCol, endCol);
  sheet.getCell(row, startCol).value = dataSheetName
    ? `Table data exported on "${dataSheetName}"`
    : "Table data";
  sheet.getCell(row, startCol).font = { italic: true, color: { argb: "FF56685E" } };
  row += 1;

  const previewFieldIds = report.selectedFieldIds.slice(0, Math.max(1, Math.min(3, endCol - startCol + 1)));
  previewFieldIds.forEach((fieldId, index) => {
    const col = startCol + index;
    sheet.getCell(row, col).value = getReportFieldLabel(report, table, fieldId);
    sheet.getCell(row, col).font = { bold: true };
  });
  row += 1;
  result.rows.slice(0, 8).forEach((dataRow) => {
    previewFieldIds.forEach((fieldId, index) => {
      sheet.getCell(row, startCol + index).value = formatReportCellValue(report, table, fieldId, dataRow[fieldId]);
    });
    row += 1;
  });
  return row;
}

async function writeDashboardTabSheet(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  tab: DashboardRunResult["tabs"][number],
  tablesById: Record<string, TableDefinition>,
  exportResultsByReportId: Record<string, ReportRunResult>,
  detailSheetNames: Record<string, string>,
  onProgress?: ExportProgressCallback
) {
  setDashboardLayoutColumns(sheet);
  const placements = layoutDashboardWidgets(tab.widgets);
  for (const placement of placements) {
    const { widget, startCol, endCol, startRow, endRow } = placement;
    const exportResult = exportResultsByReportId[widget.report.id] || widget.result;
    const table = tablesById[widget.report.sourceTableId];
    if (!table) continue;
    writeWidgetTitle(sheet, startRow, startCol, endCol, widget.widget.title || widget.report.name, widget.report.name !== widget.widget.title ? widget.report.name : "");
    let contentRow = startRow + 3;
    if (widget.widget.showSummary) {
      contentRow = writeWidgetSummaryBlock(sheet, exportResult, contentRow, startCol, endCol) + 1;
    }
    if (widgetShowsChart(widget.widget, widget.report)) {
      const image = await renderChartImage(widget.report, tab.name, exportResult.chartData, exportResult.summary);
      if (image) {
        const imageId = workbook.addImage({ base64: image, extension: "png" });
        sheet.addImage(imageId, {
          tl: { col: startCol - 1 + 0.1, row: contentRow - 1 + 0.1 },
          ext: {
            width: Math.max(260, (endCol - startCol + 1) * 90),
            height: 220
          }
        });
        contentRow += 12;
      }
    }
    if (widgetShowsDetails(widget.widget, widget.report)) {
      writeWidgetDataPreviewBlock(
        sheet,
        widget.report,
        table,
        exportResult,
        Math.min(contentRow, endRow - 10),
        startCol,
        endCol,
        detailSheetNames[widget.widgetId] || null
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
  onProgress?: ExportProgressCallback
) {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const includeSummary = reportShowsSummary(report) && result.summary.length > 0;
  const includeChart = reportShowsChart(report);
  const includeDetails = reportShowsDetails(report);

  if (includeDetails) {
    const dataSheet = workbook.addWorksheet(safeSheetName(`${report.name} Data`, usedNames));
    writeDataSheet(dataSheet, report, table, result, onProgress, {
      start: 80,
      end: 98,
      label: "Writing data sheet"
    });
  }

  if (includeSummary || includeChart) {
    const summarySheet = workbook.addWorksheet(safeSheetName(`${report.name} Summary`, usedNames));
    summarySheet.getCell("A1").value = report.name;
    summarySheet.getCell("A1").font = { size: 18, bold: true };
    summarySheet.getCell("A2").value = report.description || table.name;
    const chartRow = writeSummaryRows(summarySheet, report, result, 4, includeSummary);
    if (includeChart) {
      onProgress?.(76, "Rendering chart image");
      await addChartImage(workbook, summarySheet, report, table.name, result);
      if (!includeSummary) {
        summarySheet.getCell(`A${chartRow}`).value = "Chart only";
      }
    }
  }

  await workbook.xlsx.write(output);
  onProgress?.(100, "Export ready");
}

export async function streamDashboardWorkbook(
  output: Stream,
  dashboard: DashboardDefinition,
  rendered: DashboardRunResult,
  exportResultsByReportId: Record<string, ReportRunResult>,
  tablesById: Record<string, TableDefinition>,
  onProgress?: ExportProgressCallback
) {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const overview = workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames));
  overview.getCell("A1").value = dashboard.name;
  overview.getCell("A1").font = { size: 18, bold: true };
  overview.getCell("A2").value = dashboard.description || "Dashboard export";
  overview.getCell("A4").value = "Tab";
  overview.getCell("B4").value = "Report";
  overview.getCell("C4").value = "Exported content";
  overview.getRow(4).font = { bold: true };
  let overviewRow = 5;
  rendered.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const displayChart = widgetShowsChart(widget.widget, widget.report);
      const displaySummary = widget.widget.showSummary;
      const displayDetails = widgetShowsDetails(widget.widget, widget.report);
      const parts = [
        displaySummary ? "summary" : "",
        displayChart ? "chart" : "",
        displayDetails ? "rows" : ""
      ].filter(Boolean);
      overview.getCell(`A${overviewRow}`).value = tab.name;
      overview.getCell(`B${overviewRow}`).value = widget.report.name;
      overview.getCell(`C${overviewRow}`).value = parts.join(", ") || "skipped";
      overviewRow += 1;
    });
  });
  onProgress?.(74, "Writing dashboard overview");

  const widgets = rendered.tabs.flatMap((tab) => tab.widgets.map((widget) => ({ tab, widget })));
  const detailSheetNames: Record<string, string> = {};
  const tabSheetNamesById: Record<string, string> = {};

  for (const [widgetIndex, { tab, widget }] of widgets.entries()) {
    const exportResult = exportResultsByReportId[widget.report.id] || widget.result;
    const table = tablesById[widget.report.sourceTableId];
    if (!table) continue;
    const displayChart = widgetShowsChart(widget.widget, widget.report);
    const displaySummary = widget.widget.showSummary;
    const displayDetails = widgetShowsDetails(widget.widget, widget.report);
    if (!displayChart && !displaySummary && !displayDetails) {
      continue;
    }
    if (!displayDetails) {
      continue;
    }

    const dataSheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name} Data`, usedNames));
    detailSheetNames[widget.widgetId] = dataSheet.name;
    const totalWidgets = Math.max(widgets.length, 1);
    const widgetStart = 76 + Math.round((20 * widgetIndex) / totalWidgets);
    const widgetEnd = 76 + Math.round((20 * (widgetIndex + 1)) / totalWidgets);
    writeDataSheet(dataSheet, widget.report, table, exportResult, onProgress, {
      start: widgetStart,
      end: Math.max(widgetStart + 1, widgetEnd),
      label: `Writing ${widget.report.name}`
    });
  }

  rendered.tabs.forEach((tab) => {
    const tabSheet = workbook.addWorksheet(safeSheetName(tab.name, usedNames));
    tabSheetNamesById[tab.id] = tabSheet.name;
  });

  for (const tab of rendered.tabs) {
    const sheetName = tabSheetNamesById[tab.id];
    const sheet = sheetName ? workbook.getWorksheet(sheetName) : undefined;
    if (!sheet) continue;
    sheet.getCell("A1").value = tab.name;
    sheet.getCell("A1").font = { size: 18, bold: true };
    sheet.getCell("A2").value = dashboard.name;
    await writeDashboardTabSheet(workbook, sheet, tab, tablesById, exportResultsByReportId, detailSheetNames, onProgress);
  }

  await workbook.xlsx.write(output);
  onProgress?.(100, "Export ready");
}

export function buildReportFileName(report: ReportDefinition) {
  return `${safeFileName(report.name, report.id)}.xlsx`;
}

export function buildDashboardFileName(dashboard: DashboardDefinition) {
  return `${safeFileName(dashboard.name, dashboard.id)}.xlsx`;
}
