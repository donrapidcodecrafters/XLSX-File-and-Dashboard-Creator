import type { ReportDefinition, ReportRunResult, StudioBuilderDraft, TableDefinition } from "@studio/shared";
import { StudioReportPreview } from "./StudioReportPreview";

export function StudioDraftReviewStep({
  createDraft,
  createDraftTable,
  createDraftIssues,
  filterCount,
  previewReport,
  previewResult,
  currentPreviewPage,
  onPreviewPageChange
}: {
  createDraft: StudioBuilderDraft;
  createDraftTable: TableDefinition | null;
  createDraftIssues: string[];
  filterCount: number;
  previewReport: ReportDefinition | null;
  previewResult: ReportRunResult | null;
  currentPreviewPage: number;
  onPreviewPageChange: (page: number) => void;
}) {
  return (
    <>
      <div className="card">
        <div className="card-head">
          <strong>Review</strong>
          <span className="micro">Confirm the object before saving it into the shared or personal library.</span>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <strong>{createDraft.type === "report" ? "Report" : "Dashboard"}</strong>
            <span>Type</span>
          </div>
          <div className="summary-card">
            <strong>{createDraft.scope === "personal" ? "Personal" : createDraft.scope === "selected" ? "Shared with selected users" : "Shared"}</strong>
            <span>Scope</span>
          </div>
          {createDraft.type === "report" ? (
            <>
              <div className="summary-card">
                <strong>{createDraftTable?.name || "No table"}</strong>
                <span>Source table</span>
              </div>
              <div className="summary-card">
                <strong>{createDraft.selectedFieldIds.length}</strong>
                <span>Selected fields</span>
              </div>
              <div className="summary-card">
                <strong>{filterCount}</strong>
                <span>Filters</span>
              </div>
              <div className="summary-card">
                <strong>{createDraft.view.mode}</strong>
                <span>Default view</span>
              </div>
            </>
          ) : (
            <div className="summary-card">
              <strong>Overview</strong>
              <span>Starter tab</span>
            </div>
          )}
        </div>
        {createDraftIssues.length ? (
          <div className="sync-status sync-status-warn">
            <strong>Fix these items before saving</strong>
            <ul className="flat-list import-review-list">
              {createDraftIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        ) : (
          <div className="sync-status sync-status-ok">
            <strong>Ready to save</strong>
            <span>The draft has the minimum information needed to create the object.</span>
          </div>
        )}
      </div>

      {createDraft.type === "report" && createDraftTable && previewReport && previewResult ? (
        <div className="card">
          <div className="card-head">
            <strong>Preview</strong>
            <span className="micro">{previewResult.totalRows} rows in the current local preview</span>
          </div>
          <StudioReportPreview
            report={previewReport}
            table={createDraftTable}
            result={previewResult}
            currentPage={currentPreviewPage}
            onPageChange={onPreviewPageChange}
          />
        </div>
      ) : null}
    </>
  );
}
