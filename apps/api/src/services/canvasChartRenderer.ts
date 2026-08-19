/**
 * Server-side canvas chart renderer for scheduled/test email exports.
 * Uses node-canvas (same Canvas API as the browser) so chart output is
 * pixel-identical to the manual download produced by workbookExport.ts.
 *
 * FONTS — place TTF files in apps/api/fonts/ before deploying:
 *   Manrope-Bold.ttf      (weight 700)
 *   Manrope-SemiBold.ttf  (weight 600)
 *   Manrope-Medium.ttf    (weight 500)
 *   IBMPlexMono-Regular.ttf (weight 400)
 *
 * Download from Google Fonts (both are open-source):
 *   https://fonts.google.com/specimen/Manrope
 *   https://fonts.google.com/specimen/IBM+Plex+Mono
 *
 * On the VPS, also run once:
 *   apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
 *   (then npm install in apps/api)
 */

import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type {
  ChartDatum,
  ChartOrientation,
  ChartSeriesType,
  ChartSortMode,
  ChartType,
  ReportDefinition,
  SummaryDatum
} from "@studio/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodeCreateCanvas: ((width: number, height: number) => any) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registerFont: ((path: string, opts: { family: string; weight: string }) => void) | null = null;

try {
  // canvas is an optional native dependency — only available when node-canvas is installed.
  // This file runs as an ES module (apps/api/package.json has "type": "module"), where
  // `require` isn't a global — it must be created explicitly to load the CJS `canvas` package.
  const require = createRequire(import.meta.url);
  const canvasMod = require("canvas") as { createCanvas: typeof nodeCreateCanvas; registerFont: typeof registerFont };
  nodeCreateCanvas = canvasMod.createCanvas;
  registerFont = canvasMod.registerFont;
} catch {
  // canvas not installed — chart rendering falls back to unavailable
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, "../../fonts");

function tryRegisterFont(file: string, family: string, weight: string) {
  try {
    registerFont?.(path.join(FONTS_DIR, file), { family, weight });
  } catch {
    // Font file missing — text will fall back to system sans-serif
  }
}

tryRegisterFont("Manrope-Bold.ttf", "Manrope", "700");
tryRegisterFont("Manrope-SemiBold.ttf", "Manrope", "600");
tryRegisterFont("Manrope-Medium.ttf", "Manrope", "500");
tryRegisterFont("IBMPlexMono-Regular.ttf", "IBM Plex Mono", "400");

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Pure helpers (identical to workbookExport.ts browser version) ─────────────

const CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a", "#4f8fba"];

function formatChartValue(value: number, decimalPlaces = 2) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  }).format(value);
}

function getChartPalette(chartColors?: string[]) {
  const colors = (chartColors || [])
    .map((c) => String(c || "").trim())
    .filter((c) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c));
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
  const n = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(n)) return `${n}${alpha}`;
  if (/^#[0-9a-fA-F]{3}$/.test(n)) {
    return `#${n.slice(1).split("").map((p) => `${p}${p}`).join("")}${alpha}`;
  }
  return n;
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
  const t = label.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  }
  const p = new Date(t);
  if (!Number.isNaN(p.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(t)) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(p);
  }
  return t;
}

function comparePreviewCategory(left: string, right: string) {
  const ll = formatCategoryTickLabel(left);
  const rl = formatCategoryTickLabel(right);
  const lt = Date.parse(left) || Date.parse(ll);
  const rt = Date.parse(right) || Date.parse(rl);
  if (Number.isFinite(lt) && Number.isFinite(rt)) return lt - rt;
  const ln = Number(left), rn = Number(right);
  if (Number.isFinite(ln) && Number.isFinite(rn)) return ln - rn;
  return ll.localeCompare(rl, undefined, { numeric: true, sensitivity: "base" });
}

function isContinuousPreviewChartType(chartType: ChartType) {
  return ["line", "area", "line-bar", "spline", "area-spline", "streamgraph", "scatter", "bubble", "3d-scatter"].includes(chartType);
}

function sortPreviewItems(data: ChartDatum[], chartType: ChartType, sort: ChartSortMode) {
  if (!data.length) return data;
  const grouped = new Map<string, ChartDatum[]>();
  data.forEach((datum) => {
    const key = String(datum.rawLabel ?? datum.label ?? "");
    grouped.set(key, [...(grouped.get(key) || []), datum]);
  });
  const entries = Array.from(grouped.entries());
  if (sort === "data-order") {
    return entries.flatMap(([, items]) => items);
  }
  if (isContinuousPreviewChartType(chartType)) {
    const descending = sort === "label-desc";
    entries.sort((a, b) => comparePreviewCategory(a[0], b[0]) * (descending ? -1 : 1));
    return entries.flatMap(([, items]) => items);
  }
  if (sort === "label-asc") {
    entries.sort((a, b) => comparePreviewCategory(a[0], b[0]));
  } else if (sort === "label-desc") {
    entries.sort((a, b) => comparePreviewCategory(b[0], a[0]));
  } else {
    entries.sort((a, b) => {
      const av = a[1].filter((i) => (i.axis || "primary") === "primary").reduce((s, i) => s + i.value, 0);
      const bv = b[1].filter((i) => (i.axis || "primary") === "primary").reduce((s, i) => s + i.value, 0);
      return sort === "value-asc" ? av - bv : bv - av;
    });
  }
  return entries.flatMap(([, items]) => items);
}

function collapseChartData(data: ChartDatum[], axis: "primary" | "secondary" = "primary") {
  const grouped = new Map<string, ChartDatum>();
  data.filter((d) => (d.axis || "primary") === axis).forEach((datum) => {
    const key = String(datum.rawLabel ?? datum.label ?? "");
    const cur = grouped.get(key) || { label: datum.label, rawLabel: datum.rawLabel, value: 0, axis };
    cur.value += datum.value;
    grouped.set(key, cur);
  });
  return Array.from(grouped.values());
}

function deriveCategories(data: ChartDatum[]) {
  return Array.from(new Set(data.map((d) => String(d.rawLabel ?? d.label ?? "")))).map((rawLabel) => {
    const match = data.find((d) => String(d.rawLabel ?? d.label ?? "") === rawLabel);
    return { rawLabel, label: match?.label || rawLabel };
  });
}

function deriveSeries(data: ChartDatum[], axis: "primary" | "secondary" = "primary") {
  const filtered = data.filter((d) => (d.axis || "primary") === axis);
  if (!filtered.length) return [];
  const rawSeries = Array.from(new Set(filtered.map((d) => String(d.rawSeries || d.series || ""))));
  if (!rawSeries.length || (rawSeries.length === 1 && rawSeries[0] === "")) {
    return [{ rawSeries: "", label: axis === "secondary" ? "Secondary" : "Values" }];
  }
  return rawSeries.map((rs) => {
    const match = filtered.find((d) => String(d.rawSeries || d.series || "") === rs);
    return { rawSeries: rs, label: match?.series || rs || (axis === "secondary" ? "Secondary" : "Values") };
  });
}

function valueForCategory(data: ChartDatum[], rawLabel: string, rawSeries: string, axis: "primary" | "secondary" = "primary") {
  return data
    .filter((d) => (d.axis || "primary") === axis)
    .filter((d) => String(d.rawLabel ?? d.label ?? "") === rawLabel)
    .filter((d) => String(d.rawSeries || d.series || "") === rawSeries)
    .reduce((s, d) => s + d.value, 0);
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
  for (let v = 0; v <= axisMax + step / 1000; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks.length ? ticks : [0, axisMax];
}

function axisMaxFor(values: number[], desired = 4) {
  const ticks = buildAxisTicks(Math.max(...values, 1), desired);
  return { ticks, axisMax: ticks[ticks.length - 1] || 1 };
}

function axisTickWidth(ticks: number[], decimalPlaces: number) {
  const longest = ticks.reduce((max, t) => Math.max(max, formatChartValue(t, decimalPlaces).length), 1);
  return Math.min(190, Math.max(84, longest * 13 + 28));
}

function truncateLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}

// ─── Canvas creation (node-canvas instead of document.createElement) ──────────

function makeCanvas(width = 1200, height = 720) {
  if (!nodeCreateCanvas) throw new Error("node-canvas is not installed. Run: npm install canvas");
  return nodeCreateCanvas(width, height);
}

// ─── Drawing primitives ────────────────────────────────────────────────────────

type Ctx = ReturnType<ReturnType<typeof makeCanvas>["getContext"]>;

function roundedRect(ctx: Ctx, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawExportHeader(ctx: Ctx, title: string, subtitle: string, width: number) {
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

function measureExportLegendHeight(
  ctx: Ctx,
  items: Array<{ label: string; value?: number }>,
  maxWidth: number,
  showValues: boolean,
  decimalPlaces: number
) {
  if (!items.length || maxWidth <= 0) return 0;
  let x = 0, rows = 1;
  ctx.font = "700 15px Manrope, Arial, sans-serif";
  items.forEach((item) => {
    const valueText = showValues && typeof item.value === "number" ? ` · ${formatChartValue(item.value, decimalPlaces)}` : "";
    const label = `${truncateLabel(String(item.label || "Unassigned"), 24)}${valueText}`;
    const w = Math.min(maxWidth, Math.max(92, ctx.measureText(label).width + 42));
    if (x > 0 && x + w > maxWidth) { rows += 1; x = 0; }
    x += w + 10;
  });
  return rows * 34;
}

function estimateExportLegendHeight(
  items: Array<{ label: string; value?: number }>,
  maxWidth: number,
  showValues: boolean,
  decimalPlaces: number
) {
  if (!items.length || maxWidth <= 0) return 0;
  let x = 0, rows = 1;
  items.forEach((item) => {
    const valueText = showValues && typeof item.value === "number" ? ` · ${formatChartValue(item.value, decimalPlaces)}` : "";
    const label = `${truncateLabel(String(item.label || "Unassigned"), 24)}${valueText}`;
    const w = Math.min(maxWidth, Math.max(92, label.length * 8.5 + 42));
    if (x > 0 && x + w > maxWidth) { rows += 1; x = 0; }
    x += w + 10;
  });
  return rows * 34;
}

function drawExportLegend(
  ctx: Ctx,
  items: Array<{ label: string; value?: number; rawLabel?: string; rawSeries?: string; series?: string }>,
  options: {
    x: number; y: number; maxWidth: number;
    palette: string[]; overrides?: Record<string, string>;
    showValues?: boolean; decimalPlaces: number;
  }
) {
  let x = options.x, y = options.y;
  ctx.font = "700 15px Manrope, Arial, sans-serif";
  items.forEach((item, index) => {
    const valueText = options.showValues && typeof item.value === "number" ? ` · ${formatChartValue(item.value, options.decimalPlaces)}` : "";
    const label = `${truncateLabel(String(item.label || "Unassigned"), 24)}${valueText}`;
    const w = Math.min(options.maxWidth, Math.max(92, ctx.measureText(label).width + 42));
    if (x > options.x && x + w > options.x + options.maxWidth) { x = options.x; y += 34; }
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    roundedRect(ctx, x, y - 20, w, 24, 12);
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
    x += w + 10;
  });
  return y + 34;
}

function estimateExportChartHeight(report: ReportDefinition, data: ChartDatum[], baseHeight: number, targetWidth: number) {
  const normalizedChartType = normalizeExportChartType(report.view.chartType, report.view.chartOrientation);
  const decimalPlaces = report.view.decimalPlaces ?? 2;
  const sortedData = sortPreviewItems(data, normalizedChartType, report.view.chartSort || "value-desc");
  const primaryItems = collapseChartData(sortedData, "primary");
  const primarySeries = deriveSeries(sortedData, "primary");
  const secondarySeries = deriveSeries(sortedData, "secondary");
  const horizontal = report.view.chartType === "horizontal-bar"
    || report.view.chartType === "horizontal-stacked-bar"
    || (normalizedChartType === "bar" && report.view.chartOrientation === "horizontal");
  const legendItems = normalizedChartType === "pie" || normalizedChartType === "donut"
    ? primaryItems
    : [
        ...(horizontal ? primaryItems : primarySeries.map((s) => ({ label: s.label, rawLabel: s.rawSeries, rawSeries: s.rawSeries, series: s.label }))),
        ...secondarySeries.map((s) => ({ label: `${s.label} (secondary)`, rawLabel: s.rawSeries, rawSeries: s.rawSeries, series: `${s.label} (secondary)` }))
      ];
  const hasLegend = report.view.chartShowLegend !== false
    && (normalizedChartType === "pie" || normalizedChartType === "donut" || primarySeries.length > 1 || secondarySeries.length > 0 || horizontal);
  if (!hasLegend) return baseHeight;
  const legendHeight = 28 + estimateExportLegendHeight(
    legendItems,
    Math.max(240, targetWidth - 64),
    (normalizedChartType === "pie" || normalizedChartType === "donut") && report.view.chartShowValues !== false,
    decimalPlaces
  );
  const categoryBottomRoom = sortedData.length > 12 ? 112 : sortedData.length > 7 ? 92 : 68;
  const minimumPlotHeight = normalizedChartType === "pie" || normalizedChartType === "donut" ? 360 : 260;
  return Math.max(baseHeight, 104 + legendHeight + categoryBottomRoom + minimumPlotHeight);
}

function drawExportAxes(
  ctx: Ctx,
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
  ctx: Ctx,
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
  const total = Math.max(items.reduce((s, i) => s + i.value, 0), 1);
  const legendAreaHeight = options.showLegend
    ? 28 + measureExportLegendHeight(ctx, items, width - 64, options.showValues, options.decimalPlaces)
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
  ctx: Ctx,
  items: ChartDatum[],
  options: { palette: string[]; overrides?: Record<string, string>; showLegend: boolean; showValues: boolean; decimalPlaces: number; top: number }
) {
  const max = Math.max(...items.map((i) => i.value), 1);
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
      x: 32, y: cy + 230,
      maxWidth: ctx.canvas.width - 64,
      palette: options.palette,
      overrides: options.overrides,
      showValues: options.showValues,
      decimalPlaces: options.decimalPlaces
    });
  }
}

function drawProgressExportChart(
  ctx: Ctx,
  items: ChartDatum[],
  options: { palette: string[]; overrides?: Record<string, string>; showLegend: boolean; showValues: boolean; decimalPlaces: number; top: number }
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
  ctx: Ctx,
  items: ChartDatum[],
  options: { palette: string[]; overrides?: Record<string, string>; showValues: boolean; decimalPlaces: number; top: number }
) {
  const columns = Math.max(2, Math.min(8, Math.ceil(Math.sqrt(items.length || 1))));
  const gap = 18, left = 44;
  const availableWidth = ctx.canvas.width - left * 2;
  const size = Math.max(58, Math.min(128, (availableWidth - gap * (columns - 1)) / columns));
  const maxValue = Math.max(...items.map((i) => i.value), 1);
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
    if (options.showValues) ctx.fillText(formatChartValue(item.value, options.decimalPlaces), x + size / 2, y + size / 2 + 5);
    ctx.fillStyle = "#173126";
    ctx.font = "700 12px Manrope, Arial, sans-serif";
    ctx.fillText(truncateLabel(item.label, 16), x + size / 2, y + size + 20);
    ctx.textAlign = "left";
  });
}

function drawGaugeExportChart(
  ctx: Ctx,
  items: ChartDatum[],
  options: { palette: string[]; overrides?: Record<string, string>; showValues: boolean; decimalPlaces: number; top: number }
) {
  const current = items[0]?.value || 0;
  const max = Math.max(...items.map((i) => i.value), 1);
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
  ctx: Ctx,
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
  const categoryValues = categories.map((cat) =>
    primarySeries.reduce((sum, s) => sum + valueForCategory(items, cat.rawLabel, s.rawSeries, "primary"), 0)
  );
  const secondaryValues = categories.map((cat) =>
    secondarySeries.reduce((sum, s) => sum + valueForCategory(items, cat.rawLabel, s.rawSeries, "secondary"), 0)
  );
  const maxValue = Math.max(...categoryValues, ...secondaryValues, ...items.map((i) => i.value), 1);
  const { ticks, axisMax } = axisMaxFor([maxValue], categories.length > 16 ? 3 : 4);
  const left = axisTickWidth(ticks, options.decimalPlaces) + (options.yAxisLabel ? 28 : 8);
  const bottomLabelRoom = categories.length > 12 ? 112 : categories.length > 7 ? 92 : 68;
  const legendItems = [
    ...(horizontal ? primaryItems : primarySeries.map((s) => ({ label: s.label, rawLabel: s.rawSeries, rawSeries: s.rawSeries, series: s.label }))),
    ...secondarySeries.map((s) => ({ label: `${s.label} (secondary)`, rawLabel: s.rawSeries, rawSeries: s.rawSeries, series: `${s.label} (secondary)` }))
  ];
  const showCategoryLegend = options.showLegend && (primarySeries.length > 1 || secondarySeries.length > 0 || horizontal);
  const legendRoom = showCategoryLegend
    ? 24 + measureExportLegendHeight(ctx, legendItems, ctx.canvas.width - left - 36, false, options.decimalPlaces)
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
      x: left, y: options.top + 24,
      maxWidth: ctx.canvas.width - left - 36,
      palette: options.palette, overrides: options.overrides,
      showValues: false, decimalPlaces: options.decimalPlaces
    });
  }
  drawExportAxes(ctx, bounds, ticks, axisMax, options.decimalPlaces, options.yAxisLabel);

  if (horizontal) {
    const singleSeries = primarySeries.length <= 1 && !primarySeries[0]?.rawSeries;
    const rowGap = 14;
    const rowHeight = Math.max(18, Math.min(42, (bounds.height - rowGap * Math.max(0, primaryItems.length - 1)) / Math.max(1, primaryItems.length)));
    const maxLabelWidth = Math.min(210, Math.max(90, primaryItems.reduce((m, i) => Math.max(m, i.label.length * 8), 80)));
    primaryItems.forEach((item, index) => {
      const y = bounds.top + index * (rowHeight + rowGap);
      const width = (item.value / axisMax) * Math.max(1, bounds.width - maxLabelWidth - 24);
      ctx.fillStyle = "#173126";
      ctx.font = "700 14px Manrope, Arial, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(truncateLabel(item.label, 24), bounds.left + maxLabelWidth - 12, y + rowHeight / 2 + 4);
      ctx.textAlign = "left";
      ctx.fillStyle = getChartColorOverride(options.palette, singleSeries ? 0 : index, options.overrides, item);
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
            ? (primaryItems.find((i) => String(i.rawLabel ?? i.label ?? "") === category.rawLabel) || category.label)
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
          const datum = items.find((i) =>
            String(i.rawLabel ?? i.label ?? "") === category.rawLabel
            && String(i.rawSeries || i.series || "") === series.rawSeries
            && (i.axis || "primary") === "primary"
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
    const points = categories.map((cat, ci) => {
      const value = valueForCategory(items, cat.rawLabel, series.rawSeries, axis);
      return {
        x: bounds.left + categoryStep * ci + categoryStep / 2,
        y: bounds.top + bounds.height - (value / axisMax) * bounds.height,
        value
      };
    });
    if (areaLike && axis === "primary") {
      ctx.beginPath();
      points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
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
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
    ctx.setLineDash([]);
    points.forEach((p) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, axis === "secondary" ? 4 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (options.showValues && lineLike) {
        ctx.fillStyle = "#173126";
        ctx.font = "800 11px Manrope, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(formatChartValue(p.value, options.decimalPlaces), p.x, Math.max(bounds.top + 12, p.y - 10));
        ctx.textAlign = "left";
      }
    });
  };
  if (lineLike) primarySeries.forEach((s, i) => drawLineSeries(s, i, "primary"));
  secondarySeries.forEach((s, i) => {
    if (options.secondarySeriesType === "bar" || options.secondarySeriesType === "column") return;
    drawLineSeries(s, i, "secondary");
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

// ─── Main render function ─────────────────────────────────────────────────────

function renderChartImageToDataUrl(
  title: string,
  subtitle: string,
  chartType: ReportDefinition["view"]["chartType"],
  chartOrientation: ReportDefinition["view"]["chartOrientation"],
  data: ChartDatum[],
  style: ExportChartStyleOptions = {}
): string | null {
  const palette = getChartPalette(style.chartColors);
  const normalizedChartType = normalizeExportChartType(chartType, chartOrientation);
  const sortedData = sortPreviewItems(data, normalizedChartType, style.chartSort || "value-desc");
  const primaryItems = collapseChartData(sortedData, "primary");
  const categories = deriveCategories(sortedData.length ? sortedData : primaryItems);
  const longestLabel = categories.reduce((max, i) => Math.max(max, String(i.label || "").length), 0);
  const requestedWidth = style.targetWidth ? Math.round(style.targetWidth) : 0;
  const requestedHeight = style.targetHeight ? Math.round(style.targetHeight) : 0;
  const circular = ["pie", "donut", "radial-bar", "gauge", "kpi-card", "big-number-card"].includes(normalizedChartType);
  const canvasWidth = Math.min(
    7200,
    requestedWidth || Math.max(
      circular ? 1200 : 1300,
      circular
        ? 900 + Math.min(2600, primaryItems.length * 74)
        : 260 + Math.max(1, categories.length) * Math.min(180, Math.max(88, longestLabel * 11))
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
  const canvas = makeCanvas(canvasWidth, canvasHeight);
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
    drawPieExportChart(ctx, primaryItems, { chartType: normalizedChartType, palette, overrides: style.chartValueColors, showLegend, showValues, decimalPlaces, top });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "radial-bar") {
    drawRadialBarExportChart(ctx, primaryItems, { palette, overrides: style.chartValueColors, showLegend, showValues, decimalPlaces, top });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "progress-bar" || normalizedChartType === "bullet") {
    drawProgressExportChart(ctx, primaryItems, { palette, overrides: style.chartValueColors, showLegend, showValues, decimalPlaces, top });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "heatmap") {
    drawHeatmapExportChart(ctx, primaryItems, { palette, overrides: style.chartValueColors, showValues, decimalPlaces, top });
    return canvas.toDataURL("image/png");
  }
  if (normalizedChartType === "gauge" || normalizedChartType === "kpi-card" || normalizedChartType === "big-number-card") {
    drawGaugeExportChart(ctx, primaryItems, { palette, overrides: style.chartValueColors, showValues, decimalPlaces, top });
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

// ─── Axis label helpers (mirrors getWorkbookChartAxisLabels in workbookExport.ts) ─

function getChartFieldId(report: ReportDefinition) {
  return report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
}

function getChartAxisLabels(report: ReportDefinition) {
  const xFieldId = getChartFieldId(report);
  return {
    xAxisLabel: report.view.chartXAxisLabel?.trim() || xFieldId || "",
    yAxisLabel: report.view.chartYAxisLabel?.trim()
      || (report.view.chartAggregation === "count" ? "Rows" : ""),
    secondaryYAxisLabel: report.view.chartSecondaryYAxisLabel?.trim()
      || (report.view.chartUseSecondaryAxis ? "" : "")
  };
}

// ─── Sizing (mirrors getChartImageSizing in xlsx-export.ts) ──────────────────

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getChartSizing(report: ReportDefinition, chartData: ChartDatum[]) {
  const labels = chartData.map((i) => String(i.label || ""));
  const maxLabelLength = labels.reduce((m, l) => Math.max(m, l.length), 0);
  const count = Math.max(chartData.length, 1);
  const horizontal = report.view.chartType === "horizontal-bar"
    || report.view.chartType === "horizontal-stacked-bar"
    || (report.view.chartType === "bar" && report.view.chartOrientation === "horizontal");
  const circular = ["pie", "donut", "3d-pie", "3d-donut", "gauge", "radial-bar", "progress-bar"].includes(report.view.chartType);
  if (circular) {
    return { width: clamp(1300 + Math.max(0, count - 8) * 44, 1300, 2400), height: clamp(960 + Math.max(0, count - 8) * 28, 960, 1900) };
  }
  if (horizontal) {
    return { width: clamp(1800 + Math.max(0, maxLabelLength - 14) * 18, 1500, 3000), height: clamp(760 + count * 40, 760, 3200) };
  }
  return { width: clamp(1800 + count * 96 + Math.max(0, maxLabelLength - 10) * 34, 1500, 3400), height: clamp(1140 + Math.max(0, maxLabelLength - 16) * 22, 980, 2400) };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type CanvasChartImage = { base64: string; width: number; height: number };

export async function renderChartImageCanvas(
  report: ReportDefinition,
  subtitle: string,
  chartData: ChartDatum[],
  _summary: SummaryDatum[]
): Promise<CanvasChartImage | null> {
  if (!chartData.length) return null;
  const sizing = getChartSizing(report, chartData);
  const axisLabels = getChartAxisLabels(report);
  const baseHeight = sizing.height;
  const targetHeight = Math.min(2400, estimateExportChartHeight(report, chartData, baseHeight, sizing.width));
  const dataUrl = renderChartImageToDataUrl(
    report.view.chartTitle || report.name,
    subtitle,
    report.view.chartType,
    report.view.chartOrientation,
    chartData,
    {
      chartColors: report.view.chartColors,
      chartValueColors: report.view.chartValueColors,
      chartSort: report.view.chartSort,
      decimalPlaces: report.view.decimalPlaces,
      xAxisLabel: axisLabels.xAxisLabel,
      yAxisLabel: axisLabels.yAxisLabel,
      secondaryYAxisLabel: axisLabels.secondaryYAxisLabel,
      secondarySeriesType: report.view.chartSecondarySeriesType,
      showLegend: report.view.chartShowLegend,
      showValues: report.view.chartShowValues,
      targetWidth: sizing.width,
      targetHeight
    }
  );
  if (!dataUrl) return null;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return { base64, width: sizing.width, height: targetHeight };
}
