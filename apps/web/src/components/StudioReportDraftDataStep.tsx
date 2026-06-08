import { type Dispatch, type SetStateAction, useMemo } from "react";
import {
  autoDetectJoinConditions,
  buildMergedTableForJoins,
  studioBuilderNeedsSelectedFields,
  type SourceJoin,
  type SourceJoinCondition,
  type StudioBuilderDraft,
  type TableDefinition
} from "@studio/shared";
import { reportShowsChart } from "./studioReportUtils";
import { FieldTransferPicker } from "./FieldTransferPicker";

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function SourceJoinCard({
  join,
  primaryTable,
  childTable,
  allTables,
  usedTableIds,
  onChange,
  onRemove
}: {
  join: SourceJoin;
  primaryTable: TableDefinition;
  childTable: TableDefinition | undefined;
  allTables: TableDefinition[];
  usedTableIds: Set<string>;
  onChange: (updated: SourceJoin) => void;
  onRemove: () => void;
}) {
  const detected = useMemo(() => {
    if (!childTable) return [];
    return autoDetectJoinConditions(primaryTable, childTable);
  }, [primaryTable, childTable]);

  function addCondition() {
    const auto = childTable
      ? autoDetectJoinConditions(primaryTable, childTable).find(
          (d) => !join.conditions.some((c) => c.parentFieldId === d.parentFieldId)
        )
      : null;
    const newCond: SourceJoinCondition = {
      id: uid("cond"),
      parentFieldId: auto?.parentFieldId || primaryTable.fields[0]?.id || "",
      childFieldId: auto?.childFieldId || childTable?.fields[0]?.id || ""
    };
    onChange({ ...join, conditions: [...join.conditions, newCond] });
  }

  function autoDetect() {
    if (!childTable || !detected.length) return;
    const existing = new Set(join.conditions.map((c) => c.parentFieldId));
    const fresh: SourceJoinCondition[] = detected
      .filter((d) => !existing.has(d.parentFieldId))
      .map((d) => ({ id: uid("cond"), parentFieldId: d.parentFieldId, childFieldId: d.childFieldId }));
    onChange({ ...join, conditions: [...join.conditions, ...fresh] });
  }

  function updateCondition(index: number, patch: Partial<SourceJoinCondition>) {
    const next = join.conditions.map((c, i) => i === index ? { ...c, ...patch } : c);
    onChange({ ...join, conditions: next });
  }

  function removeCondition(index: number) {
    onChange({ ...join, conditions: join.conditions.filter((_, i) => i !== index) });
  }

  return (
    <div className="source-join-card">
      {/* Header: label + source picker + remove */}
      <div className="source-join-header">
        <span className="source-join-header-label">Linked source</span>
        <select
          value={join.sourceTableId}
          onChange={(e) => onChange({ ...join, sourceTableId: e.target.value, conditions: [] })}
        >
          {allTables
            .filter((t) => !usedTableIds.has(t.id) || t.id === join.sourceTableId)
            .map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
        </select>
        <button
          className="source-join-remove"
          onClick={onRemove}
          title="Remove this source"
          type="button"
        >
          ×
        </button>
      </div>

      {/* Join conditions */}
      <div className="source-join-conditions">
        <div className="source-join-conditions-heading">What column do these two sources have in common?</div>
        {join.conditions.length === 0 && (
          <div className="source-join-condition-empty">
            No matching column selected yet — click "Find matches" or add one manually below.
          </div>
        )}
        {join.conditions.map((condition, index) => (
          <div key={condition.id} className="source-join-condition-row">
            <select
              value={condition.parentFieldId}
              onChange={(e) => updateCondition(index, { parentFieldId: e.target.value })}
              title={`Column from ${primaryTable.name}`}
            >
              {primaryTable.fields.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <span className="source-join-condition-matches">matches</span>
            <select
              value={condition.childFieldId}
              onChange={(e) => updateCondition(index, { childFieldId: e.target.value })}
              title={`Column from ${childTable?.name ?? "additional source"}`}
            >
              {(childTable?.fields ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <button
              className="source-join-condition-remove"
              onClick={() => removeCondition(index)}
              title="Remove this match"
              type="button"
            >
              ×
            </button>
          </div>
        ))}

        {/* Actions */}
        <div className="source-join-actions">
          {detected.length > 0 && (
            <button
              className="source-join-autodetect"
              onClick={autoDetect}
              type="button"
            >
              Find matches automatically ({detected.length} found)
            </button>
          )}
          <button
            className="source-join-add-btn"
            onClick={addCondition}
            type="button"
          >
            + Add another matching column
          </button>
        </div>
      </div>

      {/* Join type */}
      <div className="source-join-type">
        <div className="source-join-type-heading">
          What should happen when a row from the main source has no match in {childTable?.name ?? "the linked source"}?
        </div>
        <label className="source-join-type-option">
          <input
            type="radio"
            name={`join-type-${join.id}`}
            checked={join.joinType === "left"}
            onChange={() => onChange({ ...join, joinType: "left" })}
          />
          Keep it — show the row even if no match is found <span className="micro">(recommended)</span>
        </label>
        <label className="source-join-type-option">
          <input
            type="radio"
            name={`join-type-${join.id}`}
            checked={join.joinType === "inner"}
            onChange={() => onChange({ ...join, joinType: "inner" })}
          />
          Remove it — only show rows that appear in both sources
        </label>
      </div>
    </div>
  );
}

export function StudioReportDraftDataStep({
  tables,
  createDraft,
  createDraftTable,
  chartValueLabelOptions,
  setCreateDraft,
  updateCreateDraftTable
}: {
  tables: TableDefinition[];
  createDraft: StudioBuilderDraft;
  createDraftTable: TableDefinition;
  chartValueLabelOptions: string[];
  setCreateDraft: Dispatch<SetStateAction<StudioBuilderDraft>>;
  updateCreateDraftTable: (tableId: string) => void;
}) {
  const needsSelectedFields = studioBuilderNeedsSelectedFields(createDraft.view);
  const sourceJoins = createDraft.sourceJoins || [];

  const usedTableIds = useMemo(
    () => new Set([createDraft.tableId, ...sourceJoins.map((j) => j.sourceTableId)]),
    [createDraft.tableId, sourceJoins]
  );
  const availableJoinTables = tables.filter((t) => !usedTableIds.has(t.id));

  const joinTables = useMemo(
    () => sourceJoins
      .map((j) => tables.find((t) => t.id === j.sourceTableId))
      .filter((t): t is TableDefinition => Boolean(t)),
    [sourceJoins, tables]
  );

  const mergedTable = useMemo(
    () => joinTables.length
      ? buildMergedTableForJoins(createDraftTable, sourceJoins, joinTables)
      : createDraftTable,
    [createDraftTable, sourceJoins, joinTables]
  );

  function addJoinSource(tableId: string) {
    const childTable = tables.find((t) => t.id === tableId);
    if (!childTable) return;
    const autoConditions = autoDetectJoinConditions(createDraftTable, childTable).map((d) => ({
      id: uid("cond"),
      parentFieldId: d.parentFieldId,
      childFieldId: d.childFieldId
    }));
    const newJoin: SourceJoin = {
      id: uid("join"),
      sourceTableId: tableId,
      joinType: "left",
      conditions: autoConditions
    };
    setCreateDraft((current) => ({
      ...current,
      sourceJoins: [...(current.sourceJoins || []), newJoin]
    }));
  }

  function updateJoin(index: number, updated: SourceJoin) {
    setCreateDraft((current) => ({
      ...current,
      sourceJoins: (current.sourceJoins || []).map((j, i) => i === index ? updated : j)
    }));
  }

  function removeJoin(index: number) {
    setCreateDraft((current) => ({
      ...current,
      sourceJoins: (current.sourceJoins || []).filter((_, i) => i !== index)
    }));
  }

  return (
    <>
      {/* ── Source section ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <strong>Where does the data come from?</strong>
          <span className="micro">
            {sourceJoins.length === 0
              ? "Choose one data source. Need data from more than one place? Click the link button below."
              : `${sourceJoins.length + 1} data sources linked — all columns appear in the field picker below.`}
          </span>
        </div>

        {/* Primary source */}
        <label className="field">
          <span>Data source</span>
          <select
            value={createDraft.tableId}
            onChange={(event) => {
              updateCreateDraftTable(event.target.value);
              if (sourceJoins.length > 0) {
                setCreateDraft((current) => ({ ...current, sourceJoins: [] }));
              }
            }}
          >
            {tables.map((table) => (
              <option key={table.id} value={table.id}>{table.name}</option>
            ))}
          </select>
        </label>

        {/* Source report override (advanced, single source only, QB tables only) */}
        {sourceJoins.length === 0 && !!createDraftTable.quickbaseTableId && (
          <label className="field">
            <span>Quickbase saved report <span style={{ fontWeight: 400, fontSize: "0.8em" }}>(advanced — leave blank for most reports)</span></span>
            <input
              value={createDraft.sourceReportOverrides[createDraftTable.quickbaseTableId || createDraftTable.id] || ""}
              onChange={(event) => {
                const tableKey = createDraftTable.quickbaseTableId || createDraftTable.id;
                const value = event.target.value.trim();
                setCreateDraft((current) => ({
                  ...current,
                  sourceReportOverrides: value
                    ? { ...current.sourceReportOverrides, [tableKey]: value }
                    : Object.fromEntries(
                        Object.entries(current.sourceReportOverrides).filter(([key]) => key !== tableKey)
                      )
                }));
              }}
              placeholder="Leave blank unless your administrator gave you a specific number"
            />
            <span className="micro">Only needed when your administrator set up a dedicated Quickbase report for this data source.</span>
          </label>
        )}

        {/* Join cards */}
        {sourceJoins.length > 0 && (
          <div className="source-join-section">
            {sourceJoins.map((join, index) => (
              <SourceJoinCard
                key={join.id}
                join={join}
                primaryTable={createDraftTable}
                childTable={tables.find((t) => t.id === join.sourceTableId)}
                allTables={tables}
                usedTableIds={usedTableIds}
                onChange={(updated) => updateJoin(index, updated)}
                onRemove={() => removeJoin(index)}
              />
            ))}
          </div>
        )}

        {/* Add another source */}
        {availableJoinTables.length > 0 && (
          <div style={{ marginTop: sourceJoins.length > 0 ? "0.125rem" : "0.25rem" }}>
            {availableJoinTables.length === 1 ? (
              <button
                className="source-add-btn"
                type="button"
                onClick={() => addJoinSource(availableJoinTables[0].id)}
              >
                + Also pull data from "{availableJoinTables[0].name}"
              </button>
            ) : (
              <div className="source-add-row">
                <span className="source-add-row-label">+ Also use data from</span>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) addJoinSource(e.target.value); }}
                >
                  <option value="">Choose a data source…</option>
                  {availableJoinTables.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {sourceJoins.length > 0 && (
          <div className="source-join-info-hint">
            Fields from all linked sources appear in the field picker below, labeled with their source name in parentheses.
          </div>
        )}
      </div>

      {/* ── Fields ─────────────────────────────────────────────────────────── */}
      {needsSelectedFields ? (
        <div className="card">
          <div className="card-head">
            <strong>Fields</strong>
            <span className="micro">{createDraft.selectedFieldIds.length} selected</span>
          </div>
          <FieldTransferPicker
            table={mergedTable}
            selectedFieldIds={createDraft.selectedFieldIds}
            onChange={(selectedFieldIds) => setCreateDraft((current) => ({ ...current, selectedFieldIds }))}
          />
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <strong>Fields</strong>
            <span className="micro">Not required for this view setup</span>
          </div>
          <div className="empty-hint">
            Selected fields stay hidden until the report mode, summary metrics, or detail rows require them.
          </div>
        </div>
      )}

      {/* ── Display labels ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <strong>Display labels</strong>
          <span className="micro">Override field headers and chart labels with client-facing names.</span>
        </div>
        {needsSelectedFields ? (
          <div className="stack-compact">
            {createDraft.selectedFieldIds.length ? (
              createDraft.selectedFieldIds.map((fieldId) => {
                const field = mergedTable.fields.find((item) => item.id === fieldId);
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
                          fields: { ...current.displayLabels.fields, [fieldId]: event.target.value }
                        }
                      }))}
                      placeholder={`Use "${field.label}"`}
                    />
                  </label>
                );
              })
            ) : (
              <div className="empty-hint">Select fields first to set custom headers.</div>
            )}
          </div>
        ) : null}
        {reportShowsChart({ view: createDraft.view }) ? (
          <div className="stack-compact">
            <div className="micro">Chart value labels</div>
            {chartValueLabelOptions.length ? (
              chartValueLabelOptions.map((label) => (
                <label className="field" key={label}>
                  <span>{label}</span>
                  <input
                    value={createDraft.displayLabels.chartValues[label] || ""}
                    onChange={(event) => setCreateDraft((current) => ({
                      ...current,
                      displayLabels: {
                        ...current.displayLabels,
                        chartValues: { ...current.displayLabels.chartValues, [label]: event.target.value }
                      }
                    }))}
                    placeholder={`Use "${label}"`}
                  />
                </label>
              ))
            ) : (
              <div className="empty-hint">
                Chart value overrides appear once the draft chart has labels to rename.
              </div>
            )}
          </div>
        ) : null}
        {!needsSelectedFields && !reportShowsChart({ view: createDraft.view }) ? (
          <div className="empty-hint">
            Display labels will appear here when this report setup uses fields or chart labels.
          </div>
        ) : null}
      </div>
    </>
  );
}
