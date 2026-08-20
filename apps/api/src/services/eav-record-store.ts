import { createHash } from "node:crypto";
import type { DataRow, FieldDefinition, TableDefinition } from "@studio/shared";
import type { PoolClient } from "pg";
import { apiConfig, isPostgresEnabled } from "../config/env.js";
import { pgQuery, withPgTransaction } from "../db/postgres.js";
import { decryptJson, encryptJson, isEncryptionEnabled } from "./encryption.js";

export type EnterpriseSourceType = "quickbase" | "xlsx" | "manual";

interface ReplaceSourceRecordsInput {
  sourceId: string;
  sourceName: string;
  sourceType: EnterpriseSourceType;
  fields?: FieldDefinition[];
  rows: DataRow[];
  metadata?: Record<string, unknown>;
  quickbaseProfileId?: string;
  quickbaseTableId?: string;
  quickbaseReportId?: string;
  keyFieldId?: string;
  /** One or more field ids whose combined value uniquely identifies a row across imports. */
  keyFieldIds?: string[];
  /**
   * This import's key field(s) don't actually produce unique values (e.g. a claim
   * number that repeats across payers) — skip key-matching for THIS import and do a
   * plain full replace instead, while still remembering keyFieldIds for next time.
   */
  allowDuplicates?: boolean;
  /** How many rows were skipped before the header row on this import — persisted for next time. */
  headerSkipRows?: number;
}

interface SourceRecordReplaceBaseInput {
  sourceId: string;
  sourceName: string;
  sourceType: EnterpriseSourceType;
  metadata?: Record<string, unknown>;
  quickbaseProfileId?: string;
  quickbaseTableId?: string;
  quickbaseReportId?: string;
  keyFieldId?: string;
  keyFieldIds?: string[];
  allowDuplicates?: boolean;
  headerSkipRows?: number;
}

interface ReplaceSourceRecordsResult {
  enabled: boolean;
  sourceId: string;
  entityId: string;
  rowCount: number;
  fieldCount: number;
  /** Only meaningful when keyFieldIds was set — counts from the upsert-by-key pass. */
  upsert?: { added: number; updated: number };
}

export interface SourceRecordSummary {
  sourceId: string;
  sourceName: string;
  sourceType: EnterpriseSourceType;
  rowCount: number;
  fieldCount: number;
  keyFieldId: string;
  keyFieldIds: string[];
  headerSkipRows: number;
  metadata: Record<string, unknown>;
  refreshedAt: string;
  updatedAt: string;
}

const INSERT_RECORD_BATCH_SIZE = 5000;
const READ_RECORD_BATCH_SIZE = 5000;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}


function compactId(prefix: string, seed: string) {
  return `${prefix}_${sha256(seed).slice(0, 24)}`;
}

function normalizePayload(row: DataRow): DataRow {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [key, value === undefined ? null : value])
  ) as DataRow;
}

function externalRecordId(row: DataRow, index: number) {
  return String(row.__recordId || row.recordId || row.id || index + 1);
}

export function normalizeKeyFieldIds(keyFieldIds: string[] | undefined | null): string[] {
  return Array.from(new Set((keyFieldIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
}

function normalizeKeyValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

// A stable identity for a row, derived from its key field value(s), so the same
// logical record maps to the same app_records row across repeated imports —
// letting a re-import update/insert by identity instead of a full replace. Rows
// whose key isn't in a given file are left untouched (not deleted).
function keyExternalId(row: DataRow, keyFieldIds: string[]) {
  return sha256(keyFieldIds.map((fieldId) => normalizeKeyValue(row[fieldId])).join("␟"));
}

function makeTableFields(table: TableDefinition | null | undefined) {
  return table?.fields || [];
}

async function upsertSourceEntity(
  client: PoolClient,
  input: SourceRecordReplaceBaseInput,
  fields: FieldDefinition[],
  rowCount: number,
  now: string,
  entityId = compactId("entity", input.sourceId)
) {
  const keyFieldIds = normalizeKeyFieldIds(input.keyFieldIds);
  const headerSkipRows = Number.isFinite(input.headerSkipRows) ? Math.max(0, Math.trunc(input.headerSkipRows as number)) : null;
  const entity = await client.query<{ id: string }>(
    `
    INSERT INTO app_entities (
      id,
      source_id,
      source_name,
      source_type,
      quickbase_profile_id,
      quickbase_table_id,
      quickbase_report_id,
      key_field_id,
      key_field_ids,
      header_skip_rows,
      metadata,
      field_count,
      record_count,
      updated_at,
      refreshed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], COALESCE($10::integer, 0), $11::jsonb, $12, $13, $14, $14)
    ON CONFLICT (source_id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      source_type = EXCLUDED.source_type,
      quickbase_profile_id = EXCLUDED.quickbase_profile_id,
      quickbase_table_id = EXCLUDED.quickbase_table_id,
      quickbase_report_id = EXCLUDED.quickbase_report_id,
      key_field_id = CASE WHEN EXCLUDED.key_field_id = '' THEN app_entities.key_field_id ELSE EXCLUDED.key_field_id END,
      key_field_ids = CASE WHEN array_length(EXCLUDED.key_field_ids, 1) IS NULL THEN app_entities.key_field_ids ELSE EXCLUDED.key_field_ids END,
      header_skip_rows = CASE WHEN $10::integer IS NULL THEN app_entities.header_skip_rows ELSE $10::integer END,
      metadata = EXCLUDED.metadata,
      field_count = EXCLUDED.field_count,
      record_count = EXCLUDED.record_count,
      updated_at = EXCLUDED.updated_at,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING id
    `,
    [
      entityId,
      input.sourceId,
      input.sourceName || input.sourceId,
      input.sourceType,
      input.quickbaseProfileId || "",
      input.quickbaseTableId || "",
      input.quickbaseReportId || "",
      input.keyFieldId || "",
      keyFieldIds,
      headerSkipRows,
      JSON.stringify(input.metadata || {}),
      fields.length,
      rowCount,
      now
    ]
  );
  return entity.rows[0]?.id || entityId;
}

async function replaceSourceAttributes(
  client: PoolClient,
  entityId: string,
  fields: FieldDefinition[],
  now: string
) {
  await client.query("DELETE FROM app_attributes WHERE entity_id = $1", [entityId]);
  if (!fields.length) return;
  const values: unknown[] = [];
  const placeholders = fields.map((field, index) => {
    values.push(
      compactId("attr", `${entityId}:${field.id}`),
      entityId,
      field.id,
      field.label || field.id,
      field.type || "text",
      index,
      JSON.stringify(field.options || []),
      now
    );
    const base = index * 8;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, $${base + 8})`;
  });
  await client.query(
    `INSERT INTO app_attributes (id, entity_id, field_id, field_label, field_type, ordinal, options, updated_at)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (entity_id, field_id) DO UPDATE SET
       field_label = EXCLUDED.field_label,
       field_type = EXCLUDED.field_type,
       ordinal = EXCLUDED.ordinal,
       options = EXCLUDED.options,
       updated_at = EXCLUDED.updated_at`,
    values
  );
}

function buildRecordBatchValues(
  entityId: string,
  sourceId: string,
  rows: DataRow[],
  now: string,
  deriveExternalId: (payload: DataRow, index: number) => string
) {
  const useEncryption = isEncryptionEnabled();
  const values: unknown[] = [];
  const externalIds: string[] = [];
  const placeholders = rows.map((row, index) => {
    const payload = normalizePayload(row);
    const externalId = deriveExternalId(payload, index);
    externalIds.push(externalId);
    const payloadJson = JSON.stringify(payload); // single serialization; row_hash not read by any query
    if (useEncryption) {
      values.push(
        entityId,
        sourceId,
        externalId,
        "",                    // row_hash: not queried; skip sha256 to avoid O(n) crypto per row
        JSON.stringify({}),    // empty JSONB placeholder — real data is in payload_enc
        encryptJson(payload),
        now
      );
    } else {
      values.push(
        entityId,
        sourceId,
        externalId,
        "",       // row_hash: not queried; skip sha256 to avoid O(n) crypto per row
        payloadJson,
        null,
        now
      );
    }
    const base = index * 7;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, $${base + 7})`;
  });
  return { values, placeholders, externalIds };
}

async function insertSourceRecordBatch(
  client: PoolClient,
  entityId: string,
  sourceId: string,
  rows: DataRow[],
  startIndex: number,
  now: string
) {
  if (!rows.length) return;
  const { values, placeholders } = buildRecordBatchValues(
    entityId, sourceId, rows, now,
    (payload, index) => externalRecordId(payload, startIndex + index)
  );
  await client.query(
    `
    INSERT INTO app_records (
      entity_id,
      source_id,
      external_record_id,
      row_hash,
      payload,
      payload_enc,
      created_at,
      updated_at
    )
    VALUES ${placeholders.join(", ")}
    `,
    values
  );
}

interface UpsertBatchResult {
  added: number;
  updated: number;
}

// Inserts new key identities and updates existing ones in place (rather than a
// full delete+reinsert), so a row's identity — and anything a future feature
// might key off app_records.id — survives across re-imports. Duplicate key
// values within one batch are rejected by Postgres itself (ON CONFLICT can't
// affect the same row twice in one statement), surfacing as a clear error.
async function upsertSourceRecordBatch(
  client: PoolClient,
  entityId: string,
  sourceId: string,
  rows: DataRow[],
  keyFieldIds: string[],
  now: string,
  seenExternalIds: Set<string>
): Promise<UpsertBatchResult> {
  if (!rows.length) return { added: 0, updated: 0 };
  const { values, placeholders, externalIds } = buildRecordBatchValues(
    entityId, sourceId, rows, now,
    (payload) => keyExternalId(payload, keyFieldIds)
  );
  for (const id of externalIds) {
    if (seenExternalIds.has(id)) {
      throw new Error("This file has more than one row with the same key field value(s). Pick additional key field(s) to make the combination unique, or turn on \"Allow duplicates\" to replace all data in this table instead of matching by key.");
    }
    seenExternalIds.add(id);
  }
  const result = await client.query<{ inserted: boolean }>(
    `
    INSERT INTO app_records (
      entity_id,
      source_id,
      external_record_id,
      row_hash,
      payload,
      payload_enc,
      created_at,
      updated_at
    )
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (entity_id, external_record_id) WHERE external_record_id <> '' DO UPDATE SET
      source_id = EXCLUDED.source_id,
      payload = EXCLUDED.payload,
      payload_enc = EXCLUDED.payload_enc,
      updated_at = EXCLUDED.updated_at
    RETURNING (xmax = 0) AS inserted
    `,
    values
  );
  const added = result.rows.filter((row) => row.inserted).length;
  return { added, updated: result.rows.length - added };
}

export async function replaceSourceRecords(input: ReplaceSourceRecordsInput): Promise<ReplaceSourceRecordsResult> {
  const sourceId = String(input.sourceId || "").trim();
  if (!isPostgresEnabled()) {
    return {
      enabled: false,
      sourceId,
      entityId: "",
      rowCount: input.rows.length,
      fieldCount: input.fields?.length || 0
    };
  }
  if (!sourceId) {
    throw new Error("sourceId is required to persist source records.");
  }

  const entityId = compactId("entity", sourceId);
  const now = new Date().toISOString();
  const fields = input.fields || [];
  const keyFieldIds = normalizeKeyFieldIds(input.keyFieldIds);
  // allowDuplicates: the chosen key field(s) don't actually produce unique values for
  // this file — skip matching and fully replace, but keyFieldIds is still persisted
  // above via upsertSourceEntity so the next import (hopefully without duplicates,
  // or with allowDuplicates checked again) can still match by it.
  const useUpsert = keyFieldIds.length > 0 && !input.allowDuplicates;

  let upsertCounts: { added: number; updated: number } | undefined;
  await withPgTransaction(async (client) => {
    const persistedEntityId = await upsertSourceEntity(client, input, fields, input.rows.length, now, entityId);
    await replaceSourceAttributes(client, persistedEntityId, fields, now);
    if (useUpsert) {
      const seen = new Set<string>();
      let added = 0;
      let updated = 0;
      for (let start = 0; start < input.rows.length; start += INSERT_RECORD_BATCH_SIZE) {
        const result = await upsertSourceRecordBatch(
          client, persistedEntityId, sourceId, input.rows.slice(start, start + INSERT_RECORD_BATCH_SIZE), keyFieldIds, now, seen
        );
        added += result.added;
        updated += result.updated;
      }
      // Rows whose key isn't in this file are left alone (not deleted) — a re-import
      // is treated as "add/update what's here," not "the file is now the whole truth."
      upsertCounts = { added, updated };
    } else {
      await client.query("DELETE FROM app_records WHERE entity_id = $1", [persistedEntityId]);
      for (let start = 0; start < input.rows.length; start += INSERT_RECORD_BATCH_SIZE) {
        await insertSourceRecordBatch(client, persistedEntityId, sourceId, input.rows.slice(start, start + INSERT_RECORD_BATCH_SIZE), start, now);
      }
    }
  });

  return {
    enabled: true,
    sourceId,
    entityId,
    rowCount: input.rows.length,
    fieldCount: fields.length,
    upsert: upsertCounts
  };
}

export async function replaceSourceRecordsFromBatches(
  input: SourceRecordReplaceBaseInput,
  handler: (writer: {
    appendRows: (rows: DataRow[]) => Promise<void>;
  }) => Promise<{ fields: FieldDefinition[]; rowCount: number; metadata?: Record<string, unknown> }>
): Promise<ReplaceSourceRecordsResult> {
  const sourceId = String(input.sourceId || "").trim();
  if (!isPostgresEnabled()) {
    return {
      enabled: false,
      sourceId,
      entityId: "",
      rowCount: 0,
      fieldCount: 0
    };
  }
  if (!sourceId) {
    throw new Error("sourceId is required to persist source records.");
  }

  const entityId = compactId("entity", sourceId);
  const now = new Date().toISOString();
  const keyFieldIds = normalizeKeyFieldIds(input.keyFieldIds);
  const useUpsert = keyFieldIds.length > 0 && !input.allowDuplicates;
  let rowCount = 0;
  let fieldCount = 0;
  let upsertCounts: { added: number; updated: number } | undefined;

  await withPgTransaction(async (client) => {
    const persistedEntityId = await upsertSourceEntity(client, input, [], 0, now, entityId);
    await replaceSourceAttributes(client, persistedEntityId, [], now);
    // Non-key (or allowDuplicates) sources still use the fast delete-then-reinsert path, unchanged.
    if (!useUpsert) {
      await client.query("DELETE FROM app_records WHERE entity_id = $1", [persistedEntityId]);
    }
    const seenExternalIds = new Set<string>();
    let added = 0;
    let updated = 0;
    const writer = {
      appendRows: async (rows: DataRow[]) => {
        const batch = rows.filter(Boolean);
        if (!batch.length) return;
        if (useUpsert) {
          const result = await upsertSourceRecordBatch(client, persistedEntityId, sourceId, batch, keyFieldIds, now, seenExternalIds);
          added += result.added;
          updated += result.updated;
        } else {
          await insertSourceRecordBatch(client, persistedEntityId, sourceId, batch, rowCount, now);
        }
        rowCount += batch.length;
      }
    };
    const completed = await handler(writer);
    const fields = completed.fields || [];
    rowCount = completed.rowCount;
    fieldCount = fields.length;
    if (useUpsert) {
      const missingKeyFields = keyFieldIds.filter((id) => !fields.some((field) => field.id === id));
      if (missingKeyFields.length) {
        throw new Error(`Key field(s) not found in this file's columns: ${missingKeyFields.join(", ")}.`);
      }
      // Rows whose key isn't in this file are left alone (not deleted) — a re-import
      // is treated as "add/update what's here," not "the file is now the whole truth."
      upsertCounts = { added, updated };
    }
    await replaceSourceAttributes(client, persistedEntityId, fields, now);
    await upsertSourceEntity(client, {
      ...input,
      metadata: {
        ...(input.metadata || {}),
        ...(completed.metadata || {})
      }
    }, fields, rowCount, now, persistedEntityId);
  });

  return {
    enabled: true,
    sourceId,
    entityId,
    rowCount,
    fieldCount,
    upsert: upsertCounts
  };
}

export async function replaceTableRecords(
  table: TableDefinition,
  rows: DataRow[],
  sourceType: EnterpriseSourceType,
  metadata: Record<string, unknown> = {}
) {
  return replaceSourceRecords({
    sourceId: table.id,
    sourceName: table.name,
    sourceType,
    fields: makeTableFields(table),
    rows,
    quickbaseProfileId: table.quickbaseProfileId || "",
    quickbaseTableId: table.quickbaseTableId || "",
    metadata
  });
}

export async function loadSourceRows(sourceId: string, limit = 1000, offset = 0): Promise<DataRow[]> {
  if (!isPostgresEnabled()) return [];
  const result = await pgQuery<{ payload: DataRow; payload_enc: string | null }>(
    `
    SELECT payload, payload_enc
    FROM app_records
    WHERE source_id = $1
    ORDER BY id
    LIMIT $2 OFFSET $3
    `,
    [sourceId, Math.max(1, Math.min(limit, 50_000)), Math.max(0, offset)]
  );
  return result.rows.map((row) => {
    if (row.payload_enc) {
      try {
        return decryptJson<DataRow>(row.payload_enc);
      } catch {
        return row.payload;
      }
    }
    return row.payload;
  });
}

export async function getSourceRecordSummary(sourceIds: string[]): Promise<SourceRecordSummary | null> {
  if (!isPostgresEnabled()) return null;
  const ids = Array.from(new Set(sourceIds.map((value) => String(value || "").trim()).filter(Boolean)));
  if (!ids.length) return null;
  const result = await pgQuery<{
    source_id: string;
    source_name: string;
    source_type: EnterpriseSourceType;
    record_count: number;
    field_count: number;
    key_field_id: string;
    key_field_ids: string[] | null;
    header_skip_rows: number | null;
    metadata: Record<string, unknown>;
    refreshed_at: Date | string | null;
    updated_at: Date | string | null;
  }>(
    `
    SELECT source_id, source_name, source_type, record_count, field_count, key_field_id, key_field_ids, header_skip_rows, metadata, refreshed_at, updated_at
    FROM app_entities
    WHERE source_id = ANY($1::text[])
    ORDER BY record_count DESC, refreshed_at DESC NULLS LAST
    LIMIT 1
    `,
    [ids]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceType: row.source_type,
    rowCount: Number(row.record_count || 0),
    fieldCount: Number(row.field_count || 0),
    keyFieldId: row.key_field_id || "",
    keyFieldIds: normalizeKeyFieldIds(row.key_field_ids),
    headerSkipRows: Number(row.header_skip_rows || 0),
    metadata: row.metadata || {},
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

export async function loadSourceAttributes(sourceId: string): Promise<FieldDefinition[]> {
  if (!isPostgresEnabled() || !sourceId) return [];
  const entity = await pgQuery<{ id: string }>(
    "SELECT id FROM app_entities WHERE source_id = $1 LIMIT 1", [sourceId]
  ).catch(() => null);
  const entityId = entity?.rows[0]?.id;
  if (!entityId) return [];
  const result = await pgQuery<{ field_id: string; field_label: string; field_type: string; options: unknown }>(
    `SELECT field_id, field_label, field_type, options
     FROM app_attributes WHERE entity_id = $1 ORDER BY ordinal`, [entityId]
  ).catch(() => null);
  if (!result?.rows.length) return [];
  return result.rows.map((row) => ({
    id: row.field_id,
    label: row.field_label || row.field_id,
    type: (row.field_type || "text") as FieldDefinition["type"],
    options: Array.isArray(row.options) ? row.options : []
  }));
}

export async function loadAllSourceAttributes(): Promise<Map<string, FieldDefinition[]>> {
  if (!isPostgresEnabled()) return new Map();
  const result = await pgQuery<{
    source_id: string;
    field_id: string;
    field_label: string;
    field_type: string;
    options: unknown;
  }>(
    `SELECT ae.source_id, aa.field_id, aa.field_label, aa.field_type, aa.options
     FROM app_entities ae
     JOIN app_attributes aa ON aa.entity_id = ae.id
     ORDER BY ae.source_id, aa.ordinal`
  ).catch(() => null);
  if (!result?.rows.length) return new Map();
  const map = new Map<string, FieldDefinition[]>();
  for (const row of result.rows) {
    if (!map.has(row.source_id)) map.set(row.source_id, []);
    map.get(row.source_id)!.push({
      id: row.field_id,
      label: row.field_label || row.field_id,
      type: (row.field_type || "text") as FieldDefinition["type"],
      options: Array.isArray(row.options) ? row.options : []
    });
  }
  return map;
}

export async function listSourceRecordSummaries(): Promise<SourceRecordSummary[]> {
  if (!isPostgresEnabled()) return [];
  const result = await pgQuery<{
    source_id: string;
    source_name: string;
    source_type: EnterpriseSourceType;
    record_count: number;
    field_count: number;
    key_field_id: string;
    key_field_ids: string[] | null;
    header_skip_rows: number | null;
    metadata: Record<string, unknown>;
    refreshed_at: Date | string | null;
    updated_at: Date | string | null;
  }>(
    `
    SELECT source_id, source_name, source_type, record_count, field_count, key_field_id, key_field_ids, header_skip_rows, metadata, refreshed_at, updated_at
    FROM app_entities
    ORDER BY updated_at DESC
    `
  );
  return result.rows.map((row) => ({
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceType: row.source_type,
    rowCount: Number(row.record_count || 0),
    fieldCount: Number(row.field_count || 0),
    keyFieldId: row.key_field_id || "",
    keyFieldIds: normalizeKeyFieldIds(row.key_field_ids),
    headerSkipRows: Number(row.header_skip_rows || 0),
    metadata: row.metadata || {},
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  }));
}

export async function loadTableRows(table: TableDefinition, limit = 50_000, offset = 0): Promise<DataRow[]> {
  const summary = await getSourceRecordSummary([table.id, table.quickbaseTableId || ""]);
  if (!summary) return [];
  const requestedLimit = Math.max(1, Number(limit) || 50_000);
  if (requestedLimit <= 50_000) {
    return loadSourceRows(summary.sourceId, requestedLimit, offset);
  }
  const rows: DataRow[] = [];
  let cursor = Math.max(0, Number(offset) || 0);
  while (rows.length < requestedLimit) {
    const batch = await loadSourceRows(summary.sourceId, Math.min(READ_RECORD_BATCH_SIZE, requestedLimit - rows.length), cursor);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < READ_RECORD_BATCH_SIZE) break;
    cursor += batch.length;
  }
  return rows;
}

export async function forEachTableRowBatch(
  table: TableDefinition,
  callback: (rows: DataRow[], offset: number, summary: SourceRecordSummary) => Promise<void> | void,
  batchSize = READ_RECORD_BATCH_SIZE
) {
  const summary = await getSourceRecordSummary([table.id, table.quickbaseTableId || ""]);
  if (!summary || summary.rowCount <= 0) return null;
  let offset = 0;
  const size = Math.max(1, Math.min(Number(batchSize) || READ_RECORD_BATCH_SIZE, 10_000));
  while (true) {
    const rows = await loadSourceRows(summary.sourceId, size, offset);
    if (!rows.length) break;
    await callback(rows, offset, summary);
    if (rows.length < size) break;
    offset += rows.length;
  }
  return summary;
}
