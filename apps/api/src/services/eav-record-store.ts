import { createHash } from "node:crypto";
import type { DataRow, FieldDefinition, TableDefinition } from "@studio/shared";
import type { PoolClient } from "pg";
import { apiConfig, isPostgresEnabled } from "../config/env.js";
import { pgQuery, withPgTransaction } from "../db/postgres.js";

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
}

interface SourceRecordReplaceBaseInput {
  sourceId: string;
  sourceName: string;
  sourceType: EnterpriseSourceType;
  metadata?: Record<string, unknown>;
  quickbaseProfileId?: string;
  quickbaseTableId?: string;
  quickbaseReportId?: string;
}

interface ReplaceSourceRecordsResult {
  enabled: boolean;
  sourceId: string;
  entityId: string;
  rowCount: number;
  fieldCount: number;
}

export interface SourceRecordSummary {
  sourceId: string;
  sourceName: string;
  sourceType: EnterpriseSourceType;
  rowCount: number;
  fieldCount: number;
  metadata: Record<string, unknown>;
  refreshedAt: string;
  updatedAt: string;
}

const INSERT_RECORD_BATCH_SIZE = 500;
const READ_RECORD_BATCH_SIZE = 1000;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
      metadata,
      field_count,
      record_count,
      updated_at,
      refreshed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $11)
    ON CONFLICT (source_id) DO UPDATE SET
      source_name = EXCLUDED.source_name,
      source_type = EXCLUDED.source_type,
      quickbase_profile_id = EXCLUDED.quickbase_profile_id,
      quickbase_table_id = EXCLUDED.quickbase_table_id,
      quickbase_report_id = EXCLUDED.quickbase_report_id,
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
  for (const [index, field] of fields.entries()) {
    await client.query(
      `
      INSERT INTO app_attributes (
        id,
        entity_id,
        field_id,
        field_label,
        field_type,
        ordinal,
        options,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (entity_id, field_id) DO UPDATE SET
        field_label = EXCLUDED.field_label,
        field_type = EXCLUDED.field_type,
        ordinal = EXCLUDED.ordinal,
        options = EXCLUDED.options,
        updated_at = EXCLUDED.updated_at
      `,
      [
        compactId("attr", `${entityId}:${field.id}`),
        entityId,
        field.id,
        field.label || field.id,
        field.type || "text",
        index,
        JSON.stringify(field.options || []),
        now
      ]
    );
  }
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
  const values: unknown[] = [];
  const placeholders = rows.map((row, index) => {
    const absoluteIndex = startIndex + index;
    const payload = normalizePayload(row);
    const payloadJson = stableJson(payload);
    values.push(
      entityId,
      sourceId,
      externalRecordId(payload, absoluteIndex),
      sha256(payloadJson),
      JSON.stringify(payload),
      now
    );
    const base = index * 6;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 6})`;
  });
  await client.query(
    `
    INSERT INTO app_records (
      entity_id,
      source_id,
      external_record_id,
      row_hash,
      payload,
      created_at,
      updated_at
    )
    VALUES ${placeholders.join(", ")}
    `,
    values
  );
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

  await withPgTransaction(async (client) => {
    const persistedEntityId = await upsertSourceEntity(client, input, fields, input.rows.length, now, entityId);
    await replaceSourceAttributes(client, persistedEntityId, fields, now);
    await client.query("DELETE FROM app_records WHERE entity_id = $1", [persistedEntityId]);
    for (let start = 0; start < input.rows.length; start += INSERT_RECORD_BATCH_SIZE) {
      await insertSourceRecordBatch(client, persistedEntityId, sourceId, input.rows.slice(start, start + INSERT_RECORD_BATCH_SIZE), start, now);
    }
  });

  return {
    enabled: true,
    sourceId,
    entityId,
    rowCount: input.rows.length,
    fieldCount: fields.length
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
  let rowCount = 0;
  let fieldCount = 0;

  await withPgTransaction(async (client) => {
    const persistedEntityId = await upsertSourceEntity(client, input, [], 0, now, entityId);
    await replaceSourceAttributes(client, persistedEntityId, [], now);
    await client.query("DELETE FROM app_records WHERE entity_id = $1", [persistedEntityId]);
    const writer = {
      appendRows: async (rows: DataRow[]) => {
        const batch = rows.filter(Boolean);
        if (!batch.length) return;
        await insertSourceRecordBatch(client, persistedEntityId, sourceId, batch, rowCount, now);
        rowCount += batch.length;
      }
    };
    const completed = await handler(writer);
    const fields = completed.fields || [];
    rowCount = completed.rowCount;
    fieldCount = fields.length;
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
    fieldCount
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
  const result = await pgQuery<{ payload: DataRow }>(
    `
    SELECT payload
    FROM app_records
    WHERE source_id = $1
    ORDER BY id
    LIMIT $2 OFFSET $3
    `,
    [sourceId, Math.max(1, Math.min(limit, 50_000)), Math.max(0, offset)]
  );
  return result.rows.map((row) => row.payload);
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
    metadata: Record<string, unknown>;
    refreshed_at: Date | string | null;
    updated_at: Date | string | null;
  }>(
    `
    SELECT source_id, source_name, source_type, record_count, field_count, metadata, refreshed_at, updated_at
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
    metadata: row.metadata || {},
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  };
}

export async function listSourceRecordSummaries(): Promise<SourceRecordSummary[]> {
  if (!isPostgresEnabled()) return [];
  const result = await pgQuery<{
    source_id: string;
    source_name: string;
    source_type: EnterpriseSourceType;
    record_count: number;
    field_count: number;
    metadata: Record<string, unknown>;
    refreshed_at: Date | string | null;
    updated_at: Date | string | null;
  }>(
    `
    SELECT source_id, source_name, source_type, record_count, field_count, metadata, refreshed_at, updated_at
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
    metadata: row.metadata || {},
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
  }));
}

export async function loadTableRows(table: TableDefinition, limit = 50_000, offset = 0): Promise<DataRow[]> {
  const summary = await getSourceRecordSummary([table.id, table.quickbaseTableId || ""]);
  if (!summary) return [];
  const requestedLimit = Math.max(1, Number(limit) || 50_000);
  if (requestedLimit > 50_000 && summary.rowCount > apiConfig.postgres.legacyRowLoadLimit) {
    throw new Error(`Source "${summary.sourceName}" has ${summary.rowCount.toLocaleString()} rows and requires batched Postgres execution. Remove unsupported sorts or use a paged/aggregate-safe report path before loading it into memory.`);
  }
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
