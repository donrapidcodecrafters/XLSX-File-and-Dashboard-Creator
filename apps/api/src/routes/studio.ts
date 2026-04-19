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
    const job = refreshJobStore.getJob(id);
    if (!job) {
      reply.code(404);
      return { message: "Refresh job not found." };
    }
    return { job };
  });
}
