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
import { importWorkbookIntoStudioDocument } from "../services/xlsx-import.js";

const STALE_REFRESH_JOB_MS = 3 * 60 * 1000;

function isRefreshJobStale(job: { status?: string; updatedAt?: string; createdAt?: string } | null) {
  if (!job || (job.status !== "queued" && job.status !== "running")) return false;
  const updatedAt = Date.parse(String(job.updatedAt || job.createdAt || ""));
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > STALE_REFRESH_JOB_MS;
}

export async function registerStudioRoutes(app: FastifyInstance) {
  app.get("/api/studio/document", async () => {
    const document = studioStore.getDocument();
    updateRefreshScheduleMetadata(document);
    return { document };
  });

  app.get("/api/studio/cache/summary", async () => {
    const document = studioStore.getLiveDocument();
    const cacheMeta = studioStore.getAllCacheMeta();
    return {
      refreshStatus: document.sync.refreshStatus,
      tables: Object.entries(document.bundle.data || {}).map(([tableId, rows]) => ({
        tableId,
        rowCount: Array.isArray(rows) ? rows.length : 0,
        cachedAt: cacheMeta[tableId]?.cachedAt || "",
        expiresAt: cacheMeta[tableId]?.expiresAt || ""
      }))
    };
  });

  app.put("/api/studio/document", async (request, reply) => {
    const body = request.body as { document?: StudioDocument } | undefined;
    if (!body?.document) {
      reply.code(400);
      return { message: "Document payload is required." };
    }
    const current = studioStore.getLiveDocument();
    const mergedDocument: StudioDocument = normalizeStudioDocument({
      ...body.document,
      bundle: {
        ...body.document.bundle,
        // Keep server-side cached rows instead of requiring the browser to upload them on every save.
        data: current.bundle.data
      },
      sync: {
        ...body.document.sync,
        refreshStatus: current.sync.refreshStatus
      },
      quickbaseProfiles: body.document.quickbaseProfiles.map((profile) => {
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
    const sync = await syncStudioDocumentToQuickbase(document).catch((error) => ({
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
    return { document, sync };
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
    const body = (request.body as { filename?: string; base64?: string } | undefined) || {};
    if (!body.filename || !body.base64) {
      reply.code(400);
      return { message: "Workbook filename and base64 payload are required." };
    }
    try {
      const current = studioStore.getLiveDocument();
      const imported = await importWorkbookIntoStudioDocument(
        current,
        body.filename,
        Buffer.from(body.base64, "base64")
      );
      const document = studioStore.saveDocument(imported.document);
      const sync = await syncStudioDocumentToQuickbase(studioStore.getLiveDocument()).catch((error) => ({
        enabled: true,
        ok: false,
        message: error instanceof Error ? error.message : "Quickbase sync failed.",
        savedObjects: 0,
        savedSettings: 0,
        savedVersions: 0,
        savedStorageConfig: 0
      }));
      return {
        document,
        primaryObjectId: imported.primaryObjectId,
        importedObjectIds: imported.importedObjectIds,
        importedTableIds: imported.importedTableIds,
        warnings: imported.warnings,
        review: imported.review,
        sync
      };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Workbook import failed."
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
        }, "", jobId);
        return {
          tableCount: result.tableCount,
          rowCount: result.rowCount
        };
      });
      await primeRefreshJob(job.id, { message: "Preparing refresh" });
      return { job };
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
      return { job };
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
}
