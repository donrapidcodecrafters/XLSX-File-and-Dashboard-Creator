import { useMemo, useState } from "react";
import type { TableDefinition } from "@studio/shared";
import { ClearableInputField } from "./ClearableInputField";

function normalizeSearchText(value: string) {
  return String(value || "").toLowerCase().trim();
}

function matchesQuery(parts: Array<string | undefined>, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return parts.some((part) => normalizeSearchText(part || "").includes(normalizedQuery));
}

export function FieldTransferPicker({
  table,
  selectedFieldIds,
  onChange
}: {
  table: TableDefinition;
  selectedFieldIds: string[];
  onChange: (fieldIds: string[]) => void;
}) {
  const [availableQuery, setAvailableQuery] = useState("");
  const [selectedQuery, setSelectedQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selectedFieldIds), [selectedFieldIds]);
  const orderedSelectedFields = useMemo(
    () => selectedFieldIds
      .map((fieldId) => table.fields.find((field) => field.id === fieldId))
      .filter((field): field is TableDefinition["fields"][number] => Boolean(field)),
    [selectedFieldIds, table.fields]
  );
  const availableFields = useMemo(
    () => [...table.fields]
      .filter((field) => !selectedSet.has(field.id))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true })),
    [selectedSet, table.fields]
  );

  const visibleAvailableFields = availableFields.filter((field) =>
    matchesQuery([field.label, field.id, field.type], availableQuery)
  );
  const visibleSelectedFields = orderedSelectedFields.filter((field) =>
    matchesQuery([field.label, field.id, field.type], selectedQuery)
  );

  function addField(fieldId: string) {
    if (selectedSet.has(fieldId)) return;
    onChange([...selectedFieldIds, fieldId]);
  }

  function removeField(fieldId: string) {
    onChange(selectedFieldIds.filter((item) => item !== fieldId));
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    const currentIndex = selectedFieldIds.indexOf(fieldId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedFieldIds.length) return;
    const next = [...selectedFieldIds];
    const [field] = next.splice(currentIndex, 1);
    next.splice(nextIndex, 0, field);
    onChange(next);
  }

  return (
    <div className="field-transfer-picker">
      <div className="field-transfer-column">
        <div className="card-head">
          <strong>Available fields</strong>
          <span className="micro">{availableFields.length}</span>
        </div>
        <ClearableInputField
          label="Search available fields"
          value={availableQuery}
          onChange={setAvailableQuery}
          placeholder="Type part of a field name, id, or type"
        />
        <div className="field-transfer-list">
          {visibleAvailableFields.length ? visibleAvailableFields.map((field) => (
            <button
              type="button"
              key={field.id}
              className="field-transfer-item"
              onDoubleClick={() => addField(field.id)}
              onClick={() => addField(field.id)}
            >
              <div className="field-transfer-meta">
                <strong>{field.label}</strong>
                <span>{field.type}</span>
              </div>
              <span className="field-transfer-add">Add</span>
            </button>
          )) : <div className="empty-hint">No matching available fields.</div>}
        </div>
        <div className="micro">Click or double click a field to add it to the report.</div>
      </div>

      <div className="field-transfer-column">
        <div className="card-head">
          <strong>Selected fields</strong>
          <span className="micro">{selectedFieldIds.length} in report order</span>
        </div>
        <ClearableInputField
          label="Search selected fields"
          value={selectedQuery}
          onChange={setSelectedQuery}
          placeholder="Filter the selected field list"
        />
        <div className="field-transfer-list">
          {visibleSelectedFields.length ? visibleSelectedFields.map((field) => {
            const currentIndex = selectedFieldIds.indexOf(field.id);
            return (
            <div className="field-transfer-item selected" key={field.id}>
              <div className="field-transfer-order">{currentIndex + 1}</div>
              <div className="field-transfer-main">
                <button type="button" className="field-transfer-main-button" onDoubleClick={() => removeField(field.id)}>
                  <strong>{field.label}</strong>
                  <span>{field.type}</span>
                </button>
                <div className="field-transfer-actions">
                  <button type="button" className="ghost-button field-transfer-action-button" onClick={() => moveField(field.id, -1)} disabled={currentIndex <= 0}>Up</button>
                  <button type="button" className="ghost-button field-transfer-action-button" onClick={() => moveField(field.id, 1)} disabled={currentIndex === selectedFieldIds.length - 1}>Down</button>
                  <button type="button" className="ghost-button field-transfer-action-button remove" onClick={() => removeField(field.id)}>Remove</button>
                </div>
              </div>
            </div>
          );
          }) : <div className="empty-hint">No matching selected fields.</div>}
        </div>
        <div className="micro">The order here is the report column order. Double click or remove a field to take it out.</div>
      </div>
    </div>
  );
}
