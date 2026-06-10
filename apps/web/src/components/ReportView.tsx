import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatReportCellValue, getReportFieldLabel, type ReportDefinition, type ReportFocusMode, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { RefreshOverlay } from "./RefreshOverlay";
import { ResizableDataTable } from "./ResizableDataTable";
import { createExportSaveTarget, fetchReportExportBundle, type ExportSaveTarget } from "../lib/api";
import { buildHostedRoute, buildObjectUrl, getHostedContext } from "../lib/embed";
import { buildQuickbaseChartDatumUrl, buildQuickbaseRecordEditUrl, buildQuickbaseReportFilterTree, type QuickbaseTableLinkContext } from "../lib/quickbaseLinks";
import { getChartViewportBounds } from "./studioReportUtils";
import { exportReportWorkbook } from "../lib/workbookExport";

interface ReportViewProps {
  report: ReportDefinition;
  table?: TableDefinition;
  quickbaseLinkContext?: QuickbaseTableLinkContext | null;
  result?: ReportRunResult;
  loadError?: string;
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
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  return `${safe || "report"} ${timestamp}.xlsx`;
}

function buildExportTableFallback(report: ReportDefinition, table?: TableDefinition) {
  if (table) return table;
  return {
    id: report.sourceTableId,
    name: report.sourceTableId || "Report data",
    description: "",
    fields: report.selectedFieldIds.map((fieldId) => ({
      id: fieldId,
      label: getReadableFieldLabel(report, fieldId),
      type: "text" as const
    }))
  };
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

export function ReportView({
  report,
  table,
  quickbaseLinkContext = null,
  result,
  loadError = "",
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
  const [localExporting, setLocalExporting] = useState(false);
  const [nativeChartExporting, setNativeChartExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [preparedExport, setPreparedExport] = useState<{ filename: string; blob: Blob } | null>(null);
  const [exportSaved, setExportSaved] = useState(false);
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
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const chartFieldId = getChartFieldId(report);
  const axisLabels = getChartAxisLabels(report, table);
  const chartBounds = getChartViewportBounds(report.view.chartType, result?.chartData.length || 0, false);
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
    setPreparedExport(null);
    setExportSaved(false);
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
    if (hosted.autoDownload !== "xlsx") return;
    if (autoExportStartedRef.current) return;
    autoExportStartedRef.current = true;
    window.history.replaceState({}, document.title, buildObjectUrl("report", report.id, { viewer: true }));
    void beginExport({ skipPicker: true });
  }, [hosted.autoDownload, report.id]);

  async function beginExport(options: { skipPicker?: boolean } = {}) {
    if (localExporting || nativeChartExporting) return;
    if (preparedExport && !options.skipPicker) {
      const saveTarget = await createExportSaveTarget(preparedExport.filename);
      if (!saveTarget && typeof (window as typeof window & { showSaveFilePicker?: unknown }).showSaveFilePicker === "function") return;
      await savePreparedWorkbook(preparedExport.blob, preparedExport.filename, saveTarget);
      setExportSaved(true);
      return;
    }
    const filename = buildExportFilename(report.name);
    setLocalExporting(true);
    setExportError("");
    setPreparedExport(null);
    setExportSaved(false);
    try {
      const exportBundle = await fetchReportExportBundle(report.id);
      const blob = await exportReportWorkbook(report, buildExportTableFallback(report, table), exportBundle.result, {
        filename,
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
    const filename = `${String(report.name || "report")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "report"} native charts dev ${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "_")}.xlsx`;
    setNativeChartExporting(true);
    setExportError("");
    setPreparedExport(null);
    setExportSaved(false);
    try {
      const { exportReportNativeChartWorkbook } = await import("../lib/nativeExcelDashboardExport");
      const exportBundle = await fetchReportExportBundle(report.id);
      const blob = await exportReportNativeChartWorkbook(report, buildExportTableFallback(report, table), exportBundle.result, {
        filename
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

  function freshnessLabel() {
    if (result?.freshness?.source === "quickbase-live") return "Live data";
    if (result?.freshness?.source === "scheduled-cache") return "Scheduled refresh cache";
    return "Local fallback data";
  }

  const resolvedFocusMode = normalizeReportFocusMode(report, focusMode, { summaryAvailable, chartAvailable, detailsAvailable });
  const configuredShowSummary = summaryAvailable && (resolvedFocusMode === "default" || resolvedFocusMode === "summary");
  const configuredShowChart = chartAvailable && (resolvedFocusMode === "default" || resolvedFocusMode === "chart");
  const configuredShowDetails = detailsAvailable && (resolvedFocusMode === "default" || resolvedFocusMode === "details");
  const hasConfiguredVisibleSection = configuredShowSummary || configuredShowChart || configuredShowDetails;
  const totalRows = Number(result?.totalRows || 0);
  const zeroRows = !loading && Boolean(result) && totalRows < 1;
  const showSummary = configuredShowSummary || (!hasConfiguredVisibleSection && Boolean(result?.summary?.length));
  const showChart = configuredShowChart || (!hasConfiguredVisibleSection && !showSummary && Boolean(result?.chartData?.length));
  const showDetails = configuredShowDetails || (!hasConfiguredVisibleSection && !showSummary && !showChart && (
    Boolean(result?.rows?.length) || totalRows > 0
  ));

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
    if (report.view.mode === "timeline") {
      const startFieldId = report.view.timelineDateField;
      const endFieldId = report.view.timelineEndField;
      const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0] || "";
      const parsedItems = rows.map((row) => {
        const startRaw = row[startFieldId];
        const endRaw = endFieldId ? row[endFieldId] : null;
        const startDate = startRaw != null ? new Date(String(startRaw)) : null;
        const endDate = endRaw != null ? new Date(String(endRaw)) : null;
        const validStart = startDate !== null && !isNaN(startDate.getTime());
        const validEnd = endDate !== null && !isNaN(endDate.getTime());
        return {
          title: table ? formatReportCellValue(report, table, titleFieldId, row[titleFieldId]) : String(row[titleFieldId] ?? ""),
          start: validStart ? startDate! : null as null,
          end: validEnd ? endDate! : (validStart ? new Date(startDate!.getTime() + 86_400_000) : null as null),
        };
      }).filter((item): item is { title: string; start: Date; end: Date } => item.start !== null && item.end !== null);
      parsedItems.sort((a, b) => a.start.getTime() - b.start.getTime());
      if (!parsedItems.length) {
        return <div className="empty">No records have a valid timeline date to display.</div>;
      }
      const tMin = parsedItems[0].start.getTime();
      const tMax = parsedItems.reduce((m, item) => Math.max(m, item.end.getTime()), tMin) + 86_400_000;
      const tSpan = tMax - tMin || 1;
      const toLeftPct = (ms: number) => ((ms - tMin) / tSpan) * 100;
      const toWidthPct = (s: number, e: number) => Math.max(0.5, ((e - s) / tSpan) * 100);
      const monthMarkers: { label: string; leftPct: number }[] = [];
      const mc = new Date(tMin);
      mc.setDate(1); mc.setHours(0, 0, 0, 0);
      while (mc.getTime() < tMax) {
        const lp = toLeftPct(mc.getTime());
        if (lp >= 0 && lp <= 100) monthMarkers.push({ label: mc.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), leftPct: lp });
        mc.setMonth(mc.getMonth() + 1);
      }
      return (
        <div className="timeline-shell">
          <div className="timeline-header-row">
            <div className="timeline-label-col" />
            <div className="timeline-track-col">
              {monthMarkers.map((mk, idx) => (
                <span key={idx} className="timeline-month-mark" style={{ left: `${mk.leftPct}%` }}>{mk.label}</span>
              ))}
            </div>
          </div>
          {parsedItems.map((item, idx) => (
            <div key={idx} className="timeline-item-row">
              <div className="timeline-label-col" title={item.title}>{item.title}</div>
              <div className="timeline-track-col">
                <div
                  className="timeline-bar"
                  style={{ left: `${toLeftPct(item.start.getTime())}%`, width: `${toWidthPct(item.start.getTime(), item.end.getTime())}%` }}
                  title={`${item.start.toLocaleDateString()} – ${item.end.toLocaleDateString()}`}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (report.view.mode === "calendar") {
      const dateFieldId = report.view.calendarDateField;
      const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0] || "";
      const eventsByDay = new Map<string, string[]>();
      rows.forEach((row) => {
        const raw = row[dateFieldId];
        if (raw == null) return;
        const d = new Date(String(raw));
        if (isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const title = table ? formatReportCellValue(report, table, titleFieldId, row[titleFieldId]) : String(row[titleFieldId] ?? "");
        eventsByDay.set(key, [...(eventsByDay.get(key) || []), title]);
      });
      const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
      const firstDow = new Date(calendarYear, calendarMonth, 1).getDay();
      const monthLabel = new Date(calendarYear, calendarMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const cells: (number | null)[] = [];
      for (let i = 0; i < firstDow; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) cells.push(d);
      function prevCalMonth() {
        if (calendarMonth === 0) { setCalendarYear((y) => y - 1); setCalendarMonth(11); }
        else setCalendarMonth((m) => m - 1);
      }
      function nextCalMonth() {
        if (calendarMonth === 11) { setCalendarYear((y) => y + 1); setCalendarMonth(0); }
        else setCalendarMonth((m) => m + 1);
      }
      return (
        <div className="calendar-shell">
          <div className="calendar-nav">
            <button type="button" className="ghost-button" onClick={prevCalMonth}>‹ Prev</button>
            <strong className="calendar-month-label">{monthLabel}</strong>
            <button type="button" className="ghost-button" onClick={nextCalMonth}>Next ›</button>
          </div>
          <div className="calendar-grid">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
              <div key={d} className="calendar-day-header">{d}</div>
            ))}
            {cells.map((day, i) => {
              const evKey = day ? `${calendarYear}-${calendarMonth}-${day}` : null;
              const evs = evKey ? (eventsByDay.get(evKey) || []) : [];
              return (
                <div key={i} className={`calendar-day${day === null ? " empty-day" : ""}${evs.length ? " has-events" : ""}`}>
                  {day ? <span className="calendar-day-num">{day}</span> : null}
                  {evs.slice(0, 3).map((ev, j) => <div key={j} className="calendar-event-chip" title={ev}>{ev}</div>)}
                  {evs.length > 3 ? <div className="calendar-event-more">+{evs.length - 3} more</div> : null}
                </div>
              );
            })}
          </div>
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
        columns={report.selectedFieldIds.map((fieldId) => ({
          key: fieldId,
          label: getReadableFieldLabel(report, fieldId, table) || "Value"
        }))}
        rows={rows.map((row, index) => ({
          key: String(row.__recordId || index),
          cells: report.selectedFieldIds.map((fieldId) =>
            table ? formatReportCellValue(report, table, fieldId, row[fieldId]) : String(row[fieldId] ?? "")
          )
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
                      <button className="ghost-button btn-system" onClick={() => window.open(fullScreenUrl, "_blank", "noopener,noreferrer")}>Open full-screen</button>
                    ) : (
                      <>
                        <button className="ghost-button btn-neutral" onClick={() => window.history.back()}>Back</button>
                        <Link className="ghost-button btn-neutral" to={buildHostedRoute("/")}>Home</Link>
                        <Link className="ghost-button btn-help" to={buildHostedRoute("/help")}>Open manual</Link>
                        <Link className="ghost-button btn-system" to={buildHostedRoute(`/studio/${report.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open in building area</Link>
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
                    <button className="ghost-button btn-export" onClick={() => { void beginExport(); }} disabled={!result || localExporting || nativeChartExporting}>
                      {localExporting ? "Generating xlsx…" : preparedExport ? (exportSaved ? "Save again" : "Save xlsx") : "Download xlsx"}
                    </button>
                    <button className="ghost-button btn-export" onClick={() => { void beginNativeChartExport(); }} disabled={!result || localExporting || nativeChartExporting}>
                      {nativeChartExporting ? "Generating native xlsx..." : "Dev native chart xlsx"}
                    </button>
                    <button className="ghost-button btn-system" onClick={onRefresh} disabled={loading}>
                      {loading ? "Refreshing…" : "Refresh now"}
                    </button>
                    <button className="ghost-button btn-neutral" onClick={resetView}>Reset view</button>
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
                {onDeleteView ? <button className="ghost-button btn-danger" onClick={() => onDeleteView(view.id)}>Remove</button> : null}
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

      {localExporting ? (
        <div className="sync-status">
          <strong>Generating export</strong>
          <span>Building the workbook and chart image from the current report.</span>
          <div className="progress-meter" aria-hidden="true">
            <div className="progress-meter-fill" style={{ width: "72%" }} />
          </div>
        </div>
      ) : null}

      {nativeChartExporting ? (
        <div className="sync-status">
          <strong>Generating native chart export</strong>
          <span>Building native Excel chart objects from hidden workbook ranges.</span>
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
            <button className="ghost-button btn-export" onClick={() => { void beginExport(); }}>
              {exportSaved ? "Save again" : "Save xlsx"}
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

      {result?.warnings?.length ? (
        <div className="sync-status sync-status-warn">
          <strong>Report warnings</strong>
          <ul className="flat-list import-review-list">
            {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {!loading && !result ? (
        <div className="sync-status sync-status-warn">
          <strong>Report results unavailable</strong>
          <span>{loadError || "This report did not return results. Try `Refresh now`, then reopen the report."}</span>
        </div>
      ) : null}

      {zeroRows ? (
        <div className="sync-status" style={{ borderLeft: "4px solid var(--border-md, #B0BEC8)" }}>
          <strong>No data available</strong>
          <span>This report returned 0 rows. If you expected results, use Refresh Now to pull fresh data from the source.</span>
        </div>
      ) : null}

      {showSummary ? (
        result?.crosstab ? (
          <div className="pivot-table-shell">
            <table className="pivot-table">
              <thead>
                <tr>
                  <th className="pivot-metric-col"></th>
                  {result.crosstab.columns.map((col, i) => (
                    <th key={i} className={col === "Grand Total" ? "pivot-grand-total" : ""}>{col || "(blank)"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.crosstab.rows.map((row) => (
                  <tr key={row.label}>
                    <td className="pivot-row-header">{row.label}</td>
                    {row.formatted.map((val, i) => (
                      <td key={i} className={result.crosstab!.columns[i] === "Grand Total" ? "pivot-grand-total" : ""}>{val}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="summary-grid">
            {(result?.summary || []).map((item) => (
              <div className="summary-card" key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        )
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
              <div className="chart-scroll-shell">
                <div style={{ minWidth: `${chartBounds.minWidth}px`, minHeight: `${chartBounds.minHeight}px`, width: "100%", height: "100%" }}>
                  <ChartPreview
                    chartType={report.view.chartType}
                    data={result?.chartData || []}
                    title={report.view.chartTitle}
                    decimalPlaces={report.view.decimalPlaces}
                    chartColors={report.view.chartColors}
                    chartValueColors={report.view.chartValueColors}
                    chartSort={report.view.chartSort}
                    chartOrientation={report.view.chartOrientation}
                    xAxisLabel={axisLabels.xAxisLabel}
                    yAxisLabel={axisLabels.yAxisLabel}
                    secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
                    secondarySeriesType={report.view.chartSecondarySeriesType}
                    showLegend={report.view.chartShowLegend}
                    showValues={report.view.chartShowValues}
                    viewportHeight={chartBounds.minHeight}
                    openLinksInNewTab={openLinksInNewTab}
                    getDatumHref={undefined}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {showDetails ? (
        <div className="card">
          <div className="card-head">
            <strong>Details</strong>
            <span className="micro">{totalRows} rows</span>
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

      {!loading && result && !showSummary && !showChart && !showDetails ? (
        <div className="sync-status" style={{ borderLeft: "4px solid var(--border-md, #B0BEC8)" }}>
          <strong>{zeroRows ? "No data available" : "No visible report sections"}</strong>
          <span>
            {zeroRows
              ? "This report returned 0 rows. Use Refresh Now to pull fresh data from the source."
              : "This report has data, but summary, chart, and detail sections are all turned off in the report editor."}
          </span>
        </div>
      ) : null}

      {focusedSection === "chart" && showChart ? (
        <div className="focus-overlay" role="dialog" aria-modal="true">
          <div className="focus-overlay-card">
            <div className="card-head">
              <strong>{report.name} · Chart focus</strong>
              <button className="ghost-button" onClick={() => setFocusedSection("")}>Close</button>
            </div>
            <div className="chart-scroll-shell">
              <div style={{ minWidth: `${chartBounds.minWidth}px`, minHeight: `${chartBounds.minHeight}px`, width: "100%", height: "100%" }}>
                <ChartPreview
                  chartType={report.view.chartType}
                  data={result?.chartData || []}
                  title={report.view.chartTitle}
                  decimalPlaces={report.view.decimalPlaces}
                  chartColors={report.view.chartColors}
                  chartValueColors={report.view.chartValueColors}
                  chartSort={report.view.chartSort}
                  chartOrientation={report.view.chartOrientation}
                  xAxisLabel={axisLabels.xAxisLabel}
                  yAxisLabel={axisLabels.yAxisLabel}
                  secondaryYAxisLabel={axisLabels.secondaryYAxisLabel}
                  secondarySeriesType={report.view.chartSecondarySeriesType}
                  showLegend={report.view.chartShowLegend}
                  showValues={report.view.chartShowValues}
                  viewportHeight={chartBounds.minHeight}
                  openLinksInNewTab={openLinksInNewTab}
                  getDatumHref={(datum) => buildQuickbaseChartDatumUrl(quickbaseLinkContext, table, chartFieldId, datum, quickbaseFilterTree)}
                />
              </div>
            </div>
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
