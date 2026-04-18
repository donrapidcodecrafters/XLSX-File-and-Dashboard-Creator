import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  const [activeTabId, setActiveTabId] = useState(dashboard.tabs[0]?.id || "");

  useEffect(() => {
    setRuntimeFilters(defaults);
  }, [defaults]);

  useEffect(() => {
    setActiveTabId((current) => dashboard.tabs.some((tab) => tab.id === current) ? current : (dashboard.tabs[0]?.id || ""));
  }, [dashboard.id, dashboard.tabs]);

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

  const tabs = result?.tabs || dashboard.tabs.map((tab) => ({ id: tab.id, name: tab.name, widgets: [] }));
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  return (
    <section className="surface stack">
      <div className="hero">
        <div>
          <span className="badge brand">Dashboard</span>
          <h1>{dashboard.name}</h1>
          <p>{dashboard.description || "Full-screen dashboard view with live filters, summaries, and linked reports."}</p>
        </div>
        <div className="stack-compact reader-actions">
          <div className="link-toolbar">
            <button className="ghost-button" onClick={() => window.history.back()}>Back</button>
            <Link className="ghost-button" to="/viewer">Home</Link>
            <Link className="ghost-button" to={`/studio/${dashboard.id}`}>Open in building area</Link>
          </div>
          <LinkToolbar type="dashboard" id={dashboard.id} />
        </div>
      </div>

      {dashboard.runtimeFilters.length ? (
        <div className="card">
          <div className="card-head">
            <strong>Filters</strong>
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

      {tabs.length ? (
        <div className="dashboard-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`dashboard-tab-button ${tab.id === activeTab?.id ? "active" : ""}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.name}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab ? (
        <div className="card">
          <div className="card-head">
            <strong>{activeTab.name}</strong>
            <span className="micro">{activeTab.widgets.length || 0} cards</span>
          </div>
          <div className="widget-grid">
            {activeTab.widgets.map((widget) => (
              <article className="widget-card" key={widget.widgetId}>
                <div className="widget-head">
                  <strong>{widget.report.name}</strong>
                  <Link to={`/report/${widget.report.id}`} className="widget-link">Open report</Link>
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
      ) : null}
    </section>
  );
}
