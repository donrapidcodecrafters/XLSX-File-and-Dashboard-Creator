import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildStudioDocument } from "../../../packages/shared/dist/index.js";
import { importWorkbookIntoStudioDocument } from "../dist/services/xlsx-import.js";

async function buildWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.addRow(["Regional Performance Summary"]);
  summarySheet.mergeCells("A1:C1");
  summarySheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFB85C2E" }
  };
  summarySheet.views = [{ state: "normal", style: "pageLayout", showGridLines: false, zoomScale: 85 }];
  summarySheet.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true };
  summarySheet.headerFooter = { oddHeader: "&CRegional Performance", oddFooter: "&RConfidential" };
  summarySheet.addRow([]);
  summarySheet.addTable({
    name: "SummaryTable",
    ref: "A3",
    headerRow: true,
    totalsRow: true,
    style: {
      theme: "TableStyleMedium9",
      showRowStripes: true,
      showColumnStripes: false
    },
    columns: [{ name: "Region" }, { name: "Amount" }, { name: "Status" }],
    rows: [
      ["West", 1200, "Open"],
      ["East", 950, "Closed"],
      ["Central", 1430, "Open"]
    ]
  });
  summarySheet.getCell("A8").value = "Workbook note outside table";

  const projectsSheet = workbook.addWorksheet("Projects");
  projectsSheet.addRow(["Task", "Status", "Owner"]);
  projectsSheet.addRow(["Atlas", "Planned", "Dana"]);
  projectsSheet.addRow(["Nova", "In Progress", "Sam"]);
  projectsSheet.addRow(["Helix", "Blocked", "Chris"]);

  const trendSheet = workbook.addWorksheet("Trend");
  trendSheet.properties.tabColor = { argb: "FF0D7C66" };
  trendSheet.addRow(["Month", "Revenue", "Cost"]);
  trendSheet.addRow(["2026-01-01", 1200, 840]);
  trendSheet.addRow(["2026-02-01", 1450, 910]);
  trendSheet.addRow(["2026-03-01", 1620, 980]);
  trendSheet.autoFilter = "A1:C4";

  const scheduleSheet = workbook.addWorksheet("Schedule");
  scheduleSheet.addRow(["Project", "Start Date", "End Date", "Owner"]);
  scheduleSheet.addRow(["Atlas", "2026-04-01", "2026-04-12", "Dana"]);
  scheduleSheet.addRow(["Nova", "2026-04-06", "2026-04-20", "Sam"]);

  const pipelineSheet = workbook.addWorksheet("Pipeline");
  pipelineSheet.addRow(["Executive Pipeline Overview"]);
  pipelineSheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF7A4DB4" }
  };
  pipelineSheet.addRow(["Generated", "2026-04-21"]);
  pipelineSheet.addRow([]);
  pipelineSheet.addRow(["Region", "Amount", "Amount", null]);
  pipelineSheet.addRow(["West", 1200, 75, "Priority"]);
  pipelineSheet.addRow(["East", 900, 60, "Standard"]);
  pipelineSheet.mergeCells("A1:D1");
  pipelineSheet.views = [{ state: "frozen", ySplit: 4 }];
  pipelineSheet.autoFilter = "A4:D6";
  pipelineSheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, printArea: "A1:D6" };
  pipelineSheet.getColumn(1).width = 28;
  pipelineSheet.getColumn(2).width = 24;
  pipelineSheet.getColumn(3).width = 24;
  pipelineSheet.getColumn(4).width = 26;
  pipelineSheet.getColumn(4).hidden = true;

  const supportSheet = workbook.addWorksheet("Detail Support", { state: "hidden" });
  supportSheet.properties.tabColor = { argb: "FF0D7C66" };
  supportSheet.addRow(["Month", "Variance Note", "Owner"]);
  supportSheet.addRow(["2026-01-01", "Launch variance", "Dana"]);
  supportSheet.addRow(["2026-02-01", "Supply variance", "Sam"]);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

async function buildAdvancedWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();

  const heatmapSheet = workbook.addWorksheet("Risk Matrix");
  heatmapSheet.addRow(["Impact", "Likelihood", "Score"]);
  heatmapSheet.addRow(["Low", "Rare", 2]);
  heatmapSheet.addRow(["Low", "Likely", 6]);
  heatmapSheet.addRow(["High", "Rare", 7]);
  heatmapSheet.addRow(["High", "Likely", 12]);

  const progressSheet = workbook.addWorksheet("KPI Progress");
  progressSheet.addRow(["KPI", "Percent"]);
  progressSheet.addRow(["Adoption", 64]);
  progressSheet.addRow(["Coverage", 81]);
  progressSheet.addRow(["Automation", 47]);

  const radarSheet = workbook.addWorksheet("Quarter Radar");
  radarSheet.addRow(["Quarter", "Score"]);
  radarSheet.addRow(["Q1", 72]);
  radarSheet.addRow(["Q2", 81]);
  radarSheet.addRow(["Q3", 69]);
  radarSheet.addRow(["Q4", 88]);

  const funnelSheet = workbook.addWorksheet("Stage Funnel");
  funnelSheet.addRow(["Stage", "Volume"]);
  funnelSheet.addRow(["Lead", 160]);
  funnelSheet.addRow(["Qualified", 110]);
  funnelSheet.addRow(["Proposal", 64]);
  funnelSheet.addRow(["Closed Won", 29]);

  const waterfallSheet = workbook.addWorksheet("Cash Walk");
  waterfallSheet.addRow(["Step", "Change"]);
  waterfallSheet.addRow(["Starting backlog", 120]);
  waterfallSheet.addRow(["Scope increase", 35]);
  waterfallSheet.addRow(["Delivery burn", -48]);
  waterfallSheet.addRow(["Change order", 22]);
  waterfallSheet.addRow(["Write-off", -12]);

  const gaugeSheet = workbook.addWorksheet("Single KPI");
  gaugeSheet.addRow(["Metric", "Percent"]);
  gaugeSheet.addRow(["Adoption", 84]);

  const bulletSheet = workbook.addWorksheet("Quota Tracker");
  bulletSheet.addRow(["Owner", "Actual", "Target"]);
  bulletSheet.addRow(["Dana", 74, 90]);
  bulletSheet.addRow(["Sam", 81, 88]);
  bulletSheet.addRow(["Chris", 63, 85]);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const document = buildStudioDocument();
  const imported = await importWorkbookIntoStudioDocument(document, "Executive Workbook.xlsx", await buildWorkbookBuffer());

  assert.equal(imported.importedTableIds.length, 6, "expected six imported tables");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Summary"), "expected imported Summary sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Projects"), "expected imported Projects sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Pipeline"), "expected imported Pipeline sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Trend"), "expected imported Trend sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Schedule"), "expected imported Schedule sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Detail Support"), "expected imported hidden support sheet table");

  const importedReports = imported.importedObjectIds
    .map((id) => imported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  assert.ok(importedReports.length >= 6, "expected one imported report per sheet");

  const primaryObject = imported.document.bundle.objects[imported.primaryObjectId];
  assert.equal(primaryObject?.type, "dashboard", "expected multi-sheet import to create a dashboard candidate");
  assert.equal(primaryObject.tabs.length, 6, "expected imported dashboard to create an overview tab plus one tab per sheet");
  assert.equal(primaryObject.tabs[0]?.name, "Overview", "expected imported dashboard to start with an overview tab");
  assert.equal(primaryObject.tabs[0]?.widgets.length, 7, "expected overview tab to include summary cards plus spotlight widgets");
  assert.equal(primaryObject.tabs[0]?.widgets[0]?.layout.x, 1, "expected imported overview widgets to preserve reconstructed X coordinates");
  assert.equal(primaryObject.tabs[0]?.widgets[1]?.layout.x, 5, "expected imported overview widgets to pack across the grid");
  assert.equal(primaryObject.tabs[0]?.widgets[5]?.layout.y, 7, "expected overview spotlight widgets to sit beneath the full summary section");
  assert.ok(
    primaryObject.tabs[0]?.widgets.slice(5).some((widget) => widget.displayMode === "chart"),
    "expected overview spotlights to include at least one chart-first widget"
  );
  assert.ok(primaryObject.runtimeFilters.length >= 2, "expected imported dashboard to infer shared runtime filters");
  assert.ok(primaryObject.runtimeFilters.some((filter) => filter.label === "Region"), "expected imported dashboard to infer a Region filter");
  assert.ok(primaryObject.runtimeFilters.some((filter) => filter.label === "Status"), "expected imported dashboard to infer a Status filter");
  assert.ok(
    primaryObject.runtimeFilters.every((filter) => filter.mode === "selected" || filter.mode === "global"),
    "expected imported dashboard runtime filters to use valid dashboard filter modes"
  );

  const summaryTable = imported.document.bundle.tables.find((table) => table.name === "Summary");
  assert.ok(summaryTable, "expected imported Summary table to exist");
  assert.equal(imported.document.bundle.data[summaryTable.id]?.length, 3, "expected imported Summary rows to be preserved");

  const pipelineTable = imported.document.bundle.tables.find((table) => table.name === "Pipeline");
  assert.ok(pipelineTable, "expected imported Pipeline table to exist");
  assert.deepEqual(
    pipelineTable.fields.map((field) => field.label),
    ["Region", "Amount", "Amount 2", "Column 4"],
    "expected importer to recover headers after title rows and repair duplicates/blanks"
  );
  assert.equal(imported.document.bundle.data[pipelineTable.id]?.length, 2, "expected imported Pipeline rows to be preserved");
  assert.ok(
    imported.warnings.some((warning) => warning.includes('Pipeline: Detected headers on row 4')),
    "expected warning about skipping leading workbook rows before the header"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes('Pipeline: Normalized 1 blank header, 1 duplicate header')),
    "expected warning about repaired Pipeline headers"
  );
  assert.equal(imported.review.importedSheetCount, 6, "expected review to count imported sheets");
  assert.equal(imported.review.skippedSheetCount, 0, "expected review to count skipped sheets");
  assert.equal(imported.review.dashboardCreated, true, "expected review to note dashboard creation");
  const pipelineReview = imported.review.sheets.find((sheet) => sheet.sheetName === "Pipeline");
  assert.ok(pipelineReview, "expected review entry for Pipeline");
  assert.equal(pipelineReview.status, "imported");
  assert.equal(pipelineReview.headerRowNumber, 4, "expected review to preserve detected header row");
  assert.ok(pipelineReview.substitutions.some((item) => item.includes('renamed to "Amount 2"')), "expected review to include duplicate-header substitution");
  assert.equal(pipelineReview.layout?.title, "Executive Pipeline Overview", "expected review to preserve recovered sheet title");
  assert.equal(pipelineReview.layout?.titleRowNumber, 1, "expected review to preserve the source title row number");
  assert.equal(pipelineReview.layout?.headerSource, "auto-filter", "expected review to record auto-filter-derived headers");
  assert.equal(pipelineReview.layout?.frozenRows, 4, "expected review to preserve frozen row count");
  assert.equal(pipelineReview.layout?.hiddenColumnCount, 1, "expected review to preserve hidden column count");
  assert.equal(pipelineReview.layout?.autoFilterRange, "A4:D6", "expected review to preserve the source auto-filter range");
  assert.equal(pipelineReview.layout?.printArea, "A1:D6", "expected review to preserve the source print area");
  assert.equal(pipelineReview.layout?.tableFocused, true, "expected review to mark table-focused sheet structure");
  assert.equal(pipelineReview.layout?.landscape, true, "expected review to preserve landscape page setup");
  assert.equal(pipelineReview.layout?.wideLayout, true, "expected review to mark wide source sheets");
  assert.ok(
    pipelineReview.layout?.hiddenFieldLabels.includes("Column 4"),
    "expected review to list hidden source fields"
  );
  assert.ok(
    pipelineReview.notes.some((note) => note.includes('auto-filter range "A4:D6"')),
    "expected review notes to mention the recovered auto-filter range"
  );
  const summaryReview = imported.review.sheets.find((sheet) => sheet.sheetName === "Summary");
  assert.ok(summaryReview, "expected review entry for Summary");
  assert.equal(summaryReview?.headerRowNumber, 3, "expected structured worksheet table to control the Summary header row");
  assert.equal(summaryReview?.rowCount, 3, "expected Summary import to use only workbook table data rows");
  assert.equal(summaryReview?.layout?.headerSource, "table", "expected Summary review to record workbook table-derived headers");
  assert.equal(summaryReview?.layout?.accentColor, "#B85C2E", "expected Summary review to preserve the styled worksheet accent color");
  assert.equal(summaryReview?.layout?.tableName, "SummaryTable", "expected Summary review to preserve workbook table name");
  assert.equal(summaryReview?.layout?.tableRange, "A3:C7", "expected Summary review to preserve workbook table range");
  assert.equal(summaryReview?.layout?.tableStyle, "TableStyleMedium9", "expected Summary review to preserve workbook table style");
  assert.equal(summaryReview?.layout?.totalsRow, true, "expected Summary review to record workbook table totals rows");
  assert.equal(summaryReview?.layout?.tableRowStripes, true, "expected Summary review to record workbook table row stripes");
  assert.equal(summaryReview?.layout?.viewStyle, "pageLayout", "expected Summary review to preserve worksheet view style");
  assert.equal(summaryReview?.layout?.showGridLines, false, "expected Summary review to preserve hidden gridlines");
  assert.equal(summaryReview?.layout?.zoomScale, 85, "expected Summary review to preserve worksheet zoom");
  assert.equal(summaryReview?.layout?.centeredHorizontally, true, "expected Summary review to preserve page centering");
  assert.equal(summaryReview?.layout?.fitToWidth, 1, "expected Summary review to preserve page fit width");
  assert.equal(summaryReview?.layout?.headerFooterText, "Regional Performance | Confidential", "expected Summary review to preserve worksheet header/footer text");
  assert.ok(
    summaryReview?.notes.some((note) => note.includes('workbook table "SummaryTable"')),
    "expected Summary review notes to mention workbook table recovery"
  );
  assert.ok(
    summaryReview?.notes.some((note) => note.includes("gridlines off")),
    "expected Summary review notes to mention worksheet view recovery"
  );

  const summaryReport = Object.values(imported.document.bundle.objects).find((object) => object?.type === "report" && object.name === "Summary");
  assert.equal(summaryReport?.type, "report", "expected imported Summary report");
  assert.ok(
    summaryReport.description.includes("Regional Performance | Confidential"),
    "expected Summary report description to include recovered header/footer text"
  );

  const trendReport = Object.values(imported.document.bundle.objects).find((object) => object?.type === "report" && object.name === "Trend");
  assert.equal(trendReport?.type, "report", "expected imported Trend report");
  assert.equal(trendReport.view.mode, "chart", "expected Trend sheet to infer a chart report");
  assert.equal(trendReport.view.chartType, "line", "expected Trend sheet to infer a line chart");
  assert.equal(trendReport.view.chartUseSecondaryAxis, true, "expected Trend sheet to use the second numeric metric as a secondary series");
  assert.equal(trendReport.view.chartColors[0], "#0D7C66", "expected Trend chart to inherit the worksheet tab color as its leading chart color");
  const trendTab = primaryObject.tabs.find((tab) => tab.name === "Trend");
  assert.ok(trendTab, "expected dashboard tab for Trend");
  assert.equal(trendTab.widgets.length, 4, "expected Trend tab to include highlights, chart, detail, and attached support widgets");
  assert.equal(trendTab.widgets[0].displayMode, "summary", "expected Trend tab to start with a highlights strip");
  assert.equal(trendTab.widgets[1].displayMode, "chart", "expected Trend tab primary data widget to open in chart mode");
  assert.deepEqual(
    trendTab.widgets.slice(0, 3).map((widget) => widget.layout.y),
    [1, 4, 9],
    "expected Trend tab widgets to stack in workbook-style reading order"
  );
  const trendReview = imported.review.sheets.find((sheet) => sheet.sheetName === "Trend");
  assert.ok(trendReview?.notes.some((note) => note.includes("time-series")), "expected Trend review to describe inferred time-series behavior");
  assert.equal(trendReview?.layout?.tabColor, "FF0D7C66", "expected Trend review to preserve worksheet tab color");

  const projectsReport = Object.values(imported.document.bundle.objects).find((object) => object?.type === "report" && object.name === "Projects");
  assert.equal(projectsReport?.type, "report", "expected imported Projects report");
  assert.equal(projectsReport.view.mode, "kanban", "expected Projects sheet to infer a kanban report");
  assert.equal(projectsReport.view.kanbanField, "status", "expected Projects kanban to use the status field");
  const projectsTab = primaryObject.tabs.find((tab) => tab.name === "Projects");
  assert.ok(projectsTab?.widgets.some((widget) => widget.displayMode === "summary"), "expected Projects tab to include a summary companion widget");
  assert.equal(projectsTab?.widgets[0]?.displayMode, "summary", "expected Projects tab to start with a summary strip");
  assert.equal(projectsTab?.widgets[1]?.layout.y, 4, "expected kanban content to sit beneath its summary strip");

  const scheduleReport = Object.values(imported.document.bundle.objects).find((object) => object?.type === "report" && object.name === "Schedule");
  assert.equal(scheduleReport?.type, "report", "expected imported Schedule report");
  assert.equal(scheduleReport.view.mode, "timeline", "expected Schedule sheet to infer a timeline report");
  assert.ok(scheduleReport.view.timelineDateField, "expected Schedule sheet to infer a timeline start field");
  assert.ok(scheduleReport.view.timelineEndField, "expected Schedule sheet to infer a timeline end field");
  const scheduleTab = primaryObject.tabs.find((tab) => tab.name === "Schedule");
  assert.equal(scheduleTab?.widgets[0]?.displayMode, "summary", "expected Schedule tab to start with a summary strip");
  assert.equal(scheduleTab?.widgets[1]?.layout.y, 4, "expected timeline content to sit beneath its summary strip");
  const pipelineReport = Object.values(imported.document.bundle.objects).find((object) => object?.type === "report" && object.name === "Pipeline");
  assert.equal(pipelineReport?.type, "report", "expected imported Pipeline report");
  assert.ok(
    pipelineReport.description.includes("Executive Pipeline Overview"),
    "expected imported Pipeline report description to include the recovered source title"
  );
  assert.equal(pipelineReview?.layout?.accentColor, "#7A4DB4", "expected Pipeline review to preserve styled worksheet accent color");
  assert.equal(pipelineReport.view.chartColors[0], "#7A4DB4", "expected Pipeline chart to inherit the styled worksheet accent color when no tab color exists");
  assert.ok(
    !pipelineReport.selectedFieldIds.includes("column-4"),
    "expected hidden workbook columns to be excluded from the default selected fields"
  );
  const pipelineTab = primaryObject.tabs.find((tab) => tab.name === "Pipeline");
  assert.ok(pipelineTab, "expected dashboard tab for Pipeline");
  assert.ok(
    pipelineTab.widgets.every((widget) => widget.layout.w === 12),
    "expected wide-source tabs to reconstruct as full-width cards"
  );
  assert.equal(pipelineTab.widgets[0]?.displayMode, "summary", "expected wide-source chart tabs to start with a summary strip");
  assert.equal(pipelineTab.widgets[1]?.displayMode, "chart", "expected wide-source chart tabs to keep the chart as the primary content block");
  assert.ok(
    pipelineTab.widgets.every((widget) => Number(widget.layout.x || 0) >= 1 && Number(widget.layout.y || 0) >= 1),
    "expected imported dashboard widgets to keep reconstructed grid coordinates"
  );
  const hiddenSupportReview = imported.review.sheets.find((sheet) => sheet.sheetName === "Detail Support");
  assert.equal(hiddenSupportReview?.layout?.state, "hidden", "expected hidden support sheet review state");
  assert.equal(hiddenSupportReview?.layout?.tabColor, "FF0D7C66", "expected hidden support sheet review tab color");
  assert.ok(
    Object.values(imported.document.bundle.objects).some((object) => object?.type === "report" && object.name === "Detail Support"),
    "expected hidden support sheet to still import as a report"
  );
  assert.ok(
    !primaryObject.tabs.some((tab) => tab.name === "Detail Support"),
    "expected hidden support sheet to stay out of primary dashboard tabs"
  );
  assert.equal(trendTab.widgets.length, 4, "expected Trend tab to include an attached hidden support detail widget");
  assert.equal(trendTab.widgets[3]?.displayMode, "table", "expected attached hidden support widget to render as a detail table");
  assert.ok(
    imported.warnings.some((warning) => warning.includes("Created an overview tab")),
    "expected workbook import warnings to mention overview dashboard reconstruction"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("overview spotlight")),
    "expected workbook import warnings to mention added overview spotlight widgets"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("summary-first reading order")),
    "expected workbook import warnings to mention summary-first layout reconstruction"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("shared dashboard filter")),
    "expected workbook import warnings to mention inferred cross-sheet dashboard filters"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("wide worksheet layout")),
    "expected workbook import warnings to mention recovered wide-sheet layout intent"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("hidden source column")),
    "expected workbook import warnings to mention hidden source columns"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("table-centric layout")),
    "expected workbook import warnings to mention table-centric reconstruction"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("hidden support sheet")),
    "expected workbook import warnings to mention hidden support sheet handling"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes("Attached") && warning.includes("support sheet widget")),
    "expected workbook import warnings to mention attached hidden support widgets"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes('auto-filter range "A4:D6"')),
    "expected workbook import warnings to mention the recovered auto-filter range"
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes('workbook table "SummaryTable"')),
    "expected workbook import warnings to mention workbook table recovery"
  );

  const advancedImported = await importWorkbookIntoStudioDocument(buildStudioDocument(), "Advanced Visual Workbook.xlsx", await buildAdvancedWorkbookBuffer());
  const advancedReports = Object.values(advancedImported.document.bundle.objects).filter((object) => object?.type === "report");
  const heatmapReport = advancedReports.find((object) => object.name === "Risk Matrix");
  assert.equal(heatmapReport?.view.chartType, "heatmap", "expected Risk Matrix sheet to infer a heatmap chart");
  assert.equal(heatmapReport?.view.chartSeriesFieldId, "likelihood", "expected Risk Matrix heatmap to use the second category as the series dimension");
  const progressReport = advancedReports.find((object) => object.name === "KPI Progress");
  assert.equal(progressReport?.view.chartType, "radial-bar", "expected KPI Progress sheet to infer a radial progress chart");
  const radarReport = advancedReports.find((object) => object.name === "Quarter Radar");
  assert.equal(radarReport?.view.chartType, "radar", "expected Quarter Radar sheet to infer a radar chart");
  const funnelReport = advancedReports.find((object) => object.name === "Stage Funnel");
  assert.equal(funnelReport?.view.chartType, "funnel", "expected Stage Funnel sheet to infer a funnel chart");
  const waterfallReport = advancedReports.find((object) => object.name === "Cash Walk");
  assert.equal(waterfallReport?.view.chartType, "waterfall", "expected Cash Walk sheet to infer a waterfall chart");
  const gaugeReport = advancedReports.find((object) => object.name === "Single KPI");
  assert.equal(gaugeReport?.view.chartType, "gauge", "expected Single KPI sheet to infer a gauge chart");
  assert.equal(gaugeReport?.view.showDetails, false, "expected single-row KPI imports to hide detail rows by default");
  const bulletReport = advancedReports.find((object) => object.name === "Quota Tracker");
  assert.equal(bulletReport?.view.chartType, "bullet", "expected Quota Tracker sheet to infer a bullet chart");
  assert.equal(bulletReport?.view.chartUseSecondaryAxis, true, "expected bullet chart imports to preserve target values");
  assert.ok(
    advancedImported.warnings.some((warning) => warning.includes("heatmap")),
    "expected advanced workbook warnings to mention heatmap inference"
  );
  assert.ok(
    advancedImported.warnings.some((warning) => warning.includes("radar chart")),
    "expected advanced workbook warnings to mention radar inference"
  );
  assert.ok(
    advancedImported.warnings.some((warning) => warning.includes("funnel chart")),
    "expected advanced workbook warnings to mention funnel inference"
  );
  assert.ok(
    advancedImported.warnings.some((warning) => warning.includes("waterfall chart")),
    "expected advanced workbook warnings to mention waterfall inference"
  );
  assert.ok(
    advancedImported.warnings.some((warning) => warning.includes("gauge chart")),
    "expected advanced workbook warnings to mention gauge inference"
  );
  assert.ok(
    advancedImported.warnings.some((warning) => warning.includes("bullet chart")),
    "expected advanced workbook warnings to mention bullet inference"
  );

  console.log("api import smoke tests passed");
}

await main();
