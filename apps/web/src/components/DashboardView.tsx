import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSetReaderTools } from "../contexts/ReaderToolsContext";
import { Link } from "react-router-dom";
import { buildDashboardFilters, compactDashboardTabWidgets, formatReportCellValue, getDashboardWidgetLayoutStyle, getDashboardWidgetPlacements, getReportFieldLabel, repackDashboardTabLayout, resolveActiveDashboardTabId, resolveDashboardWidgetRenderMode, type DashboardDefinition, type DashboardRunResult, type RefreshJobStatus, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { createExportSaveTarget, fetchFieldValues, fetchReportExportBundle, renderDashboard, runReportPage, type ExportSaveTarget } from "../lib/api";
import { ChartPreview } from "./ChartPreview";
import { RefreshOverlay } from "./RefreshOverlay";
import { ResizableDataTable } from "./ResizableDataTable";
import { buildHostedRoute, buildObjectUrl, getHostedContext } from "../lib/embed";
import { buildDashboardExportDefinition } from "../lib/dashboardExport";
import { buildQuickbaseReportFilterTree } from "../lib/quickbaseLinks";
import { getChartViewportBounds } from "./studioReportUtils";
import { exportDashboardWorkbook } from "../lib/workbookExport";
import { mapWithConcurrency } from "../lib/concurrency";

interface DashboardViewProps {
  dashboard: DashboardDefinition;
  reportDefinitions?: Record<string, ReportDefinition>;
  tables?: TableDefinition[];
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
  headerActions?: ReactNode;
}

function widgetShowsChart(widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], report: DashboardRunResult["tabs"][number]["widgets"][number]["report"]) {
  const displayMode = resolveDashboardWidgetRenderMode(widget, report.view.mode);
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

async function savePreparedWorkbook(blob: Blob, filename: string, target?: ExportSaveTarget | null) {
  if (target) {
    const writable = await target.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function DashboardView({
  dashboard,
  reportDefinitions,
  tables,
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
  openLinksInNewTab = false,
  headerActions
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
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  const [tabResults, setTabResults] = useState<Record<string, DashboardRunResult["tabs"][number]>>({});
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [tabErrors, setTabErrors] = useState<Record<string, string>>({});
  const [activeTabId, setActiveTabId] = useState(initialActiveTabId || dashboard.tabs[0]?.id || "");
  const [localExporting, setLocalExporting] = useState(false);
  const [nativeChartExporting, setNativeChartExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [preparedExport, setPreparedExport] = useState<{ filename: string; blob: Blob } | null>(null);
  const [exportSaved, setExportSaved] = useState(false);
  const autoExportStartedRef = useRef(false);
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
  const tabLoadGenerationRef = useRef(0);
  const chartMeasureObserversRef = useRef<Record<string, ResizeObserver>>({});
  const resolvedActiveTabId = resolveActiveDashboardTabId(dashboard, activeTabId);
  const activeTabResult = tabResults[resolvedActiveTabId] || null;
  const activeTabLayout = useMemo(() => {
    const tab = dashboard.tabs.find((item) => item.id === resolvedActiveTabId);
    // repackDashboardTabLayout sorts widgets by stored (y,x) and reassigns compact
    // sequential y values starting at 1, preventing corrupted large y values from
    // creating thousands of empty CSS grid rows.
    const repackedTab = tab ? (repackDashboardTabLayout(tab) || tab) : null;
    return new Map((repackedTab ? getDashboardWidgetPlacements(repackedTab) : []).map((placement) => [placement.widgetId, placement]));
  }, [dashboard.tabs, resolvedActiveTabId]);
  const activeTabError = tabErrors[resolvedActiveTabId] || "";
  const loading = Boolean(tabLoading[resolvedActiveTabId]);
  const waitingForActiveTab = Boolean(resolvedActiveTabId) && !activeTabResult && !activeTabError;
  const dashboardLoading = loading || waitingForActiveTab;
  const shouldPreloadRemainingTabs = false;
  const runtimeFiltersKey = useMemo(() => JSON.stringify(runtimeFilters), [runtimeFilters]);

  useEffect(() => {
    if (!openFilterId) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Element;
      if (!target.closest(".filter-dropdown-wrap")) {
        setOpenFilterId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openFilterId]);
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
    if (typeof ResizeObserver === "undefined") {
      return;
    }
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
    setPreparedExport(null);
    setExportSaved(false);
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
    if (freshness?.source === "quickbase-live") return "Live data";
    if (freshness?.source === "scheduled-cache") return "Scheduled refresh cache";
    return "Local fallback data";
  }

  useEffect(() => {
    setRuntimeFilters(mergedDefaults);
  }, [dashboard.id]);

  useEffect(() => {
    const textFilters = dashboard.runtimeFilters.filter(
      (f) => f.fieldId && f.sourceTableId && (f.uiType === "single-select" || f.uiType === "multi-select" || f.uiType === "searchable-dropdown" || !f.uiType)
    );
    if (!textFilters.length) return;
    void Promise.all(
      textFilters.map((f) =>
        fetchFieldValues(f.sourceTableId!, f.fieldId)
          .then((res) => ({ id: f.id, values: res.values || [] }))
          .catch(() => ({ id: f.id, values: [] }))
      )
    ).then((results) => {
      setFilterOptions(Object.fromEntries(results.map((r) => [r.id, r.values])));
    });
  }, [dashboard.id]);

  useEffect(() => {
    setFocusedWidgetId(initialFocusedWidgetId || "");
  }, [dashboard.id]);

  useEffect(() => {
    tabLoadGenerationRef.current += 1;
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
  }, [dashboard.id]);

  useEffect(() => {
    async function loadTab(tabId: string) {
      if (!tabId || tabResultsRef.current[tabId] || tabLoadingRef.current[tabId]) return;
      const requestGeneration = tabLoadGenerationRef.current;
      const requestSequence = (tabRequestSequenceRef.current[tabId] || 0) + 1;
      tabRequestSequenceRef.current[tabId] = requestSequence;
      tabLoadingRef.current = { ...tabLoadingRef.current, [tabId]: true };
      setTabLoading((current) => ({ ...current, [tabId]: true }));
      setTabErrors((current) => {
        if (!current[tabId]) return current;
        const next = { ...current };
        delete next[tabId];
        return next;
      });
      const requestIsCurrent = () =>
        tabLoadGenerationRef.current === requestGeneration
        && tabRequestSequenceRef.current[tabId] === requestSequence;
      try {
        const next = await renderDashboard(dashboard.id, runtimeFilters, tabId, { forceLive, dashboard, reportOverrides: reportDefinitions });
        if (!requestIsCurrent()) return;
        if (next.refreshJob) {
          onRefreshJobDetectedRef.current?.(next.refreshJob);
        }
        const renderedTab = next.tabs.find((tab) => tab.id === tabId) || next.tabs[0];
        if (renderedTab) {
          tabResultsRef.current = { ...tabResultsRef.current, [renderedTab.id]: renderedTab };
          setTabResults((current) => ({ ...current, [renderedTab.id]: renderedTab }));
        }
      } catch (error) {
        if (!requestIsCurrent()) return;
        setTabErrors((current) => ({
          ...current,
          [tabId]: error instanceof Error ? error.message : "Dashboard tab failed to load."
        }));
      } finally {
        if (requestIsCurrent()) {
          tabLoadingRef.current = { ...tabLoadingRef.current, [tabId]: false };
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
        renderDashboard(dashboard.id, runtimeFilters, tabId, { forceLive, dashboard, reportOverrides: reportDefinitions })
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
    if (hosted.autoDownload !== "xlsx") return;
    if (autoExportStartedRef.current) return;
    autoExportStartedRef.current = true;
    window.history.replaceState({}, document.title, buildObjectUrl("dashboard", dashboard.id, { viewer: true }));
    void beginExport({ skipPicker: true });
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
        activeTabId: resolvedActiveTabId,
        focusedWidgetId
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [focusedWidgetId, onStateChange, resolvedActiveTabId, runtimeFilters]);

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

  const setTools = useSetReaderTools();
  const hasSaveView = !!onSaveView;
  const hasToggleFavorite = !!onToggleFavorite;
  const hasRefresh = !!onRefresh;

  useEffect(() => {
    setTools(
      <>
        {hosted.embed ? (
          <button className="nav-sidebar-item" onClick={() => window.open(fullScreenUrl, "_blank", "noopener,noreferrer")}>
            <span className="nav-sidebar-icon">↗</span>
            <span className="nav-sidebar-label">Open full-screen</span>
          </button>
        ) : (
          <>
            <button className="nav-sidebar-item" onClick={() => window.history.back()}>
              <span className="nav-sidebar-icon">←</span>
              <span className="nav-sidebar-label">Back</span>
            </button>
            <Link className="nav-sidebar-item" to={buildHostedRoute("/")}>
              <span className="nav-sidebar-icon">🏠</span>
              <span className="nav-sidebar-label">Home</span>
            </Link>
            <Link className="nav-sidebar-item" to={buildHostedRoute("/help")}>
              <span className="nav-sidebar-icon">📖</span>
              <span className="nav-sidebar-label">Open manual</span>
            </Link>
            <Link
              className="nav-sidebar-item"
              to={buildHostedRoute(`/studio/${dashboard.id}`)}
              target={openLinksInNewTab ? "_blank" : undefined}
              rel={openLinksInNewTab ? "noreferrer" : undefined}
            >
              <span className="nav-sidebar-icon">🔨</span>
              <span className="nav-sidebar-label">Open in builder</span>
            </Link>
          </>
        )}
        <div className="nav-sidebar-divider" />
        {hasToggleFavorite ? (
          <button className={`nav-sidebar-item${isFavorite ? " active" : ""}`} onClick={onToggleFavorite}>
            <span className="nav-sidebar-icon">{isFavorite ? "★" : "☆"}</span>
            <span className="nav-sidebar-label">{isFavorite ? "Unfavorite" : "Favorite"}</span>
          </button>
        ) : null}
        <button
          className="nav-sidebar-item"
          onClick={() => { void beginNativeChartExport(); }}
          disabled={!activeTabResult || localExporting || nativeChartExporting}
        >
          <span className="nav-sidebar-icon">📤</span>
          <span className="nav-sidebar-label">
            {nativeChartExporting ? "Generating…" : "Export Workbook"}
          </span>
        </button>
        {hasRefresh ? (
          <button
            className="nav-sidebar-item"
            onClick={onRefresh}
            disabled={dashboardLoading}
          >
            <span className="nav-sidebar-icon">🔄</span>
            <span className="nav-sidebar-label">{dashboardLoading ? "Refreshing…" : "Refresh"}</span>
          </button>
        ) : null}
        <button className="nav-sidebar-item" onClick={resetView}>
          <span className="nav-sidebar-icon">↩</span>
          <span className="nav-sidebar-label">Reset view</span>
        </button>
        {hasSaveView ? (
          <button className="nav-sidebar-item" onClick={saveCurrentView}>
            <span className="nav-sidebar-icon">💾</span>
            <span className="nav-sidebar-label">Save view</span>
          </button>
        ) : null}
      </>
    );
    return () => setTools(null);
  }, [
    hosted.embed,
    isFavorite,
    dashboardLoading,
    localExporting,
    nativeChartExporting,
    activeTabResult,
    hasSaveView,
    hasToggleFavorite,
    hasRefresh,
    dashboard.id,
    openLinksInNewTab,
    onRefresh,
    onToggleFavorite,
    setTools
  ]);

  async function buildDashboardExportResult() {
    // Sequential (concurrency 1): an unbounded Promise.all here fires one request
    // per tab/widget simultaneously — a dashboard with many widgets can burst
    // dozens of requests at once and saturate the server's database connection
    // pool, causing intermittent 500s. Correctness/reliability matters far more
    // than export speed here, so this deliberately does not parallelize at all.
    const renderedTabs = await mapWithConcurrency(dashboard.tabs, 1, async (tab) => {
      const cached = tabResults[tab.id];
      if (cached?.widgets.length) return cached;
      const rendered = await renderDashboard(dashboard.id, runtimeFilters, tab.id, {
        forceLive,
        dashboard: exportDashboard,
        reportOverrides: reportDefinitions
      });
      return rendered.tabs.find((item) => item.id === tab.id) || { id: tab.id, name: tab.name, widgets: [] };
    });
    const exportResultsByWidgetId = Object.fromEntries(
      await mapWithConcurrency(
        renderedTabs.flatMap((tab) => tab.widgets),
        1,
        async (widget) => {
          const filters = buildDashboardFilters(dashboard, widget.report.id, runtimeFilters, widget.report.sourceTableId);
          const response = await fetchReportExportBundle(widget.report.id, filters, {
            report: widget.report
          });
          return [widget.widgetId, response.result] as const;
        }
      )
    );
    return {
      result: {
        dashboard: exportDashboard,
        tabs: renderedTabs
      } as DashboardRunResult,
      exportResultsByWidgetId: Object.fromEntries(
        Object.entries(exportResultsByWidgetId).filter((entry): entry is [string, ReportRunResult] => Boolean(entry[1]))
      )
    };
  }

  async function beginExport(options: { skipPicker?: boolean } = {}) {
    if (localExporting) return;
    if (preparedExport && !options.skipPicker) {
      const saveTarget = await createExportSaveTarget(preparedExport.filename);
      if (!saveTarget && typeof (window as typeof window & { showSaveFilePicker?: unknown }).showSaveFilePicker === "function") return;
      await savePreparedWorkbook(preparedExport.blob, preparedExport.filename, saveTarget);
      setExportSaved(true);
      return;
    }
    const filename = buildExportFilename(dashboard.name);
    setLocalExporting(true);
    setExportError("");
    setPreparedExport(null);
    setExportSaved(false);
    try {
      const exportPayload = await buildDashboardExportResult();
      const blob = await exportDashboardWorkbook(dashboard, exportPayload.result, exportPayload.exportResultsByWidgetId, {
        filename,
        tablesById: Object.fromEntries((tables || []).map((table) => [table.id, table])),
        returnBlob: true
      });
      if (!(blob instanceof Blob)) {
        throw new Error("Export did not produce a workbook file.");
      }
      if (options.skipPicker) {
        await savePreparedWorkbook(blob, filename, null);
        setExportSaved(true);
      } else {
        setPreparedExport({ filename, blob });
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setLocalExporting(false);
    }
  }

  async function beginNativeChartExport() {
    if (localExporting || nativeChartExporting) return;
    const filename = `${String(dashboard.name || "dashboard").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "dashboard"} ${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_")}.xlsx`;
    setNativeChartExporting(true);
    setExportError("");
    setPreparedExport(null);
    setExportSaved(false);
    try {
      const { exportDashboardNativeChartWorkbook } = await import("../lib/nativeExcelDashboardExport");
      const exportPayload = await buildDashboardExportResult();
      const blob = await exportDashboardNativeChartWorkbook(dashboard, exportPayload.result, exportPayload.exportResultsByWidgetId, {
        filename,
        tablesById: Object.fromEntries((tables || []).map((table) => [table.id, table])),
        includeOverviewSheet: dashboard.includeExportOverviewSheet !== false
      });
      if (!(blob instanceof Blob)) {
        throw new Error("Native chart export did not produce a workbook file.");
      }
      setPreparedExport({ filename, blob });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Native chart export failed.");
    } finally {
      setNativeChartExporting(false);
    }
  }

  const tabs = dashboard.tabs.map((tab) => tabResults[tab.id] || ({ id: tab.id, name: tab.name, widgets: [] }));
  const activeTab = tabs.find((tab) => tab.id === resolvedActiveTabId) || tabs[0];
  const isOverviewTab = true; // all tabs use grid layout to match builder positioning
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
      {dashboardLoading ? (
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
        <div className="reader-hero-actions">
          {headerActions}
        </div>
      </div>

      <div className="reader-page-shell sidebar-collapsed">
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
                {onDeleteView ? <button className="ghost-button btn-danger" onClick={() => onDeleteView(view.id)}>Remove</button> : null}
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

      {localExporting ? (
        <div className="sync-status">
          <strong>Generating export</strong>
          <span>Building the workbook and chart images from the current dashboard.</span>
          <div className="progress-meter" aria-hidden="true">
            <div className="progress-meter-fill" style={{ width: "72%" }} />
          </div>
        </div>
      ) : null}

      {nativeChartExporting ? (
        <div className="sync-status">
          <strong>Generating workbook</strong>
          <span>Building Excel workbook with charts, summaries, and data from all tabs.</span>
          <div className="progress-meter" aria-hidden="true">
            <div className="progress-meter-fill" style={{ width: "72%" }} />
          </div>
        </div>
      ) : null}

      {preparedExport ? (
        <div className="sync-status sync-status-ok">
          <strong>Export ready</strong>
          <span>The workbook is ready. Save it to your machine.</span>
          <div className="card-actions">
            <button className="ghost-button btn-export" onClick={async () => {
              const saveTarget = await createExportSaveTarget(preparedExport.filename);
              if (!saveTarget && typeof (window as typeof window & { showSaveFilePicker?: unknown }).showSaveFilePicker === "function") return;
              await savePreparedWorkbook(preparedExport.blob, preparedExport.filename, saveTarget);
              setExportSaved(true);
            }}>
              {exportSaved ? "Save again" : "Save workbook"}
            </button>
          </div>
        </div>
      ) : null}

      {exportError ? (
        <div className="sync-status sync-status-warn">
          <strong>Export failed</strong>
          <span>{exportError}</span>
        </div>
      ) : null}

      {activeTabResult?.widgets.some((widget) => widget.status === "failed") ? (
        <div className="sync-status sync-status-warn">
          <strong>Some widgets failed to load</strong>
          <ul className="flat-list import-review-list">
            {activeTabResult.widgets
              .filter((widget) => widget.status === "failed")
              .map((widget) => `${widget.report.name || widget.widget.title}: ${widget.error || widget.message}`)
              .map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {dashboard.runtimeFilters.length ? (
        <div className="card dashboard-filter-panel">
          <div className="card-head">
            <strong>Filters</strong>
            {Object.values(runtimeFilters).some((v) => v) ? (
              <button type="button" className="ghost-button" onClick={() => setRuntimeFilters({})}>Clear all</button>
            ) : null}
          </div>
          <div className="dashboard-live-filter-grid">
            {[...dashboard.runtimeFilters]
              .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
              .map((filter) => {
                const currentVal = runtimeFilters[filter.id] ?? "";
                const selectedValues = currentVal ? currentVal.split("|||").filter(Boolean) : [];
                const options = filterOptions[filter.id] || [];
                const fieldType = tables?.find((t) => t.id === filter.sourceTableId)?.fields.find((f) => f.id === filter.fieldId)?.type || "text";
                const isDate = fieldType === "date" || fieldType === "datetime";
                const isNumber = fieldType === "number" || fieldType === "currency";
                function toggleMultiValue(value: string) {
                  setRuntimeFilters((current) => {
                    const prev = (current[filter.id] || "").split("|||").filter(Boolean);
                    const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
                    return { ...current, [filter.id]: next.join("|||") };
                  });
                }
                return (
                  <div className="dashboard-live-filter-field" key={filter.id}>
                    <div className="dashboard-live-filter-label">
                      <span>{filter.label}</span>
                      {selectedValues.length ? (
                        <button type="button" className="ghost-button micro" onClick={() => setRuntimeFilters((c) => ({ ...c, [filter.id]: "" }))}>Clear</button>
                      ) : null}
                    </div>
                    {isDate ? (
                      <input
                        type="date"
                        className="dashboard-live-filter-input"
                        value={currentVal}
                        onChange={(e) => setRuntimeFilters((c) => ({ ...c, [filter.id]: e.target.value }))}
                      />
                    ) : isNumber ? (
                      <input
                        type="number"
                        className="dashboard-live-filter-input"
                        value={currentVal}
                        placeholder="Enter value"
                        onChange={(e) => setRuntimeFilters((c) => ({ ...c, [filter.id]: e.target.value }))}
                      />
                    ) : options.length ? (
                      <div className="filter-dropdown-wrap">
                        <button
                          type="button"
                          className="filter-dropdown-trigger"
                          onClick={() => setOpenFilterId((id) => id === filter.id ? null : filter.id)}
                        >
                          <span className="filter-dropdown-trigger-label">
                            {selectedValues.length === 0
                              ? "Select…"
                              : selectedValues.length === 1
                              ? selectedValues[0]
                              : `${selectedValues.length} selected`}
                          </span>
                          <span className="filter-dropdown-arrow">{openFilterId === filter.id ? "▲" : "▼"}</span>
                        </button>
                        {openFilterId === filter.id ? (
                          <div className="filter-dropdown-menu">
                            {options.map((opt) => (
                              <label key={opt} className="filter-dropdown-option">
                                <input
                                  type="checkbox"
                                  checked={selectedValues.includes(opt)}
                                  onChange={() => toggleMultiValue(opt)}
                                />
                                <span>{opt}</span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <input
                        className="dashboard-live-filter-input"
                        value={currentVal}
                        placeholder="Type to filter…"
                        onChange={(e) => setRuntimeFilters((c) => ({ ...c, [filter.id]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
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
            <span className="micro">{activeTab.widgets.length || 0} {activeTab.widgets.length === 1 ? "card" : "cards"}</span>
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
          {!isOverviewTab ? (
            activeTab.widgets.length === 0 && !dashboardLoading ? (
              <div className="sync-status" style={{ borderLeft: "4px solid var(--border-md, #B0BEC8)" }}>
                <strong>This tab has no report configured</strong>
                <span>Open this dashboard in the Building area and add a report card to this tab.</span>
              </div>
            ) : (
              <div className="stack">
                {activeTab.widgets.map((widget) => {
                  const pagedResult = widgetPageResults[widget.widgetId] || widget.result;
                  const currentPage = widgetPages[widget.widgetId] || pagedResult.page || 1;
                  const totalPages = pagedResult.totalPages || 1;
                  const pageLoading = widgetPageLoading[widget.widgetId];
                  const widgetTable = tables?.find((item) => item.id === widget.report.sourceTableId || item.quickbaseTableId === widget.report.sourceTableId);
                  const axisLabels = getChartAxisLabels(tables, widget.report);
                  const resolvedDisplayMode = resolveDashboardWidgetRenderMode(widget.widget, widget.report.view.mode);
                  const isSummaryOnly = resolvedDisplayMode === "summary";
                  const showsTable = (resolvedDisplayMode === "table" || widgetRenderMode(widget.widget, widget.report) === "timeline" || widgetRenderMode(widget.widget, widget.report) === "calendar" || widgetRenderMode(widget.widget, widget.report) === "kanban" || widget.widget.showDetails) && !isSummaryOnly;
                  const widgetTitle = widget.report.name || widget.widget.title;
                  return (
                    <div key={widget.widgetId} className="tab-widget-section">
                      <div className="tab-widget-section-head">
                        <strong>{widgetTitle}</strong>
                        {widget.status === "complete" ? (
                          <button type="button" className="widget-action-button" onClick={() => setFocusedWidgetId(widget.widgetId)}>Focus</button>
                        ) : null}
                      </div>
                      <div className={`widget-state-banner ${widget.status === "failed" ? "widget-state-banner-failed" : "widget-state-banner-ready"}`}>
                        <strong>{widget.status === "failed" ? "Widget unavailable" : "Widget ready"}</strong>
                        <span>{widget.error || widget.message}</span>
                      </div>
                      {widget.status === "complete" && (widget.widget.showSummary || isSummaryOnly) && pagedResult.summary.length > 0 ? (
                        <div className="widget-metrics">
                          {pagedResult.summary.map((item) => (
                            <div key={item.label} className="mini-stat">
                              <strong>{item.value}</strong>
                              <span>{item.label}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {widget.status === "complete" && pagedResult.crosstab ? (
                        <div className="pivot-table-shell">
                          <table className="pivot-table">
                            {widget.report.view.pivotOrientation === "vertical" ? (
                              <>
                                <thead><tr>
                                  <th className="pivot-metric-col"></th>
                                  {pagedResult.crosstab.rows.map((row, i) => <th key={i}>{row.label}</th>)}
                                </tr></thead>
                                <tbody>
                                  {pagedResult.crosstab.columns.map((col, ci) => (
                                    <tr key={ci} className={col === "Grand Total" ? "pivot-grand-total" : ""}>
                                      <td className="pivot-row-header">{col || "(blank)"}</td>
                                      {pagedResult.crosstab!.rows.map((row, ri) => (
                                        <td key={ri}>{row.formatted[ci]}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </>
                            ) : (
                              <>
                                <thead><tr>
                                  <th className="pivot-metric-col"></th>
                                  {pagedResult.crosstab.columns.map((col, ci) => (
                                    <th key={ci} className={col === "Grand Total" ? "pivot-grand-total" : ""}>{col || "(blank)"}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {pagedResult.crosstab.rows.map((row) => (
                                    <tr key={row.label}>
                                      <td className="pivot-row-header">{row.label}</td>
                                      {row.formatted.map((val, vi) => (
                                        <td key={vi} className={pagedResult.crosstab!.columns[vi] === "Grand Total" ? "pivot-grand-total" : ""}>{val}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </>
                            )}
                          </table>
                        </div>
                      ) : null}
                      {widget.status === "complete" && widgetShowsChart(widget.widget, widget.report) ? (
                        <div className="chart-scroll-shell" ref={bindChartMeasureRef(widget.widgetId)}>
                          {(() => {
                            const chartBounds = getChartViewportBounds(widget.report.view.chartType, pagedResult.chartData.length, false);
                            return (
                              <div style={{ minWidth: `${chartBounds.minWidth}px`, minHeight: `${chartBounds.minHeight}px`, width: "100%", height: "100%" }}>
                                <ChartPreview
                                  chartType={widget.report.view.chartType}
                                  data={pagedResult.chartData.length ? pagedResult.chartData : widget.result.chartData}
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
                                  showLegend={widget.report.view.chartShowLegend}
                                  showValues={widget.report.view.chartShowValues}
                                  viewportHeight={chartBounds.minHeight}
                                  openLinksInNewTab={openLinksInNewTab}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                      {widget.status === "complete" && showsTable ? (
                        <>
                          {(pagedResult.hasNextPage || currentPage > 1) ? (
                            <div className="link-toolbar">
                              {currentPage > 1 ? <button className="ghost-button" disabled={pageLoading} onClick={() => { void changeWidgetPage(widget, currentPage - 1); }}>Previous</button> : null}
                              <span className="micro">Page {currentPage} of {totalPages} · {pagedResult.totalRows || 0} rows</span>
                              {pagedResult.hasNextPage ? <button className="ghost-button" disabled={pageLoading} onClick={() => { void changeWidgetPage(widget, currentPage + 1); }}>Next</button> : null}
                            </div>
                          ) : null}
                          <div className="report-table-scroll-wrap">
                            <ResizableDataTable
                              className="report-table-shell"
                              columns={widget.report.selectedFieldIds.map((fieldId) => ({
                                key: fieldId,
                                label: getFieldLabel(tables, widget.report, fieldId)
                              }))}
                              rows={pagedResult.rows.map((row, index) => ({
                                key: String(row.__recordId || index),
                                cells: widget.report.selectedFieldIds.map((fieldId) =>
                                  widgetTable ? formatReportCellValue(widget.report, widgetTable, fieldId, row[fieldId]) : String(row[fieldId] ?? "")
                                )
                              }))}
                            />
                          </div>
                        </>
                      ) : null}
                      {dashboardLoading && !pagedResult.rows.length && !pagedResult.summary.length && !pagedResult.crosstab ? <div className="empty">Loading…</div> : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
          {isOverviewTab ? <div className="widget-grid dashboard-layout-grid">
            {activeTab.widgets.map((widget) => {
              const pagedResult = widgetPageResults[widget.widgetId] || widget.result;
              const currentPage = widgetPages[widget.widgetId] || pagedResult.page || 1;
              const totalPages = pagedResult.totalPages || 1;
              const pageLoading = widgetPageLoading[widget.widgetId];
              const summaryData = pagedResult.summary.length ? pagedResult.summary : widget.result.summary;
              const chartData = pagedResult.chartData.length ? pagedResult.chartData : widget.result.chartData;
              const widgetTable = tables?.find((item) => item.id === widget.report.sourceTableId || item.quickbaseTableId === widget.report.sourceTableId);
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
              const resolvedDisplayMode = resolveDashboardWidgetRenderMode(widget.widget, widget.report.view.mode);
              const crosstabData = pagedResult.crosstab || widget.result.crosstab;
              const isSummaryOnly = resolvedDisplayMode === "summary" && !crosstabData;
              const widgetTitle = widget.report.name || widget.widget.title;
              const displayTitle = isSummaryOnly ? `${widgetTitle} - Summary` : widgetTitle;
              return (
              <article className="widget-card dashboard-layout-item" key={widget.widgetId} style={getDashboardWidgetLayoutStyle(widget.widget, activeTabLayout.get(widget.widgetId) || null)}>
                <div className="widget-head">
                  <strong>{displayTitle}</strong>
                  <div className="widget-preview-controls">
                    <button type="button" className="widget-action-button" onClick={() => setFocusedWidgetId(widget.widgetId)}>Focus card</button>
                    {widget.report.sourceTableId ? (
                      <Link to={buildHostedRoute(`/report/${widget.report.id}`)} className="widget-action-button" target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open report</Link>
                    ) : null}
                  </div>
                </div>
                <div className={`widget-state-banner ${widget.status === "failed" ? "widget-state-banner-failed" : "widget-state-banner-ready"}`}>
                  <strong>{widget.status === "failed" ? "Widget unavailable" : "Widget ready"}</strong>
                  <span>{widget.error || widget.message}</span>
                </div>
                {widget.status === "complete" && (widget.widget.showSummary || isSummaryOnly) && summaryData.length > 0 ? (
                  <div className="widget-metrics">
                    {summaryData.map((item) => (
                      <div key={item.label} className="mini-stat">
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {widget.status === "complete" && crosstabData ? (
                  <div className="pivot-table-shell">
                    <table className="pivot-table">
                      {widget.report.view.pivotOrientation === "vertical" ? (
                        <>
                          <thead><tr>
                            <th className="pivot-metric-col"></th>
                            {crosstabData.rows.map((row, i) => <th key={i}>{row.label}</th>)}
                          </tr></thead>
                          <tbody>
                            {crosstabData.columns.map((col, ci) => (
                              <tr key={ci} className={col === "Grand Total" ? "pivot-grand-total" : ""}>
                                <td className="pivot-row-header">{col || "(blank)"}</td>
                                {crosstabData.rows.map((row, ri) => (
                                  <td key={ri}>{row.formatted[ci]}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </>
                      ) : (
                        <>
                          <thead><tr>
                            <th className="pivot-metric-col"></th>
                            {crosstabData.columns.map((col, ci) => (
                              <th key={ci} className={col === "Grand Total" ? "pivot-grand-total" : ""}>{col || "(blank)"}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {crosstabData.rows.map((row) => (
                              <tr key={row.label}>
                                <td className="pivot-row-header">{row.label}</td>
                                {row.formatted.map((val, vi) => (
                                  <td key={vi} className={crosstabData.columns[vi] === "Grand Total" ? "pivot-grand-total" : ""}>{val}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </>
                      )}
                    </table>
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
                          getDatumHref={undefined}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {widget.status === "complete" && !isSummaryOnly && !widgetShowsChart(widget.widget, widget.report) && pagedResult.totalRows > 0 ? (
                  <span className="micro" style={{ padding: "4px 0", display: "block" }}>{pagedResult.totalRows.toLocaleString()} rows — open tab to view details</span>
                ) : null}
                </article>
              );
            })}
            {dashboardLoading && !activeTab.widgets.length ? <div className="empty">Rendering dashboard…</div> : null}
            {!dashboardLoading && !tabErrors[activeTab.id] && !activeTab.widgets.length ? (
              <div className="sync-status" style={{ borderLeft: "4px solid var(--border-md, #B0BEC8)" }}>
                <strong>This tab has no cards configured</strong>
                <span>Open this dashboard in the Building area and add report or chart cards to this tab.</span>
              </div>
            ) : null}
          </div>
          : null}
        </div>
      ) : null}

      {focusedWidget ? (
        <div className="focus-overlay" role="dialog" aria-modal="true">
          <div className="focus-overlay-card">
            <div className="card-head">
              <strong>{(() => {
                const base = focusedWidget.widget.title || focusedWidget.report.name;
                const focusedResolvedMode = resolveDashboardWidgetRenderMode(focusedWidget.widget, focusedWidget.report.view.mode);
                const focusedIsSummaryOnly = focusedResolvedMode === "summary" && !focusedWidget.result.crosstab;
                return focusedIsSummaryOnly ? `${base} - Summary` : base;
              })()}</strong>
              <div className="link-toolbar">
                {focusedWidget.report.sourceTableId ? (
                  <Link className="ghost-button" to={buildHostedRoute(`/report/${focusedWidget.report.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open report</Link>
                ) : null}
                <button className="ghost-button" onClick={() => setFocusedWidgetId("")}>Close</button>
              </div>
            </div>
            {(focusedWidget.widget.showSummary || (resolveDashboardWidgetRenderMode(focusedWidget.widget, focusedWidget.report.view.mode) === "summary" && !focusedWidget.result.crosstab)) && focusedWidget.result.summary.length > 0 ? (
              <div className="widget-metrics">
                {focusedWidget.result.summary.map((item) => (
                  <div key={item.label} className="mini-stat">
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {focusedWidget.result.crosstab ? (
              <div className="pivot-table-shell">
                <table className="pivot-table">
                  {focusedWidget.report.view.pivotOrientation === "vertical" ? (
                    <>
                      <thead><tr>
                        <th className="pivot-metric-col"></th>
                        {focusedWidget.result.crosstab.rows.map((row, i) => <th key={i}>{row.label}</th>)}
                      </tr></thead>
                      <tbody>
                        {focusedWidget.result.crosstab.columns.map((col, ci) => (
                          <tr key={ci} className={col === "Grand Total" ? "pivot-grand-total" : ""}>
                            <td className="pivot-row-header">{col || "(blank)"}</td>
                            {focusedWidget.result.crosstab!.rows.map((row, ri) => (
                              <td key={ri}>{row.formatted[ci]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead><tr>
                        <th className="pivot-metric-col"></th>
                        {focusedWidget.result.crosstab.columns.map((col, ci) => (
                          <th key={ci} className={col === "Grand Total" ? "pivot-grand-total" : ""}>{col || "(blank)"}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {focusedWidget.result.crosstab.rows.map((row) => (
                          <tr key={row.label}>
                            <td className="pivot-row-header">{row.label}</td>
                            {row.formatted.map((val, vi) => (
                              <td key={vi} className={focusedWidget.result.crosstab!.columns[vi] === "Grand Total" ? "pivot-grand-total" : ""}>{val}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}
                </table>
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
            {(widgetRenderMode(focusedWidget.widget, focusedWidget.report) === "table" || focusedWidget.widget.showDetails) ? (() => {
              const focusedPagedResult = widgetPageResults[focusedWidget.widgetId] || focusedWidget.result;
              const focusedCurrentPage = widgetPages[focusedWidget.widgetId] || focusedPagedResult.page || 1;
              const focusedTotalPages = focusedPagedResult.totalPages || 1;
              const focusedPageLoading = widgetPageLoading[focusedWidget.widgetId];
              const focusedWidgetTable = tables?.find((item) => item.id === focusedWidget.report.sourceTableId || item.quickbaseTableId === focusedWidget.report.sourceTableId);
              return (
                <>
                  <div className="link-toolbar">
                    {focusedCurrentPage > 1 ? <button className="ghost-button" disabled={focusedPageLoading} onClick={() => { void changeWidgetPage(focusedWidget, focusedCurrentPage - 1); }}>Previous</button> : null}
                    <span className="micro">Page {focusedCurrentPage} of {focusedTotalPages} · {focusedPagedResult.totalRows || 0} rows</span>
                    {focusedPagedResult.hasNextPage ? <button className="ghost-button" disabled={focusedPageLoading} onClick={() => { void changeWidgetPage(focusedWidget, focusedCurrentPage + 1); }}>Next</button> : null}
                  </div>
                  <ResizableDataTable
                    className="focus-table-shell"
                    columns={focusedWidget.report.selectedFieldIds.map((fieldId) => ({
                      key: fieldId,
                      label: getFieldLabel(tables, focusedWidget.report, fieldId)
                    }))}
                    rows={focusedPagedResult.rows.map((row, index) => ({
                      key: String(row.__recordId || index),
                      cells: focusedWidget.report.selectedFieldIds.map((fieldId) =>
                        focusedWidgetTable ? formatReportCellValue(focusedWidget.report, focusedWidgetTable, fieldId, row[fieldId]) : String(row[fieldId] ?? "")
                      )
                    }))}
                  />
                </>
              );
            })() : null}
          </div>
        </div>
      ) : null}
        </div>
      </div>
      </section>
    </>
  );
}
