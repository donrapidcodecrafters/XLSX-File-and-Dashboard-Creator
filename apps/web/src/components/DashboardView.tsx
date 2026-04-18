import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildDashboardFilters, type DashboardDefinition, type DashboardRunResult, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { fetchAllReportRows, fetchReportExportBundle, renderDashboard } from "../lib/api";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { exportDashboardWorkbook } from "../lib/workbookExport";

interface DashboardViewProps {
  dashboard: DashboardDefinition;
  tables?: TableDefinition[];
}

function resolveWidgetDisplayMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], reportMode: string) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  if (reportMode === "summary") return "summary";
  if (reportMode === "chart") return "chart";
  return "table";
}

function getFieldLabel(tables: TableDefinition[] | undefined, tableId: string, fieldId: string) {
  return tables?.find((table) => table.id === tableId)?.fields.find((field) => field.id === fieldId)?.label || fieldId;
}

export function DashboardView({ dashboard, tables }: DashboardViewProps) {
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>("");
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

  async function exportWorkbook() {
    if (!result) return;
    setExporting(true);
    setExportError("");
    try {
      const exportResultsByReportId = Object.fromEntries(
        await Promise.all(
          Array.from(new Set(result.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.report.id)))).map(async (reportId) => {
            const fallback = result.tabs.flatMap((tab) => tab.widgets).find((widget) => widget.report.id === reportId)?.result;
            const filters = buildDashboardFilters(dashboard, reportId, runtimeFilters).map((filter) => ({
              fieldId: filter.fieldId,
              operator: filter.operator,
              value: filter.value
            }));
            const exportResult = await fetchReportExportBundle(reportId, filters)
              .then((response) => response.result)
              .catch(async () => fallback
                ? {
                    ...fallback,
                    rows: await fetchAllReportRows(reportId, filters).catch(() => fallback.rows)
                  }
                : null);
            return [reportId, exportResult] as const;
          })
        )
      );
      await exportDashboardWorkbook(
        dashboard,
        result,
        Object.fromEntries(Object.entries(exportResultsByReportId).filter((entry): entry is [string, ReportRunResult] => Boolean(entry[1])))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard export failed.";
      setExportError(message);
      console.error(error);
    } finally {
      setExporting(false);
    }
  }

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
            <button className="ghost-button" onClick={() => { void exportWorkbook(); }} disabled={!result || exporting}>{exporting ? "Exporting…" : "Export xlsx"}</button>
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

      {exportError ? (
        <div className="sync-status sync-status-warn">
          <strong>Export failed</strong>
          <span>{exportError}</span>
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
            {activeTab.widgets.map((widget) => {
              return (
                <article className="widget-card" key={widget.widgetId}>
                <div className="widget-head">
                  <strong>{widget.report.name}</strong>
                  <Link to={`/report/${widget.report.id}`} className="widget-link">Open report</Link>
                </div>
                {widget.widget.showSummary ? (
                  <div className="widget-metrics">
                    {widget.result.summary.map((item) => (
                      <div key={item.label} className="mini-stat">
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {resolveWidgetDisplayMode(widget.widget, widget.report.view.mode) === "chart" ? (
                  <div className="mini-chart">
                    <ChartPreview
                      chartType={widget.report.view.chartType}
                      data={widget.result.chartData}
                      compact
                      showLegend={widget.report.view.chartShowLegend}
                      showValues={widget.report.view.chartShowValues}
                    />
                  </div>
                ) : null}
                {resolveWidgetDisplayMode(widget.widget, widget.report.view.mode) === "table" || widget.widget.showDetails ? (
                  <div className="table-shell compact-table-shell">
                    <table>
                      <thead>
                        <tr>
                          {widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => (
                            <th key={fieldId}>{getFieldLabel(tables, widget.report.sourceTableId, fieldId)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {widget.result.rows.slice(0, 8).map((row, index) => (
                          <tr key={index}>
                            {widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => (
                              <td key={fieldId}>{String(row[fieldId] ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                </article>
              );
            })}
            {loading ? <div className="empty">Rendering dashboard…</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
