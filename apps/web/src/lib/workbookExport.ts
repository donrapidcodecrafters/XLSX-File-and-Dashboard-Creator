import {
  ChartDatum,
  DashboardRunResult,
  DataRow,
  getDashboardWidgetPlacements,
  getReportFieldLabel,
  ReportDefinition,
  ReportRunResult,
  SummaryDatum,
  TableDefinition
} from "@studio/shared";

const CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a"];

interface WorkbookSaveTarget {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface WorkbookExportOptions {
  filename?: string;
  saveTarget?: WorkbookSaveTarget | null;
  tablesById?: Record<string, TableDefinition>;
  returnBlob?: boolean;
}

interface ExportChartStyleOptions {
  chartColors?: string[];
  chartValueColors?: Record<string, string>;
  targetWidth?: number;
  targetHeight?: number;
}

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

function formatChartValue(value: number) {
  if (!Number.isFinite(value)) return "0";
  const whole = Math.abs(value % 1) < 0.000001;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function getChartPalette(chartColors?: string[]) {
  return chartColors?.length ? chartColors : CHART_COLORS;
}

function getChartColorOverride(
  palette: string[],
  index: number,
  overrides: Record<string, string> | undefined,
  datumOrKey: ChartDatum | string
) {
  const key = typeof datumOrKey === "string"
    ? String(datumOrKey || "").trim()
    : String(datumOrKey.rawSeries || datumOrKey.series || (datumOrKey.rawLabel ?? datumOrKey.label ?? "")).trim();
  const override = key ? String(overrides?.[key] || "").trim() : "";
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(override) ? override : palette[index % palette.length];
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveBlob(target: WorkbookSaveTarget, blob: Blob) {
  const writable = await target.createWritable();
  await writable.write(blob);
  await writable.close();
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

function drawColumnChart(
  ctx: CanvasRenderingContext2D,
  data: ChartDatum[],
  options: { horizontal?: boolean; area?: boolean; line?: boolean; palette: string[]; overrides?: Record<string, string> }
) {
  const longestLabel = data.reduce((max, item) => Math.max(max, String(item.label || "").length), 0);
  const left = options.horizontal ? 200 : 90;
  const top = 280;
  const width = ctx.canvas.width - left - 90;
  const bottomPad = options.horizontal ? 40 : Math.min(220, Math.max(128, 92 + longestLabel * 4));
  const height = ctx.canvas.height - top - bottomPad;
  const maxValue = Math.max(...data.map((item) => item.value), 1);
  drawAxes(ctx, left, top, width, height, maxValue);
  const gap = 18;
  const count = Math.max(data.length, 1);

  if (options.horizontal) {
    const rowHeight = Math.max(24, (height - gap * (count - 1)) / count);
    data.forEach((item, index) => {
      const y = top + index * (rowHeight + gap);
      const barWidth = (item.value / maxValue) * (width - 140);
      ctx.fillStyle = getChartColorOverride(options.palette, index, options.overrides, item);
      roundedRect(ctx, left + 130, y, Math.max(18, barWidth), rowHeight, 12);
      ctx.fill();
      ctx.fillStyle = "#173126";
      ctx.font = "600 15px Manrope, sans-serif";
      ctx.fillText(item.label.slice(0, 24), 30, y + rowHeight / 2 + 5);
      ctx.fillText(formatChartValue(item.value), left + 140 + barWidth, y + rowHeight / 2 + 5);
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
      ctx.fillStyle = getChartColorOverride(options.palette, index, options.overrides, item);
      roundedRect(ctx, x, y, barWidth, valueHeight, 12);
      ctx.fill();
    }
    ctx.fillStyle = "#173126";
    ctx.font = "600 16px Manrope, sans-serif";
    ctx.save();
    ctx.translate(x + 10, top + height + 28);
    ctx.rotate(-0.35);
    ctx.fillText(item.label.slice(0, 28), 0, 0);
    ctx.restore();
    if (!options.line && !options.area) {
      ctx.fillStyle = "#173126";
      ctx.font = "700 15px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(formatChartValue(item.value), x + barWidth / 2, Math.max(26, y - 10));
      ctx.textAlign = "left";
    }
  });

  if (options.line || options.area) {
    ctx.strokeStyle = getChartColorOverride(options.palette, 0, options.overrides, data[0] || "Values");
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
      ctx.fillStyle = getChartColorOverride(options.palette, index, options.overrides, data[index] || "Values");
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#173126";
      ctx.font = "700 13px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(formatChartValue(data[index]?.value || 0), point.x, point.y - 12);
      ctx.textAlign = "left";
    });
  }
}

function drawPieChart(
  ctx: CanvasRenderingContext2D,
  data: ChartDatum[],
  palette: string[],
  overrides?: Record<string, string>,
  innerRadius = 0
) {
  const total = Math.max(data.reduce((sum, item) => sum + item.value, 0), 1);
  const cx = Math.min(520, Math.round(ctx.canvas.width * 0.35));
  const cy = 420;
  const radius = Math.min(220, Math.round(ctx.canvas.height * 0.24));
  let start = -Math.PI / 2;

  data.forEach((item, index) => {
    const slice = (item.value / total) * Math.PI * 2;
    const end = start + slice;
    ctx.fillStyle = getChartColorOverride(palette, index, overrides, item);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fill();

    const mid = start + slice / 2;
    const leaderStartX = cx + Math.cos(mid) * (radius + 4);
    const leaderStartY = cy + Math.sin(mid) * (radius + 4);
    const leaderMidX = cx + Math.cos(mid) * (radius + 28);
    const leaderMidY = cy + Math.sin(mid) * (radius + 28);
    const leaderEndX = leaderMidX + (Math.cos(mid) >= 0 ? 36 : -36);
    const leaderEndY = leaderMidY;
    ctx.strokeStyle = "rgba(23,49,38,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leaderStartX, leaderStartY);
    ctx.lineTo(leaderMidX, leaderMidY);
    ctx.lineTo(leaderEndX, leaderEndY);
    ctx.stroke();
    ctx.fillStyle = "#173126";
    ctx.font = "700 15px Manrope, sans-serif";
    ctx.textAlign = Math.cos(mid) >= 0 ? "left" : "right";
    ctx.fillText(formatChartValue(item.value), leaderEndX + (Math.cos(mid) >= 0 ? 8 : -8), leaderEndY + 5);
    ctx.textAlign = "left";
    start = end;
  });

  if (innerRadius) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  data.slice(0, 6).forEach((item, index) => {
    const x = Math.round(ctx.canvas.width * 0.56);
    const y = 290 + index * 48;
    ctx.fillStyle = getChartColorOverride(palette, index, overrides, item);
    roundedRect(ctx, x, y, 20, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.font = "600 16px Manrope, sans-serif";
    ctx.fillText(`${item.label} (${formatChartValue(item.value)})`, x + 30, y + 15);
  });
}

function drawRadarChart(ctx: CanvasRenderingContext2D, data: ChartDatum[], palette: string[], overrides?: Record<string, string>) {
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
  ctx.strokeStyle = getChartColorOverride(palette, 0, overrides, data[0] || "Values");
  ctx.lineWidth = 4;
  ctx.stroke();
  points.forEach((point, index) => {
    ctx.fillStyle = getChartColorOverride(palette, index, overrides, point.item);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.font = "600 14px Manrope, sans-serif";
    ctx.fillText(point.item.label.slice(0, 12), point.lx - 22, point.ly);
    ctx.font = "700 13px Manrope, sans-serif";
    ctx.fillText(formatChartValue(point.item.value), point.x + 8, point.y - 8);
  });
}

function drawGaugeChart(ctx: CanvasRenderingContext2D, data: ChartDatum[], palette: string[], overrides?: Record<string, string>) {
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
  ctx.strokeStyle = getChartColorOverride(palette, 0, overrides, data[0] || "Current");
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * percent);
  ctx.stroke();
  ctx.fillStyle = "#173126";
  ctx.font = "700 42px Manrope, sans-serif";
  ctx.fillText(formatChartValue(current), cx - 34, cy - 10);
  ctx.fillStyle = "#5c6d63";
  ctx.font = "600 18px Manrope, sans-serif";
  ctx.fillText((data[0]?.label || "Current").slice(0, 18), cx - 50, cy + 28);
}

function drawWaterfallChart(ctx: CanvasRenderingContext2D, data: ChartDatum[], palette: string[], overrides?: Record<string, string>) {
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
    ctx.fillStyle = getChartColorOverride(palette, index, overrides, item);
    roundedRect(ctx, x, y, barWidth, valueHeight, 12);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.font = "600 13px Manrope, sans-serif";
    ctx.fillText(item.label.slice(0, 14), x, top + height + 18);
    ctx.font = "700 13px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(formatChartValue(item.value), x + barWidth / 2, Math.max(24, y - 8));
    ctx.textAlign = "left";
  });
}

function renderChartImage(
  title: string,
  subtitle: string,
  chartType: ReportDefinition["view"]["chartType"],
  chartOrientation: ReportDefinition["view"]["chartOrientation"],
  data: ChartDatum[],
  summary: SummaryDatum[],
  style: ExportChartStyleOptions = {}
) {
  const palette = getChartPalette(style.chartColors);
  const longestLabel = data.reduce((max, item) => Math.max(max, String(item.label || "").length), 0);
  const requestedWidth = style.targetWidth ? Math.round(style.targetWidth * 1.35) : 0;
  const requestedHeight = style.targetHeight ? Math.round(style.targetHeight * 1.35) : 0;
  const canvasWidth = Math.min(3200, Math.max(requestedWidth || 0, 1400, 560 + data.length * 130 + longestLabel * 14));
  const canvasHeight = chartType === "pie" || chartType === "donut"
    ? Math.min(1600, Math.max(requestedHeight || 0, 940))
    : Math.min(1600, Math.max(requestedHeight || 0, 900, 720 + Math.min(220, longestLabel * 6)));
  const canvas = createCanvas(canvasWidth, canvasHeight);
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
    drawPieChart(ctx, limited, palette, style.chartValueColors);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "donut") {
    drawPieChart(ctx, limited, palette, style.chartValueColors, 78);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "horizontal-bar" || chartType === "horizontal-stacked-bar") {
    drawColumnChart(ctx, limited, { horizontal: true, palette, overrides: style.chartValueColors });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "bar" || chartType === "stacked-bar") {
    drawColumnChart(ctx, limited, { horizontal: chartOrientation === "horizontal", palette, overrides: style.chartValueColors });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "column" || chartType === "stacked-column" || chartType === "variwide-bar" || chartType === "3d-bar" || chartType === "3d-stacked-bar") {
    drawColumnChart(ctx, limited, { horizontal: false, palette, overrides: style.chartValueColors });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "funnel") {
    drawColumnChart(ctx, limited, { horizontal: true, palette, overrides: style.chartValueColors });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "line") {
    drawColumnChart(ctx, limited, { line: true, palette, overrides: style.chartValueColors });
    return canvas.toDataURL("image/png");
  }
  if (chartType === "radar") {
    drawRadarChart(ctx, limited, palette, style.chartValueColors);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "gauge") {
    drawGaugeChart(ctx, limited, palette, style.chartValueColors);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "waterfall") {
    drawWaterfallChart(ctx, limited, palette, style.chartValueColors);
    return canvas.toDataURL("image/png");
  }
  if (chartType === "area") {
    drawColumnChart(ctx, limited, { area: true, palette, overrides: style.chartValueColors });
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
      const rawColor = getChartColorOverride(palette, index, style.chartValueColors, item);
      const hex = rawColor.replace("#", "");
      const expanded = hex.length === 3 ? hex.split("").map((part) => `${part}${part}`).join("") : hex;
      const red = Number.parseInt(expanded.slice(0, 2), 16);
      const green = Number.parseInt(expanded.slice(2, 4), 16);
      const blue = Number.parseInt(expanded.slice(4, 6), 16);
      ctx.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
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

  drawColumnChart(ctx, limited, { palette, overrides: style.chartValueColors });
  return canvas.toDataURL("image/png");
}

function resolveExportFieldLabel(report: ReportDefinition | undefined, table: TableDefinition | undefined, fieldId: string) {
  if (report && table) return getReportFieldLabel(report, table, fieldId);
  return table?.fields.find((field) => field.id === fieldId)?.label || fieldId;
}

function rowsAsObjects(fieldIds: string[], rows: DataRow[], table?: TableDefinition, report?: ReportDefinition) {
  return rows.map((row) =>
    Object.fromEntries(
      fieldIds.map((fieldId) => [resolveExportFieldLabel(report, table, fieldId), formatCell(row[fieldId])])
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

async function writeWorkbookFileWithOptions(
  workbook: any,
  filename: string,
  saveTarget?: WorkbookSaveTarget | null,
  returnBlob = false
) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (returnBlob) {
    return blob;
  }
  if (saveTarget) {
    await saveBlob(saveTarget, blob);
    return blob;
  }
  downloadBlob(filename, blob);
  return blob;
}

function widgetBaseMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  return report.view.mode;
}

function resolveWidgetDisplayMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const mode = widgetBaseMode(widget, report);
  if (mode === "summary" || mode === "chart" || mode === "table") return mode;
  return "table";
}

function widgetShowsChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  const displayMode = resolveWidgetDisplayMode(widget, report);
  return displayMode === "chart" || (displayMode === "table" && report.view.showChartInTable);
}

function widgetShowsDetails(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition) {
  return widget.showDetails || ["table", "timeline", "calendar", "kanban"].includes(widgetBaseMode(widget, report));
}

function widgetNeedsSeparateDetailSheet(
  widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"],
  report: ReportDefinition,
  isMultiWidgetTab = false
) {
  return widgetShowsDetails(widget, report) && (resolveWidgetDisplayMode(widget, report) !== "table" || isMultiWidgetTab);
}

function widgetShowsSummary(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: ReportDefinition, exportResult: ReportRunResult) {
  return Boolean(exportResult.summary.length && (widget.showSummary || widgetBaseMode(widget, report) === "summary"));
}

function resolveWidgetExportResult(
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
    totalRows: exported.totalRows || widget.result.totalRows
  };
}

function stripDataUrlPrefix(image: string) {
  const match = image.match(/^data:image\/png;base64,(.+)$/);
  return match?.[1] || image;
}

function addChartImage(workbook: any, sheet: any, image: string, row: number, width = 980, height = 560) {
  const imageId = workbook.addImage({ base64: stripDataUrlPrefix(image), extension: "png" });
  sheet.addImage(imageId, {
    tl: { col: 0, row: Math.max(0, row - 1) },
    ext: { width, height }
  });
}

function addPositionedChartImage(
  workbook: any,
  sheet: any,
  image: string,
  startCol: number,
  startRow: number,
  width: number,
  height: number
) {
  const imageId = workbook.addImage({ base64: stripDataUrlPrefix(image), extension: "png" });
  sheet.addImage(imageId, {
    tl: {
      col: Math.max(0, startCol - 1 + 0.08),
      row: Math.max(0, startRow - 1 + 0.08)
    },
    ext: { width, height }
  });
}

function sheetHyperlink(sheetName: string) {
  return `#'${sheetName.replace(/'/g, "''")}'!A1`;
}

function mergeRowRange(sheet: any, row: number, startCol: number, endCol: number) {
  if (endCol > startCol) {
    sheet.mergeCells(row, startCol, row, endCol);
  }
}

function writeOverviewHeader(sheet: any, title: string, description: string) {
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
  sheet.getCell("A2").value = description;
  sheet.getCell("A2").alignment = { wrapText: true };
}

function writeMetadataRows(sheet: any, startRow: number, items: Array<{ label: string; value: string | number }>) {
  let row = startRow;
  items.forEach((item) => {
    sheet.getCell(`A${row}`).value = item.label;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:D${row}`);
    sheet.getCell(`B${row}`).value = item.value;
    sheet.getCell(`B${row}`).alignment = { wrapText: true };
    row += 1;
  });
  return row;
}

function writeTextListSection(sheet: any, startRow: number, title: string, items: string[], emptyText = "None") {
  let row = startRow;
  sheet.getCell(`A${row}`).value = title;
  sheet.getCell(`A${row}`).font = { bold: true };
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

function writeWarningRows(sheet: any, warnings: string[], startRow: number) {
  let row = startRow;
  if (!warnings.length) return row;
  sheet.getCell(`A${row}`).value = "Warnings";
  sheet.getCell(`A${row}`).font = { bold: true };
  row += 1;
  warnings.forEach((warning) => {
    sheet.getCell(`A${row}`).value = warning;
    row += 1;
  });
  return row + 1;
}

function writeWidgetWarningBlock(
  sheet: any,
  warnings: string[],
  startRow: number,
  startCol: number,
  endCol: number
) {
  let row = startRow;
  if (!warnings.length) return row;
  mergeRowRange(sheet, row, startCol, endCol);
  sheet.getCell(row, startCol).value = "Warnings";
  sheet.getCell(row, startCol).font = { bold: true, color: { argb: "FF8A4B08" } };
  row += 1;
  warnings.forEach((warning) => {
    mergeRowRange(sheet, row, startCol, endCol);
    sheet.getCell(row, startCol).value = `• ${warning}`;
    sheet.getCell(row, startCol).alignment = { wrapText: true, vertical: "middle" };
    sheet.getCell(row, startCol).font = { color: { argb: "FF8A4B08" } };
    row += 1;
  });
  return row + 1;
}

function setDashboardLayoutColumns(sheet: any) {
  sheet.columns = Array.from({ length: 12 }, () => ({ width: 14 }));
}

function layoutDashboardWidgets(
  dashboard: DashboardRunResult["dashboard"],
  tabId: string,
  widgets: DashboardRunResult["tabs"][number]["widgets"],
  startRowOffset = 4
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
        startRow: ((placement.startRow - 1) * 7) + startRowOffset,
        endRow: (((placement.endRow - placement.startRow + 1) * 7) + ((placement.startRow - 1) * 7)) - 1 + startRowOffset
      };
    })
    .filter(Boolean) as Array<{
      widget: DashboardRunResult["tabs"][number]["widgets"][number];
      startCol: number;
      endCol: number;
      startRow: number;
      endRow: number;
    }>;
}

function writeWidgetTitle(sheet: any, row: number, startCol: number, endCol: number, title: string, subtitle: string) {
  mergeRowRange(sheet, row, startCol, endCol);
  sheet.getCell(row, startCol).value = title;
  sheet.getCell(row, startCol).font = { size: 14, bold: true };
  if (subtitle) {
    mergeRowRange(sheet, row + 1, startCol, endCol);
    sheet.getCell(row + 1, startCol).value = subtitle;
    sheet.getCell(row + 1, startCol).font = { italic: true, color: { argb: "FF56685E" } };
  }
}

function writeWidgetMessageBlock(sheet: any, row: number, startCol: number, endCol: number, message: string) {
  mergeRowRange(sheet, row, startCol, endCol);
  const cell = sheet.getCell(row, startCol);
  cell.value = message;
  cell.alignment = { wrapText: true, vertical: "middle" };
  cell.font = { italic: true, color: { argb: "FF8A4B08" } };
  return row + 2;
}

function writeWidgetSummaryBlock(
  sheet: any,
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

function writeWidgetTablePreview(
  sheet: any,
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  startRow: number,
  startCol: number,
  endCol: number,
  maxRows = 12
) {
  const availableColumns = Math.max(1, endCol - startCol + 1);
  const previewFieldIds = report.selectedFieldIds.slice(0, availableColumns);
  const headers = previewFieldIds.map((fieldId) => resolveExportFieldLabel(report, table, fieldId));
  const widths = headers.map((header) => Math.min(30, Math.max(14, String(header || "").length + 3)));
  headers.forEach((header, index) => {
    const cell = sheet.getCell(startRow, startCol + index);
    cell.value = header;
    cell.font = { bold: true };
  });
  result.rows.slice(0, maxRows).forEach((dataRow, rowIndex) => {
    previewFieldIds.forEach((fieldId, fieldIndex) => {
      const formatted = formatCell(dataRow[fieldId]);
      sheet.getCell(startRow + 1 + rowIndex, startCol + fieldIndex).value = formatted;
      widths[fieldIndex] = Math.min(34, Math.max(widths[fieldIndex], String(formatted ?? "").length + 2));
    });
  });
  widths.forEach((width, index) => {
    sheet.getColumn(startCol + index).width = Math.max(sheet.getColumn(startCol + index).width || 0, width);
  });
  let row = startRow + 1 + Math.min(result.rows.length, maxRows);
  if (result.rows.length > maxRows || report.selectedFieldIds.length > previewFieldIds.length) {
    row = writeWidgetMessageBlock(
      sheet,
      row,
      startCol,
      endCol,
      `${result.totalRows.toLocaleString()} rows exported${report.selectedFieldIds.length > previewFieldIds.length ? ` · showing ${previewFieldIds.length} of ${report.selectedFieldIds.length} fields here` : ""}.`
    );
  }
  return row;
}

function writeDetailRows(
  sheet: any,
  report: ReportDefinition,
  table: TableDefinition | undefined,
  result: ReportRunResult,
  startRow = 1
) {
  const headers = report.selectedFieldIds.map((fieldId) => resolveExportFieldLabel(report, table, fieldId));
  sheet.columns = headers.map((header) => ({ header, key: header, width: 22 }));
  const headerRow = sheet.getRow(startRow);
  headers.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  headerRow.font = { bold: true };
  result.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(startRow + rowIndex + 1);
    report.selectedFieldIds.forEach((fieldId, columnIndex) => {
      excelRow.getCell(columnIndex + 1).value = formatCell(row[fieldId]);
    });
  });
}

export async function exportReportWorkbook(
  report: ReportDefinition,
  table: TableDefinition,
  result: ReportRunResult,
  options: WorkbookExportOptions = {}
) {
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

  const image = renderChartImage(report.name, table.name, report.view.chartType, report.view.chartOrientation, result.chartData, result.summary, {
    chartColors: report.view.chartColors,
    chartValueColors: report.view.chartValueColors,
    targetWidth: 980,
    targetHeight: 560
  });
  if (image) {
    const imageId = workbook.addImage({ base64: image, extension: "png" });
    summarySheet.addImage(imageId, { tl: { col: 3, row: 1 }, ext: { width: 760, height: 460 } });
  }

  const dataSheet = workbook.addWorksheet(safeSheetName(`${report.name} Data`, usedNames));
  const rows = rowsAsObjects(report.selectedFieldIds, result.rows, table, report);
  const columns = Object.keys(rows[0] || Object.fromEntries(report.selectedFieldIds.map((fieldId) => [resolveExportFieldLabel(report, table, fieldId), ""])));
  dataSheet.columns = columns.map((header) => ({ header, key: header, width: 22 }));
  dataSheet.addRows(rows);

  return writeWorkbookFileWithOptions(
    workbook,
    options.filename || `${report.id}.xlsx`,
    options.saveTarget,
    options.returnBlob === true
  );
}

export async function exportDashboardWorkbook(
  dashboard: DashboardRunResult["dashboard"],
  result: DashboardRunResult,
  exportResultsByWidgetId?: Record<string, ReportRunResult>,
  options: WorkbookExportOptions = {}
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  workbook.creator = "Cadence Reporting Portal";
  workbook.created = new Date();

  const overviewSheet = workbook.addWorksheet(safeSheetName(`${dashboard.name} Overview`, usedNames));
  writeOverviewHeader(overviewSheet, dashboard.name, dashboard.description || "Dashboard export");
  let overviewRow = writeMetadataRows(overviewSheet, 4, [
    { label: "Generated", value: new Date(workbook.created).toLocaleString() },
    { label: "Tabs exported", value: result.tabs.length },
    { label: "Cards exported", value: result.tabs.reduce((sum, tab) => sum + tab.widgets.length, 0) }
  ]);
  overviewRow = writeTextListSection(
    overviewSheet,
    overviewRow + 1,
    "Tabs",
    result.tabs.map((tab) => `${tab.name} (${tab.widgets.length} cards)`)
  );
  overviewSheet.getCell(`A${overviewRow}`).value = "Tab";
  overviewSheet.getCell(`B${overviewRow}`).value = "Card";
  overviewSheet.getCell(`C${overviewRow}`).value = "Report";
  overviewSheet.getCell(`D${overviewRow}`).value = "Rows";
  overviewSheet.getCell(`E${overviewRow}`).value = "Sheet";
  overviewSheet.getCell(`F${overviewRow}`).value = "Exported content";
  overviewSheet.getRow(overviewRow).font = { bold: true };
  overviewRow += 1;

  const detailSheetNames: Record<string, string> = {};
  const tabSheetNamesById: Record<string, string> = {};

  result.tabs.forEach((tab) => {
    const sheet = workbook.addWorksheet(safeSheetName(tab.name, usedNames));
    tabSheetNamesById[tab.id] = sheet.name;
  });

  result.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      if (widget.status === "failed") return;
      const table = options.tablesById?.[widget.report.sourceTableId];
      const exportResult = resolveWidgetExportResult(widget, exportResultsByWidgetId);
      if (!table || !exportResult.rows.length) return;
      if (!widgetNeedsSeparateDetailSheet(widget.widget, widget.report, tab.widgets.length > 1)) return;
      const detailSheet = workbook.addWorksheet(safeSheetName(`${tab.name} ${widget.report.name} Data`, usedNames));
      detailSheetNames[widget.widgetId] = detailSheet.name;
      writeOverviewHeader(detailSheet, widget.report.name, widget.report.description || table.name);
      writeDetailRows(detailSheet, widget.report, table, exportResult, 4);
    });
  });

  result.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const exportResult = resolveWidgetExportResult(widget, exportResultsByWidgetId);
      const parts = widget.status === "failed"
        ? [`failed: ${widget.error || widget.message || "Widget load failed"}`]
        : [
            widgetShowsSummary(widget.widget, widget.report, exportResult) ? "summary" : "",
            widgetShowsChart(widget.widget, widget.report) ? "chart" : "",
            widgetShowsDetails(widget.widget, widget.report) ? "data rows" : "",
            detailSheetNames[widget.widgetId] ? "detail sheet" : ""
          ].filter(Boolean);
      overviewSheet.getCell(`A${overviewRow}`).value = tab.name;
      overviewSheet.getCell(`B${overviewRow}`).value = widget.widget.title || widget.report.name;
      overviewSheet.getCell(`C${overviewRow}`).value = widget.report.name;
      overviewSheet.getCell(`D${overviewRow}`).value = exportResult.totalRows;
      const destinationSheet = detailSheetNames[widget.widgetId] || tabSheetNamesById[tab.id] || "";
      if (destinationSheet) {
        overviewSheet.getCell(`E${overviewRow}`).value = {
          text: destinationSheet,
          hyperlink: sheetHyperlink(destinationSheet)
        };
        overviewSheet.getCell(`E${overviewRow}`).font = { color: { argb: "FF1F5AA6" }, underline: true };
      } else {
        overviewSheet.getCell(`E${overviewRow}`).value = "None";
      }
      overviewSheet.getCell(`F${overviewRow}`).value = parts.join(", ") || "metadata only";
      overviewRow += 1;
    });
  });

  result.tabs.forEach((tab) => {
    const tabSheet = workbook.getWorksheet(tabSheetNamesById[tab.id]);
    if (!tabSheet) return;
    setDashboardLayoutColumns(tabSheet);
    tabSheet.mergeCells(1, 1, 1, 12);
    tabSheet.mergeCells(2, 1, 2, 12);
    tabSheet.getCell(1, 1).value = tab.name;
    tabSheet.getCell(1, 1).font = { size: 18, bold: true };
    tabSheet.getCell(2, 1).value = `${tab.widgets.length} cards`;
    tabSheet.getCell(2, 1).font = { color: { argb: "FF56685E" } };

    const singleWidget = tab.widgets.length === 1 ? tab.widgets[0] : null;
    if (singleWidget) {
      const table = options.tablesById?.[singleWidget.report.sourceTableId];
      const exportResult = resolveWidgetExportResult(singleWidget, exportResultsByWidgetId);
      if (
        singleWidget.status === "complete"
        && table
        && resolveWidgetDisplayMode(singleWidget.widget, singleWidget.report) === "table"
        && !widgetShowsChart(singleWidget.widget, singleWidget.report)
        && !widgetShowsSummary(singleWidget.widget, singleWidget.report, exportResult)
      ) {
        writeDetailRows(tabSheet, singleWidget.report, table, exportResult, 4);
        return;
      }
    }

    layoutDashboardWidgets(dashboard, tab.id, tab.widgets).forEach((placement) => {
      const { widget, startCol, endCol, startRow, endRow } = placement;
      const exportResult = resolveWidgetExportResult(widget, exportResultsByWidgetId);
      const table = options.tablesById?.[widget.report.sourceTableId];
      writeWidgetTitle(
        tabSheet,
        startRow,
        startCol,
        endCol,
        widget.widget.title || widget.report.name,
        widget.report.name !== (widget.widget.title || widget.report.name)
          ? widget.report.name
          : table?.name || tab.name
      );
      if (widget.status === "failed") {
        writeWidgetMessageBlock(tabSheet, startRow + 3, startCol, endCol, widget.error || widget.message || "Widget failed to load.");
        return;
      }
      if (!table) {
        writeWidgetMessageBlock(tabSheet, startRow + 3, startCol, endCol, "Source table unavailable for this widget.");
        return;
      }
      let contentRow = startRow + 3;
      if (widgetShowsSummary(widget.widget, widget.report, exportResult)) {
        contentRow = writeWidgetSummaryBlock(tabSheet, exportResult, contentRow, startCol, endCol) + 1;
      }
      if (widgetShowsChart(widget.widget, widget.report)) {
        const imageWidth = Math.max(360, Math.min(1480, (endCol - startCol + 1) * 118));
        const imageHeight = Math.max(260, Math.min(760, Math.max(280, (endRow - contentRow + 1) * 20)));
        const image = renderChartImage(
          widget.widget.title || widget.report.name,
          widget.report.name !== (widget.widget.title || widget.report.name) ? widget.report.name : tab.name,
          widget.report.view.chartType,
          widget.report.view.chartOrientation,
          exportResult.chartData,
          exportResult.summary,
          {
            chartColors: widget.report.view.chartColors,
            chartValueColors: widget.report.view.chartValueColors,
            targetWidth: imageWidth,
            targetHeight: imageHeight
          }
        );
        if (image) {
          addPositionedChartImage(workbook, tabSheet, image, startCol, contentRow, imageWidth, imageHeight);
          contentRow += Math.max(10, Math.ceil(imageHeight / 24));
        } else {
          contentRow = writeWidgetMessageBlock(tabSheet, contentRow, startCol, endCol, "Chart image unavailable for this widget.");
        }
      }
      if (resolveWidgetDisplayMode(widget.widget, widget.report) === "table") {
        if (tab.widgets.length === 1) {
          writeDetailRows(tabSheet, widget.report, table, exportResult, contentRow);
        } else {
          contentRow = writeWidgetTablePreview(tabSheet, widget.report, table, exportResult, contentRow, startCol, endCol);
        }
      } else if (widgetShowsDetails(widget.widget, widget.report) && detailSheetNames[widget.widgetId]) {
        contentRow = writeWidgetMessageBlock(
          tabSheet,
          Math.min(contentRow, Math.max(startRow + 4, endRow - 2)),
          startCol,
          endCol,
          `Row details exported on "${detailSheetNames[widget.widgetId]}".`
        );
      }
      if (exportResult.warnings.length) {
        writeWidgetWarningBlock(
          tabSheet,
          exportResult.warnings,
          Math.min(contentRow, Math.max(startRow + 5, endRow - 1)),
          startCol,
          endCol
        );
      }
    });
  });

  return writeWorkbookFileWithOptions(
    workbook,
    options.filename || `${dashboard.id}.xlsx`,
    options.saveTarget,
    options.returnBlob === true
  );
}
