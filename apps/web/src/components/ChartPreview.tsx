import type { ChartDatum, ChartOrientation, ChartType } from "@studio/shared";

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
  compact?: boolean;
  showLegend?: boolean;
  showValues?: boolean;
}

function cap(value: string, max = 16) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getColor(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length];
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
  if (chartType === "line-bar") return "line";
  if (chartType === "spline") return "line";
  if (chartType === "area-spline" || chartType === "streamgraph") return "area";
  if (chartType === "radial-bar") return "gauge";
  if (chartType === "variwide-bar") return orientation === "horizontal" ? "bar" : "column";
  if (chartType === "progress-bar" || chartType === "bullet") return "bar";
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

function xLabelStep(length: number, compact: boolean) {
  const target = compact ? 4 : 8;
  return Math.max(1, Math.ceil(length / target));
}

function xTickLabel(label: string, index: number, length: number, compact: boolean) {
  const step = xLabelStep(length, compact);
  return index % step === 0 || index === length - 1 ? cap(label, compact ? 10 : 16) : "";
}

function axisMaxFor(values: number[], compact: boolean) {
  const ticks = buildAxisTicks(Math.max(...values, 1), compact ? 3 : 4);
  return {
    ticks,
    axisMax: ticks[ticks.length - 1] || 1
  };
}

function renderAxisLegend(
  items: ChartDatum[],
  compact: boolean,
  showLegend: boolean,
  showValues: boolean
) {
  if (!showLegend) return null;
  return (
    <div className="badge-row">
      {items.map((item, index) => (
        <span className="badge" key={item.label}>
          <span className="badge-dot" style={{ background: getColor(index) }} />
          {cap(item.label, compact ? 12 : 18)}{showValues ? ` · ${item.value}` : ""}
        </span>
      ))}
    </div>
  );
}

export function ChartPreview({
  chartType,
  data,
  chartOrientation = "vertical",
  title = "",
  decimalPlaces = 2,
  xAxisLabel = "",
  yAxisLabel = "",
  compact = false,
  showLegend = true,
  showValues = true
}: ChartPreviewProps) {
  if (!data.length) {
    return <div className="chart-empty">No chart data available.</div>;
  }

  const items = compact ? data.slice(0, 6) : data;
  const max = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const normalizedChartType = normalizeChartType(chartType, chartOrientation);
  const orientation = chartType === "horizontal-bar" || chartType === "horizontal-stacked-bar"
    ? "horizontal"
    : (normalizedChartType === "column" || normalizedChartType === "stacked-column" ? "vertical" : chartOrientation);
  const axisDriven = ["bar", "column", "stacked-bar", "stacked-column", "line", "area", "waterfall", "scatter"].includes(normalizedChartType);

  if (normalizedChartType === "donut" || normalizedChartType === "pie") {
    let offset = 0;
    const stops = items
      .map((item, index) => {
        const start = (offset / total) * 360;
        offset += item.value;
        const end = (offset / total) * 360;
        return `${getColor(index)} ${start}deg ${end}deg`;
      })
      .join(", ");

    return (
      <div className="chart-shell">
        {renderTitle(title)}
        <div className="donut-shell">
          <div className={`donut ${normalizedChartType === "pie" ? "pie-chart" : ""}`} style={{ background: `conic-gradient(${stops})` }}>
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
        {renderAxisLegend(items, compact, showLegend, showValues)}
      </div>
    );
  }

  if (normalizedChartType === "column" || normalizedChartType === "stacked-column" || ((normalizedChartType === "bar" || normalizedChartType === "stacked-bar") && orientation === "vertical")) {
    const { ticks, axisMax } = axisMaxFor(items.map((item) => item.value), compact);
    const reversedTicks = [...ticks].reverse();
    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-chart-layout">
          {yAxisLabel ? <div className="chart-axis-title chart-axis-title-vertical">{yAxisLabel}</div> : null}
          <div className="chart-y-axis">
            {reversedTicks.map((tick) => (
              <span className="chart-y-tick" key={tick}>{formatAxisValue(tick, decimalPlaces)}</span>
            ))}
          </div>
          <div className="chart-plot-column">
            <div className="chart-plot-surface">
              {reversedTicks.map((tick) => {
                const offset = axisMax === 0 ? 100 : ((axisMax - tick) / axisMax) * 100;
                return <span className="chart-grid-line" key={`grid-${tick}`} style={{ top: `${offset}%` }} />;
              })}
              <div className="vertical-chart-bars axis-aware-bars">
                {items.map((item, index) => {
                  const height = Math.max(18, (item.value / axisMax) * 160);
                  return (
                    <div className={normalizedChartType === "stacked-column" || normalizedChartType === "stacked-bar" ? "stacked-column" : "vertical-bar"} key={item.label}>
                      {showValues ? <div className="micro">{formatAxisValue(item.value, decimalPlaces)}</div> : null}
                      {normalizedChartType === "stacked-column" || normalizedChartType === "stacked-bar" ? (
                        <div className="stacked-column-bar" style={{ height }}>
                          <div className="stacked-segment" style={{ height: "100%", background: getColor(index) }} />
                        </div>
                      ) : (
                        <div className="vertical-bar-column" style={{ height, background: `linear-gradient(180deg, ${getColor(index)}, ${getColor(index)}cc)` }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="chart-x-axis-labels" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item, index) => (
                <span className="chart-x-tick" key={`${item.label}-${index}`}>
                  {xTickLabel(item.label, index, items.length, compact)}
                </span>
              ))}
            </div>
            {xAxisLabel ? <div className="chart-axis-title chart-axis-title-bottom">{xAxisLabel}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  if (normalizedChartType === "line" || normalizedChartType === "area") {
    const { ticks, axisMax } = axisMaxFor(items.map((item) => item.value), compact);
    const reversedTicks = [...ticks].reverse();
    const points = items.map((item, index) => {
      const x = items.length === 1 ? 200 : 20 + index * (360 / (items.length - 1));
      const y = 200 - (item.value / axisMax) * 160;
      return { x, y, item };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const areaPoints = `20,200 ${polyline} 380,200`;

    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-chart-layout">
          {yAxisLabel ? <div className="chart-axis-title chart-axis-title-vertical">{yAxisLabel}</div> : null}
          <div className="chart-y-axis">
            {reversedTicks.map((tick) => (
              <span className="chart-y-tick" key={tick}>{formatAxisValue(tick, decimalPlaces)}</span>
            ))}
          </div>
          <div className="chart-plot-column">
            <div className={normalizedChartType === "area" ? "area-chart axis-chart" : "line-chart axis-chart"}>
              <svg viewBox="0 0 400 220" preserveAspectRatio="none">
                {ticks.map((tick) => {
                  const y = 200 - (tick / axisMax) * 160;
                  return <line key={`line-${tick}`} x1="20" y1={y} x2="380" y2={y} className="chart-grid-svg-line" />;
                })}
                <line x1="20" y1="20" x2="20" y2="200" className="chart-axis-svg-line" />
                <line x1="20" y1="200" x2="380" y2="200" className="chart-axis-svg-line" />
                {normalizedChartType === "area" ? <polygon points={areaPoints} /> : null}
                <polyline points={polyline} />
                {points.map((point, index) => (
                  <circle key={`${point.item.label}-${index}`} cx={point.x} cy={point.y} r="5" fill={getColor(index)} />
                ))}
              </svg>
            </div>
            <div className="chart-x-axis-labels" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item, index) => (
                <span className="chart-x-tick" key={`${item.label}-${index}`}>
                  {xTickLabel(item.label, index, items.length, compact)}
                </span>
              ))}
            </div>
            {xAxisLabel ? <div className="chart-axis-title chart-axis-title-bottom">{xAxisLabel}</div> : null}
          </div>
        </div>
        {renderAxisLegend(items, compact, showLegend, showValues)}
      </div>
    );
  }

  if (normalizedChartType === "radar") {
    const cx = 200;
    const cy = 110;
    const radius = 84;
    const points = items.map((item, index) => {
      const angle = (-Math.PI / 2) + (index / items.length) * Math.PI * 2;
      const scaled = (item.value / max) * radius;
      return {
        item,
        x: cx + Math.cos(angle) * scaled,
        y: cy + Math.sin(angle) * scaled,
        labelX: cx + Math.cos(angle) * (radius + 22),
        labelY: cy + Math.sin(angle) * (radius + 22)
      };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    return (
      <div className="radar-chart">
        {renderTitle(title)}
        <svg viewBox="0 0 400 240" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <circle key={ratio} cx={cx} cy={cy} r={radius * ratio} fill="none" stroke="rgba(23,49,38,0.12)" />
          ))}
          {points.map((point) => (
            <line key={point.item.label} x1={cx} y1={cy} x2={point.labelX} y2={point.labelY} stroke="rgba(23,49,38,0.12)" />
          ))}
          <polygon points={polyline} />
          <polyline points={polyline} />
          {points.map((point, index) => (
            <g key={`${point.item.label}-${index}`}>
              <circle cx={point.x} cy={point.y} r="5" fill={getColor(index)} />
              {showLegend ? <text x={point.labelX} y={point.labelY} textAnchor="middle">{cap(point.item.label, compact ? 8 : 12)}</text> : null}
            </g>
          ))}
        </svg>
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
          return (
            <div className="waterfall-row" key={item.label}>
              {showLegend ? <div className="chart-label">{cap(item.label, compact ? 12 : 18)}</div> : null}
              <div className="waterfall-track">
                <div className="waterfall-bar" style={{ marginLeft: `${startPercent}%`, width: `${widthPercent}%`, background: getColor(index) }} />
              </div>
              {showValues ? <div className="chart-value">{formatAxisValue(item.value, decimalPlaces)}</div> : null}
            </div>
          );
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
          {items.map((item, index) => (
            <div
              className="stacked-segment"
              key={item.label}
              style={{ width: `${(item.value / total) * 100}%`, background: getColor(index) }}
            />
          ))}
        </div>
        {renderAxisLegend(items, compact, showLegend, showValues)}
      </div>
    );
  }

  if (normalizedChartType === "funnel") {
    return (
      <div className="funnel-chart">
        {renderTitle(title)}
        {items.map((item, index) => (
          <div
            className="funnel-step"
            key={item.label}
            style={{ width: `${Math.max(34, (item.value / max) * 100)}%`, background: getColor(index) }}
          >
            {cap(item.label, compact ? 12 : 18)}{showValues ? ` · ${formatAxisValue(item.value, decimalPlaces)}` : ""}
          </div>
        ))}
      </div>
    );
  }

  if (normalizedChartType === "heatmap") {
    return (
      <div className="heat-grid">
        {renderTitle(title)}
        {items.map((item) => (
          <div
            className="heat-cell"
            key={item.label}
            style={{ background: `rgba(13, 124, 102, ${0.22 + (item.value / max) * 0.68})` }}
          >
            {showValues ? <strong>{formatAxisValue(item.value, decimalPlaces)}</strong> : null}
            {showLegend ? <span>{cap(item.label, compact ? 10 : 16)}</span> : null}
          </div>
        ))}
      </div>
    );
  }

  if (normalizedChartType === "scatter") {
    const { ticks, axisMax } = axisMaxFor(items.map((item) => item.value), compact);
    const reversedTicks = [...ticks].reverse();
    const points = items.map((item, index) => {
      const x = items.length === 1 ? 200 : 30 + index * (340 / Math.max(1, items.length - 1));
      const y = 190 - (item.value / axisMax) * 150;
      return { item, x, y, r: chartType === "bubble" ? Math.max(8, (item.value / axisMax) * 22) : 7 };
    });
    return (
      <div className="axis-chart-shell">
        {renderTitle(title)}
        <div className="axis-chart-layout">
          {yAxisLabel ? <div className="chart-axis-title chart-axis-title-vertical">{yAxisLabel}</div> : null}
          <div className="chart-y-axis">
            {reversedTicks.map((tick) => (
              <span className="chart-y-tick" key={tick}>{formatAxisValue(tick, decimalPlaces)}</span>
            ))}
          </div>
          <div className="chart-plot-column">
            <div className="line-chart axis-chart">
              <svg viewBox="0 0 400 220" preserveAspectRatio="none">
                {ticks.map((tick) => {
                  const y = 190 - (tick / axisMax) * 150;
                  return <line key={`scatter-${tick}`} x1="24" y1={y} x2="380" y2={y} className="chart-grid-svg-line" />;
                })}
                <line x1="24" y1="16" x2="24" y2="196" className="chart-axis-svg-line" />
                <line x1="24" y1="196" x2="380" y2="196" className="chart-axis-svg-line" />
                {points.map((point, index) => (
                  <circle key={point.item.label} cx={point.x} cy={point.y} r={point.r} fill={getColor(index)} fillOpacity={chartType === "bubble" ? 0.75 : 1} />
                ))}
              </svg>
            </div>
            <div className="chart-x-axis-labels" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item, index) => (
                <span className="chart-x-tick" key={`${item.label}-${index}`}>
                  {xTickLabel(item.label, index, items.length, compact)}
                </span>
              ))}
            </div>
            {xAxisLabel ? <div className="chart-axis-title chart-axis-title-bottom">{xAxisLabel}</div> : null}
          </div>
        </div>
        {renderAxisLegend(items, compact, showLegend, showValues)}
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
      {items.map((item, index) => (
        <div className="chart-row" key={item.label}>
          {showLegend ? <div className="chart-label">{cap(item.label, compact ? 12 : 18)}</div> : null}
          <div className="chart-track">
            <div className="chart-fill" style={{ width: `${Math.max(6, (item.value / max) * 100)}%`, background: `linear-gradient(90deg, ${getColor(index)}, ${getColor(index)}dd)` }} />
          </div>
          {showValues ? <div className="chart-value">{formatAxisValue(item.value, decimalPlaces)}</div> : null}
        </div>
      ))}
    </div>
  );
}
