import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ExportJobStatus, ReportDefinition, ReportRunResult, TableDefinition } from "@studio/shared";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";
import { downloadExportJob, fetchExportJobStatus, startReportExportJob } from "../lib/api";

interface ReportViewProps {
  report: ReportDefinition;
  table?: TableDefinition;
  result?: ReportRunResult;
  loading: boolean;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function ReportView({ report, table, result, loading, currentPage, onPageChange }: ReportViewProps) {
  const totalPages = result?.totalPages || 1;
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState("");

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
    const response = await startReportExportJob({ reportId: report.id });
    setExportJob(response.job);
    setDownloadedJobId("");
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
            <button className="ghost-button" onClick={() => window.history.back()}>Back</button>
            <Link className="ghost-button" to="/viewer">Home</Link>
            <Link className="ghost-button" to={`/studio/${report.id}`}>Open in building area</Link>
            <button className="ghost-button" onClick={() => { void beginExport(); }} disabled={!result || exportJob?.status === "queued" || exportJob?.status === "running"}>
              {exportJob?.status === "queued" || exportJob?.status === "running"
                ? `Exporting ${exportJob.progress}%`
                : "Download xlsx"}
            </button>
          </div>
          <LinkToolbar type="report" id={report.id} />
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

      <div className="summary-grid">
        {(result?.summary || []).map((item) => (
          <div className="summary-card" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

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
            showLegend={report.view.chartShowLegend}
            showValues={report.view.chartShowValues}
          />
        )}
      </div>

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
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  {report.selectedFieldIds.map((fieldId) => (
                    <th key={fieldId}>{table?.fields.find((field) => field.id === fieldId)?.label || fieldId}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(result?.rows || []).map((row, index) => (
                  <tr key={index}>
                    {report.selectedFieldIds.map((fieldId) => (
                      <td key={fieldId}>{String(row[fieldId] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
