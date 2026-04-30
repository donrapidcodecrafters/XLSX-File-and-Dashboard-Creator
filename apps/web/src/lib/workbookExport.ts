import {
  ChartDatum,
  ChartOrientation,
  ChartSeriesType,
  ChartSortMode,
  ChartType,
  DashboardRunResult,
  DataRow,
  getDashboardWidgetPlacements,
  getReportFieldLabel,
  ReportDefinition,
  ReportRunResult,
  SummaryDatum,
  TableDefinition
} from "@studio/shared";

const CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a", "#4f8fba"];

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
  chartSort?: ChartSortMode;
  decimalPlaces?: number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  secondaryYAxisLabel?: string;
  secondarySeriesType?: ChartSeriesType;
  showLegend?: boolean;
  showValues?: boolean;
  targetWidth?: number;
  targetHeight?: number;
}

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

function formatChartValue(value: number, decimalPlaces = 2) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  }).format(value);
}

function getChartPalette(chartColors?: string[]) {
  const colors = (chartColors || [])
    .map((color) => String(color || "").trim())
    .filter((color) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color));
  return colors.length ? colors : CHART_COLORS;
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

function withColorAlpha(color: string, alpha: string) {
  const normalized = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return `${normalized}${alpha}`;
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    return `#${normalized.slice(1).split("").map((part) => `${part}${part}`).join("")}${alpha}`;
  }
  return normalized;
}

function normalizeExportChartType(chartType: ChartType, orientation: ChartOrientation): ChartType {
  if (chartType === "horizontal-bar") return "bar";
  if (chartType === "horizontal-stacked-bar") return "stacked-bar";
  if (chartType === "3d-bar") return "bar";
  if (chartType === "3d-stacked-bar") return "stacked-bar";
  if (chartType === "3d-area") return "area";
  if (chartType === "3d-pie") return "pie";
  if (chartType === "3d-donut") return "donut";
  if (chartType === "3d-funnel") return "funnel";
  if (chartType === "3d-scatter") return "scatter";
  if (chartType === "spline") return "line";
  if (chartType === "area-spline" || chartType === "streamgraph") return "area";
  if (chartType === "solid-gauge") return "gauge";
  if (chartType === "histogram") return "column";
  if (chartType === "pareto") return "line-bar";
  if (chartType === "treemap") return "heatmap";
  if (chartType === "sunburst") return "donut";
  if (chartType === "box-plot") return "bullet";
  if (chartType === "candlestick") return "line";
  if (chartType === "sankey") return "funnel";
  if (chartType === "network-graph") return "scatter";
  if (chartType === "column" && orientation === "horizontal") return "bar";
  return chartType;
}

function formatCategoryTickLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
  }
  return trimmed;
}

function comparePreviewCategory(left: string, right: string) {
  const leftLabel = formatCategoryTickLabel(left);
  const rightLabel = formatCategoryTickLabel(right);
  const leftTime = Date.parse(left) || Date.parse(leftLabel);
  const rightTime = Date.parse(right) || Date.parse(rightLabel);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  const leftNumeric = Number(left);
  const rightNumeric = Number(right);
  if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) return leftNumeric - rightNumeric;
  return leftLabel.localeCompare(rightLabel, undefined, { numeric: true, sensitivity: "base" });
}

function isContinuousPreviewChartType(chartType: ChartType) {
  return [
    "line",
    "area",
    "line-bar",
    "spline",
    "area-spline",
    "streamgraph",
    "scatter",
    "bubble",
    "3d-scatter"
  ].includes(chartType);
}

function sortPreviewItems(data: ChartDatum[], chartType: ChartType, sort: ChartSortMode) {
  if (!data.length) return data;
  const grouped = new Map<string, ChartDatum[]>();
  data.forEach((datum) => {
    const key = String(datum.rawLabel ?? datum.label ?? "");
    grouped.set(key, [...(grouped.get(key) || []), datum]);
  });
  const entries = Array.from(grouped.entries());
  if (isContinuousPreviewChartType(chartType)) {
    const descending = sort === "label-desc";
    entries.sort((left, right) => comparePreviewCategory(left[0], right[0]) * (descending ? -1 : 1));
    return entries.flatMap(([, items]) => items);
  }
  if (sort === "label-asc") {
    entries.sort((left, right) => comparePreviewCategory(left[0], right[0]));
  } else if (sort === "label-desc") {
    entries.sort((left, right) => comparePreviewCategory(right[0], left[0]));
  } else {
    entries.sort((left, right) => {
      const leftValue = left[1]
        .filter((item) => (item.axis || "primary") === "primary")
        .reduce((sum, item) => sum + item.value, 0);
      const rightValue = right[1]
        .filter((item) => (item.axis || "primary") === "primary")
        .reduce((sum, item) => sum + item.value, 0);
      return sort === "value-asc" ? leftValue - rightValue : rightValue - leftValue;
    });
  }
  return entries.flatMap(([, items]) => items);
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
  return rawSeries.map((rawSeries) => {
    const match = filtered.find((datum) => String(datum.rawSeries || datum.series || "") === rawSeries);
    return {
      rawSeries,
      label: match?.series || rawSeries || (axis === "secondary" ? "Secondary" : "Values")
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

function buildAxisTicks(max: number, desired = 4) {
  const safeMax = Math.max(max, 1);
  const rawStep = safeMax / Math.max(desired, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep || 1));
  const normalized = rawStep / magnitude;
  const niceBase = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = niceBase * magnitude;
  const axisMax = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= axisMax + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks.length ? ticks : [0, axisMax];
}

function axisMaxFor(values: number[], desired = 4) {
  const ticks = buildAxisTicks(Math.max(...values, 1), desired);
  return {
    ticks,
    axisMax: ticks[ticks.length - 1] || 1
  };
}

function axisTickWidth(ticks: number[], decimalPlaces: number) {
  const longest = ticks.reduce((max, tick) => Math.max(max, formatChartValue(tick, decimalPlaces).length), 1);
  return Math.min(190, Math.max(84, longest * 13 + 28));
}

function truncateLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
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

function drawExportHeader(ctx: CanvasRenderingContext2D, title: string, subtitle: string, width: number) {
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, ctx.canvas.height);
  ctx.fillStyle = "#173126";
  ctx.font = "700 30px Manrope, Arial, sans-serif";
  ctx.fillText(title || "Chart", 32, 48);
  if (subtitle) {
    ctx.fillStyle = "#56685e";
    ctx.font = "600 16px Manrope, Arial, sans-serif";
    ctx.fillText(subtitle, 32, 76);
  }
}

function drawExportLegend(
  ctx: CanvasRenderingContext2D,
  items: Array<ChartDatum | { label: string; value?: number; rawLabel?: string; rawSeries?: string; series?: string }>,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    palette: string[];
    overrides?: Record<string, string>;
    showValues?: boolean;
    decimalPlaces: number;
  }
) {
  let x = options.x;
  let y = options.y;
  const lineHeight = 34;
  ctx.font = "700 15px Manrope, Arial, sans-serif";
  items.forEach((item, index) => {
    const valueText = options.showValues && typeof item.value === "number" ? ` · ${formatChartValue(item.value, options.decimalPlaces)}` : "";
    const label = `${truncateLabel(String(item.label || "Unassigned"), 24)}${valueText}`;
    const width = Math.min(options.maxWidth, Math.max(92, ctx.measureText(label).width + 42));
    if (x > options.x && x + width > options.x + options.maxWidth) {
      x = options.x;
      y += lineHeight;
    }
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    roundedRect(ctx, x, y - 20, width, 24, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(23,49,38,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = getChartColorOverride(options.palette, index, options.overrides, item as ChartDatum);
    ctx.beginPath();
    ctx.arc(x + 14, y - 8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#173126";
    ctx.fillText(label, x + 25, y - 3);
    x += width + 10;
  });
  return y + lineHeight;
}

function measureExportLegendHeight(
  ctx: CanvasRenderingContext2D,
  items: Array<ChartDatum | { label: string; value?: number; rawLabel?: string; rawSeries?: string; series?: string }>,
  maxWidth: number,
  showValues: boolean,
  decimalPlaces: number
) {
  if (!items.length || maxWidth <= 0) return 0;
  let x = 0;
  let rows = 1;
  ctx.font = "700 15px Manrope, Arial, sans-serif";
  items.forEach((item) => {
    const valueText = showValues && typeof item.value === "number" ? ` · ${formatChartValue(item.value, decimalPlaces)}` : "";
    const label = `${truncateLabel(String(item.label || "Unassigned"), 24)}${valueText}`;
    const width = Math.min(maxWidth, Math.max(92, ctx.measureText(label).width + 42));
    if (x > 0 && x + width > maxWidth) {
      rows += 1;
      x = 0;
    }
    x += width + 10;
  });
  return rows * 34;
}

function drawExportAxes(
  ctx: CanvasRenderingContext2D,
  bounds: { left: number; top: number; width: number; height: number },
  ticks: number[],
  axisMax: number,
  decimalPlaces: number,
  yAxisLabel = ""
) {
  ctx.strokeStyle = "rgba(23,49,38,0.16)";
  ctx.lineWidth = 1.5;
  ticks.forEach((tick) => {
    const y = bounds.top + bounds.height - (tick / axisMax) * bounds.height;
    ctx.beginPath();
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.left + bounds.width, y);
    ctx.stroke();
    ctx.fillStyle = "#56685e";
    ctx.font = "600 14px IBM Plex Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(formatChartValue(tick, decimalPlaces), bounds.left - 12, y + 4);
  });
  ctx.textAlign = "left";
  ctx.strokeStyle = "rgba(23,49,38,0.34)";
  ctx.beginPath();
  ctx.moveTo(bounds.left, bounds.top);
  ctx.lineTo(bounds.left, bounds.top + bounds.height);
  ctx.lineTo(bounds.left + bounds.width, bounds.top + bounds.height);
  ctx.stroke();
  if (yAxisLabel) {
    ctx.save();
    ctx.fillStyle = "#56685e";
    ctx.font = "700 15px Manrope, Arial, sans-serif";
    ctx.translate(18, bounds.top + bounds.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(yAxisLabel, 0, 0);
    ctx.restore();
  }
}

function drawPieExportChart(
  ctx: CanvasRenderingContext2D,
  items: ChartDatum[],
  options: {
    chartType: ChartType;
    palette: string[];
    overrides?: Record<string, string>;
    showLegend: boolean;
    showValues: boolean;
    decimalPlaces: number;
    top: number;
  }
) {
  const width = ctx.canvas.width;
  const total = Math.max(items.reduce((sum, item) => sum + item.value, 0), 1);
  const legendAreaHeight = options.showLegend
    ? Math.min(ctx.canvas.height * 0.34, 28 + measureExportLegendHeight(ctx, items, width - 64, options.showValues, options.decimalPlaces))
    : 0;
  const availableHeight = ctx.canvas.height - options.top - legendAreaHeight - 32;
  const radius = Math.max(90, Math.min(width * 0.22, availableHeight * 0.42));
  const cx = Math.max(180, Math.min(width * 0.5, 120 + radius));
  const cy = options.top + Math.max(radius + 16, availableHeight / 2);
  let start = -Math.PI / 2;
  items.forEach((item, index) => {
    const slice = (item.value / total) * Math.PI * 2;
    const end = start + slice;
    ctx.fillStyle = getChartColorOverride(options.palette, index, options.overrides, item);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fbfcf8";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (options.chartType === "donut") {
      ctx.fillStyle = "#fbfcf8";
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.52, 0, Math.PI * 2);
      ctx.fill();
    }
    if (options.showValues && slice > 0.08) {
      const mid = start + slice / 2;
      const labelX = cx + Math.cos(mid) * (radius + 28);
      const labelY = cy + Math.sin(mid) * (radius + 28);
      ctx.fillStyle = "#173126";
      ctx.font = "700 15px Manrope, Arial, sans-serif";
      ctx.textAlign = Math.cos(mid) >= 0 ? "left" : "right";
      ctx.fillText(formatChartValue(item.value, options.decimalPlaces), labelX, labelY);
      ctx.textAlign = "left";
    }
    start = end;
  });
  if (options.showLegend) {
    drawExportLegend(ctx, items, {
      x: 32,
      y: ctx.canvas.height - legendAreaHeight + 28,
      maxWidth: width - 64,
      palette: options.palette,
      overrides: options.overrides,
      showValues: options.showValues,
      decimalPlaces: options.decimalPlaces
    });
  }
}

function drawRadialBarExportChart(
  ctx: CanvasRenderingContext2D,
  items: ChartDatum[],
  options: {
    palette: string[];
    overrides?: Record<string, string>;
    showLegend: boolean;
    showValues: boolean;
    decimalPlaces: number;
    top: number;
  }
) {
  const max = Math.max(...items.map((item) => item.value), 1);
  const cx = Math.min(ctx.canvas.width / 2, 340);
  const cy = options.top + 230;
  items.slice(0, 5).forEach((item, index) => {
    const radius = 56 + index * 30;
    const percent = Math.max(0, Math.min(1, item.value / max));
    ctx.strokeStyle = "rgba(23,49,38,0.10)";
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = getChartColorOverride(options.palette, index, options.overrides, item);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * percent);
    ctx.stroke();
  });
  if (options.showLegend) {
    drawExportLegend(ctx, items, {
      x: 32,
      y: cy + 230,
      maxWidth: ctx.canvas.width - 64,
      palette: options.palette,
      overrides: options.overrides,
      showValues: options.showValues,
      decimalPlaces: options.decimalPlaces
    });
  }
}

function drawProgressExportChart(
  ctx: CanvasRenderingContext2D,
  items: ChartDatum[],
  options: {
    palette: string[];
    overrides?: Record<string, string>;
    showLegend: boolean;
    showValues: boolean;
    decimalPlaces: number;
    top: number;
  }
) {
  const rowHeight = 42;
  const trackLeft = options.showLegend ? 220 : 56;
  const trackWidth = ctx.canvas.width - trackLeft - 120;
  items.forEach((item, index) => {
    const y = options.top + 20 + index * rowHeight;
    const percent = Math.max(0, Math.min(100, item.value));
    if (options.showLegend) {
      ctx.fillStyle = "#173126";
      ctx.font = "700 13px Manrope, Arial, sans-serif";
      ctx.fillText(truncateLabel(item.label, 22), 36, y + 18);
    }
    ctx.fillStyle = "rgba(23,49,38,0.10)";
    roundedRect(ctx, trackLeft, y, trackWidth, 20, 10);
    ctx.fill();
    ctx.fillStyle = getChartColorOverride(options.palette, index, options.overrides, item);
    roundedRect(ctx, trackLeft, y, Math.max(8, (percent / 100) * trackWidth), 20, 10);
    ctx.fill();
    if (options.showValues) {
      ctx.fillStyle = "#173126";
      ctx.font = "700 13px Manrope, Arial, sans-serif";
      ctx.fillText(`${formatChartValue(percent, options.decimalPlaces)}%`, trackLeft + trackWidth + 14, y + 16);
    }
  });
}

function drawHeatmapExportChart(
  ctx: CanvasRenderingContext2D,
  items: ChartDatum[],
  options: { palette: string[]; overrides?: Record<string, string>; showValues: boolean; decimalPlaces: number; top: number }
) {
  const columns = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(items.length || 1))));
  const gap = 18;
  const left = 44;
  const availableWidth = ctx.canvas.width - left * 2;
  const size = Math.max(58, Math.min(128, (availableWidth - gap * (columns - 1)) / columns));
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = left + col * (size + gap);
    const y = options.top + 24 + row * (size + gap + 28);
    const alpha = Math.max(0.18, Math.min(1, item.value / maxValue));
    const color = getChartColorOverride(options.palette, index, options.overrides, item);
    ctx.fillStyle = withColorAlpha(color, Math.round(alpha * 255).toString(16).padStart(2, "0"));
    roundedRect(ctx, x, y, size, size, 18);
    ctx.fill();
    ctx.fillStyle = alpha > 0.58 ? "#ffffff" : "#173126";
    ctx.font = "800 16px Manrope, Arial, sans-serif";
    ctx.textAlign = "center";
    if (options.showValues) {
      ctx.fillText(formatChartValue(item.value, options.decimalPlaces), x + size / 2, y + size / 2 + 5);
    }
    ctx.fillStyle = "#173126";
    ctx.font = "700 12px Manrope, Arial, sans-serif";
    ctx.fillText(truncateLabel(item.label, 16), x + size / 2, y + size + 20);
    ctx.textAlign = "left";
  });
}

function drawGaugeExportChart(
  ctx: CanvasRenderingContext2D,
  items: ChartDatum[],
  options: { palette: string[]; overrides?: Record<string, string>; showValues: boolean; decimalPlaces: number; top: number }
) {
  const current = items[0]?.value || 0;
  const max = Math.max(...items.map((item) => item.value), 1);
  const percent = Math.max(0, Math.min(1, current / max));
  const cx = ctx.canvas.width / 2;
  const cy = options.top + 260;
  const radius = Math.min(220, ctx.canvas.width * 0.24);
  ctx.strokeStyle = "rgba(23,49,38,0.12)";
  ctx.lineWidth = 42;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = getChartColorOverride(options.palette, 0, options.overrides, items[0] || "Current");
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * percent);
  ctx.stroke();
  if (options.showValues) {
    ctx.fillStyle = "#173126";
    ctx.font = "800 42px Manrope, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(formatChartValue(current, options.decimalPlaces), cx, cy - 18);
    ctx.textAlign = "left";
  }
}

function drawCategoryExportChart(
  ctx: CanvasRenderingContext2D,
  items: ChartDatum[],
  options: {
    chartType: ChartType;
    originalChartType: ChartType;
    chartOrientation: ChartOrientation;
    palette: string[];
    overrides?: Record<string, string>;
    decimalPlaces: number;
    xAxisLabel: string;
    yAxisLabel: string;
    secondaryYAxisLabel: string;
    secondarySeriesType: ChartSeriesType;
    showLegend: boolean;
    showValues: boolean;
    top: number;
  }
) {
  const horizontal = options.originalChartType === "horizontal-bar"
    || options.originalChartType === "horizontal-stacked-bar"
    || (options.chartType === "bar" && options.chartOrientation === "horizontal");
  const stacked = options.chartType === "stacked-bar" || options.chartType === "stacked-column";
  const lineLike = options.chartType === "line" || options.chartType === "area" || options.chartType === "line-bar";
  const areaLike = options.chartType === "area";
  const primaryItems = collapseChartData(items, "primary");
  const categories = deriveCategories(items.length ? items : primaryItems);
  const primarySeries = deriveSeries(items, "primary");
  const secondarySeries = deriveSeries(items, "secondary");
  const categoryValues = categories.map((category) =>
    primarySeries.reduce((sum, series) => sum + valueForCategory(items, category.rawLabel, series.rawSeries, "primary"), 0)
  );
  const secondaryValues = categories.map((category) =>
    secondarySeries.reduce((sum, series) => sum + valueForCategory(items, category.rawLabel, series.rawSeries, "secondary"), 0)
  );
  const maxValue = Math.max(...categoryValues, ...secondaryValues, ...items.map((item) => item.value), 1);
  const { ticks, axisMax } = axisMaxFor([maxValue], categories.length > 16 ? 3 : 4);
  const left = axisTickWidth(ticks, options.decimalPlaces) + (options.yAxisLabel ? 28 : 8);
  const bottomLabelRoom = categories.length > 12 ? 112 : categories.length > 7 ? 92 : 68;
  const legendItems = [
    ...(horizontal ? primaryItems : primarySeries.map((series) => ({ label: series.label, rawLabel: series.rawSeries, rawSeries: series.rawSeries, series: series.label }))),
    ...secondarySeries.map((series) => ({ label: `${series.label} (secondary)`, rawLabel: series.rawSeries, rawSeries: series.rawSeries, series: `${series.label} (secondary)` }))
  ];
  const showCategoryLegend = options.showLegend && (primarySeries.length > 1 || secondarySeries.length || horizontal);
  const legendRoom = showCategoryLegend
    ? Math.min(ctx.canvas.height * 0.28, 24 + measureExportLegendHeight(ctx, legendItems, ctx.canvas.width - left - 36, false, options.decimalPlaces))
    : 0;
  const bounds = {
    left,
    top: options.top + legendRoom,
    width: ctx.canvas.width - left - 36,
    height: ctx.canvas.height - options.top - legendRoom - bottomLabelRoom - 38
  };
  if (bounds.height < 120) bounds.height = 120;
  if (showCategoryLegend) {
    drawExportLegend(ctx, legendItems, {
      x: left,
      y: options.top + 24,
      maxWidth: ctx.canvas.width - left - 36,
      palette: options.palette,
      overrides: options.overrides,
      showValues: false,
      decimalPlaces: options.decimalPlaces
    });
  }
  drawExportAxes(ctx, bounds, ticks, axisMax, options.decimalPlaces, options.yAxisLabel);

  if (horizontal) {
    const horizontalSingleSeries = primarySeries.length <= 1 && !primarySeries[0]?.rawSeries;
    const rowGap = 14;
    const rowHeight = Math.max(18, Math.min(42, (bounds.height - rowGap * Math.max(0, primaryItems.length - 1)) / Math.max(1, primaryItems.length)));
    const maxLabelWidth = Math.min(210, Math.max(90, primaryItems.reduce((max, item) => Math.max(max, item.label.length * 8), 80)));
    primaryItems.forEach((item, index) => {
      const y = bounds.top + index * (rowHeight + rowGap);
      const width = (item.value / axisMax) * Math.max(1, bounds.width - maxLabelWidth - 24);
      ctx.fillStyle = "#173126";
      ctx.font = "700 14px Manrope, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(truncateLabel(item.label, 24), bounds.left + maxLabelWidth - 12, y + rowHeight / 2 + 4);
      ctx.textAlign = "left";
      ctx.fillStyle = getChartColorOverride(options.palette, horizontalSingleSeries ? 0 : index, options.overrides, item);
      roundedRect(ctx, bounds.left + maxLabelWidth, y, Math.max(6, width), rowHeight, 10);
      ctx.fill();
      if (options.showValues) {
        ctx.fillStyle = "#173126";
        ctx.font = "700 14px Manrope, Arial, sans-serif";
        ctx.fillText(formatChartValue(item.value, options.decimalPlaces), bounds.left + maxLabelWidth + width + 8, y + rowHeight / 2 + 4);
      }
    });
    return;
  }

  const categoryStep = bounds.width / Math.max(categories.length, 1);
  const simpleSeries = primarySeries.length <= 1 && !primarySeries[0]?.rawSeries;
  const barGroupWidth = Math.max(18, Math.min(categoryStep * 0.74, 92));
  categories.forEach((category, categoryIndex) => {
    const centerX = bounds.left + categoryStep * categoryIndex + categoryStep / 2;
    const baseY = bounds.top + bounds.height;
    const drawValueLabel = (value: number, x: number, y: number) => {
      if (!options.showValues) return;
      ctx.fillStyle = "#173126";
      ctx.font = "800 13px Manrope, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(formatChartValue(value, options.decimalPlaces), x, Math.max(bounds.top + 12, y - 7));
      ctx.textAlign = "left";
    };
    if (!lineLike || options.chartType === "line-bar") {
      if (stacked) {
        let stackY = baseY;
        primarySeries.forEach((series, seriesIndex) => {
          const value = valueForCategory(items, category.rawLabel, series.rawSeries, "primary");
          const height = (value / axisMax) * bounds.height;
          const colorKey = simpleSeries
            ? (primaryItems.find((item) => String(item.rawLabel ?? item.label ?? "") === category.rawLabel) || category.label)
            : (series.rawSeries || series.label);
          ctx.fillStyle = getChartColorOverride(options.palette, seriesIndex, options.overrides, colorKey as ChartDatum | string);
          roundedRect(ctx, centerX - barGroupWidth / 2, stackY - height, barGroupWidth, Math.max(0, height), 9);
          ctx.fill();
          stackY -= height;
        });
        drawValueLabel(categoryValues[categoryIndex] || 0, centerX, stackY);
      } else {
        const seriesCount = simpleSeries ? 1 : Math.max(primarySeries.length, 1);
        const barWidth = Math.max(8, Math.min(48, (barGroupWidth - (seriesCount - 1) * 6) / seriesCount));
        primarySeries.forEach((series, seriesIndex) => {
          const value = simpleSeries
            ? (categoryValues[categoryIndex] || 0)
            : valueForCategory(items, category.rawLabel, series.rawSeries, "primary");
          const height = (value / axisMax) * bounds.height;
          const x = centerX - ((seriesCount * barWidth + (seriesCount - 1) * 6) / 2) + seriesIndex * (barWidth + 6);
          const datum = items.find((item) =>
            String(item.rawLabel ?? item.label ?? "") === category.rawLabel
            && String(item.rawSeries || item.series || "") === series.rawSeries
            && (item.axis || "primary") === "primary"
          ) || { label: category.label, rawLabel: category.rawLabel, value, axis: "primary" as const };
          ctx.fillStyle = getChartColorOverride(options.palette, seriesIndex, options.overrides, simpleSeries ? datum : (series.rawSeries || series.label));
          roundedRect(ctx, x, baseY - height, barWidth, Math.max(0, height), 10);
          ctx.fill();
          drawValueLabel(value, x + barWidth / 2, baseY - height);
        });
      }
    }
    const label = truncateLabel(formatCategoryTickLabel(category.label || category.rawLabel), 22);
    ctx.save();
    ctx.fillStyle = "#173126";
    ctx.font = "700 14px Manrope, Arial, sans-serif";
    ctx.textAlign = categories.length > 5 ? "right" : "center";
    const labelY = baseY + 24;
    if (categories.length > 5) {
      ctx.translate(centerX - 4, labelY);
      ctx.rotate(-0.55);
      ctx.fillText(label, 0, 0);
    } else {
      ctx.fillText(label, centerX, labelY);
    }
    ctx.restore();
  });

  const drawLineSeries = (series: { rawSeries: string; label: string }, seriesIndex: number, axis: "primary" | "secondary") => {
    const color = getChartColorOverride(
      options.palette,
      axis === "secondary" ? primarySeries.length + seriesIndex : seriesIndex,
      options.overrides,
      series.rawSeries || series.label
    );
    const points = categories.map((category, categoryIndex) => {
      const value = valueForCategory(items, category.rawLabel, series.rawSeries, axis);
      return {
        x: bounds.left + categoryStep * categoryIndex + categoryStep / 2,
        y: bounds.top + bounds.height - (value / axisMax) * bounds.height,
        value
      };
    });
    if (areaLike && axis === "primary") {
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.lineTo(points[points.length - 1]?.x || bounds.left + bounds.width, bounds.top + bounds.height);
      ctx.lineTo(points[0]?.x || bounds.left, bounds.top + bounds.height);
      ctx.closePath();
      ctx.fillStyle = withColorAlpha(color, "26");
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = axis === "secondary" ? 3 : 4;
    if (axis === "secondary") ctx.setLineDash([8, 6]);
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach((point) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, axis === "secondary" ? 4 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (options.showValues && lineLike) {
        ctx.fillStyle = "#173126";
        ctx.font = "800 11px Manrope, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(formatChartValue(point.value, options.decimalPlaces), point.x, Math.max(bounds.top + 12, point.y - 10));
        ctx.textAlign = "left";
      }
    });
  };

  if (lineLike) {
    primarySeries.forEach((series, index) => drawLineSeries(series, index, "primary"));
  }
  secondarySeries.forEach((series, index) => {
    if (options.secondarySeriesType === "bar" || options.secondarySeriesType === "column") return;
    drawLineSeries(series, index, "secondary");
  });

  if (options.xAxisLabel) {
    ctx.fillStyle = "#56685e";
    ctx.font = "700 15px Manrope, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(options.xAxisLabel, bounds.left + bounds.width / 2, ctx.canvas.height - 12);
    ctx.textAlign = "left";
  }
  if (options.secondaryYAxisLabel) {
    ctx.fillStyle = "#56685e";
    ctx.font = "700 15px Manrope, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(options.secondaryYAxisLabel, ctx.canvas.width - 16, bounds.top + 18);
    ctx.textAlign = "left";
  }
}

function renderChartImage(
  title: string,
  subtitle: string,
  chartType: ReportDefinition["view"]["chartType"],
  chartOrientation: ReportDefinition["view"]["chartOrientation"],
  data: ChartDatum[],
  _summary: SummaryDatum[],
  style: ExportChartStyleOptions = {}
) {
  const palette = getChartPalette(style.chartColors);
  const normalizedChartType = normalizeExportChartType(chartType, chartOrientation);
  const sortedData = sortPreviewItems(data, normalizedChartType, style.chartSort || "value-desc");
  const primaryItems = collapseChartData(sortedData, "primary");
  const categories = deriveCategories(sortedData.length ? sortedData : primaryItems);
  const longestLabel = categories.reduce((max, item) => Math.max(max, String(item.label || "").length), 0);
  const requestedWidth = style.targetWidth ? Math.round(style.targetWidth) : 0;
  const requestedHeight = style.targetHeight ? Math.round(style.targetHeight) : 0;
  const circular = ["pie", "donut", "radial-bar", "gauge", "kpi-card", "big-number-card"].includes(normalizedChartType);
  const canvasWidth = Math.min(
    7200,
    requestedWidth || Math.max(
      circular ? 1200 : 1300,
      circular ? 900 + Math.min(2600, primaryItems.length * 74) : 260 + Math.max(1, categories.length) * Math.min(180, Math.max(88, longestLabel * 11))
    )
  );
  const canvasHeight = Math.min(
    3200,
    requestedHeight || Math.max(
      circular ? 760 : 720,
      normalizedChartType === "radial-bar" ? 920 : 0,
      normalizedChartType === "progress-bar" || normalizedChartType === "bullet" ? 180 + primaryItems.length * 52 : 0
    )
  );
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawExportHeader(ctx, title, subtitle, canvasWidth);
  const decimalPlaces = style.decimalPlaces ?? 2;
  const showLegend = style.showLegend !== false;
  const showValues = style.showValues !== false;
  const top = subtitle ? 104 : 78;

  if (!sortedData.length) {
    ctx.fillStyle = "#56685e";
    ctx.font = "700 24px Manrope, Arial, sans-serif";
    ctx.fillText("No chart data is available for this view.", 36, top + 72);
    return canvas.toDataURL("image/png");
  }

  if (normalizedChartType === "pie" || normalizedChartType === "donut") {
    drawPieExportChart(ctx, primaryItems, {
      chartType: normalizedChartType,
      palette,
      overrides: style.chartValueColors,
      showLegend,
      showValues,
      decimalPlaces,
      top
    });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "radial-bar") {
    drawRadialBarExportChart(ctx, primaryItems, {
      palette,
      overrides: style.chartValueColors,
      showLegend,
      showValues,
      decimalPlaces,
      top
    });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "progress-bar" || normalizedChartType === "bullet") {
    drawProgressExportChart(ctx, primaryItems, {
      palette,
      overrides: style.chartValueColors,
      showLegend,
      showValues,
      decimalPlaces,
      top
    });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "heatmap") {
    drawHeatmapExportChart(ctx, primaryItems, {
      palette,
      overrides: style.chartValueColors,
      showValues,
      decimalPlaces,
      top
    });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "radar") {
    drawRadarChart(ctx, primaryItems, palette, style.chartValueColors);
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "waterfall") {
    drawWaterfallChart(ctx, primaryItems, palette, style.chartValueColors);
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "gauge" || normalizedChartType === "kpi-card" || normalizedChartType === "big-number-card") {
    drawGaugeExportChart(ctx, primaryItems, {
      palette,
      overrides: style.chartValueColors,
      showValues,
      decimalPlaces,
      top
    });
    return canvas.toDataURL("image/png");
  }

  drawCategoryExportChart(ctx, sortedData, {
    chartType: normalizedChartType,
    originalChartType: chartType,
    chartOrientation,
    palette,
    overrides: style.chartValueColors,
    decimalPlaces,
    xAxisLabel: style.xAxisLabel || "",
    yAxisLabel: style.yAxisLabel || "",
    secondaryYAxisLabel: style.secondaryYAxisLabel || "",
    secondarySeriesType: style.secondarySeriesType || "line",
    showLegend,
    showValues,
    top
  });
  return canvas.toDataURL("image/png");
}

function resolveExportFieldLabel(report: ReportDefinition | undefined, table: TableDefinition | undefined, fieldId: string) {
  if (report && table) return getReportFieldLabel(report, table, fieldId);
  return table?.fields.find((field) => field.id === fieldId)?.label || fieldId;
}

function getWorkbookChartFieldId(report: ReportDefinition) {
  return report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
}

function getWorkbookChartAxisLabels(report: ReportDefinition, table: TableDefinition | undefined) {
  const xFieldId = getWorkbookChartFieldId(report);
  const primaryFieldLabel = report.view.chartValueFieldId
    ? resolveExportFieldLabel(report, table, report.view.chartValueFieldId)
    : "";
  const secondaryFieldLabel = report.view.chartSecondaryValueFieldId
    ? resolveExportFieldLabel(report, table, report.view.chartSecondaryValueFieldId)
    : "";
  return {
    xAxisLabel: report.view.chartXAxisLabel?.trim()
      || (xFieldId ? resolveExportFieldLabel(report, table, xFieldId) : ""),
    yAxisLabel: report.view.chartYAxisLabel?.trim()
      || primaryFieldLabel
      || (report.view.chartAggregation === "count" ? "Rows" : ""),
    secondaryYAxisLabel: report.view.chartSecondaryYAxisLabel?.trim()
      || (report.view.chartUseSecondaryAxis
        ? (secondaryFieldLabel || (report.view.chartSecondaryAggregation === "count" ? "Rows" : ""))
        : "")
  };
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

  const reportAxisLabels = getWorkbookChartAxisLabels(report, table);
  const image = renderChartImage(report.name, table.name, report.view.chartType, report.view.chartOrientation, result.chartData, result.summary, {
    chartColors: report.view.chartColors,
    chartValueColors: report.view.chartValueColors,
    chartSort: report.view.chartSort,
    decimalPlaces: report.view.decimalPlaces,
    xAxisLabel: reportAxisLabels.xAxisLabel,
    yAxisLabel: reportAxisLabels.yAxisLabel,
    secondaryYAxisLabel: reportAxisLabels.secondaryYAxisLabel,
    secondarySeriesType: report.view.chartSecondarySeriesType,
    showLegend: report.view.chartShowLegend,
    showValues: report.view.chartShowValues,
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
        const axisLabels = getWorkbookChartAxisLabels(widget.report, table);
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
            chartSort: widget.report.view.chartSort,
            decimalPlaces: widget.report.view.decimalPlaces,
            xAxisLabel: axisLabels.xAxisLabel,
            yAxisLabel: axisLabels.yAxisLabel,
            secondaryYAxisLabel: axisLabels.secondaryYAxisLabel,
            secondarySeriesType: widget.report.view.chartSecondarySeriesType,
            showLegend: widget.report.view.chartShowLegend,
            showValues: widget.report.view.chartShowValues,
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
