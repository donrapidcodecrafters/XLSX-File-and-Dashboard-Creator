import type { FastifyInstance } from "fastify";
import type { StudioDocument } from "@studio/shared";
import { studioStore } from "../services/studio-store.js";
import { ensureQuickbaseStorageForProfiles, syncStudioDocumentToQuickbase } from "../services/quickbase-storage.js";
import { refreshAllCachedDataWithProgress, refreshObjectCachedDataWithProgress, updateRefreshScheduleMetadata } from "../services/refresh-cache.js";
import { refreshJobStore } from "../services/refresh-jobs.js";

function synthesizeRefreshJob(id: string) {
  const document = studioStore.getLiveDocument();
  const globalStatus = document.sync.refreshStatus;
  const runningProfile = document.quickbaseProfiles.find((profile) => profile.refreshStatus.running);
  const status = runningProfile?.refreshStatus?.running ? runningProfile.refreshStatus : globalStatus;
  const isRefreshActive = globalStatus.running || document.quickbaseProfiles.some((profile) => profile.refreshStatus.running);
  if (!isRefreshActive && !globalStatus.lastStartedAt && !globalStatus.lastCompletedAt) {
    return null;
  }
  const jobStatus: "running" | "failed" | "complete" = isRefreshActive ? "running" : (status.lastError ? "failed" : "complete");
  return {
    id,
    status: jobStatus,
    progress: status.progress || globalStatus.progress || 0,
    message: status.message || globalStatus.message || (isRefreshActive ? "Refreshing…" : "Refresh complete"),
    error: status.lastError || globalStatus.lastError || undefined,
    reason: "manual" as const,
    createdAt: status.lastStartedAt || globalStatus.lastStartedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: status.lastStartedAt || globalStatus.lastStartedAt || undefined,
    completedAt: status.lastCompletedAt || globalStatus.lastCompletedAt || undefined,
    estimatedSecondsRemaining: status.estimatedSecondsRemaining ?? globalStatus.estimatedSecondsRemaining,
    tableCount: (status.cachedTableIds?.length || globalStatus.cachedTableIds?.length || 0) || undefined,
    rowCount: (status.cachedRowCount || globalStatus.cachedRowCount || 0) || undefined
  };
}

export async function registerStudioRoutes(app: FastifyInstance) {
  app.get("/api/studio/document", async () => {
    await studioStore.hydrateFromQuickbase();
    const document = studioStore.getLiveDocument();
    updateRefreshScheduleMetadata(document);
    studioStore.flushCurrent({ markSavedAt: false });
    return { document: studioStore.getDocument() };
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
    const mergedDocument: StudioDocument = {
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
          refreshStatus: existing?.refreshStatus || profile.refreshStatus
        };
      })
    };
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
      const job = refreshJobStore.createJob("manual", async ({ jobId, update }) => {
        const result = await refreshAllCachedDataWithProgress("manual", (progress, message, extras) => {
          update(progress, message, extras);
        }, "", jobId);
        return {
          tableCount: result.tableCount,
          rowCount: result.rowCount
        };
      });
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
      const job = refreshJobStore.createJob("manual", async ({ jobId, update }) => {
        const result = await refreshObjectCachedDataWithProgress(id, (progress, message, extras) => {
          update(progress, message, extras);
        }, jobId);
        return {
          tableCount: result.tableCount,
          rowCount: result.rowCount
        };
      });
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
    let job = refreshJobStore.getJob(id);
    if (!job) {
      job = synthesizeRefreshJob(id);
    }
    if (!job) {
      reply.code(404);
      return { message: "Refresh job not found." };
    }
    return { job };
  });
}
