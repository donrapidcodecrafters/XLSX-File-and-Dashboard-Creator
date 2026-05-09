import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildStudioDocument } from "../../../packages/shared/dist/index.js";
import { importWorkbookIntoStudioDocument } from "../dist/services/xlsx-import.js";

async function injectNativeChart(workbookBuffer) {
  const zip = await JSZip.loadAsync(workbookBuffer);
  const sheetXmlPath = "xl/worksheets/sheet2.xml";
  const sheetXml = await zip.file(sheetXmlPath).async("string");
  const drawingTag = '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>';
  zip.file(sheetXmlPath, sheetXml.includes("<drawing ") ? sheetXml : sheetXml.replace("</worksheet>", `${drawingTag}</worksheet>`));
  zip.file("xl/worksheets/_rels/sheet2.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  zip.file("xl/drawings/drawing1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Native Sales Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>');
  zip.file("xl/drawings/_rels/drawing1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>');
  zip.file("xl/charts/chart1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Native Sales</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Source!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>West</c:v></c:pt><c:pt idx="1"><c:v>East</c:v></c:pt><c:pt idx="2"><c:v>Central</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Source!$B$2:$B$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt><c:pt idx="2"><c:v>15</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart></c:plotArea></c:chart></c:chartSpace>');
  const contentTypes = await zip.file("[Content_Types].xml").async("string");
  zip.file("[Content_Types].xml", contentTypes.replace("</Types>", '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'));
  return zip.generateAsync({ type: "nodebuffer" });
}

async function injectStackedComboChart(workbookBuffer) {
  const zip = await JSZip.loadAsync(await injectNativeChart(workbookBuffer));
  const drawingXml = await zip.file("xl/drawings/drawing1.xml").async("string");
  zip.file("xl/drawings/drawing1.xml", drawingXml.replace("Native Sales Chart", "Stacked Combo Chart"));
  zip.file("xl/charts/chart1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Stacked Cash</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Source!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Palmetto</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Source!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Sep</c:v></c:pt><c:pt idx="1"><c:v>Oct</c:v></c:pt><c:pt idx="2"><c:v>Nov</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Source!$B$2:$B$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>70</c:v></c:pt><c:pt idx="1"><c:v>80</c:v></c:pt><c:pt idx="2"><c:v>90</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:strRef><c:f>Source!$C$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Advantage</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Source!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Sep</c:v></c:pt><c:pt idx="1"><c:v>Oct</c:v></c:pt><c:pt idx="2"><c:v>Nov</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Source!$C$2:$C$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>20</c:v></c:pt><c:pt idx="1"><c:v>30</c:v></c:pt><c:pt idx="2"><c:v>25</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:ser><c:idx val="2"/><c:order val="2"/><c:tx><c:strRef><c:f>Source!$D$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Other</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="A5A5A5"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Source!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Sep</c:v></c:pt><c:pt idx="1"><c:v>Oct</c:v></c:pt><c:pt idx="2"><c:v>Nov</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Source!$D$2:$D$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>10</c:v></c:pt><c:pt idx="2"><c:v>15</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:lineChart><c:grouping val="standard"/><c:ser><c:idx val="3"/><c:order val="3"/><c:tx><c:strRef><c:f>Source!$E$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Target</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Source!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Sep</c:v></c:pt><c:pt idx="1"><c:v>Oct</c:v></c:pt><c:pt idx="2"><c:v>Nov</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Source!$E$2:$E$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>120</c:v></c:pt><c:pt idx="2"><c:v>130</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:lineChart></c:plotArea></c:chart></c:chartSpace>');
  return zip.generateAsync({ type: "nodebuffer" });
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function buildSimpleChartScreenshotPng() {
  const width = 180;
  const height = 120;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + (width * 4));
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + (x * 4);
      let color = [255, 255, 255, 255];
      if (x >= 34 && x <= 56 && y >= 58 && y <= 100) color = [214, 53, 53, 255];
      if (x >= 78 && x <= 100 && y >= 36 && y <= 100) color = [42, 111, 201, 255];
      if (x >= 122 && x <= 144 && y >= 20 && y <= 100) color = [74, 157, 83, 255];
      if ((x >= 24 && x <= 154 && y === 101) || (x === 24 && y >= 15 && y <= 101)) color = [70, 70, 70, 255];
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = color[3];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

async function injectPictureChart(workbookBuffer) {
  const zip = await JSZip.loadAsync(workbookBuffer);
  const sheetXmlPath = "xl/worksheets/sheet2.xml";
  const sheetXml = await zip.file(sheetXmlPath).async("string");
  const drawingTag = '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>';
  zip.file(sheetXmlPath, sheetXml.includes("<drawing ") ? sheetXml : sheetXml.replace("</worksheet>", `${drawingTag}</worksheet>`));
  zip.file("xl/worksheets/_rels/sheet2.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  zip.file("xl/drawings/drawing1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Screenshot Sales Chart"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>');
  zip.file("xl/drawings/_rels/drawing1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  zip.file("xl/media/image1.png", buildSimpleChartScreenshotPng());
  const contentTypes = await zip.file("[Content_Types].xml").async("string");
  zip.file("[Content_Types].xml", contentTypes.includes('Extension="png"')
    ? contentTypes
    : contentTypes.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>'));
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const dataSheet = workbook.addWorksheet("Data", { state: "hidden" });
  dataSheet.addRow(["Region", "Amount", "Status", "Month", "Revenue", "Cost", "Task", "Start Date", "End Date", "Owner"]);
  dataSheet.addRow(["West", 1200, "Open", "2026-01-01", 1200, 840, "Atlas", "2026-04-01", "2026-04-12", "Dana"]);
  dataSheet.addRow(["East", 950, "Closed", "2026-02-01", 1450, 910, "Nova", "2026-04-06", "2026-04-20", "Sam"]);
  dataSheet.addRow(["Central", 1430, "Open", "2026-03-01", 1620, 980, "Helix", "2026-04-10", "2026-04-24", "Chris"]);

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
  const dataSheet = workbook.addWorksheet("Data", { state: "hidden" });
  dataSheet.addRow(["Category", "Series", "Value", "Target", "Percent"]);
  dataSheet.addRow(["Low", "Rare", 2, 10, 64]);
  dataSheet.addRow(["Low", "Likely", 6, 12, 81]);
  dataSheet.addRow(["High", "Rare", 7, 14, 47]);
  dataSheet.addRow(["High", "Likely", 12, 16, 84]);

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

async function buildNoDataWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const projectsSheet = workbook.addWorksheet("Projects");
  projectsSheet.addRow(["Task", "Status", "Owner"]);
  projectsSheet.addRow(["Atlas", "Planned", "Dana"]);
  projectsSheet.addRow(["Nova", "In Progress", "Sam"]);
  projectsSheet.addRow(["Helix", "Blocked", "Chris"]);
  const trendSheet = workbook.addWorksheet("Trend");
  trendSheet.addRow(["Month", "Revenue", "Cost"]);
  trendSheet.addRow(["2026-01-01", 1200, 840]);
  trendSheet.addRow(["2026-02-01", 1450, 910]);
  trendSheet.addRow(["2026-03-01", 1620, 980]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildSummaryBlocksWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const cashSheet = workbook.addWorksheet("Cash Collected");
  cashSheet.addRow([]);
  cashSheet.addRow([]);
  cashSheet.addRow([null, "Sep", "Oct", "Nov", "Dec"]);
  cashSheet.addRow(["All", 100, 120, 130, 140]);
  cashSheet.addRow(["Palmetto", 70, 80, 90, 95]);
  cashSheet.addRow(["Advantage", 20, 30, 25, 35]);
  cashSheet.addRow(["Other", 10, 10, 15, 10]);
  cashSheet.addRow([]);
  cashSheet.addRow([]);
  cashSheet.addRow([]);
  cashSheet.addRow([]);
  cashSheet.addRow([]);
  cashSheet.addRow([null, "2025-01-01", "2025-02-01", "2025-03-01"]);
  cashSheet.addRow(["All", 10, 11, 12]);
  cashSheet.addRow(["Palmetto", 7, 8, 9]);
  cashSheet.addRow(["Advantage", 2, 2, 2]);
  cashSheet.addRow(["Other", 1, 1, 1]);

  const agingSheet = workbook.addWorksheet("AR Aging");
  agingSheet.addRow([]);
  agingSheet.addRow([]);
  agingSheet.addRow([]);
  agingSheet.addRow([null, "0-30", "31-60", "61-90", "Total"]);
  agingSheet.addRow(["Unbilled", 9, 3, 1, 13]);
  agingSheet.addRow([]);
  agingSheet.addRow([]);
  agingSheet.addRow([null, "0-30", "31-60", "61-90", "Total"]);
  agingSheet.addRow(["Billed", 1, 4, 1, 6]);
  agingSheet.addRow([null, 0.16, 0.66, 0.18, null]);
  agingSheet.addRow([]);
  agingSheet.addRow([null, "0-30", "31-60", "61-90", "Total"]);
  agingSheet.addRow(["Combined", 10, 7, 2, 19]);

  const rowSheet = workbook.addWorksheet("Rows");
  rowSheet.addRow(["Task", "Status", "Owner"]);
  rowSheet.addRow(["Atlas", "Planned", "Dana"]);
  rowSheet.addRow(["Nova", "In Progress", "Sam"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildNativeChartWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sourceSheet = workbook.addWorksheet("Source");
  sourceSheet.addRow(["Region", "Amount"]);
  sourceSheet.addRow(["West", 10]);
  sourceSheet.addRow(["East", 20]);
  sourceSheet.addRow(["Central", 15]);
  workbook.addWorksheet("Dashboard");
  return injectNativeChart(Buffer.from(await workbook.xlsx.writeBuffer()));
}

async function buildStackedComboChartWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sourceSheet = workbook.addWorksheet("Source");
  sourceSheet.addRow(["Month", "Palmetto", "Advantage", "Other", "Target"]);
  sourceSheet.addRow(["Sep", 70, 20, 10, 100]);
  sourceSheet.addRow(["Oct", 80, 30, 10, 120]);
  sourceSheet.addRow(["Nov", 90, 25, 15, 130]);
  workbook.addWorksheet("Dashboard");
  return injectStackedComboChart(Buffer.from(await workbook.xlsx.writeBuffer()));
}

async function buildPictureChartWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const notesSheet = workbook.addWorksheet("Notes");
  notesSheet.addRow(["Label", "Value"]);
  notesSheet.addRow(["Imported screenshot", "Chart"]);
  workbook.addWorksheet("Dashboard");
  return injectPictureChart(Buffer.from(await workbook.xlsx.writeBuffer()));
}

async function main() {
  const document = buildStudioDocument();
  const imported = await importWorkbookIntoStudioDocument(document, "Executive Workbook.xlsx", await buildWorkbookBuffer());

  assert.equal(imported.importedTableIds.length, 7, "expected seven imported tables including the hidden Data sheet");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Summary"), "expected imported Summary sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Projects"), "expected imported Projects sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Pipeline"), "expected imported Pipeline sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Trend"), "expected imported Trend sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Schedule"), "expected imported Schedule sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Detail Support"), "expected imported hidden support sheet table");
  assert.ok(imported.document.bundle.tables.some((table) => table.name === "Data"), "expected imported hidden Data sheet table");

  const importedReports = imported.importedObjectIds
    .map((id) => imported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  assert.ok(importedReports.length >= 6, "expected one imported report per sheet");

  const primaryObject = imported.document.bundle.objects[imported.primaryObjectId];
  assert.equal(primaryObject?.type, "dashboard", "expected multi-sheet import to create a dashboard candidate");
  assert.equal(primaryObject.tabs.length, 6, "expected imported dashboard to create an overview tab plus one tab per sheet");
  assert.equal(primaryObject.tabs[0]?.name, "Overview", "expected imported dashboard to start with an overview tab");
  assert.equal(primaryObject.tabs[0]?.widgets.length, 5, "expected overview tab to include non-chart summary cards plus spotlight widgets");
  assert.equal(primaryObject.tabs[0]?.widgets[0]?.layout.x, 1, "expected imported overview widgets to preserve reconstructed X coordinates");
  assert.equal(primaryObject.tabs[0]?.widgets[1]?.layout.x, 5, "expected imported overview widgets to pack across the grid");
  assert.equal(primaryObject.tabs[0]?.widgets[3]?.layout.y, 4, "expected overview spotlight widgets to sit beneath the summary section");
  assert.ok(
    primaryObject.tabs[0]?.widgets.slice(3).some((widget) => widget.displayMode === "chart"),
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
  assert.equal(imported.review.importedSheetCount, 7, "expected review to count imported sheets");
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
  assert.equal(trendTab.widgets.length, 2, "expected Trend tab to include chart and attached support widgets without imported chart summary/details");
  assert.equal(trendTab.widgets[0].displayMode, "chart", "expected Trend tab primary data widget to open in chart mode");
  assert.equal(trendTab.widgets[1].displayMode, "table", "expected Trend tab to keep the attached support table");
  assert.deepEqual(
    trendTab.widgets.map((widget) => widget.layout.y),
    [1, 7],
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
  assert.equal(pipelineTab.widgets[0]?.displayMode, "chart", "expected wide-source chart tabs to keep the chart as the primary content block");
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
  assert.equal(trendTab.widgets.length, 2, "expected Trend tab to include an attached hidden support detail widget");
  assert.equal(trendTab.widgets[1]?.displayMode, "table", "expected attached hidden support widget to render as a detail table");
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

  const noDataImported = await importWorkbookIntoStudioDocument(buildStudioDocument(), "No Data Workbook.xlsx", await buildNoDataWorkbookBuffer());
  const noDataReports = noDataImported.importedObjectIds
    .map((id) => noDataImported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  assert.ok(noDataReports.every((report) => report.view.mode === "table"), "expected no-Data workbooks without native charts to avoid field/mode guessing");
  assert.ok(
    noDataImported.warnings.some((warning) => warning.includes("no Data sheet")),
    "expected no-Data workbook warnings to explain that field inference was skipped"
  );

  const summaryImported = await importWorkbookIntoStudioDocument(buildStudioDocument(), "Summary Blocks Workbook.xlsx", await buildSummaryBlocksWorkbookBuffer());
  const summaryReports = summaryImported.importedObjectIds
    .map((id) => summaryImported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  const cashSummaryOne = summaryReports.find((report) => report.name === "Cash Collected · Summary 1");
  const cashSummaryTwo = summaryReports.find((report) => report.name === "Cash Collected · Summary 2");
  const arUnbilledSummary = summaryReports.find((report) => report.name === "AR Aging · Unbilled");
  const arBilledSummary = summaryReports.find((report) => report.name === "AR Aging · Billed");
  const arCombinedSummary = summaryReports.find((report) => report.name === "AR Aging · Combined");
  const rowReport = summaryReports.find((report) => report.name === "Rows");
  [cashSummaryOne, cashSummaryTwo, arUnbilledSummary, arBilledSummary, arCombinedSummary].forEach((report) => {
    assert.equal(report?.view.mode, "summary", "expected compact workbook matrices to import as summary reports");
    assert.equal(report?.view.showDetails, false, "expected imported summary matrices not to render as detail tables");
    assert.equal(report?.selectedFieldIds.length, 0, "expected imported summary matrices not to preselect detail fields");
  });
  assert.deepEqual(
    cashSummaryOne?.summaryMetrics.map((metric) => metric.label),
    ["Sep", "Oct", "Nov", "Dec"],
    "expected cash summary matrices to keep month fields as summary values"
  );
  assert.deepEqual(
    arBilledSummary?.summaryMetrics.map((metric) => metric.label),
    ["0-30", "31-60", "61-90", "Total"],
    "expected AR Aging summary matrices to keep aging buckets as summary values"
  );
  assert.equal(
    summaryImported.document.bundle.data[arBilledSummary?.sourceTableId || ""]?.length,
    1,
    "expected unlabeled helper rows beneath a summary matrix not to be imported as summary detail rows"
  );
  assert.equal(rowReport?.view.mode, "table", "expected plain row-list sections to remain table reports");
  const summaryDashboard = summaryImported.document.bundle.objects[summaryImported.primaryObjectId];
  assert.equal(summaryDashboard?.type, "dashboard", "expected summary block workbook to create a dashboard");
  assert.ok(
    summaryDashboard.tabs.some((tab) => tab.name === "Cash Collected" && tab.widgets.filter((widget) => widget.displayMode === "summary" && !widget.showDetails).length >= 2),
    "expected workbook summary sections to display as summary widgets on their source tab"
  );

  const nativeImported = await importWorkbookIntoStudioDocument(buildStudioDocument(), "Native Chart Workbook.xlsx", await buildNativeChartWorkbookBuffer());
  const nativeReports = nativeImported.importedObjectIds
    .map((id) => nativeImported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  const nativeChartReport = nativeReports.find((report) => report.name === "Native Sales");
  assert.equal(nativeChartReport?.view.mode, "chart", "expected native Excel chart imports to create chart reports without a Data sheet");
  assert.equal(nativeChartReport?.view.chartType, "column", "expected native Excel column charts to preserve chart type");
  assert.equal(nativeChartReport?.view.chartFieldId, "category", "expected native chart categories to become the chart field");
  assert.equal(nativeChartReport?.view.chartValueFieldId, "value", "expected native chart values to become the value field");
  assert.equal(nativeChartReport?.view.chartColors[0], "#4472C4", "expected native chart colors to be preserved");
  assert.equal(nativeChartReport?.view.showSummary, false, "expected imported charts to leave summary fields unset");
  assert.equal(nativeChartReport?.view.showDetails, false, "expected imported charts to leave detail fields unset");
  assert.equal(nativeChartReport?.summaryMetrics.length, 0, "expected imported charts not to preselect summary metrics");
  assert.equal(nativeChartReport?.selectedFieldIds.length, 0, "expected imported charts not to preselect detail fields");
  assert.ok(nativeReports.every((report) => report.view.mode !== "kanban"), "expected native chart import not to fall back to kanban guessing");
  const nativeDashboard = nativeImported.document.bundle.objects[nativeImported.primaryObjectId];
  assert.equal(nativeDashboard?.type, "dashboard", "expected native chart workbook to create a dashboard");
  assert.ok(
    nativeDashboard.tabs.some((tab) => tab.name === "Dashboard" && tab.widgets.some((widget) => widget.reportId === nativeChartReport?.id && widget.displayMode === "chart")),
    "expected native chart report to be displayed on the workbook tab that contained the chart"
  );
  assert.ok(
    nativeDashboard.tabs.every((tab) => tab.widgets.every((widget) => widget.reportId !== nativeChartReport?.id || (!widget.showSummary && !widget.showDetails))),
    "expected imported chart widgets not to enable summary or details"
  );

  const stackedComboImported = await importWorkbookIntoStudioDocument(buildStudioDocument(), "Stacked Combo Workbook.xlsx", await buildStackedComboChartWorkbookBuffer());
  const stackedComboReports = stackedComboImported.importedObjectIds
    .map((id) => stackedComboImported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  const stackedComboChart = stackedComboReports.find((report) => report.name === "Stacked Cash");
  assert.equal(stackedComboChart?.view.mode, "chart", "expected stacked combo native chart to import as a chart");
  assert.equal(stackedComboChart?.view.chartType, "stacked-column", "expected stacked vertical Excel column combos to stay stacked-column instead of line-bar");
  assert.equal(stackedComboChart?.view.chartOrientation, "vertical", "expected stacked column chart orientation to stay vertical");
  assert.equal(stackedComboChart?.view.showSummary, false, "expected imported stacked charts to leave summary fields unset");
  assert.equal(stackedComboChart?.view.showDetails, false, "expected imported stacked charts to leave detail fields unset");

  const pictureImported = await importWorkbookIntoStudioDocument(buildStudioDocument(), "Picture Chart Workbook.xlsx", await buildPictureChartWorkbookBuffer());
  const pictureReports = pictureImported.importedObjectIds
    .map((id) => pictureImported.document.bundle.objects[id])
    .filter((object) => object?.type === "report");
  const pictureChartReport = pictureReports.find((report) => report.name === "Screenshot Sales Chart");
  assert.equal(pictureChartReport?.view.mode, "chart", "expected chart screenshots to import as chart reports");
  assert.equal(pictureChartReport?.view.chartType, "column", "expected chart screenshots to infer chart type from image geometry");
  assert.ok(pictureChartReport?.view.chartColors.length >= 3, "expected chart screenshots to recover dominant chart colors");
  assert.equal(pictureChartReport?.view.showSummary, false, "expected screenshot chart imports to leave summary fields unset");
  assert.equal(pictureChartReport?.view.showDetails, false, "expected screenshot chart imports to leave detail fields unset");
  assert.equal(pictureChartReport?.summaryMetrics.length, 0, "expected screenshot chart imports not to preselect summary metrics");
  assert.equal(pictureChartReport?.selectedFieldIds.length, 0, "expected screenshot chart imports not to preselect detail fields");
  assert.ok(
    pictureImported.warnings.some((warning) => warning.includes("picture/screenshot chart")),
    "expected screenshot chart imports to explain that a picture chart was detected"
  );

  console.log("api import smoke tests passed");
}

await main();
