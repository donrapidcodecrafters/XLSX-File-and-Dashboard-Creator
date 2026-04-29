import { type Dispatch, type SetStateAction } from "react";
import type { ReportViewMode, StudioBuilderDraft, TableDefinition } from "@studio/shared";
import { SearchableSelect } from "./SearchableSelect";
import { REPORT_VIEW_OPTIONS } from "./studioReportUtils";
import { getSortedFieldOptions } from "./studioReportUtils";

export function StudioReportDraftBasicsStep({
  createDraft,
  createDraftTable,
  setCreateDraft
}: {
  createDraft: StudioBuilderDraft;
  createDraftTable: TableDefinition | null;
  setCreateDraft: Dispatch<SetStateAction<StudioBuilderDraft>>;
}) {
  const fieldOptions = createDraftTable ? getSortedFieldOptions(createDraftTable) : [];
  return (
    <div className="card">
      <div className="card-head">
        <strong>Report basics</strong>
        <span className="micro">Choose the default mode and core report behavior before configuring data, filters, and charts.</span>
      </div>
      <div className="view-layout-grid">
        <section className="builder-subsection">
          <div className="builder-subsection-head">
            <strong>Basics</strong>
            <span className="micro">These settings belong to the report itself, not just the chart step.</span>
          </div>
          <div className="builder-subsection-grid">
            <label className="field">
              <span>Mode</span>
              <select
                value={createDraft.view.mode}
                onChange={(event) => setCreateDraft((current) => {
                  const nextMode = event.target.value as ReportViewMode;
                  return {
                    ...current,
                    view: {
                      ...current.view,
                      mode: nextMode,
                      showChartInTable: nextMode === "table" ? current.view.showChartInTable : false
                    }
                  };
                })}
              >
                {REPORT_VIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Record title field</span>
              <SearchableSelect value={createDraft.view.titleFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Optional record title" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, titleFieldId: value } }))} />
            </label>
            <label className="field">
              <span>Decimal places</span>
              <input type="number" min="0" max="6" value={createDraft.view.decimalPlaces} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, decimalPlaces: Math.max(0, Math.min(6, Number(event.target.value) || 0)) } }))} />
            </label>
            <label className="toggle-row builder-subsection-toggle">
              <input type="checkbox" checked={Boolean(createDraft.view.showSummary)} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, showSummary: event.target.checked } }))} />
              Show summary metrics
            </label>
            <label className="toggle-row builder-subsection-toggle">
              <input type="checkbox" checked={Boolean(createDraft.view.showDetails)} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, showDetails: event.target.checked } }))} />
              Include detail rows
            </label>
            {createDraft.view.mode === "table" ? (
              <label className="toggle-row builder-subsection-toggle">
                <input type="checkbox" checked={createDraft.view.showChartInTable} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, showChartInTable: event.target.checked } }))} />
                Include chart above table
              </label>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
