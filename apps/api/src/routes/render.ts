import type { FastifyInstance } from "fastify";
import { executeDashboard, executeReport, fetchAllReportRowsForExport, fetchReportExportBundle, fetchReportPage } from "../services/report-runner.js";
import { objectStore } from "../services/object-store.js";
import { studioStore } from "../services/studio-store.js";

export async function registerRenderRoutes(app: FastifyInstance) {
  app.post("/api/reports/:id/run", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const { id } = request.params as { id: string };
    const report = objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
      page?: number;
      pageSize?: number;
    } | undefined) || {};
    const extraFilters = (body.filters || []).map((filter, index) => ({
      id: "client-" + index,
      fieldId: filter.fieldId,
      operator: (filter.operator || "equals") as "equals",
      value: filter.value
    }));
    return executeReport(report, extraFilters, {
      page: body.page || 1,
      pageSize: body.pageSize || 100
    });
  });

  app.post("/api/reports/:id/page", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const { id } = request.params as { id: string };
    const report = objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
      page?: number;
      pageSize?: number;
    } | undefined) || {};
    const extraFilters = (body.filters || []).map((filter, index) => ({
      id: "client-" + index,
      fieldId: filter.fieldId,
      operator: (filter.operator || "equals") as "equals",
      value: filter.value
    }));
    return fetchReportPage(report, extraFilters, {
      page: body.page || 1,
      pageSize: body.pageSize || 100
    });
  });

  app.post("/api/reports/:id/export-rows", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const { id } = request.params as { id: string };
    const report = objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
    } | undefined) || {};
    const extraFilters = (body.filters || []).map((filter, index) => ({
      id: "client-" + index,
      fieldId: filter.fieldId,
      operator: (filter.operator || "equals") as "equals",
      value: filter.value
    }));
    const rows = await fetchAllReportRowsForExport(report, extraFilters);
    return { rows };
  });

  app.post("/api/reports/:id/export-bundle", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const { id } = request.params as { id: string };
    const report = objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
    } | undefined) || {};
    const extraFilters = (body.filters || []).map((filter, index) => ({
      id: "client-" + index,
      fieldId: filter.fieldId,
      operator: (filter.operator || "equals") as "equals",
      value: filter.value
    }));
    const result = await fetchReportExportBundle(report, extraFilters);
    return { result };
  });

  app.post("/api/dashboards/:id/render", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
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
