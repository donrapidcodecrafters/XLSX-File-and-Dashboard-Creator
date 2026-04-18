import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildDashboardFilters, type DashboardDefinition, type FilterDefinition, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { executeDashboard, executeReport, fetchAllReportRowsForExport, fetchReportExportBundle, fetchReportPage } from "../services/report-runner.js";
import { objectStore } from "../services/object-store.js";
import { studioStore } from "../services/studio-store.js";
import { buildDashboardFileName, buildReportFileName, streamDashboardWorkbook, streamReportWorkbook } from "../services/xlsx-export.js";

function normalizeClientFilters(filters: Array<{ fieldId: string; operator?: string; value: string }> = []): FilterDefinition[] {
  return filters.map((filter, index) => ({
    id: "client-" + index,
    fieldId: filter.fieldId,
    operator: (filter.operator || "equals") as "equals",
    value: filter.value
  }));
}

function parsePayload(raw: unknown) {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

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
    const extraFilters = normalizeClientFilters(body.filters || []);
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
    const extraFilters = normalizeClientFilters(body.filters || []);
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
    const extraFilters = normalizeClientFilters(body.filters || []);
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
    const extraFilters = normalizeClientFilters(body.filters || []);
    const result = await fetchReportExportBundle(report, extraFilters);
    return { result };
  });

  app.post("/api/exports/report.xlsx", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const body = (request.body as { payload?: string } | undefined) || {};
    const payload = parsePayload(body.payload) as {
      reportId?: string;
      report?: ReportDefinition;
      table?: TableDefinition;
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
    };
    const report = payload.report || (payload.reportId ? objectStore.getReport(payload.reportId) as ReportDefinition | undefined : undefined);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const table = payload.table || objectStore.getTable(report.sourceTableId);
    if (!table) {
      reply.code(404);
      return { message: "Table not found for report." };
    }
    const extraFilters = normalizeClientFilters(payload.filters || []);
    const result = await fetchReportExportBundle(report, extraFilters);
    const stream = new PassThrough();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", `attachment; filename="${buildReportFileName(report)}"`);
    reply.send(stream);
    void streamReportWorkbook(stream, report, table, result).catch((error) => {
      request.log.error({ error }, "report export stream failed");
      stream.destroy(error instanceof Error ? error : new Error("Report export failed."));
    });
    return reply;
  });

  app.post("/api/exports/dashboard.xlsx", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const body = (request.body as { payload?: string } | undefined) || {};
    const payload = parsePayload(body.payload) as {
      dashboardId?: string;
      runtimeFilters?: Record<string, string>;
    };
    const dashboard = payload.dashboardId ? objectStore.getDashboard(payload.dashboardId) as DashboardDefinition | undefined : undefined;
    if (!dashboard) {
      reply.code(404);
      return { message: "Dashboard not found." };
    }
    const runtimeFilters = payload.runtimeFilters || {};
    const rendered = await executeDashboard(dashboard.id, runtimeFilters);
    const exportResultsByReportId = Object.fromEntries(
      await Promise.all(
        Array.from(new Set(rendered.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.report.id)))).map(async (reportId) => {
          const report = objectStore.getReport(reportId) as ReportDefinition | undefined;
          if (!report) return [reportId, null] as const;
          const filters = buildDashboardFilters(dashboard, report.id, runtimeFilters);
          const result = await fetchReportExportBundle(report, filters);
          return [reportId, result] as const;
        })
      )
    );
    const tablesById = Object.fromEntries(objectStore.listTables().map((table) => [table.id, table]));
    const stream = new PassThrough();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", `attachment; filename="${buildDashboardFileName(dashboard)}"`);
    reply.send(stream);
    void streamDashboardWorkbook(
      stream,
      dashboard,
      rendered,
      Object.fromEntries(Object.entries(exportResultsByReportId).filter((entry): entry is [string, ReportRunResult] => Boolean(entry[1]))),
      tablesById
    ).catch((error) => {
      request.log.error({ error }, "dashboard export stream failed");
      stream.destroy(error instanceof Error ? error : new Error("Dashboard export failed."));
    });
    return reply;
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
