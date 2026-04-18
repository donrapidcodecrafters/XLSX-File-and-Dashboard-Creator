import type { ChartDatum, ChartType } from "@studio/shared";

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
  compact?: boolean;
}

function cap(value: string, max = 16) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getColor(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export function ChartPreview({ chartType, data, compact = false }: ChartPreviewProps) {
  if (!data.length) {
    return <div className="chart-empty">No chart data available.</div>;
  }

  const items = compact ? data.slice(0, 6) : data;
  const max = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;

  if (chartType === "donut" || chartType === "pie") {
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
        <div className="donut-shell">
          <div className={`donut ${chartType === "pie" ? "pie-chart" : ""}`} style={{ background: `conic-gradient(${stops})` }}>
            {chartType === "donut" ? (
              <div className="donut-center">
                <div>
                  <strong>{total}</strong>
                  rows
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="badge-row">
          {items.map((item, index) => (
            <span className="badge" key={item.label}>
              <span className="badge-dot" style={{ background: getColor(index) }} />
              {cap(item.label, compact ? 12 : 18)} · {item.value}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (chartType === "column" || chartType === "stacked-column") {
    return (
      <div className={chartType === "stacked-column" ? "stacked-columns" : "vertical-chart"}>
        <div className="vertical-chart-bars">
          {items.map((item, index) => {
            const height = Math.max(18, (item.value / max) * 150);
            return (
              <div className={chartType === "stacked-column" ? "stacked-column" : "vertical-bar"} key={item.label}>
                <div className="micro">{item.value}</div>
                {chartType === "stacked-column" ? (
                  <div className="stacked-column-bar" style={{ height }}>
                    <div className="stacked-segment" style={{ height: "100%", background: getColor(index) }} />
                  </div>
                ) : (
                  <div className="vertical-bar-column" style={{ height, background: `linear-gradient(180deg, ${getColor(index)}, ${getColor(index)}cc)` }} />
                )}
                <div className="vertical-bar-label">{cap(item.label, compact ? 10 : 14)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (chartType === "line" || chartType === "area") {
    const points = items.map((item, index) => {
      const x = items.length === 1 ? 200 : 20 + index * (360 / (items.length - 1));
      const y = 200 - (item.value / max) * 160;
      return { x, y, item };
    });
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const areaPoints = `20,200 ${polyline} 380,200`;

    return (
      <div className={chartType === "area" ? "area-chart" : "line-chart"}>
        <svg viewBox="0 0 400 220" preserveAspectRatio="none">
          <line x1="20" y1="200" x2="380" y2="200" stroke="rgba(23, 49, 38, 0.15)" strokeWidth="2" />
          {chartType === "area" ? <polygon points={areaPoints} /> : null}
          <polyline points={polyline} />
          {points.map((point, index) => (
            <circle key={`${point.item.label}-${index}`} cx={point.x} cy={point.y} r="5" fill={getColor(index)} />
          ))}
        </svg>
        <div className="badge-row">
          {items.map((item, index) => (
            <span className="badge" key={item.label}>
              <span className="badge-dot" style={{ background: getColor(index) }} />
              {cap(item.label, compact ? 12 : 18)} · {item.value}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (chartType === "stacked-bar") {
    return (
      <div className="chart-shell">
        <div className="stacked-track">
          {items.map((item, index) => (
            <div
              className="stacked-segment"
              key={item.label}
              style={{ width: `${(item.value / total) * 100}%`, background: getColor(index) }}
            />
          ))}
        </div>
        <div className="badge-row">
          {items.map((item, index) => (
            <span className="badge" key={item.label}>
              <span className="badge-dot" style={{ background: getColor(index) }} />
              {cap(item.label, compact ? 12 : 18)} · {item.value}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (chartType === "funnel") {
    return (
      <div className="funnel-chart">
        {items.map((item, index) => (
          <div
            className="funnel-step"
            key={item.label}
            style={{ width: `${Math.max(34, (item.value / max) * 100)}%`, background: getColor(index) }}
          >
            {cap(item.label, compact ? 12 : 18)} · {item.value}
          </div>
        ))}
      </div>
    );
  }

  if (chartType === "heatmap") {
    return (
      <div className="heat-grid">
        {items.map((item) => (
          <div
            className="heat-cell"
            key={item.label}
            style={{ background: `rgba(13, 124, 102, ${0.22 + (item.value / max) * 0.68})` }}
          >
            <strong>{item.value}</strong>
            <span>{cap(item.label, compact ? 10 : 16)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="chart-bars">
      {items.map((item, index) => (
        <div className="chart-row" key={item.label}>
          <div className="chart-label">{cap(item.label, compact ? 12 : 18)}</div>
          <div className="chart-track">
            <div className="chart-fill" style={{ width: `${Math.max(6, (item.value / max) * 100)}%`, background: `linear-gradient(90deg, ${getColor(index)}, ${getColor(index)}dd)` }} />
          </div>
          <div className="chart-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
