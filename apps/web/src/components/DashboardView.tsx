import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildDashboardFilters, getReportFieldLabel, type DashboardDefinition, type DashboardRunResult, type ExportJobStatus, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { downloadExportJob, fetchExportJobStatus, renderDashboard, runReportPage, startDashboardExportJob } from "../lib/api";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { buildObjectUrl, getHostedContext } from "../lib/embed";

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

function getFieldLabel(tables: TableDefinition[] | undefined, report: DashboardRunResult["tabs"][number]["widgets"][number]["report"], fieldId: string) {
  const table = tables?.find((item) => item.id === report.sourceTableId);
  return table ? getReportFieldLabel(report, table, fieldId) : fieldId;
}

function getWidgetLayoutStyle(layout: { w: number; h: number }) {
  const width = Math.max(1, Math.min(12, Math.round(layout.w || 6)));
  const height = Math.max(2, Math.min(10, Math.round(layout.h || 4)));
  return {
    gridColumn: `span ${width}`,
    minHeight: `${height * 96}px`
  };
}

export function DashboardView({ dashboard, tables }: DashboardViewProps) {
  const hosted = getHostedContext();
  const fullScreenUrl = buildObjectUrl("dashboard", dashboard.id, { viewer: true });
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
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState("");
  const [widgetPages, setWidgetPages] = useState<Record<string, number>>({});
  const [widgetPageResults, setWidgetPageResults] = useState<Record<string, ReportRunResult>>({});
  const [widgetPageLoading, setWidgetPageLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setRuntimeFilters(defaults);
  }, [defaults]);

  useEffect(() => {
    setWidgetPages({});
    setWidgetPageResults({});
    setWidgetPageLoading({});
  }, [dashboard.id, JSON.stringify(runtimeFilters)]);

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

  useEffect(() => {
    if (!exportJob || exportJob.status === "complete" || exportJob.status === "failed") return;
    const handle = window.setInterval(() => {
      fetchExportJobStatus(exportJob.id)
        .then((response) => setExportJob(response.job))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [exportJob?.id, exportJob?.status]);

  useEffect(() => {
    if (!exportJob || exportJob.status !== "complete" || downloadedJobId === exportJob.id) return;
    downloadExportJob(exportJob.id);
    setDownloadedJobId(exportJob.id);
  }, [downloadedJobId, exportJob]);

  async function beginExport() {
    const response = await startDashboardExportJob({ dashboardId: dashboard.id, runtimeFilters });
    setExportJob(response.job);
    setDownloadedJobId("");
  }

  const tabs = result?.tabs || dashboard.tabs.map((tab) => ({ id: tab.id, name: tab.name, widgets: [] }));
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  async function changeWidgetPage(widget: DashboardRunResult["tabs"][number]["widgets"][number], page: number) {
    if (page < 1) return;
    setWidgetPageLoading((current) => ({ ...current, [widget.widgetId]: true }));
    try {
      const filters = buildDashboardFilters(dashboard, widget.report.id, runtimeFilters);
      const next = await runReportPage(widget.report.id, page, 100, filters);
      setWidgetPages((current) => ({ ...current, [widget.widgetId]: page }));
      setWidgetPageResults((current) => ({ ...current, [widget.widgetId]: next }));
    } finally {
      setWidgetPageLoading((current) => ({ ...current, [widget.widgetId]: false }));
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
            {hosted.embed ? (
              <button className="ghost-button" onClick={() => window.open(fullScreenUrl, "_blank", "noopener,noreferrer")}>Open full-screen</button>
            ) : (
              <>
                <button className="ghost-button" onClick={() => window.history.back()}>Back</button>
                <Link className="ghost-button" to="/viewer">Home</Link>
                <Link className="ghost-button" to={`/studio/${dashboard.id}`}>Open in building area</Link>
              </>
            )}
            <button className="ghost-button" onClick={() => { void beginExport(); }} disabled={!result || exportJob?.status === "queued" || exportJob?.status === "running"}>
              {exportJob?.status === "queued" || exportJob?.status === "running"
                ? `Exporting ${exportJob.progress}%`
                : "Download xlsx"}
            </button>
          </div>
          {hosted.embed ? null : <LinkToolbar type="dashboard" id={dashboard.id} />}
        </div>
      </div>

      {exportJob ? (
        <div className={`sync-status ${exportJob.status === "failed" ? "sync-status-warn" : exportJob.status === "complete" ? "sync-status-ok" : ""}`}>
          <strong>
            {exportJob.status === "complete"
              ? "Export ready"
              : exportJob.status === "failed"
                ? "Export failed"
                : `Exporting ${exportJob.progress}%`}
          </strong>
          <span>{exportJob.error || exportJob.message}</span>
          <div className="progress-meter" aria-hidden="true">
            <div className="progress-meter-fill" style={{ width: `${exportJob.progress}%` }} />
          </div>
        </div>
      ) : null}

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
          <div className="widget-grid dashboard-layout-grid">
            {activeTab.widgets.map((widget) => {
              const pagedResult = widgetPageResults[widget.widgetId] || widget.result;
              const currentPage = widgetPages[widget.widgetId] || pagedResult.page || 1;
              const totalPages = pagedResult.totalPages || 1;
              const pageLoading = widgetPageLoading[widget.widgetId];
              const summaryData = pagedResult.summary.length ? pagedResult.summary : widget.result.summary;
              const chartData = pagedResult.chartData.length ? pagedResult.chartData : widget.result.chartData;
              return (
                <article className="widget-card dashboard-layout-item" key={widget.widgetId} style={getWidgetLayoutStyle(widget.widget.layout)}>
                <div className="widget-head">
                  <strong>{widget.widget.title || widget.report.name}</strong>
                  <Link to={`/report/${widget.report.id}`} className="widget-link">Open report</Link>
                </div>
                {widget.widget.showSummary ? (
                  <div className="widget-metrics">
                    {summaryData.map((item) => (
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
                      data={chartData}
                      compact
                      showLegend={widget.report.view.chartShowLegend}
                      showValues={widget.report.view.chartShowValues}
                    />
                  </div>
                ) : null}
                {resolveWidgetDisplayMode(widget.widget, widget.report.view.mode) === "table" || widget.widget.showDetails ? (
                  <div className="table-shell compact-table-shell">
                    <div className="widget-table-toolbar">
                      <button className="ghost-button" disabled={currentPage <= 1 || pageLoading} onClick={() => { void changeWidgetPage(widget, currentPage - 1); }}>Previous</button>
                      <span className="micro">Page {currentPage} of {totalPages} · {pagedResult.totalRows || 0} rows</span>
                      <button className="ghost-button" disabled={!pagedResult.hasNextPage || pageLoading} onClick={() => { void changeWidgetPage(widget, currentPage + 1); }}>Next</button>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          {widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => (
                            <th key={fieldId}>{getFieldLabel(tables, widget.report, fieldId)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedResult.rows.map((row, index) => (
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
