import type { FastifyInstance } from "fastify";
import type { StudioDocument } from "@studio/shared";
import { studioStore } from "../services/studio-store.js";
import { syncStudioDocumentToQuickbase } from "../services/quickbase-storage.js";
import { refreshAllCachedDataWithProgress, updateRefreshScheduleMetadata } from "../services/refresh-cache.js";
import { refreshJobStore } from "../services/refresh-jobs.js";

export async function registerStudioRoutes(app: FastifyInstance) {
  app.get("/api/studio/document", async () => {
    const document = await studioStore.hydrateFromQuickbase();
    updateRefreshScheduleMetadata(document);
    studioStore.saveDocument(document, { markSavedAt: false });
    return { document };
  });

  app.put("/api/studio/document", async (request, reply) => {
    const body = request.body as { document?: StudioDocument } | undefined;
    if (!body?.document) {
      reply.code(400);
      return { message: "Document payload is required." };
    }
    updateRefreshScheduleMetadata(body.document);
    const document = studioStore.saveDocument(body.document);
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

  app.post("/api/studio/refresh/start", async (_request, reply) => {
    try {
      const job = refreshJobStore.createJob("manual", async ({ update }) => {
        const result = await refreshAllCachedDataWithProgress("manual", (progress, message, extras) => {
          update(progress, message, extras);
        });
        return {
          tableCount: result.tableCount,
          rowCount: result.rowCount
        };
      });
      const current = studioStore.getDocument();
      current.sync.refreshStatus.running = true;
      current.sync.refreshStatus.activeJobId = job.id;
      current.sync.refreshStatus.progress = Math.max(current.sync.refreshStatus.progress || 0, 1);
      current.sync.refreshStatus.message = current.sync.refreshStatus.message || "Starting refresh";
      current.sync.refreshStatus.lastError = "";
      studioStore.saveDocument(current, { markSavedAt: false });
      return { job };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Scheduled refresh failed."
      };
    }
  });

  app.get("/api/studio/refresh/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    let job = refreshJobStore.getJob(id);
    if (!job) {
      const document = studioStore.getDocument();
      const status = document.sync.refreshStatus;
      if (status.activeJobId === id || (status.running && !status.activeJobId)) {
        job = {
          id,
          status: status.running ? "running" : (status.lastError ? "failed" : "complete"),
          progress: status.progress || 0,
          message: status.message || (status.running ? "Refreshing…" : "Refresh complete"),
          error: status.lastError || undefined,
          reason: "manual",
          createdAt: status.lastStartedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: status.lastStartedAt || undefined,
          completedAt: status.lastCompletedAt || undefined,
          estimatedSecondsRemaining: status.estimatedSecondsRemaining,
          tableCount: status.cachedTableIds?.length || undefined,
          rowCount: status.cachedRowCount || undefined
        };
      }
    }
    if (!job) {
      reply.code(404);
      return { message: "Refresh job not found." };
    }
    return { job };
  });
}
