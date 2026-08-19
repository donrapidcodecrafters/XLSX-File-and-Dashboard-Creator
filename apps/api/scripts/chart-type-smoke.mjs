import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import {
  buildStudioDocument,
  runReport
} from "../../../packages/shared/dist/index.js";
import { exportReportNativeChartWorkbook } from "../dist/services/nativeExcelExport.js";

const CHART_TYPES = [
  "bar", "column", "line", "area", "donut", "pie",
  "stacked-bar", "stacked-column", "funnel", "heatmap", "radar", "gauge",
  "waterfall", "horizontal-bar", "horizontal-stacked-bar", "line-bar",
  "spline", "area-spline", "streamgraph", "scatter", "bubble",
  "radial-bar", "variwide-bar", "progress-bar", "bullet",
  "3d-bar", "3d-stacked-bar", "3d-area", "3d-pie", "3d-donut",
  "3d-funnel", "3d-scatter", "solid-gauge", "kpi-card", "big-number-card",
  "treemap", "sunburst", "box-plot", "candlestick", "histogram", "pareto",
  "map", "sankey", "network-graph"
];

function parseXmlOrThrow(label, xmlText) {
  const result = XMLValidator.validate(xmlText, { allowBooleanAttributes: true });
  assert.equal(result, true, `${label} produced malformed XML: ${result === true ? "" : JSON.stringify(result.err)}`);
}

async function main() {
  const document = buildStudioDocument();
  const baseReport = document.bundle.objects["report-project-portfolio"];
  const table = document.bundle.tables.find((item) => item.id === baseReport.sourceTableId);
  assert.ok(baseReport?.type === "report", "expected seed chart-capable report");
  assert.ok(table, "expected source table");

  let failures = 0;

  for (const chartType of CHART_TYPES) {
    const report = {
      ...baseReport,
      id: `report-smoke-${chartType}`,
      name: `Smoke ${chartType}`,
      view: {
        ...baseReport.view,
        mode: "chart",
        showSummary: false,
        showDetails: false,
        showChartInTable: false,
        chartType,
        chartFieldId: "region",
        chartAggregation: "sum",
        chartValueFieldId: "budget",
        chartUseSecondaryAxis: chartType === "line-bar" || chartType === "pareto" || chartType === "bubble",
        chartSecondaryValueFieldId: "completion",
        chartSecondaryAggregation: "avg",
        chartSecondarySeriesType: "line"
      }
    };
    try {
      const result = runReport(report, table, document.bundle.data[table.id], []);
      assert.ok(result.chartData.length > 0, `expected chart data for ${chartType}`);
      const buffer = await exportReportNativeChartWorkbook(report, table, result);

      // 1) Must be a loadable, valid xlsx package.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      assert.ok(workbook.worksheets.length > 0, `${chartType}: expected at least one worksheet`);

      // 2) Every generated chart part must be well-formed XML (catches
      //    unclosed tags / malformed attributes that ExcelJS's loader
      //    doesn't itself validate against the chart schema).
      const zip = await JSZip.loadAsync(buffer);
      const chartFiles = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
      if (chartType === "kpi-card" || chartType === "big-number-card") {
        // Not real Excel chart types — these render as a plain big-number
        // cell block instead of a chart object, matching the live dashboard.
        assert.equal(chartFiles.length, 0, `${chartType}: expected no chart part (renders as cells)`);
        const sheet = workbook.worksheets[0];
        assert.ok(sheet.getCell("A6").value !== null && sheet.getCell("A6").value !== undefined, `${chartType}: expected big-number value cell`);
        console.log(`ok   ${chartType} — rendered as big-number cells`);
      } else {
        assert.ok(chartFiles.length > 0, `${chartType}: expected at least one native chart part`);
        for (const path of chartFiles) {
          const xmlText = await zip.file(path).async("string");
          parseXmlOrThrow(`${chartType} (${path})`, xmlText);
        }
        console.log(`ok   ${chartType} — ${chartFiles.length} chart part(s)`);
      }
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${chartType} — ${error instanceof Error ? error.message : error}`);
    }
  }

  assert.equal(failures, 0, `${failures} chart type(s) failed native export`);
  console.log(`all ${CHART_TYPES.length} chart types exported and validated`);
}

await main();
