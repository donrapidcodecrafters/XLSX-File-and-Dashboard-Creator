import { Worker } from "node:worker_threads";
import { buildDashboardFilters, buildDashboardResult, runReport, type DashboardRunResult, type DataRow, type FilterDefinition, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { ExecutionCache } from "./execution-cache.js";
import { objectStore } from "./object-store.js";
import { studioStore } from "./studio-store.js";
import { fetchQuickbaseTableRows } from "./quickbase-storage.js";

interface WorkerRequest {
  report: ReportDefinition;
  table: TableDefinition;
  rows: DataRow[];
  extraFilters: FilterDefinition[];
}

function collectReportFieldIds(report: ReportDefinition) {
  return Array.from(new Set(
    [
      ...(report.selectedFieldIds || []),
      ...(report.filters || []).map((item) => item.fieldId),
      ...(report.groups || []).map((item) => item.fieldId),
      ...(report.sorts || []).map((item) => item.fieldId),
      ...((report.summaryMetrics || []).map((item) => item.fieldId)),
      report.view.chartFieldId,
      report.view.timelineDateField,
      report.view.timelineEndField,
      report.view.calendarDateField,
      report.view.kanbanField,
      report.view.titleFieldId
    ].filter(Boolean).map(String)
  ));
}

const cache = new ExecutionCache<ReportRunResult>(20_000);

function runReportWorker(payload: WorkerRequest): Promise<ReportRunResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/report.worker.js", import.meta.url), {
      workerData: payload
    });
    worker.once("message", (message: ReportRunResult) => resolve(message));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error("Report worker exited with code " + code));
    });
  });
}

function cacheKey(report: ReportDefinition, extraFilters: FilterDefinition[]): string {
  return JSON.stringify({
    reportId: report.id,
    updatedAt: report.updatedAt,
    filters: extraFilters
      .filter((filter) => Boolean(filter.value))
      .map((filter) => [filter.fieldId, filter.operator, filter.value])
  });
}

export async function executeReport(report: ReportDefinition, extraFilters: FilterDefinition[] = []): Promise<ReportRunResult> {
  const key = cacheKey(report, extraFilters);
  return cache.getOrCreate(key, async () => {
    const table = objectStore.getTable(report.sourceTableId);
    if (!table) {
      throw new Error("Table not found for report " + report.id + ".");
    }
    const quickbase = studioStore.getDocument().quickbase;
    const requestedFieldIds = collectReportFieldIds(report);
    const rows = quickbase.realmHostname && quickbase.userToken && quickbase.appId
      ? await fetchQuickbaseTableRows(quickbase, table.id, requestedFieldIds, { top: 1000 }).catch(() => objectStore.getRows(table.id))
      : objectStore.getRows(table.id);

    if (rows.length <= 1500) {
      return runReport(report, table, rows, extraFilters);
    }

    return runReportWorker({ report, table, rows, extraFilters });
  });
}

export async function executeDashboard(dashboardId: string, runtimeValues: Record<string, string>): Promise<DashboardRunResult> {
  const dashboard = objectStore.getDashboard(dashboardId);
  if (!dashboard) {
    throw new Error("Dashboard not found.");
  }

  const widgetResults = await Promise.all(
    dashboard.tabs.flatMap((tab) =>
      tab.widgets.map(async (widget) => {
        const report = objectStore.resolveWidgetReport(widget);
        if (!report) {
          throw new Error("Widget report not found for " + widget.id + ".");
        }
        const extraFilters = buildDashboardFilters(dashboard, report.id, runtimeValues);
        const result = await executeReport(report, extraFilters);
        return {
          widgetId: widget.id,
          report,
          result
        };
      })
    )
  );

  return buildDashboardResult(dashboard, widgetResults);
}
