import type { FastifyInstance } from "fastify";
import { loadQuickbaseSchema } from "../services/quickbase-schema.js";

export async function registerQuickbaseRoutes(app: FastifyInstance) {
  app.post("/api/quickbase/schema", async (request, reply) => {
    const body = (request.body as {
      realmHostname?: string;
      userToken?: string;
      appToken?: string;
      appId?: string;
    } | undefined) || {};

    try {
      const schema = await loadQuickbaseSchema({
        realmHostname: body.realmHostname || "",
        userToken: body.userToken || "",
        appToken: body.appToken || "",
        appId: body.appId || ""
      });
      return { schema };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Quickbase schema lookup failed."
      };
    }
  });
}
