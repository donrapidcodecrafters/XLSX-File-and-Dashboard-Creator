import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatReportCellValue, getReportFieldLabel, type ExportJobStatus, type ReportDefinition, type ReportFocusMode, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { RefreshOverlay } from "./RefreshOverlay";
import { ResizableDataTable } from "./ResizableDataTable";
import { createExportSaveTarget, downloadExportJob, fetchExportJobStatus, startReportExportJob, type ExportSaveTarget } from "../lib/api";
import { buildHostedRoute, buildObjectUrl, getHostedContext } from "../lib/embed";
import { buildQuickbaseChartDatumUrl, buildQuickbaseRecordEditUrl, buildQuickbaseReportFilterTree, type QuickbaseTableLinkContext } from "../lib/quickbaseLinks";

interface ReportViewProps {
  report: ReportDefinition;
  table?: TableDefinition;
  quickbaseLinkContext?: QuickbaseTableLinkContext | null;
  result?: ReportRunResult;
  loading: boolean;
  currentPage: number;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  initialFocusMode?: ReportFocusMode;
  initialFocusedSection?: "" | "chart" | "details";
  savedViews?: Array<{
    id: string;
    name: string;
    currentPage: number;
    focusMode: ReportFocusMode;
    focusedSection: "" | "chart" | "details";
    updatedAt: string;
  }>;
  onSaveView?: (view: {
    id: string;
    name: string;
    currentPage: number;
    focusMode: ReportFocusMode;
    focusedSection: "" | "chart" | "details";
  }) => void;
  onDeleteView?: (viewId: string) => void;
  onStateChange?: (state: { currentPage: number; focusMode: ReportFocusMode; focusedSection: "" | "chart" | "details" }) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  openLinksInNewTab?: boolean;
}

function reportShowsChart(report: ReportDefinition) {
  return report.view.mode === "chart" || (report.view.mode === "table" && report.view.showChartInTable);
}

function reportShowsSummary(report: ReportDefinition) {
  if (typeof report.view.showSummary === "boolean") return report.view.showSummary;
  return report.view.mode === "table" || report.view.mode === "summary" || report.view.mode === "chart";
}

function reportShowsDetails(report: ReportDefinition) {
  if (typeof report.view.showDetails === "boolean") return report.view.showDetails;
  return report.view.mode === "table" || report.view.mode === "timeline" || report.view.mode === "calendar" || report.view.mode === "kanban";
}

function formatFreshnessTimestamp(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getChartFieldId(report: ReportDefinition) {
  return report.view.chartFieldId || report.groups[0]?.fieldId || report.selectedFieldIds[0] || "";
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

function getReadableFieldLabel(report: ReportDefinition, fieldId: string, table?: TableDefinition) {
  const displayLabel = report.displayLabels?.fields?.[fieldId]?.trim();
  if (displayLabel) return displayLabel;
  if (table) {
    const tableLabel = getReportFieldLabel(report, table, fieldId);
    if (tableLabel && tableLabel !== fieldId) return tableLabel;
  }
  return formatFallbackFieldLabel(fieldId);
}

function getChartAxisLabels(report: ReportDefinition, table?: TableDefinition) {
  const xFieldId = getChartFieldId(report);
  const primaryFieldLabel = report.view.chartValueFieldId
    ? getReadableFieldLabel(report, report.view.chartValueFieldId, table)
    : "";
  const secondaryFieldLabel = report.view.chartSecondaryValueFieldId
    ? getReadableFieldLabel(report, report.view.chartSecondaryValueFieldId, table)
    : "";
  return {
    xAxisLabel: report.view.chartXAxisLabel?.trim()
      || (xFieldId ? getReadableFieldLabel(report, xFieldId, table) : ""),
    yAxisLabel: report.view.chartYAxisLabel?.trim()
      || primaryFieldLabel
      || (report.view.chartAggregation === "count" ? "Rows" : ""),
    secondaryYAxisLabel: report.view.chartSecondaryYAxisLabel?.trim()
      || (report.view.chartUseSecondaryAxis
        ? (secondaryFieldLabel || (report.view.chartSecondaryAggregation === "count" ? "Rows" : ""))
        : "")
  };
}

function availableReportFocusModes(
  report: ReportDefinition,
  options: {
    summaryAvailable?: boolean;
    chartAvailable?: boolean;
    detailsAvailable?: boolean;
  } = {}
): ReportFocusMode[] {
  const modes: ReportFocusMode[] = ["default"];
  const summaryAvailable = options.summaryAvailable ?? reportShowsSummary(report);
  const chartAvailable = options.chartAvailable ?? reportShowsChart(report);
  const detailsAvailable = options.detailsAvailable ?? reportShowsDetails(report);
  const defaultShowsSummary = summaryAvailable && reportShowsSummary(report);
  const defaultShowsChart = chartAvailable && reportShowsChart(report);
  const defaultShowsDetails = detailsAvailable && reportShowsDetails(report);
  const defaultSectionCount = [defaultShowsSummary, defaultShowsChart, defaultShowsDetails].filter(Boolean).length;
  if (summaryAvailable && !(defaultSectionCount === 1 && defaultShowsSummary)) modes.push("summary");
  if (chartAvailable && !(defaultSectionCount === 1 && defaultShowsChart)) modes.push("chart");
  if (detailsAvailable && !(defaultSectionCount === 1 && defaultShowsDetails)) modes.push("details");
  return modes;
}

function normalizeReportFocusMode(
  report: ReportDefinition,
  candidate?: ReportFocusMode,
  options: {
    summaryAvailable?: boolean;
    chartAvailable?: boolean;
    detailsAvailable?: boolean;
  } = {}
): ReportFocusMode {
  const modes = availableReportFocusModes(report, options);
  return candidate && modes.includes(candidate) ? candidate : "default";
}

function buildExportFilename(name: string) {
  const safe = String(name || "report")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe || "report"}.xlsx`;
}

export function ReportView({
  report,
  table,
  quickbaseLinkContext = null,
  result,
  loading,
  currentPage,
  onPageChange,
  onRefresh,
  initialFocusMode = "default",
  initialFocusedSection = "",
  savedViews = [],
  onSaveView,
  onDeleteView,
  onStateChange,
  isFavorite = false,
  onToggleFavorite,
  openLinksInNewTab = false
}: ReportViewProps) {
  const hosted = getHostedContext();
  const fullScreenUrl = buildObjectUrl("report", report.id, { viewer: true });
  const totalPages = result?.totalPages || 1;
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState("");
  const [pendingSaveOnReady, setPendingSaveOnReady] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(true);
  const autoExportStartedRef = useRef(false);
  const summaryAvailable = reportShowsSummary(report) && Boolean(result?.summary?.length);
  const chartAvailable = reportShowsChart(report) && (loading || Boolean(result?.chartData?.length));
  const detailsAvailable = reportShowsDetails(report) && (
    loading
      || Boolean(result?.rows?.length)
      || Number(result?.totalRows || 0) > 0
  );
  const [focusMode, setFocusMode] = useState<ReportFocusMode>(
    normalizeReportFocusMode(report, initialFocusMode, { summaryAvailable, chartAvailable, detailsAvailable })
  );
  const [focusedSection, setFocusedSection] = useState<"" | "chart" | "details">(initialFocusedSection);
  const chartFieldId = getChartFieldId(report);
  const axisLabels = getChartAxisLabels(report, table);
  const quickbaseFilterTree = buildQuickbaseReportFilterTree(report);
  const focusModes = useMemo(
    () => availableReportFocusModes(report, { summaryAvailable, chartAvailable, detailsAvailable }),
    [chartAvailable, detailsAvailable, report, summaryAvailable]
  );
  const skipStateBroadcastRef = useRef(true);
  const lastBroadcastStateRef = useRef("");

  useEffect(() => {
    skipStateBroadcastRef.current = true;
    lastBroadcastStateRef.current = "";
  }, [report.id]);

  useEffect(() => {
    setFocusMode(normalizeReportFocusMode(report, initialFocusMode, { summaryAvailable, chartAvailable, detailsAvailable }));
  }, [chartAvailable, detailsAvailable, initialFocusMode, report, summaryAvailable]);

  useEffect(() => {
    setFocusedSection(initialFocusedSection || "");
  }, [initialFocusedSection, report.id]);

  useEffect(() => {
    if (!onStateChange) return;
    const nextState = JSON.stringify({
      currentPage: Math.max(1, currentPage),
      focusMode: normalizeReportFocusMode(report, focusMode, { summaryAvailable, chartAvailable, detailsAvailable }),
      focusedSection
    });
    if (skipStateBroadcastRef.current) {
      skipStateBroadcastRef.current = false;
      lastBroadcastStateRef.current = nextState;
      return;
    }
    if (lastBroadcastStateRef.current === nextState) return;
    const handle = window.setTimeout(() => {
      lastBroadcastStateRef.current = nextState;
      onStateChange({
        currentPage: Math.max(1, currentPage),
        focusMode: normalizeReportFocusMode(report, focusMode, { summaryAvailable, chartAvailable, detailsAvailable }),
        focusedSection
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [chartAvailable, currentPage, detailsAvailable, focusMode, focusedSection, onStateChange, report, summaryAvailable]);

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
        const saveTarget = await createExportSaveTarget(buildExportFilename(report.name));
        if (!saveTarget || cancelled) return;
        await downloadExportJob(completedJob.id, {
          directDownload: hosted.embed,
          saveTarget,
          fallbackFilename: buildExportFilename(report.name)
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
  }, [downloadedJobId, exportJob, hosted.embed, pendingSaveOnReady, report.name]);

  useEffect(() => {
    if (hosted.autoDownload !== "xlsx") return;
    if (autoExportStartedRef.current) return;
    autoExportStartedRef.current = true;
    window.history.replaceState({}, document.title, buildObjectUrl("report", report.id, { viewer: true }));
    void beginExportInPlace();
  }, [hosted.autoDownload, report.id]);

  async function beginExportInPlace() {
    const response = await startReportExportJob({ reportId: report.id, report, table });
    setExportJob(response.job);
    setDownloadedJobId("");
  }

  async function beginExport() {
    if (exportJob?.status === "complete" && downloadedJobId !== exportJob.id) {
      const saveTarget = await createExportSaveTarget(buildExportFilename(report.name));
      if (!saveTarget) return;
      await downloadExportJob(exportJob.id, {
        directDownload: hosted.embed,
        saveTarget,
        fallbackFilename: buildExportFilename(report.name)
      });
      setDownloadedJobId(exportJob.id);
      setPendingSaveOnReady(false);
      return;
    }
    setPendingSaveOnReady(true);
    await beginExportInPlace();
  }

  function freshnessLabel() {
    if (result?.freshness?.source === "quickbase-live") return "Live Quickbase data";
    if (result?.freshness?.source === "scheduled-cache") return "Scheduled refresh cache";
    return "Local fallback data";
  }

  const resolvedFocusMode = normalizeReportFocusMode(report, focusMode, { summaryAvailable, chartAvailable, detailsAvailable });
  const showSummary = summaryAvailable && (resolvedFocusMode === "default" || resolvedFocusMode === "summary");
  const showChart = chartAvailable && (resolvedFocusMode === "default" || resolvedFocusMode === "chart");
  const showDetails = detailsAvailable && (resolvedFocusMode === "default" || resolvedFocusMode === "details");

  function resetView() {
    onPageChange(1);
    setFocusMode("default");
    setFocusedSection("");
  }

  function saveCurrentView() {
    if (!onSaveView) return;
    const entered = window.prompt("Save report view as", `${report.name} view`);
    const name = String(entered || "").trim();
    if (!name) return;
    onSaveView({
      id: `report-view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      currentPage: Math.max(1, currentPage),
      focusMode: resolvedFocusMode,
      focusedSection
    });
  }

  function applySavedView(view: NonNullable<ReportViewProps["savedViews"]>[number]) {
    onPageChange(Math.max(1, view.currentPage || 1));
    setFocusMode(normalizeReportFocusMode(report, view.focusMode, { summaryAvailable, chartAvailable, detailsAvailable }));
    setFocusedSection(view.focusedSection || "");
  }

  function renderDetailContent(tableShellClassName = "report-table-shell") {
    if (!result) return null;
    const rows = result.rows || [];
    if (report.view.mode === "timeline" || report.view.mode === "calendar") {
      const dateFieldId = report.view.mode === "timeline" ? report.view.timelineDateField : report.view.calendarDateField;
      const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0] || "";
      return (
        <div className="studio-card-grid">
          {rows.map((row, index) => (
            <article className="studio-mini-card" key={index}>
              <strong>{table ? formatReportCellValue(report, table, titleFieldId, row[titleFieldId]) : String(row[titleFieldId] ?? "")}</strong>
              <span>{getReadableFieldLabel(report, dateFieldId, table) || "Date"}: {table ? formatReportCellValue(report, table, dateFieldId, row[dateFieldId]) : String(row[dateFieldId] ?? "")}</span>
              {report.view.mode === "timeline" && report.view.timelineEndField ? (
                <span>Ends: {table ? formatReportCellValue(report, table, report.view.timelineEndField, row[report.view.timelineEndField]) : String(row[report.view.timelineEndField] ?? "")}</span>
              ) : null}
            </article>
          ))}
        </div>
      );
    }
    if (report.view.mode === "kanban") {
      const statusFieldId = report.view.kanbanField || report.selectedFieldIds[0] || "";
      const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0] || "";
      const columns = new Map<string, typeof rows>();
      rows.forEach((row) => {
        const key = table ? formatReportCellValue(report, table, statusFieldId, row[statusFieldId]) : String(row[statusFieldId] ?? "Unassigned");
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
                    <strong>{table ? formatReportCellValue(report, table, titleFieldId, row[titleFieldId]) : String(row[titleFieldId] ?? "")}</strong>
                    {report.selectedFieldIds.filter((fieldId) => fieldId !== titleFieldId).slice(0, 3).map((fieldId) => (
                      <span key={fieldId}>{table ? formatReportCellValue(report, table, fieldId, row[fieldId]) : String(row[fieldId] ?? "")}</span>
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
        className={tableShellClassName}
        columns={[
          ...(quickbaseLinkContext ? [{ key: "__quickbase", label: "Quickbase", minWidth: 120, defaultWidth: 120, className: "table-action-col" }] : []),
          ...report.selectedFieldIds.map((fieldId) => ({
            key: fieldId,
            label: getReadableFieldLabel(report, fieldId, table) || "Value"
          }))
        ]}
        rows={rows.map((row, index) => ({
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
            ...report.selectedFieldIds.map((fieldId) =>
              table ? formatReportCellValue(report, table, fieldId, row[fieldId]) : String(row[fieldId] ?? "")
            )
          ]
        }))}
      />
    );
  }

  return (
    <>
      {loading ? (
        <RefreshOverlay
          title="Loading this report"
          indeterminate
          job={{
            message: result ? "Refreshing report results…" : "Rendering report and loading rows if needed…"
          }}
        />
      ) : null}
      <section className="surface stack">
        <div className="hero reader-hero">
          <div>
            <span className="badge brand">Report</span>
            <h1>{report.name}</h1>
            <p>{report.description || "Full-screen report view with live data, summaries, charts, and detail rows."}</p>
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
                        <Link className="ghost-button" to={buildHostedRoute(`/studio/${report.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open in building area</Link>
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
                    <button className="ghost-button" onClick={() => { void beginExport(); }} disabled={!result || exportJob?.status === "queued" || exportJob?.status === "running"}>
                      {exportJob?.status === "queued" || exportJob?.status === "running"
                        ? `Exporting ${exportJob.progress}%`
                        : exportJob?.status === "complete" && downloadedJobId !== exportJob.id
                          ? "Save xlsx"
                          : "Download xlsx"}
                    </button>
                    <button className="ghost-button" onClick={onRefresh} disabled={loading}>
                      {loading ? "Refreshing…" : "Refresh now"}
                    </button>
                    <button className="ghost-button" onClick={resetView}>Reset view</button>
                    {onSaveView ? <button className="ghost-button" onClick={saveCurrentView}>Save view</button> : null}
                  </div>
                </div>

                {focusModes.length > 1 ? (
                  <div className="reader-sidebar-section">
                    <strong>View</strong>
                    <div className="reader-sidebar-actions">
                      {focusModes.map((mode) => (
                        <button
                          key={mode}
                          className={`ghost-button ${resolvedFocusMode === mode ? "active-tab" : ""}`}
                          onClick={() => setFocusMode(mode)}
                        >
                          {mode === "default" ? "Default layout" : mode === "summary" ? "Summary" : mode === "chart" ? "Chart" : "Details"}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {hosted.embed ? null : (
                  <div className="reader-sidebar-section">
                    <strong>Links</strong>
                    <LinkToolbar type="report" id={report.id} />
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
            <span className="micro">Personal bookmarks for page, layout, and focus state</span>
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

      {result?.freshness ? (
        <div className={`sync-status ${result.freshness.source === "quickbase-live" || result.freshness.source === "scheduled-cache" ? "sync-status-ok" : "sync-status-warn"}`}>
          <strong>{freshnessLabel()}</strong>
          <span>Fetched {formatFreshnessTimestamp(result.freshness.fetchedAt)}</span>
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

      {result?.warnings?.length ? (
        <div className="sync-status sync-status-warn">
          <strong>Report warnings</strong>
          <ul className="flat-list import-review-list">
            {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {showSummary ? (
        <div className="summary-grid">
          {(result?.summary || []).map((item) => (
            <div className="summary-card" key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showChart ? (
        <div className="card">
          <div className="card-head">
            <strong>Chart</strong>
            <span className="micro">{table?.name || report.sourceTableId}</span>
          </div>
          {loading ? (
            <div className="empty">Running report…</div>
          ) : (
            <>
              <div className="link-toolbar">
                <button className="ghost-button" onClick={() => setFocusedSection("chart")}>Focus chart</button>
              </div>
              <ChartPreview
                chartType={report.view.chartType}
                data={result?.chartData || []}
                title={report.view.chartTitle}
                decimalPlaces={report.view.decimalPlaces}
                chartColors={report.view.chartColors}
                chartOrientation={report.view.chartOrientation}
                xAxisLabel={axisLabels.xAxisLabel}
                yAxisLabel={axisLabels.yAxisLabel}
                secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
                secondarySeriesType={report.view.chartSecondarySeriesType}
                showLegend={report.view.chartShowLegend}
                showValues={report.view.chartShowValues}
                openLinksInNewTab={openLinksInNewTab}
                getDatumHref={(datum) => buildQuickbaseChartDatumUrl(quickbaseLinkContext, table, chartFieldId, datum, quickbaseFilterTree)}
              />
            </>
          )}
        </div>
      ) : null}

      {showDetails ? (
        <div className="card">
          <div className="card-head">
            <strong>Details</strong>
            <span className="micro">{result?.totalRows || 0} rows</span>
          </div>
          <div className="link-toolbar">
            <button className="ghost-button" disabled={currentPage <= 1 || loading} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>Previous</button>
            <span className="micro">Page {result?.page || currentPage} of {totalPages}</span>
            <button className="ghost-button" disabled={!result?.hasNextPage || loading} onClick={() => onPageChange(currentPage + 1)}>Next</button>
            <button className="ghost-button" onClick={() => setFocusedSection("details")}>Focus details</button>
          </div>
          {loading ? (
            <div className="empty">Loading rows…</div>
          ) : (
            renderDetailContent()
          )}
        </div>
      ) : null}

      {focusedSection === "chart" && showChart ? (
        <div className="focus-overlay" role="dialog" aria-modal="true">
          <div className="focus-overlay-card">
            <div className="card-head">
              <strong>{report.name} · Chart focus</strong>
              <button className="ghost-button" onClick={() => setFocusedSection("")}>Close</button>
            </div>
            <ChartPreview
              chartType={report.view.chartType}
              data={result?.chartData || []}
              title={report.view.chartTitle}
              decimalPlaces={report.view.decimalPlaces}
              chartColors={report.view.chartColors}
              chartOrientation={report.view.chartOrientation}
              xAxisLabel={axisLabels.xAxisLabel}
              yAxisLabel={axisLabels.yAxisLabel}
              secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
              secondarySeriesType={report.view.chartSecondarySeriesType}
              showLegend={report.view.chartShowLegend}
              showValues={report.view.chartShowValues}
              openLinksInNewTab={openLinksInNewTab}
              getDatumHref={(datum) => buildQuickbaseChartDatumUrl(quickbaseLinkContext, table, chartFieldId, datum, quickbaseFilterTree)}
            />
          </div>
        </div>
      ) : null}

      {focusedSection === "details" && showDetails ? (
        <div className="focus-overlay" role="dialog" aria-modal="true">
          <div className="focus-overlay-card">
            <div className="card-head">
              <strong>{report.name} · Detail focus</strong>
              <button className="ghost-button" onClick={() => setFocusedSection("")}>Close</button>
            </div>
            {renderDetailContent("focus-table-shell")}
          </div>
        </div>
      ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
