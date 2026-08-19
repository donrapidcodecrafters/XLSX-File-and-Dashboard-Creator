import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildDashboardFilters, type DashboardDefinition, type FilterDefinition, type FilterOperator, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { executeDashboard, executeReport, fetchAllReportRowsForExport, fetchReportExportBundle, fetchReportPage } from "../services/report-runner.js";
import { objectStore } from "../services/object-store.js";
import { studioStore } from "../services/studio-store.js";
import { exportJobStore } from "../services/export-jobs.js";
import { buildDashboardFileName, buildReportFileName } from "../services/xlsx-export.js";
import { exportDashboardNativeChartWorkbook, exportReportNativeChartWorkbook } from "../services/nativeExcelExport.js";

function writeBufferToStream(stream: NodeJS.WritableStream, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.end(buffer, (error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

function normalizeClientFilters(filters: Array<{ fieldId: string; operator?: string; value: string; valueSource?: "literal" | "field"; compareFieldId?: string }> = []): FilterDefinition[] {
  return filters.map((filter, index) => ({
    id: "client-" + index,
    fieldId: filter.fieldId,
    operator: (filter.operator || "equals") as FilterOperator,
    value: filter.value,
    valueSource: filter.valueSource || "literal",
    compareFieldId: filter.compareFieldId || ""
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

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}


export async function registerRenderRoutes(app: FastifyInstance) {
  app.post("/api/reports/:id/run", async (request, reply) => {
    studioStore.getDocument();
    const { id } = request.params as { id: string };
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
      page?: number;
      pageSize?: number;
      forceLive?: boolean;
      report?: ReportDefinition;
    } | undefined) || {};
    const report = body.report?.id === id ? body.report : objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const extraFilters = normalizeClientFilters(body.filters || []);
    return executeReport(report, extraFilters, {
      page: body.page || 1,
      pageSize: body.pageSize || 100,
      forceLive: body.forceLive === true
    });
  });

  app.post("/api/reports/:id/page", async (request, reply) => {
    studioStore.getDocument();
    const { id } = request.params as { id: string };
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
      page?: number;
      pageSize?: number;
      forceLive?: boolean;
      report?: ReportDefinition;
    } | undefined) || {};
    const report = body.report?.id === id ? body.report : objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const extraFilters = normalizeClientFilters(body.filters || []);
    return fetchReportPage(report, extraFilters, {
      page: body.page || 1,
      pageSize: body.pageSize || 100,
      forceLive: body.forceLive === true
    });
  });

  app.post("/api/reports/:id/export-rows", async (request, reply) => {
    studioStore.getDocument();
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
    const body = (request.body as {
      filters?: Array<{ fieldId: string; operator?: string; value: string }>;
      report?: ReportDefinition;
    } | undefined) || {};
    const report = body.report?.id === id
      ? body.report
      : objectStore.getReport(id);
    if (!report) {
      reply.code(404);
      return { message: "Report not found." };
    }
    const extraFilters = normalizeClientFilters(body.filters || []);
    const result = await fetchReportExportBundle(report, extraFilters);
    return { result };
  });

  app.post("/api/exports/report/start", async (request, reply) => {
    studioStore.getDocument();
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
      const buffer = await exportReportNativeChartWorkbook(report, table, result);
      await writeBufferToStream(stream, buffer);
    });
    return { job };
  });

  app.post("/api/exports/dashboard/start", async (request, reply) => {
    studioStore.getDocument();
    const body = (request.body as { payload?: string } | undefined) || {};
    const payload = parsePayload(body.payload) as {
      dashboardId?: string;
      dashboard?: DashboardDefinition;
      runtimeFilters?: Record<string, string>;
    };
    const dashboard = payload.dashboard?.id
      ? payload.dashboard
      : (payload.dashboardId ? objectStore.getDashboard(payload.dashboardId) as DashboardDefinition | undefined : undefined);
    if (!dashboard) {
      reply.code(404);
      return { message: "Dashboard not found." };
    }
    const runtimeFilters = payload.runtimeFilters || {};
    const filename = buildDashboardFileName(dashboard);
    const job = exportJobStore.createJob(dashboard.id, "dashboard", filename, async ({ jobId, update }) => {
      update(5, "Rendering dashboard");
      const rendered = await executeDashboard(dashboard.id, runtimeFilters, { dashboard });
      const renderedWidgets = rendered.tabs.flatMap((tab) => tab.widgets);
      const exportResultsByWidgetId: Record<string, ReportRunResult> = {};
      const tablesById = Object.fromEntries(objectStore.listTables().map((table) => [table.id, table]));
      const reportProgress = new Map<string, number>();
      const reportMessage = new Map<string, string>();
      const updateOverallProgress = () => {
        const total = Math.max(renderedWidgets.length, 1);
        const average = renderedWidgets.reduce((sum, widget) => sum + (reportProgress.get(widget.widgetId) || 0), 0) / total;
        const leadReport = renderedWidgets
          .map((widget) => ({
            widgetId: widget.widgetId,
            progress: reportProgress.get(widget.widgetId) || 0,
            message: reportMessage.get(widget.widgetId) || ""
          }))
          .sort((left, right) => right.progress - left.progress)[0];
        const message = leadReport?.message || "Loading dashboard reports";
        update(10 + Math.round(average * 55), message);
      };
      await runWithConcurrency(renderedWidgets, 2, async (widget) => {
        const report = widget.report;
        if (!report) return;
        const filters = buildDashboardFilters(dashboard, report.id, runtimeFilters, report.sourceTableId);
        reportProgress.set(widget.widgetId, 0);
        reportMessage.set(widget.widgetId, `Loading ${report.name}`);
        updateOverallProgress();

        // If this widget needs a separate detail sheet but has no selectedFieldIds,
        // augment the report so rows are projected with all table fields.
        const widgetMode = widget.widget.displayMode !== "inherit" ? widget.widget.displayMode : report.view.mode;
        const needsDetailSheet = widgetMode !== "table" && widget.widget.showDetails;
        let effectiveReport = report;
        if (needsDetailSheet && !report.selectedFieldIds.length) {
          const srcTable = tablesById[report.sourceTableId];
          if (srcTable?.fields.length) {
            effectiveReport = { ...report, selectedFieldIds: srcTable.fields.map((f) => String(f.id)) };
          }
        }

        try {
          exportResultsByWidgetId[widget.widgetId] = await fetchReportExportBundle(effectiveReport, filters, (progress, message) => {
            reportProgress.set(widget.widgetId, Math.max(0, Math.min(100, progress)));
            reportMessage.set(widget.widgetId, `${report.name}: ${message}`);
            updateOverallProgress();
          });
          reportProgress.set(widget.widgetId, 100);
          reportMessage.set(widget.widgetId, `${report.name}: ready`);
        } catch (error) {
          reportProgress.set(widget.widgetId, 100);
          reportMessage.set(widget.widgetId, `${report.name}: ${error instanceof Error ? error.message : "failed"}`);
        }
        updateOverallProgress();
      });
      update(72, "Building workbook");
      const stream = exportJobStore.createFileStream(jobId);
      if (!stream) {
        throw new Error("Unable to create export file stream.");
      }
      const buffer = await exportDashboardNativeChartWorkbook(dashboard, rendered, exportResultsByWidgetId, {
        tablesById,
        includeOverviewSheet: dashboard.includeExportOverviewSheet !== false
      });
      await writeBufferToStream(stream, buffer);
    });
    return { job };
  });

  app.get("/api/exports/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await exportJobStore.getJob(id);
    if (!job) {
      reply.code(404);
      return { message: "Export job not found." };
    }
    return { job };
  });

  app.get("/api/exports/jobs", async () => {
    return { jobs: exportJobStore.listJobs() };
  });

  app.get("/api/exports/jobs/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await exportJobStore.getJob(id);
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
    studioStore.getDocument();
    const { id } = request.params as { id: string };
    const body = (request.body as {
      runtimeFilters?: Record<string, string>;
      activeTabId?: string;
      forceLive?: boolean;
      dashboard?: DashboardDefinition;
      reportOverrides?: Record<string, unknown>;
    } | undefined) || {};
    try {
      const dashboard = body.dashboard?.id === id
        ? body.dashboard
        : (objectStore.getDashboard(id) as DashboardDefinition | undefined);
      if (!dashboard) {
        reply.code(404);
        return { message: "Dashboard not found." };
      }
      return executeDashboard(id, body.runtimeFilters || {}, {
        activeTabId: body.activeTabId || "",
        forceLive: body.forceLive === true,
        dashboard,
        reportOverrides: body.reportOverrides as Record<string, ReportDefinition> | undefined
      });
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : "Dashboard render failed."
      };
    }
  });
}
