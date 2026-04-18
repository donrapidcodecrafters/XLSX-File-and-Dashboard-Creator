import type { FastifyInstance } from "fastify";
import { executeDashboard, executeReport } from "../services/report-runner.js";
import { objectStore } from "../services/object-store.js";

export async function registerRenderRoutes(app: FastifyInstance) {
  app.post("/api/reports/:id/run", async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const body = (request.body as { filters?: Array<{ fieldId: string; operator?: string; value: string }> } | undefined) || {};
    const extraFilters = (body.filters || []).map((filter, index) => ({
      id: "client-" + index,
      fieldId: filter.fieldId,
      operator: (filter.operator || "equals") as "equals",
      value: filter.value
    }));
    return executeReport(report, extraFilters);
  });

  app.post("/api/dashboards/:id/render", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { runtimeFilters?: Record<string, string> } | undefined) || {};
    try {
      return await executeDashboard(id, body.runtimeFilters || {});
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : "Dashboard render failed."
      };
    }
  });
}
