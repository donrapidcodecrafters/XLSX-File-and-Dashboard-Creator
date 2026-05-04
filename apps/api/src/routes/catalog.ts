import type { FastifyInstance } from "fastify";
import { objectStore } from "../services/object-store.js";
import { studioStore } from "../services/studio-store.js";

export async function registerCatalogRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({
    ok: true,
    app: objectStore.getAppInfo(),
    timestamp: new Date().toISOString()
  }));

  app.get("/api/catalog", async () => {
    return {
      app: objectStore.getAppInfo(),
      objects: objectStore.listCatalog()
    };
  });

  app.get("/api/tables", async () => {
    return {
      app: objectStore.getAppInfo(),
      tables: objectStore.listTables()
    };
  });

  app.get("/api/objects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    let object = objectStore.getObject(id);
    if (!object) {
      await studioStore.hydrateFromQuickbase(true);
      object = objectStore.getObject(id);
    }
    if (!object) {
      reply.code(404);
      return { message: "Object not found." };
    }
    return { object };
  });
}
