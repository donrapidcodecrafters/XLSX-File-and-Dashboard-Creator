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

function writeSummaryRows(sheet: ExcelJS.Worksheet, report: ReportDefinition, result: ReportRunResult, startRow = 1) {
  const decimalPlaces = getReportDecimalPlaces(report);
  let row = startRow;
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
  sheet.getCell(`A${row}`).value = "Chart label";
  sheet.getCell(`B${row}`).value = "Chart value";
  sheet.getRow(row).font = { bold: true };
  row += 1;
  result.chartData.forEach((item) => {
    sheet.getCell(`A${row}`).value = item.label;
    sheet.getCell(`B${row}`).value = formatNumericValue(item.value, decimalPlaces);
    row += 1;
  });
  if (!result.chartData.length) {
    sheet.getCell(`A${row}`).value = "No chart data";
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

  const summarySheet = workbook.addWorksheet(safeSheetName(`${report.name} Summary`, usedNames));
  summarySheet.getCell("A1").value = report.name;
  summarySheet.getCell("A1").font = { size: 18, bold: true };
  summarySheet.getCell("A2").value = report.description || table.name;
  writeSummaryRows(summarySheet, report, result, 4);
  onProgress?.(76, "Rendering chart image");
  await addChartImage(workbook, summarySheet, report, table.name, result);

  const dataSheet = workbook.addWorksheet(safeSheetName(`${report.name} Data`, usedNames));
  writeDataSheet(dataSheet, report, table, result, onProgress, {
    start: 80,
    end: 98,
    label: "Writing data sheet"
  });

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
  overview.getCell("C4").value = "Rows";
  overview.getRow(4).font = { bold: true };
  let overviewRow = 5;
  rendered.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const exportResult = exportResultsByReportId[widget.report.id] || widget.result;
      overview.getCell(`A${overviewRow}`).value = tab.name;
      overview.getCell(`B${overviewRow}`).value = widget.report.name;
      overview.getCell(`C${overviewRow}`).value = exportResult.totalRows;
      overviewRow += 1;
    });
  });
  onProgress?.(74, "Writing dashboard overview");

  const widgets = rendered.tabs.flatMap((tab) => tab.widgets.map((widget) => ({ tab, widget })));
  for (const [widgetIndex, { tab, widget }] of widgets.entries()) {
    const exportResult = exportResultsByReportId[widget.report.id] || widget.result;
    const table = tablesById[widget.report.sourceTableId];
    if (!table) continue;
    const sheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name}`, usedNames));
    sheet.getCell("A1").value = widget.report.name;
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A2").value = tab.name;
    writeSummaryRows(sheet, widget.report, exportResult, 4);
    await addChartImage(workbook, sheet, widget.report, tab.name, exportResult);

    const dataSheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name} Data`, usedNames));
    const totalWidgets = Math.max(widgets.length, 1);
    const widgetStart = 76 + Math.round((20 * widgetIndex) / totalWidgets);
    const widgetEnd = 76 + Math.round((20 * (widgetIndex + 1)) / totalWidgets);
    writeDataSheet(dataSheet, widget.report, table, exportResult, onProgress, {
      start: widgetStart,
      end: Math.max(widgetStart + 1, widgetEnd),
      label: `Writing ${widget.report.name}`
    });
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
