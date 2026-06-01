import type { FastifyInstance } from "fastify";
import { normalizeStudioDocument, type StudioDocument } from "@studio/shared";
import { studioStore } from "../services/studio-store.js";
import { ensureQuickbaseStorageForProfiles, syncStudioDocumentToQuickbase, syncStudioUserSettingsToQuickbase } from "../services/quickbase-storage.js";
import {
  cancelRefreshJob,
  getActiveRefreshJob,
  getTrackedRefreshJob,
  primeRefreshJob,
  refreshAllCachedDataWithProgress,
  refreshObjectCachedDataWithProgress,
  updateRefreshScheduleMetadata
} from "../services/refresh-cache.js";
import { refreshJobStore } from "../services/refresh-jobs.js";
import { listSourceRecordSummaries } from "../services/eav-record-store.js";
import { ingestXlsxWorkbookSource, ingestXlsxWorkbookSourceAndRecreate, ingestXlsxWorkbookSourceStream } from "../services/xlsx-source-ingest.js";
import { invalidateSourceCaches } from "../services/report-runner.js";
import { logAuditEvent } from "../services/audit-log.js";
import { importWorkbookIntoStudioDocument } from "../services/xlsx-import.js";
import { pgQuery, withPgTransaction } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

const STALE_REFRESH_JOB_MS = 3 * 60 * 1000;

function isRefreshJobStale(job: { status?: string; updatedAt?: string; createdAt?: string } | null) {
  if (!job || (job.status !== "queued" && job.status !== "running")) return false;
  const updatedAt = Date.parse(String(job.updatedAt || job.createdAt || ""));
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > STALE_REFRESH_JOB_MS;
}

export async function registerStudioRoutes(app: FastifyInstance) {
  app.get("/api/studio/document", async () => {
    await studioStore.hydrateFromQuickbase();
    const hydrated = studioStore.getLiveDocument();
    updateRefreshScheduleMetadata(hydrated);
    const provisioned = await ensureQuickbaseStorageForProfiles(hydrated);
    const document = studioStore.saveDocument(provisioned, { markSavedAt: false });
    return {
      document: {
        ...document,
        // Keep the main studio document lightweight; versions are fetched on demand.
        versions: {},
        exportJobs: []
      }
    };
  });

  app.get("/api/studio/cache/summary", async () => {
    const document = studioStore.getLiveDocument();
    const cacheMeta = studioStore.getAllCacheMeta();
    const postgresSources = await listSourceRecordSummaries();
    return {
      refreshStatus: document.sync.refreshStatus,
      tables: Object.entries(document.bundle.data || {}).map(([tableId, rows]) => ({
        tableId,
        rowCount: Array.isArray(rows) ? rows.length : 0,
        cachedAt: cacheMeta[tableId]?.cachedAt || "",
        expiresAt: cacheMeta[tableId]?.expiresAt || ""
      })),
      postgresSources
    };
  });

  app.get("/api/studio/sources/:sourceId/preview", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const query = (request.query as { limit?: string } | undefined) || {};
    const limit = Math.max(1, Math.min(20, Number(query.limit) || 5));
    const { loadSourceRows, getSourceRecordSummary } = await import("../services/eav-record-store.js");
    const summary = await getSourceRecordSummary([sourceId]);
    if (!summary) {
      reply.code(404);
      return { message: "Source not found." };
    }
    const rows = await loadSourceRows(sourceId, limit, 0);
    return { summary, rows };
  });

  app.get("/api/studio/sources", async () => {
    const document = studioStore.getDocument();
    const sources = await listSourceRecordSummaries();
    return {
      sources: sources.map((source) => ({
        ...source,
        table: document.bundle.tables.find((table) => table.id === source.sourceId) || null
      }))
    };
  });

  app.put("/api/studio/document", async (request, reply) => {
    const body = request.body as { document?: StudioDocument; removedObjectIds?: string[] } | undefined;
    if (!body?.document) {
      reply.code(400);
      return { message: "Document payload is required." };
    }
    const incomingDocument = body.document;
    const current = studioStore.getLiveDocument();
    const removedObjectIds = Array.isArray(body.removedObjectIds) ? body.removedObjectIds.map(String).filter(Boolean) : [];
    const mergedObjects = {
      ...(current.bundle.objects || {}),
      ...(incomingDocument.bundle?.objects || {})
    };
    removedObjectIds.forEach((objectId) => {
      delete mergedObjects[objectId];
    });
    const mergedOrder = [
      ...((incomingDocument.bundle?.order || []).filter((id) => !removedObjectIds.includes(id))),
      ...(current.bundle.order || []).filter((id) => !removedObjectIds.includes(id) && !((incomingDocument.bundle?.order || []).includes(id)))
    ].filter((id, index, list) => Boolean(mergedObjects[id]) && list.indexOf(id) === index);
    const mergedDocument: StudioDocument = normalizeStudioDocument({
      ...incomingDocument,
      // Version history and export jobs stay on the server; the browser does not upload them on save.
      versions: current.versions,
      exportJobs: current.exportJobs,
      bundle: {
        ...incomingDocument.bundle,
        objects: mergedObjects,
        order: mergedOrder,
        // Keep server-side cached rows instead of requiring the browser to upload them on every save.
        data: current.bundle.data
      },
      sync: {
        ...incomingDocument.sync,
        refreshStatus: current.sync.refreshStatus
      },
      quickbaseProfiles: incomingDocument.quickbaseProfiles.map((profile) => {
        const existing = current.quickbaseProfiles.find((item) => item.id === profile.id);
        return {
          ...profile,
          bootstrap: existing?.bootstrap || profile.bootstrap,
          refreshStatus: existing?.refreshStatus || profile.refreshStatus
        };
      })
    });
    updateRefreshScheduleMetadata(mergedDocument);
    const provisioned = await ensureQuickbaseStorageForProfiles(mergedDocument);
    const document = studioStore.saveDocument(provisioned);
    const sync = await syncStudioDocumentToQuickbase(document, { removedObjectIds }).catch((error) => ({
      enabled: true,
      ok: false,
      message: error instanceof Error ? error.message : "Quickbase sync failed.",
      savedObjects: 0,
      savedSettings: 0,
      savedVersions: 0,
      savedStorageConfig: 0
    }));
    return { document, sync };
  });

  app.patch("/api/studio/user-settings", async (request, reply) => {
    const body = (request.body as {
      favorites?: string[];
      recent?: string[];
      personalOverrides?: StudioDocument["personalOverrides"];
    } | undefined) || {};
    const current = studioStore.getLiveDocument();
    const document = studioStore.saveDocument(normalizeStudioDocument({
      ...current,
      favorites: Array.isArray(body.favorites) ? body.favorites.map(String) : current.favorites,
      recent: Array.isArray(body.recent) ? body.recent.map(String) : current.recent,
      personalOverrides: body.personalOverrides || current.personalOverrides
    }), { markSavedAt: false });
    const sync = await syncStudioUserSettingsToQuickbase(document).catch((error) => ({
      enabled: true,
      ok: false,
      message: error instanceof Error ? error.message : "Quickbase user settings sync failed.",
      savedObjects: 0,
      savedSettings: 0,
      savedVersions: 0,
      savedStorageConfig: 0
    }));
    return {
      settings: {
        favorites: document.favorites,
        recent: document.recent,
        personalOverrides: document.personalOverrides
      },
      sync
    };
  });

  app.patch("/api/studio/session", async (request, reply) => {
    const body = (request.body as { session?: Partial<StudioDocument["session"]> } | undefined) || {};
    if (!body.session) {
      reply.code(400);
      return { message: "Session payload is required." };
    }
    const current = studioStore.getLiveDocument();
    const session = studioStore.saveSession({
      ...current.session,
      ...body.session
    });
    return { session };
  });

  app.post("/api/studio/import/xlsx", async (request, reply) => {
    try {
      let filename = "";
      let workbookBuffer: Buffer | null = null;
      if (request.isMultipart()) {
        const file = await request.file();
        if (file) {
          filename = file.filename || "";
          workbookBuffer = await file.toBuffer();
        }
      } else {
        const body = (request.body as { filename?: string; base64?: string } | undefined) || {};
        if (body.filename && body.base64) {
          filename = body.filename;
          workbookBuffer = Buffer.from(body.base64, "base64");
        }
      }
      if (!filename || !workbookBuffer) {
        reply.code(400);
        return { message: "Workbook file upload is required." };
      }
      const buffer = workbookBuffer;
      const current = studioStore.getLiveDocument();
      const imported = await importWorkbookIntoStudioDocument(
        current,
        filename,
        buffer
      );
      return {
        document: imported.document,
        primaryObjectId: imported.primaryObjectId,
        importedObjectIds: imported.importedObjectIds,
        importedTableIds: imported.importedTableIds,
        warnings: imported.warnings,
        review: imported.review
      };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Workbook import failed."
      };
    }
  });

  // Returns the first few rows and column names from an uploaded xlsx file for preview.
  app.post("/api/studio/sources/xlsx/peek", async (request, reply) => {
    try {
      const ExcelJSMod = await import("exceljs");
      const ExcelJSWorkbook = ExcelJSMod.default.Workbook;
      let filename = "";
      let rows: Record<string, unknown>[] = [];
      let headers: string[] = [];
      let sheetNames: string[] = [];
      let rowCount = 0;

      if (request.isMultipart()) {
        const file = await request.file();
        if (!file) { reply.code(400); return { message: "No file provided." }; }
        filename = file.filename || "";
        const workbook = new ExcelJSWorkbook();
        await workbook.xlsx.read(file.file);
        sheetNames = workbook.worksheets.map((ws) => ws.name);
        const ws = workbook.worksheets[0];
        if (ws) {
          const headerRow = ws.getRow(1);
          headers = (headerRow.values as unknown[]).slice(1).map((v, i) => String(v ?? `Column ${i + 1}`).trim() || `Column ${i + 1}`);
          rowCount = ws.rowCount - 1;
          ws.eachRow((row, rowNum) => {
            if (rowNum === 1 || rows.length >= 5) return;
            const obj: Record<string, unknown> = {};
            headers.forEach((h, i) => { obj[h] = (row.values as unknown[])[i + 1] ?? null; });
            rows.push(obj);
          });
        }
      }

      if (!filename) { reply.code(400); return { message: "No file provided." }; }
      return { filename, sheetNames, headers, rows, rowCount };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Could not preview file." };
    }
  });

  app.post("/api/studio/sources/xlsx/recreate", async (request, reply) => {
    try {
      const query = (request.query as { sourceId?: string; sourceName?: string } | undefined) || {};
      let filename = "";
      let workbookBuffer: Buffer | null = null;
      let sourceId = String(query.sourceId || "").trim();
      let sourceName = String(query.sourceName || "").trim();
      if (request.isMultipart()) {
        const file = await request.file();
        if (file) {
          filename = file.filename || "";
          workbookBuffer = await file.toBuffer();
        }
      } else {
        const body = (request.body as { filename?: string; base64?: string; sourceId?: string; sourceName?: string } | undefined) || {};
        if (body.filename && body.base64) {
          filename = body.filename;
          workbookBuffer = Buffer.from(body.base64, "base64");
        }
        sourceId = sourceId || String(body.sourceId || "").trim();
        sourceName = sourceName || String(body.sourceName || "").trim();
      }
      if (!filename || !workbookBuffer) {
        reply.code(400);
        return { message: "Workbook file upload is required." };
      }
      const result = await ingestXlsxWorkbookSourceAndRecreate({
        filename,
        buffer: workbookBuffer as Buffer,
        sourceId,
        sourceName
      });
      invalidateSourceCaches(...result.sources.map((s) => s.sourceId));
      void logAuditEvent("source.import.recreate", { userEmail: (request as unknown as { session?: { userEmail?: string } }).session?.userEmail, objectType: "source", metadata: { filename, sourceCount: result.sources.length } });
      return {
        document: result.document,
        sources: result.sources,
        reports: result.reports,
        dashboard: result.dashboard,
        warnings: result.warnings,
        review: result.review
      };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Workbook recreation failed." };
    }
  });

  app.post("/api/studio/sources/xlsx", async (request, reply) => {
    try {
      const query = (request.query as { sourceId?: string; sourceName?: string } | undefined) || {};
      let filename = "";
      let workbookBuffer: Buffer | null = null;
      let streamImport: ReturnType<typeof ingestXlsxWorkbookSourceStream> | null = null;
      let sourceId = String(query.sourceId || "").trim();
      let sourceName = String(query.sourceName || "").trim();
      if (request.isMultipart()) {
        const file = await request.file();
        if (file) {
          filename = file.filename || "";
          streamImport = ingestXlsxWorkbookSourceStream({
            filename,
            stream: file.file,
            sourceId,
            sourceName
          });
        }
      } else {
        const body = (request.body as { filename?: string; base64?: string; sourceId?: string; sourceName?: string } | undefined) || {};
        if (body.filename && body.base64) {
          filename = body.filename;
          workbookBuffer = Buffer.from(body.base64, "base64");
        }
        sourceId = sourceId || String(body.sourceId || "").trim();
        sourceName = sourceName || String(body.sourceName || "").trim();
      }
      if (!filename || (!workbookBuffer && !streamImport)) {
        reply.code(400);
        return { message: "Workbook file upload is required." };
      }
      const ingested = streamImport
        ? await streamImport
        : await ingestXlsxWorkbookSource({
            filename,
            buffer: workbookBuffer as Buffer,
            sourceId,
            sourceName
          });
      invalidateSourceCaches(...ingested.sources.map((s) => s.sourceId));
      void logAuditEvent("source.import", { userEmail: (request as unknown as { session?: { userEmail?: string } }).session?.userEmail, objectType: "source", metadata: { filename, sourceCount: ingested.sources.length } });
      return {
        document: ingested.document,
        sources: ingested.sources,
        warnings: ingested.warnings,
        review: ingested.review
      };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Workbook source import failed."
      };
    }
  });

  app.get("/api/studio/objects/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    return {
      versions: studioStore.listVersions(id)
    };
  });

  app.post("/api/studio/objects/:id/snapshot", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { label?: string } | undefined) || {};
    try {
      return {
        version: studioStore.snapshotObject(id, body.label || "Manual snapshot")
      };
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : "Snapshot failed."
      };
    }
  });

  app.post("/api/studio/objects/:id/restore/:versionId", async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    try {
      return {
        object: studioStore.restoreVersion(id, versionId)
      };
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : "Restore failed."
      };
    }
  });

  app.post("/api/studio/refresh/start", async (request, reply) => {
    try {
      const body = (request.body as { profileId?: string } | undefined) || {};
      const profileId = String(body.profileId || "").trim();
      let activeJob = getActiveRefreshJob();
      if (isRefreshJobStale(activeJob)) {
        await cancelRefreshJob(activeJob!.id, "Previous refresh stalled.");
        activeJob = getActiveRefreshJob();
      }
      if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
        return { job: activeJob };
      }
      const job = refreshJobStore.createJob("manual", async ({ jobId, update }) => {
        const result = await refreshAllCachedDataWithProgress("manual", (progress, message, extras) => {
          update(progress, message, extras);
        }, profileId, jobId);
        return {
          tableCount: result.tableCount,
          rowCount: result.rowCount
        };
      });
      await primeRefreshJob(job.id, { profileId, message: "Preparing refresh" });
      return { job: getTrackedRefreshJob(job.id) || job };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Scheduled refresh failed."
      };
    }
  });

  app.post("/api/studio/objects/:id/refresh/start", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      let activeJob = getActiveRefreshJob();
      if (isRefreshJobStale(activeJob)) {
        await cancelRefreshJob(activeJob!.id, "Previous refresh stalled.");
        activeJob = getActiveRefreshJob();
      }
      if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
        return { job: activeJob };
      }
      const job = refreshJobStore.createJob("manual", async ({ jobId, update }) => {
        const result = await refreshObjectCachedDataWithProgress(id, (progress, message, extras) => {
          update(progress, message, extras);
        }, jobId);
        return {
          tableCount: result.tableCount,
          rowCount: result.rowCount
        };
      });
      await primeRefreshJob(job.id, { objectId: id, message: "Preparing object refresh" });
      return { job: getTrackedRefreshJob(job.id) || job };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Object refresh failed."
      };
    }
  });

  app.get("/api/studio/refresh/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = getTrackedRefreshJob(id);
    if (!job) {
      reply.code(404);
      return { message: "Refresh job not found." };
    }
    return { job };
  });

  app.post("/api/studio/refresh/jobs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await cancelRefreshJob(id);
    if (!job) {
      reply.code(404);
      return { message: "Refresh job not found." };
    }
    return { job };
  });

  // ── Data management endpoints ─────────────────────────────────────────────

  app.get("/api/studio/sources/:sourceId", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not enabled." };
    }
    const result = await pgQuery<{
      id: string;
      source_id: string;
      source_name: string;
      source_type: string;
      field_count: number;
      record_count: number;
      metadata: Record<string, unknown>;
      refreshed_at: Date | string | null;
      updated_at: Date | string | null;
      actual_row_count: string;
    }>(
      `SELECT ae.*, COUNT(ar.id) as actual_row_count
       FROM app_entities ae
       LEFT JOIN app_records ar ON ar.entity_id = ae.id
       WHERE ae.source_id = $1
       GROUP BY ae.id`,
      [sourceId]
    );
    if (!result.rows.length) {
      reply.code(404);
      return { message: "Source not found." };
    }
    const row = result.rows[0];
    return {
      source: {
        id: row.id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        sourceType: row.source_type,
        fieldCount: Number(row.field_count || 0),
        recordCount: Number(row.record_count || 0),
        actualRowCount: Number(row.actual_row_count || 0),
        metadata: row.metadata || {},
        refreshedAt: row.refreshed_at ? new Date(row.refreshed_at).toISOString() : "",
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ""
      }
    };
  });

  app.patch("/api/studio/sources/:sourceId", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const body = (request.body as { sourceName?: string } | undefined) || {};
    const sourceName = String(body.sourceName || "").trim();
    if (!sourceName) {
      reply.code(400);
      return { message: "sourceName is required." };
    }
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not enabled." };
    }
    const updateResult = await pgQuery<{ id: string; source_id: string }>(
      `UPDATE app_entities SET source_name = $1, updated_at = $2
       WHERE source_id = $3
       RETURNING id, source_id`,
      [sourceName, new Date().toISOString(), sourceId]
    );
    if (!updateResult.rows.length) {
      reply.code(404);
      return { message: "Source not found." };
    }
    // Also update the table name in the studio document bundle if present
    const current = studioStore.getLiveDocument();
    const updatedTables = (current.bundle.tables || []).map((table) =>
      table.id === sourceId ? { ...table, name: sourceName } : table
    );
    const hasTable = updatedTables.some((t) => t.id === sourceId);
    if (hasTable) {
      studioStore.saveDocument(normalizeStudioDocument({
        ...current,
        bundle: { ...current.bundle, tables: updatedTables }
      }));
    }
    return { sourceId, sourceName };
  });

  app.delete("/api/studio/sources/:sourceId", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const session = (request as unknown as { session?: { userRole?: string } }).session;
    const userRole = session?.userRole || "viewer";
    const allowedRoles = new Set(["admin", "developer"]);
    if (!allowedRoles.has(userRole)) {
      reply.code(403);
      return { message: "data.delete permission required." };
    }
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not enabled." };
    }
    const deleteResult = await pgQuery<{ source_id: string }>(
      `DELETE FROM app_entities WHERE source_id = $1 RETURNING source_id`,
      [sourceId]
    );
    if (!deleteResult.rows.length) {
      reply.code(404);
      return { message: "Source not found." };
    }
    // Remove the table from the studio document bundle if present
    const current = studioStore.getLiveDocument();
    const filteredTables = (current.bundle.tables || []).filter((table) => table.id !== sourceId);
    if (filteredTables.length !== (current.bundle.tables || []).length) {
      studioStore.saveDocument(normalizeStudioDocument({
        ...current,
        bundle: { ...current.bundle, tables: filteredTables }
      }));
    }
    invalidateSourceCaches(sourceId);
    void logAuditEvent("source.delete", {
      userEmail: (request as unknown as { session?: { userEmail?: string } }).session?.userEmail,
      objectType: "source",
      metadata: { sourceId }
    });
    return { deleted: true, sourceId };
  });

  app.delete("/api/studio/sources/:sourceId/records", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not enabled." };
    }
    const entityResult = await pgQuery<{ id: string }>(
      `SELECT id FROM app_entities WHERE source_id = $1 LIMIT 1`,
      [sourceId]
    );
    if (!entityResult.rows.length) {
      reply.code(404);
      return { message: "Source not found." };
    }
    const entityId = entityResult.rows[0].id;
    await withPgTransaction(async (client) => {
      await client.query(
        `DELETE FROM app_records WHERE entity_id = (SELECT id FROM app_entities WHERE source_id = $1)`,
        [sourceId]
      );
      await client.query(
        `UPDATE app_entities SET field_count = 0, record_count = 0, updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), entityId]
      );
    });
    invalidateSourceCaches(sourceId);
    return { cleared: true, sourceId };
  });
}
