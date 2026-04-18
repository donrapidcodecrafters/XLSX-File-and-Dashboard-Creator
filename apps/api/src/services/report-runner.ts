import { Worker } from "node:worker_threads";
import { buildDashboardFilters, buildDashboardResult, type DashboardRunResult, type FilterDefinition, type ReportDefinition, type ReportRunResult } from "@studio/shared";
import { ExecutionCache } from "./execution-cache.js";
import { objectStore } from "./object-store.js";

interface WorkerRequest {
  report: ReportDefinition;
  extraFilters: FilterDefinition[];
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
  return cache.getOrCreate(key, () => runReportWorker({ report, extraFilters }));
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
