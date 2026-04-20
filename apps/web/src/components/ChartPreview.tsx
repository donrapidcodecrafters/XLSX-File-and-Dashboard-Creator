import type { ChartDatum, ChartOrientation, ChartSeriesType, ChartType } from "@studio/shared";

const CHART_COLORS = [
  "#0d7c66",
  "#d88d3d",
  "#5b7cfa",
  "#9b59b6",
  "#e66f5c",
  "#3a9782",
  "#b7a26a",
  "#4f8fba"
];

interface ChartPreviewProps {
  chartType: ChartType;
  data: ChartDatum[];
  chartOrientation?: ChartOrientation;
  title?: string;
  decimalPlaces?: number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  secondaryYAxisLabel?: string;
  secondarySeriesType?: ChartSeriesType;
  compact?: boolean;
  showLegend?: boolean;
  showValues?: boolean;
  getDatumHref?: (datum: ChartDatum) => string;
  openLinksInNewTab?: boolean;
}

function cap(value: string, max = 16) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getColor(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length];
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
  if (!filtered.length) {
    return [];
  }
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

function normalizeChartType(chartType: ChartType, orientation: ChartOrientation): ChartType {
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
  if (chartType === "radial-bar") return "radial-bar";
  if (chartType === "variwide-bar") return "variwide-bar";
  if (chartType === "progress-bar") return "progress-bar";
  if (chartType === "bullet") return "bullet";
  return chartType;
}

function renderTitle(title?: string) {
  const trimmed = title?.trim();
  return trimmed ? <div className="chart-title">{trimmed}</div> : null;
}

function formatAxisValue(value: number, decimalPlaces = 2) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  }).format(value);
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

function xTickLabel(label: string, _index: number, length: number, compact: boolean) {
  const maxLength = compact ? 8 : length >= 10 ? 10 : length >= 7 ? 12 : 16;
  return cap(label, maxLength);
}

function formatCategoryTickLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "Unassigned";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric"
      }).format(date);
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric"
    }).format(parsed);
  }
  return trimmed;
}

function axisMaxFor(values: number[], compact: boolean) {
  const ticks = buildAxisTicks(Math.max(...values, 1), compact ? 3 : 4);
  return {
    ticks,
    axisMax: ticks[ticks.length - 1] || 1
  };
}

function buildSmoothLinePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] || points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] || next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }
  return path;
}

function buildAreaPath(points: Array<{ x: number; y: number }>, bottom: number, smooth = false) {
  if (!points.length) return "";
  const linePath = smooth
    ? buildSmoothLinePath(points)
    : `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
  const last = points[points.length - 1];
  const first = points[0];
  return `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
}

function chartLabelNumericValue(rawLabel: string, index: number) {
  const trimmed = String(rawLabel || "").trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const dateValue = Date.parse(trimmed);
  if (Number.isFinite(dateValue)) return dateValue;
  return index;
}

function axisTickTextWidth(ticks: number[], decimalPlaces: number, compact: boolean) {
  const longest = ticks.reduce((max, tick) => {
    const length = formatAxisValue(tick, decimalPlaces).length;
    return Math.max(max, length);
  }, 1);
  const perChar = compact ? 6.4 : 7.6;
  return Math.min(160, Math.max(72, Math.round(longest * perChar + 24)));
}

function columnBottomPad(itemCount: number, compact: boolean, hasAxisLabel: boolean) {
  const densityPad = itemCount >= 12 ? 118 : itemCount >= 9 ? 102 : itemCount >= 6 ? 88 : 74;
  return densityPad + (hasAxisLabel ? 18 : 0);
}

function renderAxisLegend(
  items: ChartDatum[],
  compact: boolean,
  showLegend: boolean,
  showValues: boolean,
  getDatumHref?: (datum: ChartDatum) => string,
  openLinksInNewTab = false
) {
  if (!showLegend) return null;
  return (
    <div className="badge-row">
      {items.map((item, index) => (
        (() => {
          const href = getDatumHref?.(item) || "";
          const content = (
            <span className={`badge${href ? " chart-badge-link" : ""}`} key={item.label}>
              <span className="badge-dot" style={{ background: getColor(index) }} />
              {cap(item.label, compact ? 12 : 18)}{showValues ? ` · ${item.value}` : ""}
            </span>
          );
          return href ? (
            <a
              key={item.label}
              className="chart-link-reset"
              href={href}
              target={openLinksInNewTab ? "_blank" : undefined}
              rel={openLinksInNewTab ? "noreferrer" : undefined}
            >
              {content}
            </a>
          ) : content;
        })()
      ))}
    </div>
  );
}

function shouldRenderLegendStrip(chartType: ChartType, compact: boolean) {
  if (compact) {
    return chartType === "pie" || chartType === "donut";
  }
  return chartType === "pie" || chartType === "donut" || chartType === "heatmap" || chartType === "funnel";
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

function describePieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function describeDonutSlicePath(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z"
  ].join(" ");
}

export function ChartPreview({
  chartType,
  data,
  chartOrientation = "vertical",
  title = "",
  decimalPlaces = 2,
  xAxisLabel = "",
  yAxisLabel = "",
  secondaryYAxisLabel = "",
  secondarySeriesType = "line",
  compact = false,
  showLegend = true,
  showValues = true,
  getDatumHref,
  openLinksInNewTab = false
}: ChartPreviewProps) {
  if (!data.length) {
    return <div className="chart-empty">No chart data available.</div>;
  }

  const items = data;
  const primaryItems = collapseChartData(items, "primary");
  const secondaryItems = collapseChartData(items, "secondary");
  const categories = deriveCategories(items.length ? items : primaryItems);
  const primarySeries = deriveSeries(items, "primary");
  const secondarySeries = deriveSeries(items, "secondary");
  const max = Math.max(...items.map((item) => item.value), 1);
  const total = primaryItems.reduce((sum, item) => sum + item.value, 0) || 1;
  const normalizedChartType = normalizeChartType(chartType, chartOrientation);
  const smoothLine = chartType === "spline" || chartType === "area-spline";
  const streamgraph = chartType === "streamgraph";
  const threeDimensional = chartType.startsWith("3d-");
  const bubbleChart = chartType === "bubble";
  const orientation = chartType === "horizontal-bar" || chartType === "horizontal-stacked-bar"
    ? "horizontal"
    : (normalizedChartType === "column" || normalizedChartType === "stacked-column" ? "vertical" : chartOrientation);
  const axisDriven = ["bar", "column", "stacked-bar", "stacked-column", "line", "area", "waterfall", "scatter"].includes(normalizedChartType);
  const anchorTarget = openLinksInNewTab ? "_blank" : undefined;
  const anchorRel = openLinksInNewTab ? "noreferrer" : undefined;

  if (normalizedChartType === "donut" || normalizedChartType === "pie") {
    const cx = 100;
    const cy = 100;
    const outerRadius = 82;
    const innerRadius = normalizedChartType === "donut" ? 44 : 0;
    let offset = 0;
    const slices = primaryItems.map((item, index) => {
      const startAngle = (offset / total) * 360;
      offset += item.value;
      const endAngle = (offset / total) * 360;
      return {
        item,
        index,
        path: normalizedChartType === "donut"
          ? describeDonutSlicePath(cx, cy, outerRadius, innerRadius, startAngle, endAngle)
          : describePieSlicePath(cx, cy, outerRadius, startAngle, endAngle)
      };
    });

    return (
      <div className="chart-shell">
        {renderTitle(title)}
        <div className="donut-shell">
          <div className={`donut ${normalizedChartType === "pie" ? "pie-chart" : ""}`}>
            <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              {slices.map(({ item, index, path }) => {
                const href = getDatumHref?.(item) || "";
                const content = (
                  <g>
                    {threeDimensional ? <path d={path} transform="translate(0 8)" fill="rgba(23,49,38,0.18)" /> : null}
                    <path d={path} fill={getColor(index)} className={href ? "chart-linkable" : undefined} />
                  </g>
                );
                return href ? (
                  <a key={item.label} href={href} target={anchorTarget} rel={anchorRel}>
                    {content}
                  </a>
                ) : (
                  <g key={item.label}>{content}</g>
                );
              })}
            </svg>
            {normalizedChartType === "donut" ? (
              <div className="donut-center">
                <div>
                  <strong>{total}</strong>
                  rows
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {renderAxisLegend(primaryItems, compact, showLegend, showValues, getDatumHref, openLinksInNewTab)}
      </div>
    );
  }

  if (normalizedChartType === "variwide-bar") {
    const { ticks, axisMax } = axisMaxFor(primaryItems.map((item) => item.value), compact);
    const chartWidth = 760;
    const chartHeight = 348;
    const leftPad = axisTickTextWidth(ticks, decimalPlaces, compact);
    const rightPad = 24;
    const topPad = 24;
    const bottomPad = columnBottomPad(primaryItems.length, compact, Boolean(xAxisLabel));
    const plotWidth = chartWidth - leftPad - rightPad;
    const plotHeight = chartHeight - topPad - bottomPad;
    const totalWidthWeight = primaryItems.reduce((sum, item) => sum + Math.max(item.value, 1), 0) || 1;
    let currentX = leftPad;
    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-svg-shell">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" className="bar-chart-svg">
            {ticks.map((tick) => {
              const y = topPad + plotHeight - (tick / axisMax) * plotHeight;
              return (
                <g key={`variwide-tick-${tick}`}>
                  <line x1={leftPad} y1={y} x2={chartWidth - rightPad} y2={y} className="chart-grid-svg-line" />
                  <text x={leftPad - 10} y={y + 4} textAnchor="end" className="chart-svg-tick">{formatAxisValue(tick, decimalPlaces)}</text>
                </g>
              );
            })}
            <line x1={leftPad} y1={topPad} x2={leftPad} y2={topPad + plotHeight} className="chart-axis-svg-line" />
            <line x1={leftPad} y1={topPad + plotHeight} x2={chartWidth - rightPad} y2={topPad + plotHeight} className="chart-axis-svg-line" />
            {yAxisLabel ? (
              <text
                x={18}
                y={topPad + plotHeight / 2}
                transform={`rotate(-90 18 ${topPad + plotHeight / 2})`}
                textAnchor="middle"
                className="chart-svg-axis-title"
              >
                {yAxisLabel}
              </text>
            ) : null}
            {primaryItems.map((item, index) => {
              const width = Math.max(22, (Math.max(item.value, 1) / totalWidthWeight) * plotWidth);
              const height = (item.value / axisMax) * plotHeight;
              const x = currentX;
              currentX += width;
              const y = topPad + plotHeight - height;
              const href = getDatumHref?.(item) || "";
              const content = (
                <g className={href ? "chart-linkable" : undefined}>
                  <rect x={x + 2} y={y} width={Math.max(width - 6, 14)} height={Math.max(height, 0)} rx="10" fill={getColor(index)} fillOpacity="0.9" />
                  <polygon
                    points={`${x + width - 4},${y} ${x + width + 6},${y - 6} ${x + width + 6},${topPad + plotHeight - 6} ${x + width - 4},${topPad + plotHeight}`}
                    fill="rgba(23,49,38,0.14)"
                  />
                  <text
                    x={x + width / 2}
                    y={topPad + plotHeight + 16}
                    textAnchor="end"
                    transform={`rotate(-40 ${x + width / 2} ${topPad + plotHeight + 16})`}
                    className="chart-svg-label"
                  >
                    {xTickLabel(item.label, index, primaryItems.length, compact)}
                  </text>
                  {showValues ? (
                    <text x={x + width / 2} y={Math.max(topPad + 12, y - 8)} textAnchor="middle" className="chart-svg-value">
                      {formatAxisValue(item.value, decimalPlaces)}
                    </text>
                  ) : null}
                </g>
              );
              return href ? (
                <a key={item.label} href={href} target={anchorTarget} rel={anchorRel}>
                  {content}
                </a>
              ) : <g key={item.label}>{content}</g>;
            })}
            {xAxisLabel ? (
              <text x={leftPad + plotWidth / 2} y={chartHeight - 12} textAnchor="middle" className="chart-svg-axis-title">
                {xAxisLabel}
              </text>
            ) : null}
          </svg>
        </div>
      </div>
    );
  }

  if (normalizedChartType === "column" || normalizedChartType === "stacked-column" || ((normalizedChartType === "bar" || normalizedChartType === "stacked-bar") && orientation === "vertical")) {
    const stacked = normalizedChartType === "stacked-column" || normalizedChartType === "stacked-bar";
    const categorySums = categories.map((category) =>
      primarySeries.reduce((sum, series) => sum + valueForCategory(items, category.rawLabel, series.rawSeries, "primary"), 0)
    );
    const primaryMax = Math.max(...categorySums, ...primaryItems.map((item) => item.value), 1);
    const { ticks, axisMax } = axisMaxFor([primaryMax], compact);
    const chartWidth = 760;
    const chartHeight = 348;
    const leftPad = axisTickTextWidth(ticks, decimalPlaces, compact);
    const rightPad = 24;
    const topPad = 24;
    const bottomPad = columnBottomPad(categories.length, compact, Boolean(xAxisLabel));
    const plotWidth = chartWidth - leftPad - rightPad;
    const plotHeight = chartHeight - topPad - bottomPad;
    const step = plotWidth / Math.max(categories.length, 1);
    const seriesCount = Math.max(primarySeries.length, 1);
    const groupWidth = Math.max(24, Math.min(88, step * 0.72));
    const barWidth = stacked
      ? groupWidth
      : Math.max(12, Math.min(36, (groupWidth - Math.max(0, seriesCount - 1) * 6) / seriesCount));
    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-svg-shell">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" className="bar-chart-svg">
            {ticks.map((tick) => {
              const y = topPad + plotHeight - (tick / axisMax) * plotHeight;
              return (
                <g key={`v-tick-${tick}`}>
                  <line x1={leftPad} y1={y} x2={chartWidth - rightPad} y2={y} className="chart-grid-svg-line" />
                  <text x={leftPad - 10} y={y + 4} textAnchor="end" className="chart-svg-tick">{formatAxisValue(tick, decimalPlaces)}</text>
                </g>
              );
            })}
            <line x1={leftPad} y1={topPad} x2={leftPad} y2={topPad + plotHeight} className="chart-axis-svg-line" />
            <line x1={leftPad} y1={topPad + plotHeight} x2={chartWidth - rightPad} y2={topPad + plotHeight} className="chart-axis-svg-line" />
            {yAxisLabel ? (
              <text
                x={18}
                y={topPad + plotHeight / 2}
                transform={`rotate(-90 18 ${topPad + plotHeight / 2})`}
                textAnchor="middle"
                className="chart-svg-axis-title"
              >
                {yAxisLabel}
              </text>
            ) : null}
            {categories.map((category, categoryIndex) => {
              const groupX = leftPad + step * categoryIndex + (step - groupWidth) / 2;
              let stackedHeight = 0;
              return (
                <g key={category.rawLabel}>
                  {primarySeries.map((series, seriesIndex) => {
                    const datum = items.find((item) =>
                      String(item.rawLabel ?? item.label ?? "") === category.rawLabel &&
                      String(item.rawSeries || item.series || "") === series.rawSeries &&
                      (item.axis || "primary") === "primary"
                    );
                    const value = datum?.value || 0;
                    const height = Math.max(value > 0 ? 8 : 0, (value / axisMax) * plotHeight);
                    const x = stacked ? groupX : groupX + seriesIndex * (barWidth + 6);
                    const y = stacked
                      ? topPad + plotHeight - stackedHeight - height
                      : topPad + plotHeight - height;
                    if (stacked) {
                      stackedHeight += height;
                    }
                    const href = datum ? (getDatumHref?.(datum) || "") : "";
                    const content = (
                      <g key={`${category.rawLabel}-${series.rawSeries || "default"}-${seriesIndex}`} className={href ? "chart-linkable" : undefined}>
                        {threeDimensional ? (
                          <>
                            <polygon
                              points={`${x + barWidth},${y} ${x + barWidth + 8},${y - 6} ${x + barWidth + 8},${topPad + plotHeight - 6} ${x + barWidth},${topPad + plotHeight}`}
                              fill="rgba(23,49,38,0.16)"
                            />
                            <polygon
                              points={`${x},${y} ${x + 8},${y - 6} ${x + barWidth + 8},${y - 6} ${x + barWidth},${y}`}
                              fill="rgba(255,255,255,0.18)"
                            />
                          </>
                        ) : null}
                        <rect x={x} y={y} width={barWidth} height={Math.max(height, 0)} rx="10" fill={getColor(seriesIndex)} fillOpacity="0.9" />
                        {showValues && value > 0 ? (
                          <text x={x + barWidth / 2} y={Math.max(topPad + 12, y - 8)} textAnchor="middle" className="chart-svg-value">
                            {formatAxisValue(value, decimalPlaces)}
                          </text>
                        ) : null}
                      </g>
                    );
                    return href ? (
                      <a key={`${category.rawLabel}-${series.rawSeries || "default"}-${seriesIndex}`} href={href} target={anchorTarget} rel={anchorRel}>
                        {content}
                      </a>
                    ) : content;
                  })}
                  <text
                    x={groupX + groupWidth / 2}
                    y={topPad + plotHeight + 16}
                    textAnchor="end"
                    transform={`rotate(-40 ${groupX + groupWidth / 2} ${topPad + plotHeight + 16})`}
                    className="chart-svg-label"
                  >
                    {xTickLabel(category.label, categoryIndex, categories.length, compact)}
                  </text>
                </g>
              );
            })}
            {xAxisLabel ? (
              <text x={leftPad + plotWidth / 2} y={chartHeight - 12} textAnchor="middle" className="chart-svg-axis-title">
                {xAxisLabel}
              </text>
            ) : null}
          </svg>
        </div>
        {primarySeries.length > 1 ? renderAxisLegend(primarySeries.map((series, index) => ({
          label: series.label,
          value: 0,
          rawLabel: series.rawSeries,
          rawSeries: series.rawSeries,
          series: series.label
        })), compact, showLegend, false, undefined, openLinksInNewTab) : null}
      </div>
    );
  }

  if ((normalizedChartType === "bar" || normalizedChartType === "stacked-bar") && orientation === "horizontal") {
    const stacked = normalizedChartType === "stacked-bar";
    const categorySums = categories.map((category) =>
      primarySeries.reduce((sum, series) => sum + valueForCategory(items, category.rawLabel, series.rawSeries, "primary"), 0)
    );
    const primaryMax = Math.max(...categorySums, ...primaryItems.map((item) => item.value), 1);
    const { ticks, axisMax } = axisMaxFor([primaryMax], compact);
    const chartWidth = 760;
    const chartHeight = Math.max(220, 84 + categories.length * 44);
    const labelPad = Math.min(220, Math.max(132, categories.reduce((max, item) => Math.max(max, cap(item.label, compact ? 12 : 18).length), 1) * 8 + 36));
    const leftPad = labelPad + (yAxisLabel ? 26 : 0);
    const rightPad = showValues ? axisTickTextWidth([axisMax], decimalPlaces, compact) : 28;
    const topPad = 20;
    const bottomPad = xAxisLabel ? 54 : 36;
    const plotWidth = chartWidth - leftPad - rightPad;
    const plotHeight = chartHeight - topPad - bottomPad;
    const rowHeight = plotHeight / Math.max(categories.length, 1);
    const seriesCount = Math.max(primarySeries.length, 1);
    const groupHeight = Math.max(18, Math.min(34, rowHeight * 0.72));
    const barHeight = stacked
      ? groupHeight
      : Math.max(10, Math.min(24, (groupHeight - Math.max(0, seriesCount - 1) * 4) / seriesCount));
    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-svg-shell">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" className="bar-chart-svg">
            {ticks.map((tick) => {
              const x = leftPad + (tick / axisMax) * plotWidth;
              return (
                <g key={`h-tick-${tick}`}>
                  <line x1={x} y1={topPad} x2={x} y2={topPad + plotHeight} className="chart-grid-svg-line" />
                  <text x={x} y={topPad + plotHeight + 18} textAnchor="middle" className="chart-svg-tick">{formatAxisValue(tick, decimalPlaces)}</text>
                </g>
              );
            })}
            {yAxisLabel ? (
              <text
                x={18}
                y={topPad + plotHeight / 2}
                transform={`rotate(-90 18 ${topPad + plotHeight / 2})`}
                textAnchor="middle"
                className="chart-svg-axis-title"
              >
                {yAxisLabel}
              </text>
            ) : null}
            <line x1={leftPad} y1={topPad} x2={leftPad} y2={topPad + plotHeight} className="chart-axis-svg-line" />
            <line x1={leftPad} y1={topPad + plotHeight} x2={chartWidth - rightPad} y2={topPad + plotHeight} className="chart-axis-svg-line" />
            {categories.map((category, categoryIndex) => {
              const groupY = topPad + rowHeight * categoryIndex + (rowHeight - groupHeight) / 2;
              let stackedWidth = 0;
              return (
                <g key={category.rawLabel}>
                  <text x={leftPad - 12} y={groupY + groupHeight / 2 + 4} textAnchor="end" className="chart-svg-label">{cap(category.label, compact ? 12 : 18)}</text>
                  {primarySeries.map((series, seriesIndex) => {
                    const datum = items.find((item) =>
                      String(item.rawLabel ?? item.label ?? "") === category.rawLabel &&
                      String(item.rawSeries || item.series || "") === series.rawSeries &&
                      (item.axis || "primary") === "primary"
                    );
                    const value = datum?.value || 0;
                    const width = Math.max(value > 0 ? 8 : 0, (value / axisMax) * plotWidth);
                    const y = stacked ? groupY : groupY + seriesIndex * (barHeight + 4);
                    const x = stacked ? leftPad + stackedWidth : leftPad;
                    if (stacked) {
                      stackedWidth += width;
                    }
                    const href = datum ? (getDatumHref?.(datum) || "") : "";
                    const content = (
                      <g key={`${category.rawLabel}-${series.rawSeries || "default"}-${seriesIndex}`} className={href ? "chart-linkable" : undefined}>
                        {threeDimensional ? (
                          <>
                            <polygon
                              points={`${x + width},${y} ${x + width + 8},${y - 5} ${x + width + 8},${y + barHeight - 5} ${x + width},${y + barHeight}`}
                              fill="rgba(23,49,38,0.16)"
                            />
                            <polygon
                              points={`${x},${y} ${x + 8},${y - 5} ${x + width + 8},${y - 5} ${x + width},${y}`}
                              fill="rgba(255,255,255,0.16)"
                            />
                          </>
                        ) : null}
                        <rect x={x} y={y} width={width} height={barHeight} rx="10" fill={getColor(seriesIndex)} fillOpacity="0.9" />
                        {showValues && value > 0 ? (
                          <text x={x + width + 10} y={y + barHeight / 2 + 4} textAnchor="start" className="chart-svg-value">
                            {formatAxisValue(value, decimalPlaces)}
                          </text>
                        ) : null}
                      </g>
                    );
                    return href ? (
                      <a key={`${category.rawLabel}-${series.rawSeries || "default"}-${seriesIndex}`} href={href} target={anchorTarget} rel={anchorRel}>
                        {content}
                      </a>
                    ) : content;
                  })}
                </g>
              );
            })}
            {xAxisLabel ? (
              <text x={leftPad + plotWidth / 2} y={chartHeight - 10} textAnchor="middle" className="chart-svg-axis-title">
                {xAxisLabel}
              </text>
            ) : null}
          </svg>
        </div>
        {primarySeries.length > 1 ? renderAxisLegend(primarySeries.map((series) => ({
          label: series.label,
          value: 0,
          rawLabel: series.rawSeries,
          rawSeries: series.rawSeries,
          series: series.label
        })), compact, showLegend, false, undefined, openLinksInNewTab) : null}
      </div>
    );
  }

  if (normalizedChartType === "line" || normalizedChartType === "area" || normalizedChartType === "line-bar") {
    const primaryMax = Math.max(...primaryItems.map((item) => item.value), 1);
    const secondaryMax = Math.max(...secondaryItems.map((item) => item.value), 1);
    const { ticks, axisMax } = axisMaxFor([primaryMax], compact);
    const secondaryAxis = secondaryItems.length ? axisMaxFor([secondaryMax], compact) : null;
    const reversedTicks = [...ticks].reverse();
    const yAxisWidth = axisTickTextWidth(ticks, decimalPlaces, compact);
    const secondaryAxisWidth = secondaryAxis ? axisTickTextWidth(secondaryAxis.ticks, decimalPlaces, compact) : 0;
    const chartWidth = 400;
    const chartHeight = 292;
    const plotLeft = 10;
    const plotRight = 394;
    const plotTop = 20;
    const plotBottom = 186;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const tickLabelY = 226;
    const axisLabelY = 274;
    const axisLayoutColumns = `${yAxisLabel ? "auto " : ""}${yAxisWidth}px minmax(0, 1fr)${secondaryAxis ? ` ${secondaryAxisWidth}px` : ""}`;
    const buildSeriesPoints = (seriesRaw: string, axis: "primary" | "secondary") => {
      const maxValue = axis === "secondary" && secondaryAxis ? secondaryAxis.axisMax : axisMax;
      return categories.map((category, index) => {
        const x = categories.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + index * (plotWidth / Math.max(1, categories.length - 1));
        const value = valueForCategory(items, category.rawLabel, seriesRaw, axis);
        const y = plotBottom - (value / maxValue) * plotHeight;
        const item = items.find((datum) =>
          String(datum.rawLabel ?? datum.label ?? "") === category.rawLabel &&
          String(datum.rawSeries || datum.series || "") === seriesRaw &&
          (datum.axis || "primary") === axis
        ) || {
          label: category.label,
          rawLabel: category.rawLabel,
          value,
          rawSeries: seriesRaw,
          axis
        };
        return { x, y, item };
      });
    };

    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-chart-layout" style={{ gridTemplateColumns: axisLayoutColumns }}>
          {yAxisLabel ? <div className="chart-axis-title chart-axis-title-vertical">{yAxisLabel}</div> : null}
          <div className="chart-y-axis">
            {reversedTicks.map((tick) => (
              <span className="chart-y-tick" key={tick}>{formatAxisValue(tick, decimalPlaces)}</span>
            ))}
          </div>
          <div className="chart-plot-column">
            <div className={normalizedChartType === "area" ? "area-chart axis-chart" : "line-chart axis-chart"}>
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ width: "100%", height: "auto", aspectRatio: `${chartWidth} / ${chartHeight}` }}
              >
                {ticks.map((tick) => {
                  const y = plotBottom - (tick / axisMax) * plotHeight;
                  return <line key={`line-${tick}`} x1={plotLeft} y1={y} x2={plotRight} y2={y} className="chart-grid-svg-line" />;
                })}
                <line x1={plotLeft} y1={plotTop} x2={plotLeft} y2={plotBottom} className="chart-axis-svg-line" />
                <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} className="chart-axis-svg-line" />
                {normalizedChartType === "line-bar" ? categories.map((category, categoryIndex) => {
                  const value = primarySeries.reduce((sum, series) => sum + valueForCategory(items, category.rawLabel, series.rawSeries, "primary"), 0);
                  const width = Math.max(18, Math.min(42, 280 / Math.max(categories.length, 1)));
                  const x = categories.length === 1 ? plotLeft + plotWidth / 2 - width / 2 : plotLeft + categoryIndex * (plotWidth / Math.max(1, categories.length - 1)) - width / 2;
                  const height = (value / axisMax) * plotHeight;
                  const y = plotBottom - height;
                  const datum = primaryItems.find((item) => String(item.rawLabel ?? item.label ?? "") === category.rawLabel) || {
                    label: category.label,
                    rawLabel: category.rawLabel,
                    value,
                    axis: "primary" as const
                  };
                  const href = getDatumHref?.(datum) || "";
                  const content = (
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={Math.max(height, 0)}
                      rx="10"
                      fill={getColor(categoryIndex)}
                      fillOpacity="0.72"
                      className={href ? "chart-linkable" : undefined}
                    />
                  );
                  return href ? (
                    <a key={`combo-bar-${category.rawLabel}`} href={href} target={anchorTarget} rel={anchorRel}>
                      {content}
                    </a>
                  ) : content;
                }) : null}
                {streamgraph && primarySeries.length > 1 ? (() => {
                  const totals = categories.map((category) =>
                    primarySeries.reduce((sum, series) => sum + valueForCategory(items, category.rawLabel, series.rawSeries, "primary"), 0)
                  );
                  const baselines = totals.map((totalValue) => Math.max(0, (axisMax - totalValue) / 2));
                  const cumulativeValues = [...baselines];
                  return primarySeries.map((series, seriesIndex) => {
                    const upperPoints = categories.map((category, index) => {
                      cumulativeValues[index] += valueForCategory(items, category.rawLabel, series.rawSeries, "primary");
                      const x = categories.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + index * (plotWidth / Math.max(1, categories.length - 1));
                      const y = plotBottom - (cumulativeValues[index] / axisMax) * plotHeight;
                      return { x, y };
                    });
                    const lowerValues = [...cumulativeValues].map((value, index) => value - valueForCategory(items, categories[index].rawLabel, series.rawSeries, "primary"));
                    const lowerPoints = categories.map((category, index) => {
                      const x = categories.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + index * (plotWidth / Math.max(1, categories.length - 1));
                      const y = plotBottom - (lowerValues[index] / axisMax) * plotHeight;
                      return { x, y };
                    }).reverse();
                    const path = `${buildSmoothLinePath(upperPoints)} L ${lowerPoints.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
                    return <path key={`stream-${series.rawSeries || "default"}-${seriesIndex}`} d={path} fill={getColor(seriesIndex)} fillOpacity="0.34" stroke="none" />;
                  });
                })() : null}
                {primarySeries.map((series, seriesIndex) => {
                  const points = buildSeriesPoints(series.rawSeries, "primary");
                  const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
                  const linePath = smoothLine || streamgraph ? buildSmoothLinePath(points) : `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
                  const areaPath = buildAreaPath(points, plotBottom, smoothLine || streamgraph);
                  return (
                    <g key={`primary-${series.rawSeries || "default"}-${seriesIndex}`}>
                      {normalizedChartType === "area" && !streamgraph ? <path d={areaPath} fill={getColor(seriesIndex)} fillOpacity={primarySeries.length > 1 ? 0.12 : 0.22} /> : null}
                      {threeDimensional && (normalizedChartType === "area" || normalizedChartType === "line") ? (
                        <path d={linePath} transform="translate(0 8)" stroke="rgba(23,49,38,0.18)" fill="none" strokeWidth="5" />
                      ) : null}
                      {normalizedChartType === "area" || streamgraph || smoothLine ? (
                        <path d={linePath} stroke={getColor(seriesIndex)} fill="none" strokeWidth="3" />
                      ) : (
                        <polyline points={pointList} stroke={getColor(seriesIndex)} fill="none" strokeWidth="3" />
                      )}
                      {points.map((point, index) => {
                        const href = getDatumHref?.(point.item) || "";
                        const content = <circle key={`${series.rawSeries}-${point.item.label}-${index}`} cx={point.x} cy={point.y} r="5" fill={getColor(seriesIndex)} className={href ? "chart-linkable" : undefined} />;
                        return href ? (
                          <a key={`${series.rawSeries}-${point.item.label}-${index}`} href={href} target={anchorTarget} rel={anchorRel}>
                            {content}
                          </a>
                        ) : content;
                      })}
                    </g>
                  );
                })}
                {secondarySeries.map((series, seriesIndex) => {
                  if (!secondaryItems.length) return null;
                  const points = buildSeriesPoints(series.rawSeries, "secondary");
                  const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
                  const linePath = smoothLine ? buildSmoothLinePath(points) : `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
                  const areaPath = buildAreaPath(points, plotBottom, smoothLine);
                  const secondaryColor = getColor(primarySeries.length + seriesIndex);
                  const seriesType = secondarySeriesType;
                  return (
                    <g key={`secondary-${series.rawSeries || "default"}-${seriesIndex}`}>
                      {seriesType === "area" ? <path d={areaPath} fill={secondaryColor} fillOpacity="0.12" /> : null}
                      {(seriesType === "line" || seriesType === "area") ? (
                        (smoothLine
                          ? <path d={linePath} stroke={secondaryColor} fill="none" strokeWidth="3" strokeDasharray="8 5" />
                          : <polyline points={pointList} stroke={secondaryColor} fill="none" strokeWidth="3" strokeDasharray="8 5" />)
                      ) : null}
                      {(seriesType === "bar" || seriesType === "column") ? points.map((point, index) => {
                        const previousX = index === 0 ? plotLeft : points[index - 1].x;
                        const nextX = index === points.length - 1 ? plotRight : points[index + 1].x;
                        const barWidth = Math.max(10, Math.min(24, ((nextX - previousX) / 2) * 0.35));
                        const barHeight = plotBottom - point.y;
                        const href = getDatumHref?.(point.item) || "";
                        const content = (
                          <rect
                            key={`${series.rawSeries}-${point.item.label}-${index}-secondary-bar`}
                            x={point.x - barWidth / 2}
                            y={point.y}
                            width={barWidth}
                            height={Math.max(barHeight, 0)}
                            rx="8"
                            fill={secondaryColor}
                            fillOpacity="0.58"
                            className={href ? "chart-linkable" : undefined}
                          />
                        );
                        return href ? (
                          <a key={`${series.rawSeries}-${point.item.label}-${index}-secondary-bar`} href={href} target={anchorTarget} rel={anchorRel}>
                            {content}
                          </a>
                        ) : content;
                      }) : null}
                      {points.map((point, index) => {
                        const href = getDatumHref?.(point.item) || "";
                        if (!(seriesType === "line" || seriesType === "area")) return null;
                        const content = <circle key={`${series.rawSeries}-${point.item.label}-${index}`} cx={point.x} cy={point.y} r="4.5" fill={secondaryColor} className={href ? "chart-linkable" : undefined} />;
                        return href ? (
                          <a key={`${series.rawSeries}-${point.item.label}-${index}`} href={href} target={anchorTarget} rel={anchorRel}>
                            {content}
                          </a>
                        ) : content;
                      })}
                    </g>
                  );
                })}
                {categories.map((item, index) => {
                  const x = categories.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + index * (plotWidth / Math.max(1, categories.length - 1));
                  const tickLabel = formatCategoryTickLabel(item.label || item.rawLabel || "Unassigned");
                  const rotate = categories.length >= 12 ? -30 : categories.length >= 8 ? -22 : 0;
                  const textAnchor = rotate ? "end" : "middle";
                  return (
                    <text
                      key={`line-label-${item.rawLabel}-${index}`}
                      x={x}
                      y={tickLabelY}
                      textAnchor={textAnchor}
                      className="chart-svg-tick"
                      transform={rotate ? `rotate(${rotate} ${x} ${tickLabelY})` : undefined}
                    >
                      {tickLabel}
                    </text>
                  );
                })}
                {xAxisLabel ? (
                  <text x={plotLeft + plotWidth / 2} y={axisLabelY} textAnchor="middle" className="chart-svg-axis-title">
                    {xAxisLabel}
                  </text>
                ) : null}
              </svg>
            </div>
          </div>
          {secondaryAxis ? (
            <div className="chart-y-axis">
              {secondaryYAxisLabel ? <div className="chart-axis-title chart-axis-title-right">{secondaryYAxisLabel}</div> : null}
              {[...secondaryAxis.ticks].reverse().map((tick) => (
                <span className="chart-y-tick" key={`secondary-${tick}`}>{formatAxisValue(tick, decimalPlaces)}</span>
              ))}
            </div>
          ) : null}
        </div>
        {(primarySeries.length > 1 || secondarySeries.length > 0) ? renderAxisLegend([
          ...primarySeries.map((series) => ({ label: series.label, value: 0, rawLabel: series.rawSeries, rawSeries: series.rawSeries, series: series.label })),
          ...secondarySeries.map((series) => ({ label: `${series.label} (secondary)`, value: 0, rawLabel: series.rawSeries, rawSeries: series.rawSeries, series: `${series.label} (secondary)` }))
        ], compact, showLegend, false, undefined, openLinksInNewTab) : null}
      </div>
    );
  }

  if (normalizedChartType === "radar") {
    const cx = 200;
    const cy = 110;
    const radius = 84;
    const labels = categories.length ? categories : primaryItems.map((item) => ({ rawLabel: item.rawLabel || item.label, label: item.label }));
    return (
      <div className="radar-chart">
        {renderTitle(title)}
        <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", aspectRatio: "400 / 240" }}>
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <circle key={ratio} cx={cx} cy={cy} r={radius * ratio} fill="none" stroke="rgba(23,49,38,0.12)" />
          ))}
          {labels.map((point, index) => {
            const angle = (-Math.PI / 2) + (index / Math.max(labels.length, 1)) * Math.PI * 2;
            const labelX = cx + Math.cos(angle) * (radius + 22);
            const labelY = cy + Math.sin(angle) * (radius + 22);
            return <line key={point.rawLabel} x1={cx} y1={cy} x2={labelX} y2={labelY} stroke="rgba(23,49,38,0.12)" />;
          })}
          {primarySeries.map((series, seriesIndex) => {
            const points = labels.map((item, index) => {
              const angle = (-Math.PI / 2) + (index / Math.max(labels.length, 1)) * Math.PI * 2;
              const value = valueForCategory(items, item.rawLabel, series.rawSeries, "primary");
              const scaled = (value / max) * radius;
              return {
                item,
                x: cx + Math.cos(angle) * scaled,
                y: cy + Math.sin(angle) * scaled,
                labelX: cx + Math.cos(angle) * (radius + 22),
                labelY: cy + Math.sin(angle) * (radius + 22),
                datum: items.find((datum) =>
                  String(datum.rawLabel ?? datum.label ?? "") === item.rawLabel &&
                  String(datum.rawSeries || datum.series || "") === series.rawSeries &&
                  (datum.axis || "primary") === "primary"
                )
              };
            });
            const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
            return (
              <g key={`radar-${series.rawSeries || "default"}-${seriesIndex}`}>
                <polygon points={polyline} fill={getColor(seriesIndex)} fillOpacity="0.14" />
                <polyline points={polyline} stroke={getColor(seriesIndex)} fill="none" strokeWidth="3" />
                {points.map((point, index) => (
                  <g key={`${series.rawSeries}-${point.item.rawLabel}-${index}`}>
                    {(() => {
                      const href = point.datum ? (getDatumHref?.(point.datum) || "") : "";
                      const content = <circle cx={point.x} cy={point.y} r="5" fill={getColor(seriesIndex)} className={href ? "chart-linkable" : undefined} />;
                      return href ? (
                        <a href={href} target={anchorTarget} rel={anchorRel}>
                          {content}
                        </a>
                      ) : content;
                    })()}
                    {showLegend && seriesIndex === 0 ? <text x={point.labelX} y={point.labelY} textAnchor="middle">{cap(point.item.label, compact ? 8 : 12)}</text> : null}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
        {primarySeries.length > 1 ? renderAxisLegend(primarySeries.map((series) => ({ label: series.label, value: 0, rawLabel: series.rawSeries, rawSeries: series.rawSeries, series: series.label })), compact, showLegend, false, undefined, openLinksInNewTab) : null}
      </div>
    );
  }

  if (normalizedChartType === "radial-bar") {
    const cx = 110;
    const cy = 110;
    const baseRadius = 34;
    const ringGap = 18;
    return (
      <div className="chart-shell">
        {renderTitle(title)}
        <div className="donut-shell">
          <div className="donut">
              <svg viewBox="0 0 220 220" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", aspectRatio: "1 / 1" }} aria-hidden="true">
              {primaryItems.slice(0, 5).map((item, index) => {
                const radius = baseRadius + index * ringGap;
                const circumference = 2 * Math.PI * radius;
                const percent = Math.max(0, Math.min(1, item.value / max));
                const href = getDatumHref?.(item) || "";
                const content = (
                  <g>
                    <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(23,49,38,0.10)" strokeWidth="12" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill="none"
                      stroke={getColor(index)}
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={`${circumference * percent} ${circumference}`}
                      transform={`rotate(-90 ${cx} ${cy})`}
                      className={href ? "chart-linkable" : undefined}
                    />
                  </g>
                );
                return href ? (
                  <a key={item.label} href={href} target={anchorTarget} rel={anchorRel}>{content}</a>
                ) : <g key={item.label}>{content}</g>;
              })}
            </svg>
          </div>
        </div>
        {renderAxisLegend(primaryItems, compact, showLegend, showValues, getDatumHref, openLinksInNewTab)}
      </div>
    );
  }

  if (normalizedChartType === "progress-bar" || normalizedChartType === "bullet") {
    return (
      <div className="waterfall-chart">
        {renderTitle(title)}
        {primaryItems.map((item, index) => {
          const href = getDatumHref?.(item) || "";
          const percent = Math.max(0, Math.min(100, item.value));
          const secondaryMatch = secondaryItems.find((entry) => String(entry.rawLabel ?? entry.label ?? "") === String(item.rawLabel ?? item.label ?? ""));
          const targetPercent = Math.max(0, Math.min(100, secondaryMatch?.value ?? 80));
          const content = (
            <div className={`waterfall-row${href ? " chart-linkable" : ""}`} key={item.label}>
              {showLegend ? <div className="chart-label">{cap(item.label, compact ? 12 : 18)}</div> : null}
              <div className="waterfall-track" style={normalizedChartType === "bullet" ? { position: "relative", background: "linear-gradient(90deg, rgba(23,49,38,0.08) 0 45%, rgba(23,49,38,0.14) 45% 75%, rgba(23,49,38,0.22) 75% 100%)" } : undefined}>
                <div className="waterfall-bar" style={{ width: `${percent}%`, background: getColor(index) }} />
                {normalizedChartType === "bullet" ? (
                  <div style={{ position: "absolute", left: `${targetPercent}%`, top: "-4px", bottom: "-4px", width: "3px", background: "rgba(23,49,38,0.8)", borderRadius: "999px" }} />
                ) : null}
              </div>
              {showValues ? <div className="chart-value">{normalizedChartType === "progress-bar" || normalizedChartType === "bullet" ? `${formatAxisValue(percent, decimalPlaces)}%` : formatAxisValue(item.value, decimalPlaces)}</div> : null}
            </div>
          );
          return href ? (
            <a key={item.label} className="chart-link-reset chart-row-link" href={href} target={anchorTarget} rel={anchorRel}>
              {content}
            </a>
          ) : content;
        })}
      </div>
    );
  }

  if (normalizedChartType === "gauge") {
    const current = items[0]?.value || 0;
    const percent = Math.max(0, Math.min(100, max ? (current / max) * 100 : 0));
    return (
      <div className="gauge-chart">
        {renderTitle(title)}
        <div className="gauge-track">
          <div className="gauge-fill" style={{ transform: `rotate(${(percent / 100) * 180}deg)` }} />
          <div className="gauge-center">
            {showValues ? <strong>{formatAxisValue(current, decimalPlaces)}</strong> : null}
            {showLegend ? <span>{cap(items[0]?.label || "Current", 18)}</span> : null}
          </div>
        </div>
      </div>
    );
  }

  if (normalizedChartType === "waterfall") {
    let runningTotal = 0;
    const points = items.map((item) => {
      const start = runningTotal;
      runningTotal += item.value;
      return { ...item, start, end: runningTotal };
    });
    const maxTotal = Math.max(...points.map((item) => item.end), 1);
    return (
      <div className="waterfall-chart">
        {renderTitle(title)}
        {points.map((item, index) => {
          const startPercent = (item.start / maxTotal) * 100;
          const widthPercent = Math.max(8, (item.value / maxTotal) * 100);
          const href = getDatumHref?.(item) || "";
          const content = (
            <div className={`waterfall-row${href ? " chart-linkable" : ""}`} key={item.label}>
              {showLegend ? <div className="chart-label">{cap(item.label, compact ? 12 : 18)}</div> : null}
              <div className="waterfall-track">
                <div className="waterfall-bar" style={{ marginLeft: `${startPercent}%`, width: `${widthPercent}%`, background: getColor(index) }} />
              </div>
              {showValues ? <div className="chart-value">{formatAxisValue(item.value, decimalPlaces)}</div> : null}
            </div>
          );
          return href ? (
            <a key={item.label} className="chart-link-reset chart-row-link" href={href} target={anchorTarget} rel={anchorRel}>
              {content}
            </a>
          ) : content;
        })}
      </div>
    );
  }

  if (normalizedChartType === "stacked-bar") {
    return (
      <div className="chart-shell">
        {renderTitle(title)}
        {axisDriven && (xAxisLabel || yAxisLabel) ? (
          <div className="chart-axis-labels horizontal-axis-labels">
            {yAxisLabel ? <span className="chart-axis-label">{yAxisLabel}</span> : <span />}
            {xAxisLabel ? <span className="chart-axis-label">{xAxisLabel}</span> : null}
          </div>
        ) : null}
        <div className="stacked-track">
          {items.map((item, index) => {
            const href = getDatumHref?.(item) || "";
            const content = (
              <div
                className={`stacked-segment${href ? " chart-linkable" : ""}`}
                key={item.label}
                style={{ width: `${(item.value / total) * 100}%`, background: getColor(index) }}
              />
            );
            return href ? (
              <a key={item.label} className="chart-link-reset stacked-segment-link" href={href} target={anchorTarget} rel={anchorRel}>
                {content}
              </a>
            ) : content;
          })}
        </div>
        {shouldRenderLegendStrip(normalizedChartType, compact) ? renderAxisLegend(items, compact, showLegend, showValues, getDatumHref, openLinksInNewTab) : null}
      </div>
    );
  }

  if (normalizedChartType === "funnel") {
    return (
      <div className="funnel-chart">
        {renderTitle(title)}
        {items.map((item, index) => {
          const href = getDatumHref?.(item) || "";
          const content = (
            <div
              className={`funnel-step${href ? " chart-linkable" : ""}`}
              key={item.label}
              style={{
                width: `${Math.max(34, (item.value / max) * 100)}%`,
                background: threeDimensional
                  ? `linear-gradient(135deg, ${getColor(index)}, rgba(23,49,38,0.34))`
                  : getColor(index),
                boxShadow: threeDimensional ? "0 10px 18px rgba(23,49,38,0.14)" : undefined
              }}
            >
              {cap(item.label, compact ? 12 : 18)}{showValues ? ` · ${formatAxisValue(item.value, decimalPlaces)}` : ""}
            </div>
          );
          return href ? (
            <a key={item.label} className="chart-link-reset chart-row-link" href={href} target={anchorTarget} rel={anchorRel}>
              {content}
            </a>
          ) : content;
        })}
      </div>
    );
  }

  if (normalizedChartType === "heatmap") {
    return (
      <div className="heat-grid">
        {renderTitle(title)}
        {items.map((item) => {
          const href = getDatumHref?.(item) || "";
          const content = (
            <div
              className={`heat-cell${href ? " chart-linkable" : ""}`}
              key={item.label}
              style={{ background: `rgba(13, 124, 102, ${0.22 + (item.value / max) * 0.68})` }}
            >
              {showValues ? <strong>{formatAxisValue(item.value, decimalPlaces)}</strong> : null}
              {showLegend ? <span>{cap(item.label, compact ? 10 : 16)}</span> : null}
            </div>
          );
          return href ? (
            <a key={item.label} className="chart-link-reset" href={href} target={anchorTarget} rel={anchorRel}>
              {content}
            </a>
          ) : content;
        })}
      </div>
    );
  }

  if (normalizedChartType === "scatter") {
    const xNumbers = items.map((item, index) => chartLabelNumericValue(String(item.rawLabel ?? item.label ?? ""), index));
    const xMin = Math.min(...xNumbers);
    const xMax = Math.max(...xNumbers);
    const xRange = Math.max(1, xMax - xMin);
    const { ticks, axisMax } = axisMaxFor(items.map((item) => item.value), compact);
    const reversedTicks = [...ticks].reverse();
    const yAxisWidth = axisTickTextWidth(ticks, decimalPlaces, compact);
    const axisLayoutColumns = `${yAxisLabel ? "auto " : ""}${yAxisWidth}px minmax(0, 1fr)`;
    const points = items.map((item, index) => {
      const rawX = chartLabelNumericValue(String(item.rawLabel ?? item.label ?? ""), index);
      const x = items.length === 1 ? 200 : 30 + ((rawX - xMin) / xRange) * 340;
      const y = 190 - (item.value / axisMax) * 150;
      const sizeMatch = secondaryItems.find((entry) =>
        String(entry.rawLabel ?? entry.label ?? "") === String(item.rawLabel ?? item.label ?? "")
        && String(entry.rawSeries || entry.series || "") === String(item.rawSeries || item.series || "")
      );
      const sizeSource = bubbleChart ? (sizeMatch?.value ?? item.value) : item.value;
      const radius = bubbleChart
        ? Math.max(8, Math.min(26, 8 + (sizeSource / Math.max(...secondaryItems.map((entry) => entry.value), ...items.map((entry) => entry.value), 1)) * 18))
        : 7;
      return { item, x, y, r: radius };
    });
    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-chart-layout" style={{ gridTemplateColumns: axisLayoutColumns }}>
          {yAxisLabel ? <div className="chart-axis-title chart-axis-title-vertical">{yAxisLabel}</div> : null}
          <div className="chart-y-axis">
            {reversedTicks.map((tick) => (
              <span className="chart-y-tick" key={tick}>{formatAxisValue(tick, decimalPlaces)}</span>
            ))}
          </div>
          <div className="chart-plot-column">
            <div className="line-chart axis-chart">
              <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", aspectRatio: "400 / 220" }}>
                {ticks.map((tick) => {
                  const y = 190 - (tick / axisMax) * 150;
                  return <line key={`scatter-${tick}`} x1="24" y1={y} x2="380" y2={y} className="chart-grid-svg-line" />;
                })}
                <line x1="24" y1="16" x2="24" y2="196" className="chart-axis-svg-line" />
                <line x1="24" y1="196" x2="380" y2="196" className="chart-axis-svg-line" />
                {points.map((point, index) => {
                  const href = getDatumHref?.(point.item) || "";
                  const content = (
                    <g>
                      {threeDimensional ? (
                        <circle
                          cx={point.x + 4}
                          cy={point.y + 5}
                          r={point.r}
                          fill="rgba(23,49,38,0.16)"
                        />
                      ) : null}
                      <circle
                        key={point.item.label}
                        cx={point.x}
                        cy={point.y}
                        r={point.r}
                        fill={getColor(index)}
                        fillOpacity={bubbleChart ? 0.68 : 1}
                        className={href ? "chart-linkable" : undefined}
                      />
                    </g>
                  );
                  return href ? (
                    <a key={point.item.label} href={href} target={anchorTarget} rel={anchorRel}>
                      {content}
                    </a>
                  ) : content;
                })}
              </svg>
            </div>
            <div className="chart-x-axis-labels" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item, index) => (
                <span className="chart-x-tick" key={`${item.label}-${index}`}>
                  {formatCategoryTickLabel(item.label || item.rawLabel || "")}
                </span>
              ))}
            </div>
            {xAxisLabel ? <div className="chart-axis-title chart-axis-title-bottom">{xAxisLabel}</div> : null}
          </div>
        </div>
        {renderAxisLegend(items, compact, showLegend, showValues, getDatumHref, openLinksInNewTab)}
      </div>
    );
  }

  return (
    <div className="chart-bars">
      {renderTitle(title)}
      {axisDriven && (xAxisLabel || yAxisLabel) ? (
        <div className="chart-axis-labels horizontal-axis-labels">
          {yAxisLabel ? <span className="chart-axis-label">{yAxisLabel}</span> : <span />}
          {xAxisLabel ? <span className="chart-axis-label">{xAxisLabel}</span> : null}
        </div>
      ) : null}
      {items.map((item, index) => {
        const href = getDatumHref?.(item) || "";
        const content = (
          <div className={`chart-row${href ? " chart-linkable" : ""}`} key={item.label}>
            {showLegend ? <div className="chart-label">{cap(item.label, compact ? 12 : 18)}</div> : null}
            <div className="chart-track">
              <div className="chart-fill" style={{ width: `${Math.max(6, (item.value / max) * 100)}%`, background: `linear-gradient(90deg, ${getColor(index)}, ${getColor(index)}dd)` }} />
            </div>
            {showValues ? <div className="chart-value">{formatAxisValue(item.value, decimalPlaces)}</div> : null}
          </div>
        );
        return href ? (
          <a key={item.label} className="chart-link-reset chart-row-link" href={href} target={anchorTarget} rel={anchorRel}>
            {content}
          </a>
        ) : content;
      })}
    </div>
  );
}
