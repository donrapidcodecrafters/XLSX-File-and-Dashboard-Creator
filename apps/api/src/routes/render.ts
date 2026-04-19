import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildDashboardFilters, type DashboardDefinition, type FilterDefinition, type FilterOperator, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { executeDashboard, executeReport, fetchAllReportRowsForExport, fetchReportExportBundle, fetchReportPage } from "../services/report-runner.js";
import { objectStore } from "../services/object-store.js";
import { studioStore } from "../services/studio-store.js";
import { exportJobStore } from "../services/export-jobs.js";
import { buildDashboardFileName, buildReportFileName, streamDashboardWorkbook, streamReportWorkbook } from "../services/xlsx-export.js";

function normalizeClientFilters(filters: Array<{ fieldId: string; operator?: string; value: string }> = []): FilterDefinition[] {
  return filters.map((filter, index) => ({
    id: "client-" + index,
    fieldId: filter.fieldId,
    operator: (filter.operator || "equals") as FilterOperator,
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

  app.post("/api/exports/report/start", async (request, reply) => {
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
    const filename = buildReportFileName(report);
    const job = exportJobStore.createJob(report.id, "report", filename, async ({ jobId, update }) => {
      update(6, "Loading full report data");
      const result = await fetchReportExportBundle(report, extraFilters, update);
      update(72, "Building workbook");
      const stream = exportJobStore.createFileStream(jobId);
      if (!stream) {
        throw new Error("Unable to create export file stream.");
      }
      await streamReportWorkbook(stream, report, table, result, update);
    });
    return { job };
  });

  app.post("/api/exports/dashboard/start", async (request, reply) => {
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
    const filename = buildDashboardFileName(dashboard);
    const job = exportJobStore.createJob(dashboard.id, "dashboard", filename, async ({ jobId, update }) => {
      update(5, "Rendering dashboard");
      const rendered = await executeDashboard(dashboard.id, runtimeFilters);
      const widgetReportIds = Array.from(new Set(rendered.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.report.id))));
      const exportResultsByReportId: Record<string, ReportRunResult> = {};
      for (let index = 0; index < widgetReportIds.length; index += 1) {
        const reportId = widgetReportIds[index];
        const report = objectStore.getReport(reportId) as ReportDefinition | undefined;
        if (!report) continue;
        const filters = buildDashboardFilters(dashboard, report.id, runtimeFilters);
        const rangeStart = 10 + Math.round((index / Math.max(widgetReportIds.length, 1)) * 55);
        const rangeEnd = 10 + Math.round(((index + 1) / Math.max(widgetReportIds.length, 1)) * 55);
        update(rangeStart, `Loading ${report.name}`);
        exportResultsByReportId[reportId] = await fetchReportExportBundle(report, filters, (progress, message) => {
          const ratio = Math.max(0, Math.min(1, progress / 100));
          const mapped = rangeStart + Math.round((rangeEnd - rangeStart) * ratio);
          update(mapped, `${report.name}: ${message}`);
        });
      }
      const tablesById = Object.fromEntries(objectStore.listTables().map((table) => [table.id, table]));
      update(72, "Building workbook");
      const stream = exportJobStore.createFileStream(jobId);
      if (!stream) {
        throw new Error("Unable to create export file stream.");
      }
      await streamDashboardWorkbook(stream, dashboard, rendered, exportResultsByReportId, tablesById, update);
    });
    return { job };
  });

  app.get("/api/exports/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = exportJobStore.getJob(id);
    if (!job) {
      reply.code(404);
      return { message: "Export job not found." };
    }
    return { job };
  });

  app.get("/api/exports/jobs/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = exportJobStore.getJob(id);
    if (!job) {
      reply.code(404);
      return { message: "Export job not found." };
    }
    if (job.status !== "complete" || !job.filePath) {
      reply.code(409);
      return { message: "Export is not ready yet." };
    }
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", `attachment; filename="${job.filename || `${job.objectId}.xlsx`}"`);
    return reply.send(createReadStream(job.filePath));
  });

  app.post("/api/dashboards/:id/render", async (request, reply) => {
    await studioStore.hydrateFromQuickbase();
    const { id } = request.params as { id: string };
    const body = (request.body as { runtimeFilters?: Record<string, string>; activeTabId?: string } | undefined) || {};
    try {
      return await executeDashboard(id, body.runtimeFilters || {}, {
        activeTabId: body.activeTabId || ""
      });
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : "Dashboard render failed."
      };
    }
  });
}
