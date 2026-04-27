import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { buildDashboardFilters, formatReportCellValue, getDashboardWidgetLayoutStyle, getDashboardWidgetPlacements, getReportFieldLabel, resolveActiveDashboardTabId, type DashboardDefinition, type DashboardRunResult, type ExportJobStatus, type RefreshJobStatus, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { createExportSaveTarget, downloadExportJob, fetchExportJobStatus, renderDashboard, runReportPage, startDashboardExportJob, type ExportSaveTarget } from "../lib/api";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { RefreshOverlay } from "./RefreshOverlay";
import { ResizableDataTable } from "./ResizableDataTable";
import { buildHostedRoute, buildObjectUrl, getHostedContext } from "../lib/embed";
import { buildDashboardExportDefinition } from "../lib/dashboardExport";
import { buildQuickbaseChartDatumUrl, buildQuickbaseRecordEditUrl, buildQuickbaseReportFilterTree, type QuickbaseTableLinkContext } from "../lib/quickbaseLinks";
import { getChartViewportBounds } from "./studioReportUtils";

interface DashboardViewProps {
  dashboard: DashboardDefinition;
  reportDefinitions?: Record<string, ReportDefinition>;
  tables?: TableDefinition[];
  getQuickbaseLinkContext?: (tableId: string) => QuickbaseTableLinkContext | null;
  refreshNonce?: number;
  onRefresh?: () => void;
  initialRuntimeFilters?: Record<string, string>;
  initialActiveTabId?: string;
  initialFocusedWidgetId?: string;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  savedViews?: Array<{
    id: string;
    name: string;
    runtimeFilters: Record<string, string>;
    activeTabId: string;
    focusedWidgetId: string;
    updatedAt: string;
  }>;
  onSaveView?: (view: {
    id: string;
    name: string;
    runtimeFilters: Record<string, string>;
    activeTabId: string;
    focusedWidgetId: string;
  }) => void;
  onDeleteView?: (viewId: string) => void;
  onStateChange?: (state: { runtimeFilters: Record<string, string>; activeTabId: string; focusedWidgetId: string }) => void;
  onRefreshJobDetected?: (job: RefreshJobStatus | null) => void;
  forceLive?: boolean;
  openLinksInNewTab?: boolean;
}

function resolveWidgetDisplayMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], reportMode: string) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  if (reportMode === "summary") return "summary";
  if (reportMode === "chart") return "chart";
  return "table";
}

function widgetShowsChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: DashboardRunResult["tabs"][number]["widgets"][number]["report"]) {
  const displayMode = resolveWidgetDisplayMode(widget, report.view.mode);
  return displayMode === "chart" || (displayMode === "table" && report.view.showChartInTable);
}

function widgetRenderMode(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: DashboardRunResult["tabs"][number]["widgets"][number]["report"]) {
  if (widget.displayMode !== "inherit") return widget.displayMode;
  return report.view.mode;
}

function formatFallbackFieldLabel(fieldId: string) {
  const trimmed = String(fieldId || "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return "";
  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFieldLabel(tables: TableDefinition[] | undefined, report: DashboardRunResult["tabs"][number]["widgets"][number]["report"], fieldId: string) {
  const table = tables?.find((item) => item.id === report.sourceTableId || item.quickbaseTableId === report.sourceTableId);
  const displayLabel = report.displayLabels?.fields?.[fieldId]?.trim();
  if (displayLabel) return displayLabel;
  if (table) {
    const tableLabel = getReportFieldLabel(report, table, fieldId);
    if (tableLabel && tableLabel !== fieldId) return tableLabel;
  }
  return formatFallbackFieldLabel(fieldId);
}

function getChartFieldId(report: DashboardRunResult["tabs"][number]["widgets"][number]["report"]) {
  return report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
}

function getChartAxisLabels(
  tables: TableDefinition[] | undefined,
  report: DashboardRunResult["tabs"][number]["widgets"][number]["report"]
) {
  const xFieldId = getChartFieldId(report);
  const primaryFieldLabel = report.view.chartValueFieldId
    ? getFieldLabel(tables, report, report.view.chartValueFieldId)
    : "";
  const secondaryFieldLabel = report.view.chartSecondaryValueFieldId
    ? getFieldLabel(tables, report, report.view.chartSecondaryValueFieldId)
    : "";
  return {
    xAxisLabel: report.view.chartXAxisLabel?.trim()
      || (xFieldId ? getFieldLabel(tables, report, xFieldId) : ""),
    yAxisLabel: report.view.chartYAxisLabel?.trim()
      || primaryFieldLabel
      || (report.view.chartAggregation === "count" ? "Rows" : ""),
    secondaryYAxisLabel: report.view.chartSecondaryYAxisLabel?.trim()
      || (report.view.chartUseSecondaryAxis
        ? (secondaryFieldLabel || (report.view.chartSecondaryAggregation === "count" ? "Rows" : ""))
        : "")
  };
}

function formatFreshnessTimestamp(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function runtimeFilterAppliesToReport(
  filter: DashboardDefinition["runtimeFilters"][number],
  reportId: string
) {
  return filter.mode === "global" || !filter.targetReportIds.length || filter.targetReportIds.includes(reportId);
}

function getDashboardCrossFilterOptions(
  dashboard: DashboardDefinition,
  report: DashboardRunResult["tabs"][number]["widgets"][number]["report"],
  chartData: DashboardRunResult["tabs"][number]["widgets"][number]["result"]["chartData"]
) {
  const labelFieldId = report.view.chartFieldId || report.groups[0]?.fieldId || "";
  const seriesFieldId = report.view.chartSeriesFieldId || "";
  const options: Array<{ filterId: string; filterLabel: string; value: string }> = [];
  const seen = new Set<string>();

  function pushOptions(fieldId: string, values: string[]) {
    if (!fieldId) return;
    const matchingFilters = dashboard.runtimeFilters.filter((filter) => filter.fieldId === fieldId && runtimeFilterAppliesToReport(filter, report.id));
    matchingFilters.forEach((filter) => {
      values
        .filter(Boolean)
        .slice(0, 6)
        .forEach((value) => {
          const key = `${filter.id}:${value}`;
          if (seen.has(key)) return;
          seen.add(key);
          options.push({
            filterId: filter.id,
            filterLabel: filter.label,
            value
          });
        });
    });
  }

  pushOptions(
    labelFieldId,
    Array.from(new Set(chartData.map((datum) => String(datum.rawLabel ?? datum.label ?? "").trim())))
  );
  pushOptions(
    seriesFieldId,
    Array.from(new Set(chartData.map((datum) => String(datum.rawSeries ?? datum.series ?? "").trim())))
  );

  return options;
}

function buildExportFilename(name: string) {
  const safe = String(name || "dashboard")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  return `${safe || "dashboard"} ${timestamp}.xlsx`;
}

export function DashboardView({
  dashboard,
  reportDefinitions,
  tables,
  getQuickbaseLinkContext,
  refreshNonce = 0,
  onRefresh,
  initialRuntimeFilters,
  initialActiveTabId = "",
  initialFocusedWidgetId = "",
  isFavorite = false,
  onToggleFavorite,
  savedViews = [],
  onSaveView,
  onDeleteView,
  onStateChange,
  onRefreshJobDetected,
  forceLive = false,
  openLinksInNewTab = false
}: DashboardViewProps) {
  const hosted = getHostedContext();
  const fullScreenUrl = buildObjectUrl("dashboard", dashboard.id, { viewer: true });
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        dashboard.runtimeFilters.map((filter) => [filter.id, filter.defaultValue || ""])
      ),
    [dashboard]
  );
  const mergedDefaults = useMemo(
    () => ({ ...defaults, ...(initialRuntimeFilters || {}) }),
    [defaults, initialRuntimeFilters]
  );
  const [runtimeFilters, setRuntimeFilters] = useState<Record<string, string>>(mergedDefaults);
  const [tabResults, setTabResults] = useState<Record<string, DashboardRunResult["tabs"][number]>>({});
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [tabErrors, setTabErrors] = useState<Record<string, string>>({});
  const [activeTabId, setActiveTabId] = useState(initialActiveTabId || dashboard.tabs[0]?.id || "");
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState("");
  const [pendingSaveOnReady, setPendingSaveOnReady] = useState(false);
  const autoExportStartedRef = useRef(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(true);
  const [widgetPages, setWidgetPages] = useState<Record<string, number>>({});
  const [widgetPageResults, setWidgetPageResults] = useState<Record<string, ReportRunResult>>({});
  const [widgetPageLoading, setWidgetPageLoading] = useState<Record<string, boolean>>({});
  const [widgetChartHeights, setWidgetChartHeights] = useState<Record<string, number>>({});
  const [focusedWidgetId, setFocusedWidgetId] = useState(initialFocusedWidgetId);
  const [tabReloadNonce, setTabReloadNonce] = useState(0);
  const skipStateBroadcastRef = useRef(true);
  const tabResultsRef = useRef(tabResults);
  const tabLoadingRef = useRef(tabLoading);
  const onRefreshJobDetectedRef = useRef(onRefreshJobDetected);
  const tabRequestSequenceRef = useRef<Record<string, number>>({});
  const chartMeasureObserversRef = useRef<Record<string, ResizeObserver>>({});
  const resolvedActiveTabId = resolveActiveDashboardTabId(dashboard, activeTabId);
  const activeTabResult = tabResults[resolvedActiveTabId] || null;
  const activeTabLayout = useMemo(() => {
    const tab = dashboard.tabs.find((item) => item.id === resolvedActiveTabId);
    return new Map((tab ? getDashboardWidgetPlacements(tab) : []).map((placement) => [placement.widgetId, placement]));
  }, [dashboard.tabs, resolvedActiveTabId]);
  const loading = Boolean(tabLoading[resolvedActiveTabId]);
  const shouldPreloadRemainingTabs = false;
  const runtimeFiltersKey = useMemo(() => JSON.stringify(runtimeFilters), [runtimeFilters]);
  const exportDashboard = useMemo(
    () => buildDashboardExportDefinition(dashboard, reportDefinitions),
    [dashboard, reportDefinitions]
  );

  const bindChartMeasureRef = useCallback((widgetId: string) => (node: HTMLDivElement | null) => {
    const existingObserver = chartMeasureObserversRef.current[widgetId];
    if (existingObserver) {
      existingObserver.disconnect();
      delete chartMeasureObserversRef.current[widgetId];
    }
    if (!node) return;
    const updateHeight = () => {
      const nextHeight = Math.max(0, Math.floor(node.clientHeight));
      setWidgetChartHeights((current) => current[widgetId] === nextHeight ? current : { ...current, [widgetId]: nextHeight });
    };
    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);
    chartMeasureObserversRef.current[widgetId] = observer;
  }, []);

  useEffect(() => () => {
    Object.values(chartMeasureObserversRef.current).forEach((observer) => observer.disconnect());
    chartMeasureObserversRef.current = {};
  }, []);

  useEffect(() => {
    skipStateBroadcastRef.current = true;
  }, [dashboard.id]);

  useEffect(() => {
    tabResultsRef.current = tabResults;
  }, [tabResults]);

  useEffect(() => {
    tabLoadingRef.current = tabLoading;
  }, [tabLoading]);

  useEffect(() => {
    onRefreshJobDetectedRef.current = onRefreshJobDetected;
  }, [onRefreshJobDetected]);

  function freshnessLabel() {
    const freshness = activeTabResult?.widgets.find((widget) => widget.result.freshness)?.result.freshness;
    if (freshness?.source === "quickbase-live") return "Live Quickbase data";
    if (freshness?.source === "scheduled-cache") return "Scheduled refresh cache";
    return "Local fallback data";
  }

  useEffect(() => {
    setRuntimeFilters(mergedDefaults);
  }, [mergedDefaults]);

  useEffect(() => {
    setFocusedWidgetId(initialFocusedWidgetId || "");
  }, [dashboard.id, initialFocusedWidgetId]);

  useEffect(() => {
    tabResultsRef.current = {};
    tabLoadingRef.current = {};
    tabRequestSequenceRef.current = {};
    setWidgetPages({});
    setWidgetPageResults({});
    setWidgetPageLoading({});
    setTabResults({});
    setTabLoading({});
    setTabErrors({});
  }, [dashboard.id, forceLive, refreshNonce, runtimeFiltersKey]);

  useEffect(() => {
    setActiveTabId((current) => {
      if (initialActiveTabId && dashboard.tabs.some((tab) => tab.id === initialActiveTabId)) {
        return initialActiveTabId;
      }
      return resolveActiveDashboardTabId(dashboard, current);
    });
  }, [dashboard.id, dashboard.tabs, initialActiveTabId]);

  useEffect(() => {
    async function loadTab(tabId: string) {
      if (!tabId || tabResultsRef.current[tabId] || tabLoadingRef.current[tabId]) return;
      const requestSequence = (tabRequestSequenceRef.current[tabId] || 0) + 1;
      tabRequestSequenceRef.current[tabId] = requestSequence;
      setTabLoading((current) => ({ ...current, [tabId]: true }));
      setTabErrors((current) => {
        if (!current[tabId]) return current;
        const next = { ...current };
        delete next[tabId];
        return next;
      });
      try {
        const next = await renderDashboard(dashboard.id, runtimeFilters, tabId, { forceLive, dashboard });
        if (tabRequestSequenceRef.current[tabId] !== requestSequence) return;
        onRefreshJobDetectedRef.current?.(next.refreshJob || null);
        const renderedTab = next.tabs.find((tab) => tab.id === tabId) || next.tabs[0];
        if (renderedTab) {
          setTabResults((current) => ({ ...current, [renderedTab.id]: renderedTab }));
        }
      } catch (error) {
        if (tabRequestSequenceRef.current[tabId] !== requestSequence) return;
        setTabErrors((current) => ({
          ...current,
          [tabId]: error instanceof Error ? error.message : "Dashboard tab failed to load."
        }));
      } finally {
        if (tabRequestSequenceRef.current[tabId] === requestSequence) {
          setTabLoading((current) => ({ ...current, [tabId]: false }));
        }
      }
    }
    void loadTab(resolvedActiveTabId);
  }, [dashboard.id, forceLive, resolvedActiveTabId, runtimeFiltersKey, tabReloadNonce]);

  useEffect(() => {
    if (!shouldPreloadRemainingTabs) return;
    if (!activeTabResult) return;
    window.setTimeout(() => {
      const remainingTabIds = dashboard.tabs
        .map((tab) => tab.id)
        .filter((tabId) => tabId !== resolvedActiveTabId && !tabResultsRef.current[tabId] && !tabLoadingRef.current[tabId]);
      if (!remainingTabIds.length) return;
      remainingTabIds.forEach((tabId) => {
        const requestSequence = (tabRequestSequenceRef.current[tabId] || 0) + 1;
        tabRequestSequenceRef.current[tabId] = requestSequence;
        setTabLoading((current) => ({ ...current, [tabId]: true }));
        renderDashboard(dashboard.id, runtimeFilters, tabId, { forceLive, dashboard })
          .then((next) => {
            if (tabRequestSequenceRef.current[tabId] !== requestSequence) return;
            const renderedTab = next.tabs.find((tab) => tab.id === tabId) || next.tabs[0];
            if (renderedTab) {
              setTabResults((current) => ({ ...current, [renderedTab.id]: renderedTab }));
            }
          })
          .catch((error) => {
            if (tabRequestSequenceRef.current[tabId] !== requestSequence) return;
            setTabErrors((current) => ({
              ...current,
              [tabId]: error instanceof Error ? error.message : "Dashboard tab failed to load."
            }));
          })
          .finally(() => {
            if (tabRequestSequenceRef.current[tabId] === requestSequence) {
              setTabLoading((current) => ({ ...current, [tabId]: false }));
            }
          });
      });
    }, 150);
  }, [activeTabResult, dashboard.id, dashboard.tabs, forceLive, resolvedActiveTabId, runtimeFiltersKey, shouldPreloadRemainingTabs, tabReloadNonce]);

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
    if (!exportJob || exportJob.status !== "failed") return;
    setPendingSaveOnReady(false);
  }, [exportJob]);

  useEffect(() => {
    if (!exportJob || exportJob.status !== "complete" || downloadedJobId === exportJob.id || !pendingSaveOnReady) return;
    const completedJob = exportJob;
    let cancelled = false;
    async function saveWhenReady() {
      try {
        const saveTarget = await createExportSaveTarget(buildExportFilename(dashboard.name));
        if (!saveTarget || cancelled) return;
        await downloadExportJob(completedJob.id, {
          directDownload: hosted.embed,
          saveTarget,
          fallbackFilename: buildExportFilename(dashboard.name)
        });
        if (cancelled) return;
        setDownloadedJobId(completedJob.id);
      } finally {
        if (!cancelled) setPendingSaveOnReady(false);
      }
    }
    void saveWhenReady();
    return () => {
      cancelled = true;
    };
  }, [dashboard.name, downloadedJobId, exportJob, hosted.embed, pendingSaveOnReady]);

  useEffect(() => {
    if (hosted.autoDownload !== "xlsx") return;
    if (autoExportStartedRef.current) return;
    autoExportStartedRef.current = true;
    window.history.replaceState({}, document.title, buildObjectUrl("dashboard", dashboard.id, { viewer: true }));
    void beginExportInPlace();
  }, [dashboard.id, hosted.autoDownload]);

  useEffect(() => {
    if (!onStateChange) return;
    if (skipStateBroadcastRef.current) {
      skipStateBroadcastRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      onStateChange({
        runtimeFilters,
        activeTabId,
        focusedWidgetId
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [activeTabId, focusedWidgetId, onStateChange, runtimeFilters]);

  function resetView() {
    setRuntimeFilters(defaults);
    setActiveTabId(dashboard.tabs[0]?.id || "");
    setFocusedWidgetId("");
  }

  function saveCurrentView() {
    if (!onSaveView) return;
    const entered = window.prompt("Save dashboard view as", `${dashboard.name} view`);
    const name = String(entered || "").trim();
    if (!name) return;
    onSaveView({
      id: `dashboard-view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      runtimeFilters,
      activeTabId: resolvedActiveTabId,
      focusedWidgetId
    });
  }

  function applySavedView(view: NonNullable<DashboardViewProps["savedViews"]>[number]) {
    setRuntimeFilters({ ...defaults, ...(view.runtimeFilters || {}) });
    setActiveTabId(resolveActiveDashboardTabId(dashboard, view.activeTabId));
    setFocusedWidgetId(view.focusedWidgetId || "");
  }

  async function beginExportInPlace() {
    const response = await startDashboardExportJob({ dashboardId: dashboard.id, dashboard: exportDashboard, runtimeFilters });
    setExportJob(response.job);
    setDownloadedJobId("");
  }

  async function beginExport() {
    if (exportJob?.status === "complete" && downloadedJobId !== exportJob.id) {
      const saveTarget = await createExportSaveTarget(buildExportFilename(dashboard.name));
      if (!saveTarget) return;
      await downloadExportJob(exportJob.id, {
        directDownload: hosted.embed,
        saveTarget,
        fallbackFilename: buildExportFilename(dashboard.name)
      });
      setDownloadedJobId(exportJob.id);
      setPendingSaveOnReady(false);
      return;
    }
    setPendingSaveOnReady(true);
    await beginExportInPlace();
  }

  const tabs = dashboard.tabs.map((tab) => tabResults[tab.id] || ({ id: tab.id, name: tab.name, widgets: [] }));
  const activeTab = tabs.find((tab) => tab.id === resolvedActiveTabId) || tabs[0];
  const focusedWidget = activeTab?.widgets.find((widget) => widget.widgetId === focusedWidgetId) || null;
  const focusedWidgetCrossFilterOptions = focusedWidget
    ? getDashboardCrossFilterOptions(dashboard, focusedWidget.report, focusedWidget.result.chartData)
    : [];

  async function changeWidgetPage(widget: DashboardRunResult["tabs"][number]["widgets"][number], page: number) {
    if (page < 1) return;
    setWidgetPageLoading((current) => ({ ...current, [widget.widgetId]: true }));
    try {
      const filters = buildDashboardFilters(dashboard, widget.report.id, runtimeFilters, widget.report.sourceTableId);
      const next = await runReportPage(widget.report.id, page, 100, filters, { forceLive, report: widget.report });
      setWidgetPages((current) => ({ ...current, [widget.widgetId]: page }));
      setWidgetPageResults((current) => ({ ...current, [widget.widgetId]: next }));
    } finally {
      setWidgetPageLoading((current) => ({ ...current, [widget.widgetId]: false }));
    }
  }

  return (
    <>
      {loading && !activeTabResult ? (
        <RefreshOverlay
          title="Loading this dashboard"
          indeterminate
          job={{
            message: "Rendering dashboard and loading rows for the active tab if needed…"
          }}
        />
      ) : null}
      <section className="surface stack">
      <div className="hero reader-hero">
        <div>
          <span className="badge brand">Dashboard</span>
          <h1>{dashboard.name}</h1>
          <p>{dashboard.description || "Full-screen dashboard view with live filters, summaries, and linked reports."}</p>
        </div>
      </div>

      <div className="reader-page-shell">
        <aside className={`reader-sidebar ${toolbarCollapsed ? "collapsed" : ""}`}>
          <button className="ghost-button reader-sidebar-toggle" onClick={() => setToolbarCollapsed((current) => !current)}>
            {toolbarCollapsed ? "Show tools" : "Hide tools"}
          </button>
          {toolbarCollapsed ? null : (
            <div className="reader-sidebar-stack">
              <div className="reader-sidebar-section">
                <strong>Navigation</strong>
                <div className="reader-sidebar-actions">
                  {hosted.embed ? (
                    <button className="ghost-button" onClick={() => window.open(fullScreenUrl, "_blank", "noopener,noreferrer")}>Open full-screen</button>
                  ) : (
                    <>
                      <button className="ghost-button" onClick={() => window.history.back()}>Back</button>
                      <Link className="ghost-button" to={buildHostedRoute("/")}>Home</Link>
                      <Link className="ghost-button" to={buildHostedRoute("/help")}>Open manual</Link>
                      <Link className="ghost-button" to={buildHostedRoute(`/studio/${dashboard.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open in building area</Link>
                    </>
                  )}
                </div>
              </div>

              <div className="reader-sidebar-section">
                <strong>Actions</strong>
                <div className="reader-sidebar-actions">
                  {onToggleFavorite ? (
                    <button className="ghost-button" onClick={onToggleFavorite}>
                      {isFavorite ? "Unfavorite" : "Favorite"}
                    </button>
                  ) : null}
                  <button className="ghost-button" onClick={() => { void beginExport(); }} disabled={!activeTabResult || exportJob?.status === "queued" || exportJob?.status === "running"}>
                    {exportJob?.status === "queued" || exportJob?.status === "running"
                      ? `Exporting ${exportJob.progress}%`
                      : exportJob?.status === "complete" && downloadedJobId !== exportJob.id
                        ? "Save xlsx"
                        : "Download xlsx"}
                  </button>
                  {onRefresh ? (
                    <button className="ghost-button" onClick={onRefresh} disabled={loading}>
                      {loading ? "Refreshing…" : "Refresh now"}
                    </button>
                  ) : null}
                  <button className="ghost-button" onClick={resetView}>Reset view</button>
                  {onSaveView ? <button className="ghost-button" onClick={saveCurrentView}>Save view</button> : null}
                </div>
              </div>

              {hosted.embed ? null : (
                <div className="reader-sidebar-section">
                  <strong>Links</strong>
                  <LinkToolbar type="dashboard" id={dashboard.id} />
                </div>
              )}
            </div>
          )}
        </aside>

        <div className="reader-page-content">
      {savedViews.length ? (
        <div className="card">
          <div className="card-head">
            <strong>Saved views</strong>
            <span className="micro">Personal bookmarks for filters, tabs, and focused cards</span>
          </div>
          <div className="saved-view-toolbar">
            {savedViews.map((view) => (
              <div className="saved-view-chip" key={view.id}>
                <button className="ghost-button" onClick={() => applySavedView(view)}>{view.name}</button>
                {onDeleteView ? <button className="ghost-button" onClick={() => onDeleteView(view.id)}>Remove</button> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTabResult?.widgets.some((widget) => widget.result.freshness) ? (
        <div className={`sync-status ${activeTabResult.widgets.some((widget) => widget.result.freshness?.source === "quickbase-live" || widget.result.freshness?.source === "scheduled-cache") ? "sync-status-ok" : "sync-status-warn"}`}>
          <strong>{freshnessLabel()}</strong>
          <span>Fetched {formatFreshnessTimestamp(activeTabResult.widgets.find((widget) => widget.result.freshness)?.result.freshness?.fetchedAt)}</span>
        </div>
      ) : null}

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
          {exportJob.status === "complete" ? (
            <div className="card-actions">
              <button className="ghost-button" onClick={() => { void beginExport(); }}>
                {downloadedJobId === exportJob.id ? "Save again" : "Save xlsx"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTabResult?.widgets.some((widget) => widget.status === "failed" || widget.result.warnings.length) ? (
        <div className="sync-status sync-status-warn">
          <strong>Active tab warnings</strong>
          <ul className="flat-list import-review-list">
            {activeTabResult.widgets.flatMap((widget) => [
              ...(widget.status === "failed" ? [`${widget.widget.title || widget.report.name}: ${widget.error || widget.message}`] : []),
              ...widget.result.warnings.map((warning) => `${widget.widget.title || widget.report.name}: ${warning}`)
            ]).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {dashboard.runtimeFilters.length ? (
        <div className="card">
          <div className="card-head">
            <strong>Filters</strong>
            <span className="micro">Dashboard controls applied to the most recent refresh</span>
          </div>
          <div className="filter-grid">
            {dashboard.runtimeFilters.map((filter) => (
              <label className="field" key={filter.id}>
                <span>{filter.label}</span>
                {filter.valueSource === "field" ? (
                  <input value={`Uses ${filter.compareFieldId || "another field"}`} disabled />
                ) : (
                  <input
                    value={runtimeFilters[filter.id] ?? ""}
                    onChange={(event) =>
                      setRuntimeFilters((current) => ({
                        ...current,
                        [filter.id]: event.target.value
                      }))
                    }
                  />
                )}
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
              className={`dashboard-tab-button ${tab.id === activeTab?.id ? "active" : ""} ${tabLoading[tab.id] ? "dashboard-tab-button-loading" : ""} ${tabErrors[tab.id] ? "dashboard-tab-button-error" : tabResults[tab.id] ? "dashboard-tab-button-ready" : ""}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.name}
              {tabLoading[tab.id] ? " · loading" : tabErrors[tab.id] ? " · error" : tabResults[tab.id] ? " · ready" : ""}
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
          {tabErrors[activeTab.id] ? (
            <div className="sync-status sync-status-warn">
              <strong>Tab failed to load</strong>
              <span>{tabErrors[activeTab.id]}</span>
              <button
                className="ghost-button"
                onClick={() => {
                  setTabResults((current) => {
                    const next = { ...current };
                    delete next[activeTab.id];
                    return next;
                  });
                  setTabLoading((current) => {
                    const next = { ...current };
                    delete next[activeTab.id];
                    return next;
                  });
                  setTabReloadNonce((current) => current + 1);
                }}
              >
                Retry tab
              </button>
            </div>
          ) : null}
          <div className="widget-grid dashboard-layout-grid">
            {activeTab.widgets.map((widget) => {
              const pagedResult = widgetPageResults[widget.widgetId] || widget.result;
              const currentPage = widgetPages[widget.widgetId] || pagedResult.page || 1;
              const totalPages = pagedResult.totalPages || 1;
              const pageLoading = widgetPageLoading[widget.widgetId];
              const summaryData = pagedResult.summary.length ? pagedResult.summary : widget.result.summary;
              const chartData = pagedResult.chartData.length ? pagedResult.chartData : widget.result.chartData;
              const widgetTable = tables?.find((item) => item.id === widget.report.sourceTableId || item.quickbaseTableId === widget.report.sourceTableId);
              const quickbaseLinkContext = getQuickbaseLinkContext?.(widget.report.sourceTableId) || null;
              const chartFieldId = getChartFieldId(widget.report);
              const axisLabels = getChartAxisLabels(tables, widget.report);
              const widgetQuickbaseFilterTree = buildQuickbaseReportFilterTree(
                widget.report,
                buildDashboardFilters(dashboard, widget.report.id, runtimeFilters, widget.report.sourceTableId)
              );
              const measuredChartHeight = widgetChartHeights[widget.widgetId] || 0;
              const requestedChartHeight = Math.max(
                220,
                measuredChartHeight || ((widget.widget.layout.h || 4) * 96 - 96)
              );
              const chartBounds = getChartViewportBounds(widget.report.view.chartType, chartData.length, true, requestedChartHeight);
              const crossFilterOptions = getDashboardCrossFilterOptions(dashboard, widget.report, widget.result.chartData);
              const clearableFilterIds = Array.from(new Set(
                crossFilterOptions
                  .map((option) => option.filterId)
                  .filter((filterId) => String(runtimeFilters[filterId] || "").trim())
              ));
              return (
                <article className="widget-card dashboard-layout-item" key={widget.widgetId} style={getDashboardWidgetLayoutStyle(widget.widget, activeTabLayout.get(widget.widgetId) || null)}>
                <div className="widget-head">
                  <strong>{widget.widget.title || widget.report.name}</strong>
                  <div className="widget-preview-controls">
                    <button className="link-like" onClick={() => setFocusedWidgetId(widget.widgetId)}>Focus card</button>
                    {widget.report.sourceTableId ? (
                      <Link to={buildHostedRoute(`/report/${widget.report.id}`)} className="widget-link" target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open report</Link>
                    ) : null}
                  </div>
                </div>
                <div className={`widget-state-banner ${widget.status === "failed" ? "widget-state-banner-failed" : "widget-state-banner-ready"}`}>
                  <strong>{widget.status === "failed" ? "Widget unavailable" : "Widget ready"}</strong>
                  <span>{widget.error || widget.message}</span>
                </div>
                {widget.status === "complete" && widget.widget.showSummary ? (
                  <div className="widget-metrics">
                    {summaryData.map((item) => (
                      <div key={item.label} className="mini-stat">
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {widget.status === "complete" && crossFilterOptions.length ? (
                  <div className="widget-filter-toolbar">
                    <span className="micro">Cross-filter</span>
                    <div className="link-toolbar">
                      {crossFilterOptions.map((option) => (
                        <button
                          key={`${widget.widgetId}-${option.filterId}-${option.value}`}
                          className={`ghost-button ${runtimeFilters[option.filterId] === option.value ? "active-tab" : ""}`}
                          onClick={() =>
                            setRuntimeFilters((current) => ({
                              ...current,
                              [option.filterId]: option.value
                            }))
                          }
                        >
                          {option.filterLabel}: {option.value}
                        </button>
                      ))}
                      {clearableFilterIds.map((filterId) => (
                        <button
                          key={`${widget.widgetId}-${filterId}-clear`}
                          className="ghost-button"
                          onClick={() =>
                            setRuntimeFilters((current) => ({
                              ...current,
                              [filterId]: defaults[filterId] || ""
                            }))
                          }
                        >
                          Clear {dashboard.runtimeFilters.find((filter) => filter.id === filterId)?.label || filterId}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {widget.status === "complete" && widgetShowsChart(widget.widget, widget.report) ? (
                  <div className="mini-chart" ref={bindChartMeasureRef(widget.widgetId)}>
                    <div className="chart-scroll-shell">
                      <div style={{ minWidth: `${chartBounds.minWidth}px`, minHeight: `${chartBounds.minHeight}px`, width: "100%", height: "100%" }}>
                        <ChartPreview
                          chartType={widget.report.view.chartType}
                          data={chartData}
                          title={widget.report.view.chartTitle || widget.widget.title}
                          decimalPlaces={widget.report.view.decimalPlaces}
                          chartColors={widget.report.view.chartColors}
                          chartValueColors={widget.report.view.chartValueColors}
                          chartSort={widget.report.view.chartSort}
                          chartOrientation={widget.report.view.chartOrientation}
                          xAxisLabel={axisLabels.xAxisLabel}
                          yAxisLabel={axisLabels.yAxisLabel}
                          secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
                          secondarySeriesType={widget.report.view.chartSecondarySeriesType}
                          compact
                          showLegend={widget.report.view.chartShowLegend}
                          showValues={widget.report.view.chartShowValues}
                          viewportHeight={chartBounds.minHeight}
                          openLinksInNewTab={openLinksInNewTab}
                          getDatumHref={(datum) => buildQuickbaseChartDatumUrl(quickbaseLinkContext, widgetTable, chartFieldId, datum, widgetQuickbaseFilterTree)}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {widget.status === "complete" && (widgetRenderMode(widget.widget, widget.report) === "table" || widgetRenderMode(widget.widget, widget.report) === "timeline" || widgetRenderMode(widget.widget, widget.report) === "calendar" || widgetRenderMode(widget.widget, widget.report) === "kanban" || widget.widget.showDetails) ? (
                  <div className="compact-table-shell">
                    <div className="widget-table-toolbar">
                      <button className="ghost-button" disabled={currentPage <= 1 || pageLoading} onClick={() => { void changeWidgetPage(widget, currentPage - 1); }}>Previous</button>
                      <span className="micro">Page {currentPage} of {totalPages} · {pagedResult.totalRows || 0} rows</span>
                      <button className="ghost-button" disabled={!pagedResult.hasNextPage || pageLoading} onClick={() => { void changeWidgetPage(widget, currentPage + 1); }}>Next</button>
                    </div>
                    {(() => {
                      const mode = widgetRenderMode(widget.widget, widget.report);
                      if (mode === "timeline" || mode === "calendar") {
                        const dateFieldId = mode === "timeline" ? widget.report.view.timelineDateField : widget.report.view.calendarDateField;
                        const titleFieldId = widget.report.view.titleFieldId || widget.report.selectedFieldIds[0] || "";
                        return (
                          <div className="studio-card-grid">
                            {pagedResult.rows.map((row, index) => (
                              <article className="studio-mini-card" key={index}>
                                <strong>{widgetTable ? formatReportCellValue(widget.report, widgetTable, titleFieldId, row[titleFieldId]) : String(row[titleFieldId] ?? "")}</strong>
                                <span>{widgetTable ? getReportFieldLabel(widget.report, widgetTable, dateFieldId) : "Date"}: {widgetTable ? formatReportCellValue(widget.report, widgetTable, dateFieldId, row[dateFieldId]) : String(row[dateFieldId] ?? "")}</span>
                                {mode === "timeline" && widget.report.view.timelineEndField ? (
                                  <span>Ends: {widgetTable ? formatReportCellValue(widget.report, widgetTable, widget.report.view.timelineEndField, row[widget.report.view.timelineEndField]) : String(row[widget.report.view.timelineEndField] ?? "")}</span>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        );
                      }
                      if (mode === "kanban") {
                        const fieldId = widget.report.view.kanbanField || widget.report.selectedFieldIds[0] || "";
                        const titleFieldId = widget.report.view.titleFieldId || widget.report.selectedFieldIds[0] || "";
                        const columns = new Map<string, typeof pagedResult.rows>();
                        pagedResult.rows.forEach((row) => {
                          const key = widgetTable ? formatReportCellValue(widget.report, widgetTable, fieldId, row[fieldId]) : String(row[fieldId] ?? "Unassigned");
                          columns.set(key || "Unassigned", [...(columns.get(key || "Unassigned") || []), row]);
                        });
                        return (
                          <div className="kanban-board">
                            {Array.from(columns.entries()).map(([column, columnRows]) => (
                              <section className="kanban-column" key={column}>
                                <div className="kanban-head">
                                  <strong>{column}</strong>
                                  <span>{columnRows.length}</span>
                                </div>
                                <div className="kanban-stack">
                                  {columnRows.map((row, index) => (
                                    <article className="studio-mini-card" key={index}>
                                      <strong>{widgetTable ? formatReportCellValue(widget.report, widgetTable, titleFieldId, row[titleFieldId]) : String(row[titleFieldId] ?? "")}</strong>
                                      {widget.report.selectedFieldIds.filter((fieldId) => fieldId !== titleFieldId).slice(0, 3).map((fieldId) => (
                                        <span key={fieldId}>{widgetTable ? formatReportCellValue(widget.report, widgetTable, fieldId, row[fieldId]) : String(row[fieldId] ?? "")}</span>
                                      ))}
                                    </article>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        );
                      }
                      return (
                        <ResizableDataTable
                          className="widget-table-shell"
                          columns={[
                            ...(quickbaseLinkContext ? [{ key: "__quickbase", label: "Quickbase", minWidth: 120, defaultWidth: 120, className: "table-action-col" }] : []),
                            ...widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => ({
                              key: fieldId,
                              label: getFieldLabel(tables, widget.report, fieldId)
                            }))
                          ]}
                          rows={pagedResult.rows.map((row, index) => ({
                            key: String(row.__recordId || index),
                            cells: [
                              ...(quickbaseLinkContext ? [
                                String(row.__recordId || "").trim() ? (
                                  <a
                                    className="ghost-button table-edit-link"
                                    href={buildQuickbaseRecordEditUrl(quickbaseLinkContext, String(row.__recordId || ""))}
                                    target={openLinksInNewTab ? "_blank" : undefined}
                                    rel={openLinksInNewTab ? "noreferrer" : undefined}
                                  >
                                    Edit
                                  </a>
                                ) : null
                              ] : []),
                              ...widget.report.selectedFieldIds.slice(0, 6).map((fieldId) =>
                                widgetTable ? formatReportCellValue(widget.report, widgetTable, fieldId, row[fieldId]) : String(row[fieldId] ?? "")
                              )
                            ]
                          }))}
                        />
                      );
                    })()}
                  </div>
                ) : null}
                </article>
              );
            })}
            {loading && !activeTab.widgets.length ? <div className="empty">Rendering dashboard…</div> : null}
          </div>
        </div>
      ) : null}

      {focusedWidget ? (
        <div className="focus-overlay" role="dialog" aria-modal="true">
          <div className="focus-overlay-card">
            <div className="card-head">
              <strong>{focusedWidget.widget.title || focusedWidget.report.name}</strong>
              <div className="link-toolbar">
                {focusedWidget.report.sourceTableId ? (
                  <Link className="ghost-button" to={buildHostedRoute(`/report/${focusedWidget.report.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open report</Link>
                ) : null}
                <button className="ghost-button" onClick={() => setFocusedWidgetId("")}>Close</button>
              </div>
            </div>
            {focusedWidget.widget.showSummary ? (
              <div className="widget-metrics">
                {focusedWidget.result.summary.map((item) => (
                  <div key={item.label} className="mini-stat">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {focusedWidgetCrossFilterOptions.length ? (
              <div className="widget-filter-toolbar">
                <span className="micro">Cross-filter</span>
                <div className="link-toolbar">
                  {focusedWidgetCrossFilterOptions.map((option) => (
                    <button
                      key={`${focusedWidget.widgetId}-${option.filterId}-${option.value}`}
                      className={`ghost-button ${runtimeFilters[option.filterId] === option.value ? "active-tab" : ""}`}
                      onClick={() =>
                        setRuntimeFilters((current) => ({
                          ...current,
                          [option.filterId]: option.value
                        }))
                      }
                    >
                      {option.filterLabel}: {option.value}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {widgetShowsChart(focusedWidget.widget, focusedWidget.report) ? (
              <div className="card">
                <div className="chart-scroll-shell">
                  <div
                    style={{
                      minWidth: `${getChartViewportBounds(focusedWidget.report.view.chartType, focusedWidget.result.chartData.length).minWidth}px`,
                      minHeight: `${getChartViewportBounds(focusedWidget.report.view.chartType, focusedWidget.result.chartData.length).minHeight}px`,
                      width: "100%",
                      height: "100%"
                    }}
                  >
                    <ChartPreview
                      chartType={focusedWidget.report.view.chartType}
                      data={focusedWidget.result.chartData}
                      title={focusedWidget.report.view.chartTitle || focusedWidget.widget.title}
                      decimalPlaces={focusedWidget.report.view.decimalPlaces}
                      chartColors={focusedWidget.report.view.chartColors}
                      chartValueColors={focusedWidget.report.view.chartValueColors}
                      chartSort={focusedWidget.report.view.chartSort}
                      chartOrientation={focusedWidget.report.view.chartOrientation}
                      xAxisLabel={getChartAxisLabels(tables, focusedWidget.report).xAxisLabel}
                      yAxisLabel={getChartAxisLabels(tables, focusedWidget.report).yAxisLabel}
                      secondaryYAxisLabel={getChartAxisLabels(tables, focusedWidget.report).secondaryYAxisLabel}
                      secondarySeriesType={focusedWidget.report.view.chartSecondarySeriesType}
                      showLegend={focusedWidget.report.view.chartShowLegend}
                      showValues={focusedWidget.report.view.chartShowValues}
                      viewportHeight={getChartViewportBounds(focusedWidget.report.view.chartType, focusedWidget.result.chartData.length).minHeight}
                      openLinksInNewTab={openLinksInNewTab}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            {(widgetRenderMode(focusedWidget.widget, focusedWidget.report) === "table" || focusedWidget.widget.showDetails) ? (
              <ResizableDataTable
                className="focus-table-shell"
                columns={focusedWidget.report.selectedFieldIds.slice(0, 8).map((fieldId) => ({
                  key: fieldId,
                  label: getFieldLabel(tables, focusedWidget.report, fieldId)
                }))}
                rows={focusedWidget.result.rows.slice(0, 20).map((row, index) => ({
                  key: String(row.__recordId || index),
                  cells: focusedWidget.report.selectedFieldIds.slice(0, 8).map((fieldId) => {
                    const focusedWidgetTable = tables?.find((item) => item.id === focusedWidget.report.sourceTableId || item.quickbaseTableId === focusedWidget.report.sourceTableId);
                    return focusedWidgetTable ? formatReportCellValue(focusedWidget.report, focusedWidgetTable, fieldId, row[fieldId]) : String(row[fieldId] ?? "");
                  })
                }))}
              />
            ) : null}
          </div>
        </div>
      ) : null}
        </div>
      </div>
      </section>
    </>
  );
}
