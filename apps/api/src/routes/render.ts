import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { buildDashboardFilters, type DashboardDefinition, type FilterDefinition, type FilterOperator, type RefreshJobStatus, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { executeDashboard, executeReport, fetchAllReportRowsForExport, fetchReportExportBundle, fetchReportPage } from "../services/report-runner.js";
import { objectStore } from "../services/object-store.js";
import { studioStore } from "../services/studio-store.js";
import { exportJobStore } from "../services/export-jobs.js";
import { buildDashboardFileName, buildReportFileName, streamDashboardWorkbook, streamReportWorkbook } from "../services/xlsx-export.js";
import { refreshJobStore } from "../services/refresh-jobs.js";
import { getActiveRefreshJob, primeRefreshJob, refreshObjectCachedDataWithProgress } from "../services/refresh-cache.js";

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

function getTableRefreshState(tableId: string) {
  const table = objectStore.getTable(tableId);
  if (!table) return { hasRows: false, isFresh: false };
  const keys = Array.from(new Set([tableId, table.id, table.quickbaseTableId || ""].filter(Boolean)));
  let hasRows = false;
  let isFresh = false;
  let hasMeta = false;
  let isExpired = false;
  for (const key of keys) {
    const rows = objectStore.getRows(key);
    if (rows.length) {
      hasRows = true;
    }
    const meta = studioStore.getCacheMeta(key);
    if (!meta) continue;
    hasMeta = true;
    const expiresAt = Date.parse(String(meta.expiresAt || ""));
    if (!Number.isNaN(expiresAt) && expiresAt > Date.now()) {
      isFresh = true;
      isExpired = false;
      break;
    }
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      isExpired = true;
    }
  }
  if (!hasMeta && hasRows) {
    isFresh = true;
  }
  return { hasRows, isFresh, isExpired };
}

function hasQuickbaseSource(tableId: string) {
  const document = studioStore.getDocument();
  const table = objectStore.getTable(tableId);
  if (!table) return false;
  const profile = table.quickbaseProfileId
    ? document.quickbaseProfiles.find((item) => item.id === table.quickbaseProfileId)
    : null;
  const quickbase = profile?.quickbase || document.quickbase;
  return Boolean((table.quickbaseTableId || table.id) && quickbase.realmHostname && quickbase.userToken && quickbase.appId);
}

async function startAutoRefreshForObject(objectId: string) {
  const activeJob = getActiveRefreshJob();
  if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
    return activeJob;
  }
  const job = refreshJobStore.createJob("manual", async ({ jobId, update }) => {
    const result = await refreshObjectCachedDataWithProgress(objectId, (progress, message, extras) => {
      update(progress, message, extras);
    }, jobId);
    return {
      tableCount: result.tableCount,
      rowCount: result.rowCount
    };
  });
  await primeRefreshJob(job.id, { objectId, message: "Preparing object refresh" });
  return job;
}

async function maybeStartAutoRefreshForReport(report: ReportDefinition) {
  const state = getTableRefreshState(report.sourceTableId);
  if (state.isFresh || (state.hasRows && !state.isExpired)) return { refreshJob: null, needsBlockingLoad: false };
  if (!hasQuickbaseSource(report.sourceTableId)) return null;
  return {
    refreshJob: await startAutoRefreshForObject(report.id),
    needsBlockingLoad: !state.hasRows
  };
}

async function maybeStartAutoRefreshForDashboard(dashboard: DashboardDefinition, activeTabId = "") {
  const tabsToCheck = activeTabId
    ? dashboard.tabs.filter((tab) => tab.id === activeTabId)
    : dashboard.tabs;
  const tableIds = Array.from(new Set(
    tabsToCheck.flatMap((tab) => tab.widgets.map((widget) => widget.reportId))
      .map((reportId) => objectStore.getReport(reportId)?.sourceTableId || "")
      .filter(Boolean)
  ));
  if (!tableIds.length) return null;
  const states = tableIds.map((tableId) => ({ tableId, ...getTableRefreshState(tableId) }));
  if (states.every((state) => state.isFresh || (state.hasRows && !state.isExpired))) {
    return { refreshJob: null, needsBlockingLoad: false };
  }
  if (!tableIds.some((tableId) => hasQuickbaseSource(tableId))) return null;
  return {
    refreshJob: await startAutoRefreshForObject(dashboard.id),
    // Dashboards should render the active tab immediately when possible and
    // let refresh continue in the background instead of returning an empty shell.
    needsBlockingLoad: false
  };
}

function buildPendingReportResult(
  report: ReportDefinition,
  refreshJob: RefreshJobStatus,
  page = 1,
  pageSize = 100
): ReportRunResult {
  return {
    reportId: report.id,
    tableId: report.sourceTableId,
    totalRows: 0,
    rows: [],
    summary: [],
    chartData: [],
    warnings: ["Loading source records for this report. The report will open automatically when the refresh completes."],
    page,
    pageSize,
    totalPages: 1,
    hasNextPage: false,
    refreshJob
  };
}

function buildPendingDashboardResult(dashboard: DashboardDefinition, refreshJob: RefreshJobStatus) {
  return {
    dashboard,
    tabs: dashboard.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      widgets: []
    })),
    refreshJob
  };
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
    const pendingRefresh = await maybeStartAutoRefreshForReport(report);
    if (pendingRefresh?.refreshJob && pendingRefresh.needsBlockingLoad) {
      return buildPendingReportResult(report, pendingRefresh.refreshJob, body.page || 1, body.pageSize || 100);
    }
    const result = await executeReport(report, extraFilters, {
      page: body.page || 1,
      pageSize: body.pageSize || 100,
      forceLive: body.forceLive === true
    });
    if (pendingRefresh?.refreshJob) {
      return {
        ...result,
        refreshJob: pendingRefresh.refreshJob
      };
    }
    return result;
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
    const pendingRefresh = await maybeStartAutoRefreshForReport(report);
    if (pendingRefresh?.refreshJob && pendingRefresh.needsBlockingLoad) {
      return buildPendingReportResult(report, pendingRefresh.refreshJob, body.page || 1, body.pageSize || 100);
    }
    const result = await fetchReportPage(report, extraFilters, {
      page: body.page || 1,
      pageSize: body.pageSize || 100,
      forceLive: body.forceLive === true
    });
    if (pendingRefresh?.refreshJob) {
      return {
        ...result,
        refreshJob: pendingRefresh.refreshJob
      };
    }
    return result;
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
      await streamReportWorkbook(stream, report, table, result, update, extraFilters);
    });
    return { job };
  });

  app.post("/api/exports/dashboard/start", async (request, reply) => {
    studioStore.getDocument();
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
      const reportProgress = new Map<string, number>();
      const reportMessage = new Map<string, string>();
      const updateOverallProgress = () => {
        const total = Math.max(widgetReportIds.length, 1);
        const average = widgetReportIds.reduce((sum, reportId) => sum + (reportProgress.get(reportId) || 0), 0) / total;
        const leadReport = widgetReportIds
          .map((reportId) => ({
            reportId,
            progress: reportProgress.get(reportId) || 0,
            message: reportMessage.get(reportId) || ""
          }))
          .sort((left, right) => right.progress - left.progress)[0];
        const message = leadReport?.message || "Loading dashboard reports";
        update(10 + Math.round(average * 55), message);
      };
      await runWithConcurrency(widgetReportIds, 2, async (reportId, index) => {
        const report = objectStore.getReport(reportId) as ReportDefinition | undefined;
        if (!report) return;
        const filters = buildDashboardFilters(dashboard, report.id, runtimeFilters, report.sourceTableId);
        reportProgress.set(report.id, 0);
        reportMessage.set(report.id, `Loading ${report.name}`);
        updateOverallProgress();
        try {
          exportResultsByReportId[reportId] = await fetchReportExportBundle(report, filters, (progress, message) => {
            reportProgress.set(report.id, Math.max(0, Math.min(100, progress)));
            reportMessage.set(report.id, `${report.name}: ${message}`);
            updateOverallProgress();
          });
          reportProgress.set(report.id, 100);
          reportMessage.set(report.id, `${report.name}: ready`);
        } catch (error) {
          reportProgress.set(report.id, 100);
          reportMessage.set(report.id, `${report.name}: ${error instanceof Error ? error.message : "failed"}`);
        }
        updateOverallProgress();
      });
      const tablesById = Object.fromEntries(objectStore.listTables().map((table) => [table.id, table]));
      update(72, "Building workbook");
      const stream = exportJobStore.createFileStream(jobId);
      if (!stream) {
        throw new Error("Unable to create export file stream.");
      }
      await streamDashboardWorkbook(stream, dashboard, rendered, exportResultsByReportId, tablesById, update, runtimeFilters);
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

  app.get("/api/exports/jobs", async () => {
    return { jobs: exportJobStore.listJobs() };
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
    studioStore.getDocument();
    const { id } = request.params as { id: string };
    const body = (request.body as {
      runtimeFilters?: Record<string, string>;
      activeTabId?: string;
      forceLive?: boolean;
      dashboard?: DashboardDefinition;
    } | undefined) || {};
    try {
      const dashboard = body.dashboard?.id === id
        ? body.dashboard
        : (objectStore.getDashboard(id) as DashboardDefinition | undefined);
      if (!dashboard) {
        reply.code(404);
        return { message: "Dashboard not found." };
      }
      const pendingRefresh = await maybeStartAutoRefreshForDashboard(dashboard, body.activeTabId || "");
      const result = await executeDashboard(id, body.runtimeFilters || {}, {
        activeTabId: body.activeTabId || "",
        forceLive: body.forceLive === true,
        dashboard
      });
      if (pendingRefresh?.refreshJob) {
        return {
          ...result,
          refreshJob: pendingRefresh.refreshJob
        };
      }
      return result;
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : "Dashboard render failed."
      };
    }
  });
}
