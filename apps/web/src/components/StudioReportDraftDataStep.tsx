import { type Dispatch, type SetStateAction } from "react";
import type { StudioBuilderDraft, TableDefinition } from "@studio/shared";
import { reportShowsChart } from "./studioReportUtils";

export function StudioReportDraftDataStep({
  tables,
  createDraft,
  createDraftTable,
  createFieldQuery,
  setCreateFieldQuery,
  visibleCreateFields,
  chartValueLabelOptions,
  setCreateDraft,
  updateCreateDraftTable
}: {
  tables: TableDefinition[];
  createDraft: StudioBuilderDraft;
  createDraftTable: TableDefinition;
  createFieldQuery: string;
  setCreateFieldQuery: Dispatch<SetStateAction<string>>;
  visibleCreateFields: TableDefinition["fields"];
  chartValueLabelOptions: string[];
  setCreateDraft: Dispatch<SetStateAction<StudioBuilderDraft>>;
  updateCreateDraftTable: (tableId: string) => void;
}) {
  return (
    <>
      <div className="card">
        <div className="card-head">
          <strong>Source table</strong>
          <span className="micro">Choose the table first so the rest of the builder only shows relevant fields.</span>
        </div>
        <label className="field">
          <span>Table</span>
          <select value={createDraft.tableId} onChange={(event) => updateCreateDraftTable(event.target.value)}>
            {tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Source report override</span>
          <input
            value={createDraft.sourceReportOverrides[createDraftTable.quickbaseTableId || createDraftTable.id] || ""}
            onChange={(event) => {
              const tableKey = createDraftTable.quickbaseTableId || createDraftTable.id;
              const value = event.target.value.trim();
              setCreateDraft((current) => ({
                ...current,
                sourceReportOverrides: value
                  ? { ...current.sourceReportOverrides, [tableKey]: value }
                  : Object.fromEntries(Object.entries(current.sourceReportOverrides).filter(([key]) => key !== tableKey))
              }));
            }}
            placeholder="Optional Quickbase report ID for this report only"
          />
          <span className="micro">Leave blank to use the app default from Settings during refresh.</span>
        </label>
      </div>

      <div className="card">
        <div className="card-head">
          <strong>Fields</strong>
          <span className="micro">{createDraft.selectedFieldIds.length} selected</span>
        </div>
        <label className="field">
          <span>Find fields</span>
          <input value={createFieldQuery} onChange={(event) => setCreateFieldQuery(event.target.value)} placeholder="Search field name, FID, or type" />
        </label>
        <div className="picker-list modal-picker-list">
          {visibleCreateFields.map((field) => (
            <label className="picker-row" key={field.id}>
              <input
                type="checkbox"
                checked={createDraft.selectedFieldIds.includes(field.id)}
                onChange={(event) => setCreateDraft((current) => ({
                  ...current,
                  selectedFieldIds: event.target.checked
                    ? [...current.selectedFieldIds, field.id]
                    : current.selectedFieldIds.filter((item) => item !== field.id)
                }))}
              />
              <span>{field.label}</span>
              <em>FID {field.id} · {field.type}</em>
            </label>
          ))}
          {!visibleCreateFields.length ? <div className="empty-hint">No matching fields.</div> : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <strong>Display labels</strong>
          <span className="micro">Override field headers and chart labels with client-facing names.</span>
        </div>
        <div className="stack-compact">
          {createDraft.selectedFieldIds.length ? createDraft.selectedFieldIds.map((fieldId) => {
            const field = createDraftTable.fields.find((item) => item.id === fieldId);
            if (!field) return null;
            return (
              <label className="field" key={fieldId}>
                <span>{field.label}</span>
                <input
                  value={createDraft.displayLabels.fields[fieldId] || ""}
                  onChange={(event) => setCreateDraft((current) => ({
                    ...current,
                    displayLabels: {
                      ...current.displayLabels,
                      fields: {
                        ...current.displayLabels.fields,
                        [fieldId]: event.target.value
                      }
                    }
                  }))}
                  placeholder={`Use "${field.label}"`}
                />
              </label>
            );
          }) : <div className="empty-hint">Select fields first to set custom headers.</div>}
        </div>
        {reportShowsChart({ view: createDraft.view }) ? (
          <div className="stack-compact">
            <div className="micro">Chart value labels</div>
            {chartValueLabelOptions.length ? chartValueLabelOptions.map((label) => (
              <label className="field" key={label}>
                <span>{label}</span>
                <input
                  value={createDraft.displayLabels.chartValues[label] || ""}
                  onChange={(event) => setCreateDraft((current) => ({
                    ...current,
                    displayLabels: {
                      ...current.displayLabels,
                      chartValues: {
                        ...current.displayLabels.chartValues,
                        [label]: event.target.value
                      }
                    }
                  }))}
                  placeholder={`Use "${label}"`}
                />
              </label>
            )) : <div className="empty-hint">Chart value overrides appear once the draft chart has labels to rename.</div>}
          </div>
        ) : null}
      </div>
    </>
  );
}
