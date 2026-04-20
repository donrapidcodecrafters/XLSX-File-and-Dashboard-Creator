import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatReportCellValue, getReportFieldLabel, type ExportJobStatus, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { downloadExportJob, fetchExportJobStatus, startReportExportJob } from "../lib/api";
import { buildObjectUrl, getHostedContext } from "../lib/embed";
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

function getChartAxisLabels(report: ReportDefinition, table?: TableDefinition) {
  const xFieldId = getChartFieldId(report);
  return {
    xAxisLabel: report.view.chartXAxisLabel?.trim()
      || (xFieldId ? (table ? getReportFieldLabel(report, table, xFieldId) : xFieldId) : ""),
    yAxisLabel: report.view.chartYAxisLabel?.trim()
      || (report.view.chartAggregation === "count"
        ? "Rows"
        : (report.view.chartValueFieldId
          ? (table ? getReportFieldLabel(report, table, report.view.chartValueFieldId) : report.view.chartValueFieldId)
          : "")),
    secondaryYAxisLabel: report.view.chartSecondaryYAxisLabel?.trim()
      || (report.view.chartUseSecondaryAxis
        ? (report.view.chartSecondaryAggregation === "count"
          ? "Rows"
          : (report.view.chartSecondaryValueFieldId
            ? (table ? getReportFieldLabel(report, table, report.view.chartSecondaryValueFieldId) : report.view.chartSecondaryValueFieldId)
            : ""))
        : "")
  };
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
  openLinksInNewTab = false
}: ReportViewProps) {
  const hosted = getHostedContext();
  const fullScreenUrl = buildObjectUrl("report", report.id, { viewer: true });
  const totalPages = result?.totalPages || 1;
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState("");
  const [exportPopup, setExportPopup] = useState<Window | null>(null);
  const chartFieldId = getChartFieldId(report);
  const axisLabels = getChartAxisLabels(report, table);
  const quickbaseFilterTree = buildQuickbaseReportFilterTree(report);

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
    downloadExportJob(exportJob.id, { directDownload: hosted.embed, popupWindow: exportPopup });
    setDownloadedJobId(exportJob.id);
    setExportPopup(null);
  }, [downloadedJobId, exportJob, exportPopup, hosted.embed]);

  async function beginExport() {
    if (hosted.embed) {
      const popup = window.open("", "_blank");
      if (popup && !popup.closed) {
        popup.document.write("<title>Preparing export</title><p style=\"font-family: sans-serif; padding: 16px;\">Preparing your export…</p>");
      }
      setExportPopup(popup);
    }
    const response = await startReportExportJob({ reportId: report.id });
    setExportJob(response.job);
    setDownloadedJobId("");
  }

  function freshnessLabel() {
    if (result?.freshness?.source === "quickbase-live") return "Live Quickbase data";
    if (result?.freshness?.source === "scheduled-cache") return "Scheduled refresh cache";
    return "Local fallback data";
  }

  function renderDetailContent() {
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
              <span>{table ? getReportFieldLabel(report, table, dateFieldId) : "Date"}: {table ? formatReportCellValue(report, table, dateFieldId, row[dateFieldId]) : String(row[dateFieldId] ?? "")}</span>
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
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              {quickbaseLinkContext ? <th className="table-action-col">Quickbase</th> : null}
              {report.selectedFieldIds.map((fieldId) => (
                <th key={fieldId}>{table ? getReportFieldLabel(report, table, fieldId) : fieldId}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {quickbaseLinkContext ? (
                  <td className="table-action-cell">
                    {String(row.__recordId || "").trim() ? (
                      <a
                        className="ghost-button table-edit-link"
                        href={buildQuickbaseRecordEditUrl(quickbaseLinkContext, String(row.__recordId || ""))}
                        target={openLinksInNewTab ? "_blank" : undefined}
                        rel={openLinksInNewTab ? "noreferrer" : undefined}
                      >
                        Edit
                      </a>
                    ) : null}
                  </td>
                ) : null}
                {report.selectedFieldIds.map((fieldId) => (
                  <td key={fieldId}>{table ? formatReportCellValue(report, table, fieldId, row[fieldId]) : String(row[fieldId] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="surface stack">
      <div className="hero">
        <div>
          <span className="badge brand">Report</span>
          <h1>{report.name}</h1>
          <p>{report.description || "Full-screen report view with live data, summaries, charts, and detail rows."}</p>
        </div>
        <div className="stack-compact reader-actions">
          <div className="link-toolbar">
            {hosted.embed ? (
              <button className="ghost-button" onClick={() => window.open(fullScreenUrl, "_blank", "noopener,noreferrer")}>Open full-screen</button>
            ) : (
              <>
                <button className="ghost-button" onClick={() => window.history.back()}>Back</button>
                <Link className="ghost-button" to="/">Home</Link>
                <Link className="ghost-button" to={`/studio/${report.id}`} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>Open in building area</Link>
              </>
            )}
            <button className="ghost-button" onClick={() => { void beginExport(); }} disabled={!result || exportJob?.status === "queued" || exportJob?.status === "running"}>
              {exportJob?.status === "queued" || exportJob?.status === "running"
                ? `Exporting ${exportJob.progress}%`
                : "Download xlsx"}
            </button>
            <button className="ghost-button" onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
          {hosted.embed ? null : <LinkToolbar type="report" id={report.id} />}
        </div>
      </div>

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
        </div>
      ) : null}

      {reportShowsSummary(report) ? (
        <div className="summary-grid">
          {(result?.summary || []).map((item) => (
            <div className="summary-card" key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {reportShowsChart(report) ? (
        <div className="card">
          <div className="card-head">
            <strong>Chart</strong>
            <span className="micro">{table?.name || report.sourceTableId}</span>
          </div>
          {loading ? (
            <div className="empty">Running report…</div>
          ) : (
            <ChartPreview
              chartType={report.view.chartType}
              data={result?.chartData || []}
              title={report.view.chartTitle}
              decimalPlaces={report.view.decimalPlaces}
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
          )}
        </div>
      ) : null}

      {reportShowsDetails(report) ? (
        <div className="card">
          <div className="card-head">
            <strong>Details</strong>
            <span className="micro">{result?.totalRows || 0} rows</span>
          </div>
          <div className="link-toolbar">
            <button className="ghost-button" disabled={currentPage <= 1 || loading} onClick={() => onPageChange(Math.max(1, currentPage - 1))}>Previous</button>
            <span className="micro">Page {result?.page || currentPage} of {totalPages}</span>
            <button className="ghost-button" disabled={!result?.hasNextPage || loading} onClick={() => onPageChange(currentPage + 1)}>Next</button>
          </div>
          {loading ? (
            <div className="empty">Loading rows…</div>
          ) : (
            renderDetailContent()
          )}
        </div>
      ) : null}
    </section>
  );
}
