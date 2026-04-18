import { useEffect, useMemo, useState } from "react";
import type { DashboardDefinition, DashboardRunResult } from "@studio/shared";
import { renderDashboard } from "../lib/api";
import { LinkToolbar } from "./LinkToolbar";

interface DashboardViewProps {
  dashboard: DashboardDefinition;
}

export function DashboardView({ dashboard }: DashboardViewProps) {
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        dashboard.runtimeFilters.map((filter) => [filter.id, filter.defaultValue || ""])
      ),
    [dashboard]
  );
  const [runtimeFilters, setRuntimeFilters] = useState<Record<string, string>>(defaults);
  const [result, setResult] = useState<DashboardRunResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRuntimeFilters(defaults);
  }, [defaults]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    renderDashboard(dashboard.id, runtimeFilters)
      .then((next) => {
        if (active) setResult(next);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dashboard.id, runtimeFilters]);

  return (
    <section className="surface stack">
      <div className="hero">
        <div>
          <span className="badge brand">Dashboard</span>
          <h1>{dashboard.name}</h1>
          <p>{dashboard.description || "Worker-backed dashboard render with direct links for every hosted object."}</p>
        </div>
        <LinkToolbar type="dashboard" id={dashboard.id} />
      </div>

      {dashboard.runtimeFilters.length ? (
        <div className="card">
          <div className="card-head">
            <strong>Runtime filters</strong>
            <span className="micro">Live dashboard controls</span>
          </div>
          <div className="filter-grid">
            {dashboard.runtimeFilters.map((filter) => (
              <label className="field" key={filter.id}>
                <span>{filter.label}</span>
                <input
                  value={runtimeFilters[filter.id] ?? ""}
                  onChange={(event) =>
                    setRuntimeFilters((current) => ({
                      ...current,
                      [filter.id]: event.target.value
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {(result?.tabs || dashboard.tabs).map((tab) => {
        const renderedTab = result?.tabs.find((item) => item.id === tab.id);
        return (
          <div className="card" key={tab.id}>
            <div className="card-head">
              <strong>{tab.name}</strong>
              <span className="micro">{renderedTab?.widgets.length || 0} widgets</span>
            </div>
            <div className="widget-grid">
              {(renderedTab?.widgets || []).map((widget) => (
                <article className="widget-card" key={widget.widgetId}>
                  <div className="widget-head">
                    <strong>{widget.report.name}</strong>
                    <a href={`#/report/${widget.report.id}`} className="widget-link">Open report</a>
                  </div>
                  <div className="widget-metrics">
                    {widget.result.summary.map((item) => (
                      <div key={item.label} className="mini-stat">
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mini-chart">
                    {widget.result.chartData.slice(0, 5).map((datum) => (
                      <div className="mini-bar" key={datum.label}>
                        <span>{datum.label}</span>
                        <div className="mini-bar-fill" style={{ width: `${Math.max(12, datum.value * 18)}px` }} />
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {loading ? <div className="empty">Rendering dashboard…</div> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
