import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { normalizeStudioDocument, type DashboardDefinition, type DataRow, type FieldDefinition, type FieldType, type ReportDefinition, type StudioDocument, type TableDefinition } from "@studio/shared";
import { isPostgresEnabled } from "../config/env.js";
import { getSourceRecordSummary, replaceSourceRecords, replaceSourceRecordsFromBatches, type SourceRecordSummary } from "./eav-record-store.js";
import { studioStore } from "./studio-store.js";
import { importWorkbookIntoStudioDocument } from "./xlsx-import.js";

interface IngestXlsxSourceOptions {
  filename: string;
  buffer: Uint8Array;
  sourceId?: string;
  sourceName?: string;
  /** Sheet names that should be stored as Postgres tables. Others are skipped for ingestion. */
  dataSheets?: string[];
  /** Field id(s) that uniquely identify a row — enables upsert-by-key instead of full replace. */
  keyFieldIds?: string[];
  /** The chosen key field(s) don't actually produce unique values for this file — skip
   *  matching and fully replace, but keyFieldIds is still remembered for next time. */
  allowDuplicates?: boolean;
}

interface IngestXlsxSourceStreamOptions extends Omit<IngestXlsxSourceOptions, "buffer"> {
  stream: Readable;
}

interface IngestedXlsxSource {
  sourceId: string;
  sourceName: string;
  /** Original Excel sheet name before renaming to the display source name */
  sheetName: string;
  table: TableDefinition;
  rowCount: number;
  fieldCount: number;
  summary?: SourceRecordSummary;
  /** Present when keyFieldIds was set — how many rows were added/updated/removed by key. */
  upsert?: { added: number; updated: number; removed: number };
}

interface IngestXlsxWorkbookSourceResult {
  document: StudioDocument;
  sources: IngestedXlsxSource[];
  warnings: string[];
  review: unknown;
}

function slugify(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function normalizeCellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => String(item || "")).join(", ");
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return normalizeCellValue(value.result as ExcelJS.CellValue);
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("");
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return typeof value.text === "string" && value.text.trim() ? value.text : value.hyperlink;
    }
    if ("formula" in value && typeof value.formula === "string") {
      return value.formula;
    }
  }
  return String(value);
}

function isBlankValue(value: unknown) {
  return value === null || value === undefined || String(value).trim() === "";
}

function trimTrailingBlankValues(values: Array<string | number | boolean | null>) {
  let last = values.length - 1;
  while (last >= 0 && isBlankValue(values[last])) {
    last -= 1;
  }
  return values.slice(0, last + 1);
}

function getRowValues(row: ExcelJS.Row) {
  const values = Array.isArray(row.values) ? row.values.slice(1) : [];
  return trimTrailingBlankValues(values.map((value) => normalizeCellValue(value as ExcelJS.CellValue)));
}

function uniqueFieldId(label: string, index: number, used: Set<string>) {
  const base = slugify(label) || `column-${index + 1}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildFieldsFromHeader(values: Array<string | number | boolean | null>) {
  const used = new Set<string>();
  return values.map((value, index) => {
    const label = String(value ?? "").trim() || `Column ${index + 1}`;
    return {
      id: uniqueFieldId(label, index, used),
      label,
      type: "text" as FieldType
    };
  });
}

interface FieldTypeTracker {
  hasValue: boolean;
  allNumbers: boolean;
  allDates: boolean;
  hasDateTime: boolean;
}

function createFieldTypeTrackers(count: number): FieldTypeTracker[] {
  return Array.from({ length: count }, () => ({
    hasValue: false,
    allNumbers: true,
    allDates: true,
    hasDateTime: false
  }));
}

function updateFieldTypeTracker(tracker: FieldTypeTracker, value: unknown) {
  if (isBlankValue(value)) return;
  tracker.hasValue = true;
  if (typeof value !== "number") {
    tracker.allNumbers = false;
  }
  const text = String(value ?? "").trim();
  const parsedDate = typeof value === "string" && text ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(parsedDate)) {
    tracker.allDates = false;
  } else if (/t\d{2}:\d{2}|\d{1,2}:\d{2}/i.test(text)) {
    tracker.hasDateTime = true;
  }
}

function finalizeFieldType(tracker: FieldTypeTracker): FieldType {
  if (!tracker.hasValue) return "text";
  if (tracker.allNumbers) return "number";
  if (tracker.allDates) return tracker.hasDateTime ? "datetime" : "date";
  return "text";
}

function buildDataRow(fields: FieldDefinition[], values: Array<string | number | boolean | null>): DataRow {
  const row: DataRow = {};
  fields.forEach((field, index) => {
    row[field.id] = values[index] ?? null;
  });
  return row;
}

function uniqueSourceId(base: string, used: Set<string>) {
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function workbookNameFromFilename(filename: string) {
  return filename.replace(/\.xlsx$/i, "").trim() || "Imported Workbook";
}

async function resolveBaseSourceName(sourceId: string | undefined, sourceName: string | undefined, workbookName: string): Promise<string> {
  const explicit = String(sourceName || "").trim();
  if (explicit) return explicit;
  // When updating an existing source with no explicit name, preserve the name already in Postgres.
  if (sourceId) {
    const existing = await getSourceRecordSummary([sourceId]);
    if (existing?.sourceName) return existing.sourceName;
  }
  return workbookName;
}

function normalizeBaseSourceId(sourceId: string | undefined, filename: string, sourceName?: string) {
  // When creating a new source with an explicit name, derive the ID from that name so
  // each tab in a multi-sheet import gets a distinct, stable ID rather than all sharing
  // the filename-derived fallback.
  const fallback = sourceName
    ? `xlsx:${slugify(sourceName) || "workbook"}`
    : `xlsx:${slugify(workbookNameFromFilename(filename)) || "workbook"}`;
  const trimmed = String(sourceId || "").trim();
  if (!trimmed) return fallback;
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function stableSheetSourceId(baseSourceId: string, table: TableDefinition, index: number, singleTable: boolean, used: Set<string>) {
  if (singleTable) return uniqueSourceId(baseSourceId, used);
  const suffix = slugify(table.name || table.id) || `sheet-${index + 1}`;
  return uniqueSourceId(`${baseSourceId}:${suffix}`, used);
}

function buildSourceTable(table: TableDefinition, sourceId: string, sourceName: string, filename: string): TableDefinition {
  return {
    ...table,
    id: sourceId,
    name: sourceName,
    description: `Excel source imported from "${filename}".`,
    quickbaseProfileId: "",
    quickbaseTableId: "",
    quickbaseAppId: ""
  };
}

function upsertSourceTables(document: StudioDocument, tables: TableDefinition[]) {
  const sourceIds = new Set(tables.map((table) => table.id));
  const newIdByName = new Map(tables.map((table) => [table.name.trim().toLowerCase(), table.id]));
  const sourceNames = new Set(newIdByName.keys());

  // A table gets evicted below when a re-import produces the same name under a new id.
  // Any report still pointing at the evicted table's old id would otherwise start
  // throwing "Table not found" on every run — repoint those reports at the new id.
  const staleTableIdRemap = new Map<string, string>();
  for (const table of document.bundle.tables) {
    if (sourceIds.has(table.id)) continue;
    const name = table.name.trim().toLowerCase();
    const newId = name ? newIdByName.get(name) : undefined;
    if (newId) staleTableIdRemap.set(table.id, newId);
  }
  const objects = staleTableIdRemap.size
    ? Object.fromEntries(
        Object.entries(document.bundle.objects).map(([id, obj]) => {
          if (obj.type === "report" && staleTableIdRemap.has(obj.sourceTableId)) {
            return [id, { ...obj, sourceTableId: staleTableIdRemap.get(obj.sourceTableId)! }];
          }
          return [id, obj];
        })
      )
    : document.bundle.objects;

  return normalizeStudioDocument({
    ...document,
    bundle: {
      ...document.bundle,
      objects,
      tables: [
        ...document.bundle.tables.filter(
          (table) => !sourceIds.has(table.id) && !sourceNames.has(table.name.trim().toLowerCase())
        ),
        ...tables
      ],
      data: Object.fromEntries(
        Object.entries(document.bundle.data || {}).filter(([tableId]) => !sourceIds.has(tableId))
      )
    }
  });
}

function buildImportReview(workbookName: string, sources: IngestedXlsxSource[]) {
  const importedAt = new Date().toISOString();
  return {
    workbookName,
    importedAt,
    importedSheetCount: sources.length,
    skippedSheetCount: 0,
    dashboardCreated: false,
    sheets: sources.map((source) => ({
      sheetName: source.table.name,
      status: "imported" as const,
      headerRowNumber: 1,
      rowCount: source.rowCount,
      columnCount: source.fieldCount,
      importedTableId: source.table.id,
      notes: [`Imported "${source.table.name}" as durable source "${source.sourceId}".`],
      substitutions: []
    }))
  };
}

export async function ingestXlsxWorkbookSource(options: IngestXlsxSourceOptions): Promise<IngestXlsxWorkbookSourceResult> {
  if (!isPostgresEnabled()) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required before importing Excel files as durable sources.");
  }
  const importBase = studioStore.getLiveDocument();
  const imported = await importWorkbookIntoStudioDocument(importBase, options.filename, options.buffer);
  const workbookName = workbookNameFromFilename(options.filename);
  const baseSourceId = normalizeBaseSourceId(options.sourceId, options.filename, options.sourceName);
  const baseSourceName = await resolveBaseSourceName(options.sourceId, options.sourceName, workbookName);
  const allImportedTables = imported.importedTableIds
    .map((tableId) => imported.document.bundle.tables.find((table) => table.id === tableId))
    .filter((table): table is TableDefinition => Boolean(table));

  // Only ingest sheets the user designated as data tabs. Fall back to all if no selection made.
  const dataSheetSet = options.dataSheets && options.dataSheets.length > 0
    ? new Set(options.dataSheets.map((s) => s.trim().toLowerCase()))
    : null;
  const importedTables = dataSheetSet
    ? allImportedTables.filter((t) => dataSheetSet.has(t.name.trim().toLowerCase()))
    : allImportedTables;

  const usedSourceIds = new Set<string>();
  const sourceTables: TableDefinition[] = [];
  const sources: IngestedXlsxSource[] = [];

  for (const [index, importedTable] of importedTables.entries()) {
    const sourceId = stableSheetSourceId(baseSourceId, importedTable, index, importedTables.length === 1, usedSourceIds);
    const sourceName = importedTables.length === 1 ? baseSourceName : `${baseSourceName} - ${importedTable.name}`;
    const rows = imported.document.bundle.data[importedTable.id] || [];
    const table = buildSourceTable(importedTable, sourceId, sourceName, options.filename);
    const replaced = await replaceSourceRecords({
      sourceId,
      sourceName,
      sourceType: "xlsx",
      fields: table.fields,
      rows,
      keyFieldIds: options.keyFieldIds,
      allowDuplicates: options.allowDuplicates,
      metadata: {
        workbookName,
        filename: options.filename,
        sheetName: importedTable.name,
        originalImportedTableId: importedTable.id,
        importedAt: imported.review.importedAt
      }
    });
    sourceTables.push(table);
    sources.push({
      sourceId,
      sourceName,
      sheetName: importedTable.name,
      table,
      rowCount: rows.length,
      fieldCount: table.fields.length,
      upsert: replaced.upsert
    });
  }

  const document = studioStore.updateDocument((c) => upsertSourceTables(c, sourceTables), { markSavedAt: false });
  return {
    document,
    sources,
    warnings: imported.warnings,
    review: imported.review
  };
}

export async function ingestXlsxWorkbookSourceStream(options: IngestXlsxSourceStreamOptions): Promise<IngestXlsxWorkbookSourceResult> {
  if (!isPostgresEnabled()) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required before importing Excel files as durable sources.");
  }
  const workbookName = workbookNameFromFilename(options.filename);
  const baseSourceId = normalizeBaseSourceId(options.sourceId, options.filename, options.sourceName);
  const baseSourceName = await resolveBaseSourceName(options.sourceId, options.sourceName, workbookName);
  const usedSourceIds = new Set<string>();
  const sourceTables: TableDefinition[] = [];
  const sources: IngestedXlsxSource[] = [];
  const warnings: string[] = [];
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(options.stream, {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "ignore"
  });

  const streamDataSheetSet = options.dataSheets && options.dataSheets.length > 0
    ? new Set(options.dataSheets.map((s) => s.trim().toLowerCase()))
    : null;

  let worksheetIndex = 0;
  for await (const worksheet of workbookReader) {
    const workbookModel = workbookReader as unknown as { model?: { sheets?: unknown[] } };
    const sheetCount = Array.isArray(workbookModel.model?.sheets) ? workbookModel.model.sheets.length : 0;
    // singleTable drives whether the source ID gets a sheet-name suffix.
    // When the user selected exactly one data sheet from a multi-sheet file, treat it as single-table
    // so the source ID matches the base (existing) source ID and updates it instead of creating a new one.
    // When options.sourceId is explicitly provided the user chose an existing source — always single-table
    // so the ID never gets a sheet-name suffix that would create a new source instead of updating.
    const singleTable = options.sourceId
      ? true
      : (streamDataSheetSet ? streamDataSheetSet.size === 1 : sheetCount === 1);
    const worksheetName = (worksheet as unknown as { name?: string }).name;
    const sheetName = String(worksheetName || `Sheet ${worksheetIndex + 1}`);

    // If the user selected specific data sheets, consume-and-skip anything not in the list.
    if (streamDataSheetSet && !streamDataSheetSet.has(sheetName.trim().toLowerCase())) {
      for await (const _row of worksheet) { /* consume stream rows to avoid stall */ }
      worksheetIndex += 1;
      continue;
    }
    const sourceId = stableSheetSourceId(baseSourceId, { id: "", name: sheetName, description: "", fields: [] }, worksheetIndex, singleTable, usedSourceIds);
    const sourceName = singleTable ? baseSourceName : `${baseSourceName} - ${sheetName}`;
    let fields: FieldDefinition[] = [];
    let trackers: FieldTypeTracker[] = [];
    let rowCount = 0;
    let skippedBlankRows = 0;
    const batch: DataRow[] = [];

    const replaced = await replaceSourceRecordsFromBatches({
      sourceId,
      sourceName,
      sourceType: "xlsx",
      keyFieldIds: options.keyFieldIds,
      allowDuplicates: options.allowDuplicates,
      metadata: {
        workbookName,
        filename: options.filename,
        sheetName,
        streamParsed: true
      }
    }, async (writer) => {
      for await (const row of worksheet) {
        const values = getRowValues(row);
        if (!values.length || values.every(isBlankValue)) {
          if (!fields.length) skippedBlankRows += 1;
          continue;
        }
        if (!fields.length) {
          fields = buildFieldsFromHeader(values);
          trackers = createFieldTypeTrackers(fields.length);
          continue;
        }
        const dataRow = buildDataRow(fields, values);
        fields.forEach((field, index) => {
          updateFieldTypeTracker(trackers[index], dataRow[field.id]);
        });
        batch.push(dataRow);
        rowCount += 1;
        if (batch.length >= 500) {
          await writer.appendRows(batch.splice(0));
        }
      }
      if (!fields.length) {
        throw new Error(`Skipped "${sheetName}" because it had no usable header row.`);
      }
      if (batch.length) {
        await writer.appendRows(batch.splice(0));
      }
      fields = fields.map((field, index) => ({
        ...field,
        type: finalizeFieldType(trackers[index])
      }));
      return {
        fields,
        rowCount,
        metadata: {
          workbookName,
          filename: options.filename,
          sheetName,
          skippedBlankRows,
          streamParsed: true
        }
      };
    }).catch((error) => {
      warnings.push(error instanceof Error ? error.message : `Skipped "${sheetName}".`);
      return null;
    });

    // `replaced` is null when the transaction (and its post-handler validation,
    // e.g. a duplicate/missing key field) failed and rolled back — `fields` may
    // still be populated at that point since the handler mutates it before the
    // rollback-triggering check runs, so gate on `replaced` too or a failed
    // sheet would be reported as successfully imported with no data written.
    if (fields.length && replaced) {
      const table = buildSourceTable({
        id: sourceId,
        name: sheetName,
        description: `Excel source imported from "${options.filename}".`,
        fields
      }, sourceId, sourceName, options.filename);
      sourceTables.push(table);
      sources.push({
        sourceId,
        sourceName,
        sheetName,
        table,
        rowCount,
        fieldCount: fields.length,
        upsert: replaced?.upsert
      });
    }
    worksheetIndex += 1;
  }

  if (!sources.length) {
    throw new Error(warnings[0] || "No importable sheets were found in this workbook.");
  }

  const document = studioStore.updateDocument((c) => upsertSourceTables(c, sourceTables), { markSavedAt: false });
  return {
    document,
    sources,
    warnings,
    review: buildImportReview(workbookName, sources)
  };
}

export interface RecreatedWorkbookResult {
  document: StudioDocument;
  sources: IngestedXlsxSource[];
  reports: ReportDefinition[];
  dashboard: DashboardDefinition | null;
  warnings: string[];
  review: unknown;
}

// Ingests the data tab(s) into app_records as durable sources, then runs the
// chart-parsing import engine to recreate the workbook's tab/chart structure as
// studio reports and a dashboard. Each created report's sourceTableId is patched
// to point at the durable Postgres source_id instead of the ephemeral xlsx table ID.
export async function ingestXlsxWorkbookSourceAndRecreate(
  options: IngestXlsxSourceOptions
): Promise<RecreatedWorkbookResult> {
  if (!isPostgresEnabled()) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required before importing Excel files as durable sources.");
  }

  const preingestDocument = studioStore.getLiveDocument();

  // Step 1: ingest data to Postgres and register durable source tables
  const ingested = await ingestXlsxWorkbookSource(options);

  // Step 2: run chart/structure import on the pre-ingest document so we get
  // fresh temp table IDs and chart-derived reports/dashboard.
  // Pass dataSheets so chart formulas resolve against the correct sheet name.
  const imported = await importWorkbookIntoStudioDocument(
    preingestDocument,
    options.filename,
    options.buffer,
    { dataSheets: options.dataSheets, workbookName: options.sourceName }
  );

  // Step 3: build a name→sourceId map from the durable ingest.
  // Match by both the display source name AND the original Excel sheet name so that
  // chart-derived reports on a sheet named differently than the source display name
  // still get patched correctly.
  const sourceIdByName = new Map<string, string>();
  ingested.sources.forEach((source) => {
    sourceIdByName.set(source.table.name.trim().toLowerCase(), source.sourceId);
    if (source.sheetName && source.sheetName.trim().toLowerCase() !== source.table.name.trim().toLowerCase()) {
      sourceIdByName.set(source.sheetName.trim().toLowerCase(), source.sourceId);
    }
  });
  const sourceIdById = new Map(
    ingested.sources.map((source) => [source.sourceId, source.sourceId])
  );
  // When there is exactly one durable source, use it as the fallback for any temp table
  // that can't be matched by name — covers chart-derived tables whose display name
  // never matches the user-chosen source name.
  const singleDurableSourceId = ingested.sources.length === 1 ? ingested.sources[0].sourceId : null;

  // Step 4: for each imported table, resolve its durable source_id by name match
  const importedTableIdToDurableId = new Map<string, string>();
  imported.importedTableIds.forEach((tableId) => {
    const table = imported.document.bundle.tables.find((t) => t.id === tableId);
    if (!table) return;
    const durableId =
      sourceIdByName.get(table.name.trim().toLowerCase()) ||
      sourceIdById.get(tableId) ||
      singleDurableSourceId ||
      undefined;
    if (durableId) {
      importedTableIdToDurableId.set(tableId, durableId);
    }
  });

  // Step 5: patch imported objects — replace temp table IDs with durable source IDs
  const patchedObjects: StudioDocument["bundle"]["objects"] = {};
  imported.importedObjectIds.forEach((objectId) => {
    const obj = imported.document.bundle.objects[objectId];
    if (!obj) return;
    if (obj.type === "report") {
      const durableId = importedTableIdToDurableId.get(obj.sourceTableId);
      patchedObjects[objectId] = durableId ? { ...obj, sourceTableId: durableId } : obj;
    } else {
      patchedObjects[objectId] = obj;
    }
  });

  // Step 6: merge — start from the post-ingest document (use ingested.document which
  // has the durable source tables already saved, not a fresh store read which may race).
  // Any temp tables that could NOT be remapped to a durable source (chart synthetic tables
  // where the fallback didn't apply) are included as-is so their reports can still render.
  const ingestDoc = ingested.document;
  const unmappedTempTableIds = new Set(
    imported.importedTableIds.filter((id) => !importedTableIdToDurableId.has(id))
  );
  const unmappedTempTables = imported.document.bundle.tables.filter((t) => unmappedTempTableIds.has(t.id));
  const unmappedTempData = Object.fromEntries(
    [...unmappedTempTableIds].map((id) => [id, imported.document.bundle.data[id] || []])
  );
  const merged = normalizeStudioDocument({
    ...ingestDoc,
    bundle: {
      ...ingestDoc.bundle,
      // Include any unmapped synthetic chart tables so their reports can load
      tables: unmappedTempTables.length
        ? [...ingestDoc.bundle.tables, ...unmappedTempTables]
        : ingestDoc.bundle.tables,
      data: unmappedTempTables.length
        ? { ...ingestDoc.bundle.data, ...unmappedTempData }
        : ingestDoc.bundle.data,
      objects: {
        ...ingestDoc.bundle.objects,
        ...patchedObjects
      },
      order: Array.from(new Set([
        ...imported.document.bundle.order.filter((id) => Boolean(patchedObjects[id])),
        ...ingestDoc.bundle.order
      ]))
    }
  });
  const document = studioStore.saveDocument(merged, { markSavedAt: false });

  const reports = imported.importedObjectIds
    .map((id) => patchedObjects[id])
    .filter((obj): obj is ReportDefinition => obj?.type === "report");

  const dashboard = imported.importedObjectIds
    .map((id) => patchedObjects[id])
    .find((obj): obj is DashboardDefinition => obj?.type === "dashboard") ?? null;

  const extraWarnings: string[] = [];
  if (imported.importedObjectIds.length === 0) {
    extraWarnings.push("No chart tabs were detected in this workbook. Data was imported as a source but no reports or dashboard were created automatically.");
  }

  return {
    document,
    sources: ingested.sources,
    reports,
    dashboard,
    warnings: [...ingested.warnings, ...imported.warnings, ...extraWarnings],
    review: imported.review
  };
}
