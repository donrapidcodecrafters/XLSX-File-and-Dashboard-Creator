import type {
  ChartDatum,
  DashboardRunResult,
  DataRow,
  ReportDefinition,
  ReportRunResult,
  SummaryDatum,
  TableDefinition
} from "@studio/shared";

const CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a"];

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

function createCanvas(width = 1200, height = 720) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawFrame(ctx: CanvasRenderingContext2D, title: string, subtitle: string) {
  const { width, height } = ctx.canvas;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f7f4eb");
  gradient.addColorStop(1, "#eef2ea");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.94)";
  roundedRect(ctx, 26, 26, width - 52, height - 52, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(23,49,38,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#173126";
  ctx.font = "700 34px Manrope, sans-serif";
  ctx.fillText(title, 60, 84);
  ctx.fillStyle = "#5c6d63";
  ctx.font = "500 18px Manrope, sans-serif";
  ctx.fillText(subtitle, 60, 118);
}

function drawSummaryStrip(ctx: CanvasRenderingContext2D, summary: SummaryDatum[]) {
  summary.slice(0, 4).forEach((item, index) => {
    const x = 60 + index * 265;
    ctx.fillStyle = "rgba(247,248,243,0.98)";
    roundedRect(ctx, x, 150, 230, 92, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(23,49,38,0.08)";
    ctx.stroke();
    ctx.fillStyle = "#173126";
    ctx.font = "700 28px Manrope, sans-serif";
    ctx.fillText(item.value, x + 18, 192);
    ctx.fillStyle = "#5c6d63";
    ctx.font = "600 15px Manrope, sans-serif";
    ctx.fillText(item.label, x + 18, 220);
  });
}

function drawAxes(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number, maxValue: number) {
  ctx.strokeStyle = "rgba(23,49,38,0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + height);
  ctx.lineTo(left + width, top + height);
  ctx.stroke();

  ctx.fillStyle = "#5c6d63";
  ctx.font = "500 13px IBM Plex Mono, monospace";
  for (let step = 0; step <= 4; step += 1) {
    const value = Math.round((maxValue / 4) * (4 - step));
    const y = top + (height / 4) * step;
    ctx.fillText(String(value), left - 40, y + 4);
    ctx.strokeStyle = "rgba(23,49,38,0.08)";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
  }
}

function drawColumnChart(ctx: CanvasRenderingContext2D, data: ChartDatum[], options: { horizontal?: boolean; area?: boolean; line?: boolean }) {
  const left = 70;
  const top = 280;
  const width = 1040;
  const height = 360;
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  drawAxes(ctx, left, top, width, height, maxValue);
  const gap = 18;
  const count = Math.max(data.length, 1);

  if (options.horizontal) {
    const rowHeight = Math.max(24, (height - gap * (count - 1)) / count);
    data.forEach((item, index) => {
      const y = top + index * (rowHeight + gap);
      const barWidth = (item.value / maxValue) * (width - 140);
      ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
      roundedRect(ctx, left + 130, y, Math.max(18, barWidth), rowHeight, 12);
      ctx.fill();
      ctx.fillStyle = "#173126";
      ctx.font = "600 15px Manrope, sans-serif";
      ctx.fillText(item.label.slice(0, 16), left, y + rowHeight / 2 + 5);
      ctx.fillText(String(item.value), left + 140 + barWidth, y + rowHeight / 2 + 5);
    });
    return;
  }

  const barWidth = Math.max(32, (width - gap * (count - 1)) / count);
  const points: Array<{ x: number; y: number }> = [];
  data.forEach((item, index) => {
    const x = left + index * (barWidth + gap);
    const valueHeight = (item.value / maxValue) * (height - 24);
    const y = top + height - valueHeight;
    points.push({ x: x + barWidth / 2, y });
    if (!options.line && !options.area) {
      ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
      roundedRect(ctx, x, y, barWidth, valueHeight, 12);
      ctx.fill();
    }
    ctx.fillStyle = "#173126";
    ctx.font = "600 13px Manrope, sans-serif";
    ctx.save();
    ctx.translate(x + 8, top + height + 18);
    ctx.rotate(-0.35);
    ctx.fillText(item.label.slice(0, 18), 0, 0);
    ctx.restore();
  });

  if (options.line || options.area) {
    ctx.strokeStyle = CHART_COLORS[0];
    ctx.lineWidth = 4;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    if (options.area) {
      ctx.lineTo(points[points.length - 1]?.x || left + width, top + height);
      ctx.lineTo(points[0]?.x || left, top + height);
      ctx.closePath();
      ctx.fillStyle = "rgba(13,124,102,0.18)";
      ctx.fill();
    }

    points.forEach((point, index) => {
      ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawPieChart(ctx: CanvasRenderingContext2D, data: ChartDatum[], innerRadius = 0) {
  const total = Math.max(data.reduce((sum, item) => sum + item.value, 0), 1);
  const cx = 400;
  const cy = 420;
  const radius = 170;
  let start = -Math.PI / 2;

  data.forEach((item, index) => {
    const slice = (item.value / total) * Math.PI * 2;
    const end = start + slice;
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fill();
    start = end;
  });

  if (innerRadius) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  data.slice(0, 6).forEach((item, index) => {
    const x = 690;
    const y = 290 + index * 48;
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    roundedRect(ctx, x, y, 20, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.font = "600 16px Manrope, sans-serif";
    ctx.fillText(`${item.label} (${item.value})`, x + 30, y + 15);
  });
}

function drawRadarChart(ctx: CanvasRenderingContext2D, data: ChartDatum[]) {
  const cx = 390;
  const cy = 430;
  const radius = 170;
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  ctx.strokeStyle = "rgba(23,49,38,0.12)";
  ctx.lineWidth = 2;
  [0.25, 0.5, 0.75, 1].forEach((ratio) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
    ctx.stroke();
  });
  const points = data.map((item, index) => {
    const angle = (-Math.PI / 2) + (index / data.length) * Math.PI * 2;
    const scaled = (item.value / maxValue) * radius;
    return {
      item,
      x: cx + Math.cos(angle) * scaled,
      y: cy + Math.sin(angle) * scaled,
      lx: cx + Math.cos(angle) * (radius + 24),
      ly: cy + Math.sin(angle) * (radius + 24)
    };
  });
  ctx.fillStyle = "rgba(13,124,102,0.16)";
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = CHART_COLORS[0];
  ctx.lineWidth = 4;
  ctx.stroke();
  points.forEach((point, index) => {
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.font = "600 14px Manrope, sans-serif";
    ctx.fillText(point.item.label.slice(0, 12), point.lx - 22, point.ly);
  });
}

function drawGaugeChart(ctx: CanvasRenderingContext2D, data: ChartDatum[]) {
  const current = data[0]?.value || 0;
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  const percent = Math.max(0, Math.min(1, current / maxValue));
  const cx = 390;
  const cy = 500;
  const radius = 180;
  ctx.strokeStyle = "rgba(23,49,38,0.12)";
  ctx.lineWidth = 40;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = CHART_COLORS[0];
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * percent);
  ctx.stroke();
  ctx.fillStyle = "#173126";
  ctx.font = "700 42px Manrope, sans-serif";
  ctx.fillText(String(current), cx - 20, cy - 10);
  ctx.fillStyle = "#5c6d63";
  ctx.font = "600 18px Manrope, sans-serif";
  ctx.fillText((data[0]?.label || "Current").slice(0, 18), cx - 50, cy + 28);
}

function drawWaterfallChart(ctx: CanvasRenderingContext2D, data: ChartDatum[]) {
  const left = 70;
  const top = 280;
  const width = 1040;
  const height = 360;
  let running = 0;
  const points = data.map((item) => {
    const start = running;
    running += item.value;
    return { ...item, start, end: running };
  });
  const maxTotal = Math.max(...points.map((item) => item.end), 1);
  drawAxes(ctx, left, top, width, height, maxTotal);
  const gap = 20;
  const barWidth = Math.max(32, (width - gap * (points.length - 1)) / Math.max(points.length, 1));
  points.forEach((item, index) => {
    const x = left + index * (barWidth + gap);
    const y = top + height - (item.end / maxTotal) * (height - 24);
    const startY = top + height - (item.start / maxTotal) * (height - 24);
    const valueHeight = Math.max(18, startY - y);
    ctx.fillStyle = CHART_COLORS[index % CHART_COLORS.length];
    roundedRect(ctx, x, y, barWidth, valueHeight, 12);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.font = "600 13px Manrope, sans-serif";
    ctx.fillText(item.label.slice(0, 14), x, top + height + 18);
  });
}

function renderChartImage(title: string, subtitle: string, chartType: ReportDefinition["view"]["chartType"], data: ChartDatum[], summary: SummaryDatum[]) {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawFrame(ctx, title, subtitle);
  drawSummaryStrip(ctx, summary);
  const limited = data.slice(0, 10);
  if (!limited.length) {
    ctx.fillStyle = "#5c6d63";
    ctx.font = "600 24px Manrope, sans-serif";
    ctx.fillText("No chart data is available for this view.", 60, 330);
    return canvas.toDataURL("image/png");
  }

  if (chartType === "pie") {
    drawPieChart(ctx, limited);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "donut") {
    drawPieChart(ctx, limited, 78);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "bar" || chartType === "stacked-bar" || chartType === "funnel") {
    drawColumnChart(ctx, limited, { horizontal: true });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "line") {
    drawColumnChart(ctx, limited, { line: true });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "radar") {
    drawRadarChart(ctx, limited);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "gauge") {
    drawGaugeChart(ctx, limited);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "waterfall") {
    drawWaterfallChart(ctx, limited);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "area") {
    drawColumnChart(ctx, limited, { area: true });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "heatmap") {
    const left = 70;
    const top = 300;
    const size = 92;
    limited.forEach((item, index) => {
      const x = left + (index % 5) * (size + 18);
      const y = top + Math.floor(index / 5) * (size + 18);
      const alpha = Math.max(0.15, item.value / Math.max(...limited.map((entry) => entry.value), 1));
      ctx.fillStyle = `rgba(13,124,102,${alpha})`;
      roundedRect(ctx, x, y, size, size, 18);
      ctx.fill();
      ctx.fillStyle = alpha > 0.5 ? "#ffffff" : "#173126";
      ctx.font = "700 18px Manrope, sans-serif";
      ctx.fillText(String(item.value), x + 24, y + 48);
      ctx.font = "600 13px Manrope, sans-serif";
      ctx.fillText(item.label.slice(0, 10), x + 14, y + 74);
    });
    return canvas.toDataURL("image/png");
  }

  drawColumnChart(ctx, limited, {});
  return canvas.toDataURL("image/png");
}

function rowsAsObjects(fieldIds: string[], rows: DataRow[], table?: TableDefinition) {
  return rows.map((row) =>
    Object.fromEntries(
      fieldIds.map((fieldId) => [table?.fields.find((field) => field.id === fieldId)?.label || fieldId, formatCell(row[fieldId])])
    )
  );
}

function addSummaryTable(worksheet: any, summary: SummaryDatum[]) {
  worksheet.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 18 }
  ];
  summary.forEach((item) => worksheet.addRow({ metric: item.label, value: item.value }));
}

async function writeWorkbookFile(workbook: any, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(filename, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export async function exportReportWorkbook(report: ReportDefinition, table: TableDefinition, result: ReportRunResult, fullRows?: DataRow[]) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet(safeSheetName(`${report.name} Summary`, usedNames));
  summarySheet.getCell("A1").value = report.name;
  summarySheet.getCell("A1").font = { size: 20, bold: true };
  summarySheet.getCell("A2").value = report.description || table.name;
  addSummaryTable(summarySheet, result.summary);

  const image = renderChartImage(report.name, table.name, report.view.chartType, result.chartData, result.summary);
  if (image) {
    const imageId = workbook.addImage({ base64: image, extension: "png" });
    summarySheet.addImage(imageId, { tl: { col: 3, row: 1 }, ext: { width: 760, height: 460 } });
  }

  const dataSheet = workbook.addWorksheet(safeSheetName(`${report.name} Data`, usedNames));
  const rows = rowsAsObjects(report.selectedFieldIds, fullRows || result.rows, table);
  const columns = Object.keys(rows[0] || Object.fromEntries(report.selectedFieldIds.map((fieldId) => [table.fields.find((field) => field.id === fieldId)?.label || fieldId, ""])));
  dataSheet.columns = columns.map((header) => ({ header, key: header, width: 22 }));
  rows.forEach((row) => dataSheet.addRow(row));

  await writeWorkbookFile(workbook, `${report.id}.xlsx`);
}

export async function exportDashboardWorkbook(
  dashboard: DashboardRunResult["dashboard"],
  result: DashboardRunResult,
  fullRowsByReportId?: Record<string, DataRow[]>
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const overviewSheet = workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames));
  overviewSheet.getCell("A1").value = dashboard.name;
  overviewSheet.getCell("A1").font = { size: 20, bold: true };
  overviewSheet.getCell("A2").value = dashboard.description || "Dashboard export";
  overviewSheet.getCell("A4").value = "Tabs";
  overviewSheet.getCell("A4").font = { bold: true };
  result.tabs.forEach((tab, index) => {
    overviewSheet.getCell(`A${5 + index}`).value = `${tab.name} (${tab.widgets.length} cards)`;
  });

  result.tabs.forEach((tab) => {
    const tabSheet = workbook.addWorksheet(safeSheetName(tab.name, usedNames));
    let rowCursor = 1;
    tab.widgets.forEach((widget) => {
      tabSheet.getCell(`A${rowCursor}`).value = widget.report.name;
      tabSheet.getCell(`A${rowCursor}`).font = { size: 16, bold: true };
      rowCursor += 1;
      const image = renderChartImage(widget.report.name, tab.name, widget.report.view.chartType, widget.result.chartData, widget.result.summary);
      if (image) {
        const imageId = workbook.addImage({ base64: image, extension: "png" });
        tabSheet.addImage(imageId, {
          tl: { col: 0, row: rowCursor },
          ext: { width: 720, height: 420 }
        });
        rowCursor += 22;
      }
      rowCursor += 1;
    });

    tab.widgets.forEach((widget) => {
      const tableSheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name}`, usedNames));
      const rows = rowsAsObjects(
        widget.report.selectedFieldIds,
        fullRowsByReportId?.[widget.report.id] || widget.result.rows
      );
      const columns = Object.keys(rows[0] || Object.fromEntries(widget.report.selectedFieldIds.map((fieldId) => [fieldId, ""])));
      tableSheet.columns = columns.map((header) => ({ header, key: header, width: 22 }));
      rows.forEach((row) => tableSheet.addRow(row));
    });
  });

  await writeWorkbookFile(workbook, `${dashboard.id}.xlsx`);
}
