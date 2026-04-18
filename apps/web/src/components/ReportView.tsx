import { Link } from "react-router-dom";
import type { ReportDefinition, ReportRunResult, TableDefinition } from "@studio/shared";
import { LinkToolbar } from "./LinkToolbar";
import { ChartPreview } from "./ChartPreview";

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
          </div>
          <LinkToolbar type="report" id={report.id} />
        </div>
      </div>

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
          <ChartPreview chartType={report.view.chartType} data={result?.chartData || []} />
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
