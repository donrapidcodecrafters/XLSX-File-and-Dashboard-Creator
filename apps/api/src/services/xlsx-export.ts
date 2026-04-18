import ExcelJS from "exceljs";
import type { Stream } from "node:stream";
import type { DashboardDefinition, DashboardRunResult, ReportDefinition, ReportRunResult, TableDefinition } from "@studio/shared";

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

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function writeSummaryRows(sheet: any, result: ReportRunResult, startRow = 1) {
  let row = startRow;
  sheet.getRow(row).values = ["Metric", "Value"];
  sheet.getRow(row).font = { bold: true };
  sheet.getRow(row).commit();
  row += 1;
  result.summary.forEach((item) => {
    sheet.addRow([item.label, item.value]).commit();
    row += 1;
  });
  if (!result.summary.length) {
    sheet.addRow(["Rows", result.totalRows]).commit();
    row += 1;
  }
  row += 1;
  sheet.getRow(row).values = ["Chart label", "Chart value"];
  sheet.getRow(row).font = { bold: true };
  sheet.getRow(row).commit();
  row += 1;
  result.chartData.forEach((item) => {
    sheet.addRow([item.label, item.value]).commit();
    row += 1;
  });
  if (!result.chartData.length) {
    sheet.addRow(["No chart data", ""]).commit();
    row += 1;
  }
  return row;
}

function writeDataSheet(
  sheet: any,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult
) {
  const headers = report.selectedFieldIds.map((fieldId) => table.fields.find((field) => field.id === fieldId)?.label || fieldId);
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(32, Math.max(16, header.length + 4))
  }));
  result.rows.forEach((row) => {
    sheet.addRow(report.selectedFieldIds.map((fieldId) => formatCell(row[fieldId]))).commit();
  });
}

export async function streamReportWorkbook(
  output: Stream,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult
) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: false,
    useSharedStrings: false
  });
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet(safeSheetName(`${report.name} Summary`, usedNames));
  summarySheet.getRow(1).values = [report.name];
  summarySheet.getRow(1).font = { size: 18, bold: true };
  summarySheet.getRow(1).commit();
  summarySheet.getRow(2).values = [report.description || table.name];
  summarySheet.getRow(2).commit();
  writeSummaryRows(summarySheet, result, 4);
  summarySheet.commit();

  const dataSheet = workbook.addWorksheet(safeSheetName(`${report.name} Data`, usedNames));
  writeDataSheet(dataSheet, report, table, result);
  dataSheet.commit();

  await workbook.commit();
}

export async function streamDashboardWorkbook(
  output: Stream,
  dashboard: DashboardDefinition,
  rendered: DashboardRunResult,
  exportResultsByReportId: Record<string, ReportRunResult>,
  tablesById: Record<string, TableDefinition>
) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: false,
    useSharedStrings: false
  });
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const overview = workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames));
  overview.getRow(1).values = [dashboard.name];
  overview.getRow(1).font = { size: 18, bold: true };
  overview.getRow(1).commit();
  overview.getRow(2).values = [dashboard.description || "Dashboard export"];
  overview.getRow(2).commit();
  overview.getRow(4).values = ["Tab", "Report", "Rows"];
  overview.getRow(4).font = { bold: true };
  overview.getRow(4).commit();
  rendered.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const exportResult = exportResultsByReportId[widget.report.id] || widget.result;
      overview.addRow([tab.name, widget.report.name, exportResult.totalRows]).commit();
    });
  });
  overview.commit();

  rendered.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const exportResult = exportResultsByReportId[widget.report.id] || widget.result;
      const table = tablesById[widget.report.sourceTableId];
      if (!table) return;
      const sheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name}`, usedNames));
      sheet.getRow(1).values = [widget.report.name];
      sheet.getRow(1).font = { size: 16, bold: true };
      sheet.getRow(1).commit();
      sheet.getRow(2).values = [tab.name];
      sheet.getRow(2).commit();
      const nextRow = writeSummaryRows(sheet, exportResult, 4) + 1;
      sheet.getRow(nextRow).values = ["Data"];
      sheet.getRow(nextRow).font = { bold: true };
      sheet.getRow(nextRow).commit();

      const headers = widget.report.selectedFieldIds.map((fieldId) => table.fields.find((field) => field.id === fieldId)?.label || fieldId);
      const headerRow = sheet.getRow(nextRow + 1);
      headerRow.values = headers;
      headerRow.font = { bold: true };
      headerRow.commit();
      exportResult.rows.forEach((row) => {
        sheet.addRow(widget.report.selectedFieldIds.map((fieldId) => formatCell(row[fieldId]))).commit();
      });
      sheet.commit();
    });
  });

  await workbook.commit();
}

export function buildReportFileName(report: ReportDefinition) {
  return `${safeFileName(report.name, report.id)}.xlsx`;
}

export function buildDashboardFileName(dashboard: DashboardDefinition) {
  return `${safeFileName(dashboard.name, dashboard.id)}.xlsx`;
}
