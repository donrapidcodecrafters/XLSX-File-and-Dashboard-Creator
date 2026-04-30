import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import {
  buildDashboardFilters,
  buildStudioDocument,
  runReport
} from "../../../packages/shared/dist/index.js";
import { streamDashboardWorkbook, streamReportWorkbook } from "../dist/services/xlsx-export.js";

async function writeWorkbookBuffer(writer) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const finished = new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  await writer(stream);
  stream.end();
  await finished;
  return Buffer.concat(chunks);
}

function sheetText(sheet) {
  return sheet.getSheetValues()
    .flatMap((row) => Array.isArray(row) ? row : [])
    .map((value) => {
      if (value && typeof value === "object" && "text" in value) return String(value.text || "");
      return String(value || "");
    })
    .filter(Boolean);
}

async function main() {
  const document = buildStudioDocument();
  const report = document.bundle.objects["report-invoice-health"];
  const table = document.bundle.tables.find((item) => item.id === report.sourceTableId);
  assert.ok(report?.type === "report", "expected seed invoice report");
  assert.ok(table, "expected source table for invoice report");

  const exportFilters = [{ id: "export-region", fieldId: "region", operator: "equals", value: "North" }];
  const reportResult = runReport(report, table, document.bundle.data[table.id], exportFilters);
  const reportBuffer = await writeWorkbookBuffer((stream) =>
    streamReportWorkbook(stream, report, table, reportResult, undefined, exportFilters)
  );
  const reportWorkbook = new ExcelJS.Workbook();
  await reportWorkbook.xlsx.load(reportBuffer);

  const reportOverview = reportWorkbook.getWorksheet("Invoice Health Overview");
  assert.ok(reportOverview, "expected report overview sheet");
  const reportOverviewText = sheetText(reportOverview);
  assert.ok(reportOverviewText.includes("Saved report filters"), "expected saved filter section on report overview");
  assert.ok(reportOverviewText.includes("Export-only filters"), "expected export-only filter section on report overview");
  assert.ok(reportOverviewText.some((value) => value.includes("Region equals North")), "expected export filter summary in report overview");
  assert.ok(reportWorkbook.getWorksheet("Invoice Health Summary"), "expected summary sheet for report export");

  const chartBaseReport = document.bundle.objects["report-project-portfolio"];
  const chartTable = document.bundle.tables.find((item) => item.id === chartBaseReport.sourceTableId);
  assert.ok(chartBaseReport?.type === "report", "expected seed chart-capable report");
  assert.ok(chartTable, "expected source table for chart-capable report");
  const chartReport = {
    ...chartBaseReport,
    id: "report-chart-export-smoke",
    name: "Chart Export Smoke",
    view: {
      ...chartBaseReport.view,
      mode: "chart",
      showSummary: true,
      showDetails: false,
      showChartInTable: false,
      chartType: "bar",
      chartFieldId: "region",
      chartAggregation: "sum",
      chartValueFieldId: "budget"
    }
  };
  const donutReport = {
    ...chartReport,
    id: "report-donut-export-smoke",
    name: "Donut Export Smoke",
    view: {
      ...chartReport.view,
      chartType: "donut"
    }
  };
  const chartReportResult = runReport(chartReport, chartTable, document.bundle.data[chartTable.id], exportFilters);
  const donutReportResult = runReport(donutReport, chartTable, document.bundle.data[chartTable.id], exportFilters);
  const chartReportBuffer = await writeWorkbookBuffer((stream) =>
    streamReportWorkbook(stream, chartReport, chartTable, chartReportResult, undefined, exportFilters)
  );
  const chartReportWorkbook = new ExcelJS.Workbook();
  await chartReportWorkbook.xlsx.load(chartReportBuffer);
  assert.ok(
    chartReportWorkbook.worksheets.some((sheet) => typeof sheet.getImages === "function" && sheet.getImages().length > 0),
    "expected chart report export workbook to embed at least one chart image"
  );

  const dashboardTemplate = document.bundle.objects["dashboard-executive-pulse"];
  assert.ok(dashboardTemplate?.type === "dashboard", "expected seed dashboard");
  const dashboard = {
    ...dashboardTemplate,
    id: "dashboard-export-smoke",
    name: "Export Smoke Dashboard",
    tabs: [{
      id: "tab-export",
      name: "Overview",
      widgets: [
        {
          id: "widget-export-chart",
          title: "Portfolio Chart",
          mode: "linked",
          displayMode: "chart",
          showSummary: true,
          showDetails: false,
          reportId: chartReport.id,
          layout: { w: 6, h: 4, x: 1, y: 1 }
        },
        {
          id: "widget-export-invoice",
          title: "Open Invoices",
          mode: "linked",
          displayMode: "table",
          showSummary: true,
          showDetails: true,
          reportId: report.id,
          layout: { w: 6, h: 4, x: 7, y: 1 }
        }
      ]
    }, {
      id: "tab-export-2",
      name: "Tab 2",
      widgets: [
        {
          id: "widget-export-donut",
          title: "Portfolio Donut",
          mode: "linked",
          displayMode: "chart",
          showSummary: false,
          showDetails: false,
          reportId: donutReport.id,
          layout: { w: 6, h: 4, x: 1, y: 1 }
        }
      ]
    }],
    runtimeFilters: [{
      id: "runtime-region",
      label: "Region",
      fieldId: "region",
      mode: "global",
      targetReportIds: [],
      defaultValue: ""
    }]
  };
  const runtimeValues = { "runtime-region": "North" };
  const widgetFilters = buildDashboardFilters(dashboard, report.id, runtimeValues, report.sourceTableId);
  const dashboardReportResult = runReport(report, table, document.bundle.data[table.id], widgetFilters);
  const chartWidgetFilters = buildDashboardFilters(dashboard, chartReport.id, runtimeValues, chartReport.sourceTableId);
  const dashboardChartResult = runReport(chartReport, chartTable, document.bundle.data[chartTable.id], chartWidgetFilters);
  const donutWidgetFilters = buildDashboardFilters(dashboard, donutReport.id, runtimeValues, donutReport.sourceTableId);
  const dashboardDonutResult = runReport(donutReport, chartTable, document.bundle.data[chartTable.id], donutWidgetFilters);
  const rendered = {
    dashboard,
    tabs: [{
      id: "tab-export",
      name: "Overview",
      widgets: [{
        widgetId: "widget-export-chart",
        widget: dashboard.tabs[0].widgets[0],
        report: chartReport,
        result: dashboardChartResult,
        status: "complete",
        message: `${dashboardChartResult.totalRows} rows`
      }, {
        widgetId: "widget-export-invoice",
        widget: dashboard.tabs[0].widgets[1],
        report,
        result: dashboardReportResult,
        status: "complete",
        message: `${dashboardReportResult.totalRows} rows`
      }]
    }, {
      id: "tab-export-2",
      name: "Tab 2",
      widgets: [{
        widgetId: "widget-export-donut",
        widget: dashboard.tabs[1].widgets[0],
        report: donutReport,
        result: dashboardDonutResult,
        status: "complete",
        message: `${dashboardDonutResult.totalRows} rows`
      }]
    }]
  };
  const dashboardBuffer = await writeWorkbookBuffer((stream) =>
    streamDashboardWorkbook(
      stream,
      dashboard,
      rendered,
      {
        "widget-export-chart": dashboardChartResult,
        "widget-export-invoice": dashboardReportResult,
        "widget-export-donut": dashboardDonutResult
      },
      Object.fromEntries(document.bundle.tables.map((item) => [item.id, item])),
      undefined,
      runtimeValues
    )
  );
  const dashboardWorkbook = new ExcelJS.Workbook();
  await dashboardWorkbook.xlsx.load(dashboardBuffer);

  const dashboardOverview = dashboardWorkbook.getWorksheet("Export Smoke Dashboard Overview");
  assert.ok(dashboardOverview, "expected dashboard overview sheet");
  const dashboardOverviewText = sheetText(dashboardOverview);
  assert.ok(dashboardOverviewText.includes("Runtime filters"), "expected runtime filter section in dashboard overview");
  assert.ok(
    dashboardOverviewText.some((value) => value.includes("Region equals North") || value.includes("Region: Region equals North")),
    "expected dashboard runtime filter summary"
  );
  assert.ok(
    dashboardOverviewText.some((value) => value.includes("Overview")),
    "expected dashboard overview to link to the dashboard tab sheet"
  );
  assert.equal(
    dashboardWorkbook.getWorksheet("Overview Invoice Health Data"),
    undefined,
    "expected table widgets to stay on the dashboard tab instead of creating a duplicate data sheet"
  );
  const dashboardTabSheet = dashboardWorkbook.getWorksheet("Overview");
  assert.ok(dashboardTabSheet, "expected exported dashboard tab sheet");
  assert.equal(dashboardTabSheet.getCell("A1").value, "Portfolio Chart", "expected first widget title to render at its explicit grid origin");
  assert.equal(dashboardTabSheet.getCell("G1").value, "Open Invoices", "expected second widget title to render at its reconstructed X position");
  const dashboardSecondTabSheet = dashboardWorkbook.getWorksheet("Tab 2");
  assert.ok(dashboardSecondTabSheet, "expected second dashboard tab sheet");
  assert.ok(
    dashboardWorkbook.worksheets.some((sheet) => typeof sheet.getImages === "function" && sheet.getImages().length > 0),
    "expected dashboard export workbook to embed at least one chart image"
  );
  assert.ok(
    typeof dashboardSecondTabSheet.getImages === "function" && dashboardSecondTabSheet.getImages().length > 0,
    "expected second dashboard tab sheet to embed its chart image"
  );

  console.log("api export smoke tests passed");
}

await main();
