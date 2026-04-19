import type {
  CatalogSummaryItem,
  DashboardRunResult,
  ExportJobStatus,
  ReportRunResult,
  StudioObject,
  TableDefinition
} from "@studio/shared";
import { getHostedContext } from "./embed";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

function parseDownloadFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] || fallback;
}

async function downloadExportBlob(url: string, fallbackFilename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Download failed with status " + response.status);
  }
  const blob = await response.blob();
  const filename = parseDownloadFilename(response.headers.get("content-disposition"), fallbackFilename);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function ensureDownloadFrame() {
  const existing = document.getElementById("studio-download-frame") as HTMLIFrameElement | null;
  if (existing) return existing;
  const frame = document.createElement("iframe");
  frame.id = "studio-download-frame";
  frame.name = "studio-download-frame";
  frame.style.display = "none";
  document.body.appendChild(frame);
  return frame;
}

function submitDownload(path: string, payload: unknown) {
  ensureDownloadFrame();
  const form = document.createElement("form");
  form.method = "POST";
  form.action = API_BASE + path;
  form.target = "studio-download-frame";
  form.style.display = "none";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify(payload ?? {});
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init
  });
  if (!response.ok) {
    throw new Error("Request failed with status " + response.status);
  }
  return response.json() as Promise<T>;
}

export function fetchCatalog() {
  return request<{ app: { id: string; name: string }; objects: CatalogSummaryItem[] }>("/api/catalog");
}

export function fetchTables() {
  return request<{ tables: TableDefinition[] }>("/api/tables");
}

export function fetchObject(id: string) {
  return request<{ object: StudioObject }>("/api/objects/" + encodeURIComponent(id));
}

export function runReport(
  id: string,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = [],
  options: { forceLive?: boolean } = {}
) {
  return request<ReportRunResult>("/api/reports/" + encodeURIComponent(id) + "/run", {
    method: "POST",
    body: JSON.stringify({ filters, page: 1, pageSize: 100, forceLive: options.forceLive === true })
  });
}

export function runReportPage(
  id: string,
  page: number,
  pageSize: number,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = [],
  options: { forceLive?: boolean } = {}
) {
  return request<ReportRunResult>("/api/reports/" + encodeURIComponent(id) + "/page", {
    method: "POST",
    body: JSON.stringify({ filters, page, pageSize, forceLive: options.forceLive === true })
  });
}

export function fetchReportExportBundle(
  id: string,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = []
) {
  return request<{ result: ReportRunResult }>("/api/reports/" + encodeURIComponent(id) + "/export-bundle", {
    method: "POST",
    body: JSON.stringify({ filters })
  });
}

export async function fetchAllReportRows(
  id: string,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = [],
  pageSize = 500
) {
  try {
    const response = await fetchReportExportBundle(id, filters);
    return response.result.rows;
  } catch {
    // Fall back to page-by-page fetch if the export endpoint is not available yet.
  }
  const rows: ReportRunResult["rows"] = [];
  let page = 1;
  let totalRows = 0;
  while (true) {
    const response = await runReportPage(id, page, pageSize, filters);
    rows.push(...response.rows);
    totalRows = response.totalRows;
    if (!response.hasNextPage || rows.length >= totalRows) {
      break;
    }
    page += 1;
  }
  return rows;
}

export function renderDashboard(id: string, runtimeFilters: Record<string, string>, activeTabId = "", options: { forceLive?: boolean } = {}) {
  return request<DashboardRunResult>("/api/dashboards/" + encodeURIComponent(id) + "/render", {
    method: "POST",
    body: JSON.stringify({ runtimeFilters, activeTabId, forceLive: options.forceLive === true })
  });
}

export function downloadReportWorkbook(payload: {
  reportId?: string;
  report?: unknown;
  table?: unknown;
  filters?: Array<{ fieldId: string; value: string; operator?: string }>;
}) {
  submitDownload("/api/exports/report.xlsx", payload);
}

export function downloadDashboardWorkbook(payload: {
  dashboardId?: string;
  runtimeFilters?: Record<string, string>;
}) {
  submitDownload("/api/exports/dashboard.xlsx", payload);
}

export function startReportExportJob(payload: {
  reportId?: string;
  report?: unknown;
  table?: unknown;
  filters?: Array<{ fieldId: string; value: string; operator?: string }>;
}) {
  return request<{ job: ExportJobStatus }>("/api/exports/report/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      payload: JSON.stringify(payload ?? {})
    }).toString()
  });
}

export function startDashboardExportJob(payload: {
  dashboardId?: string;
  runtimeFilters?: Record<string, string>;
}) {
  return request<{ job: ExportJobStatus }>("/api/exports/dashboard/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      payload: JSON.stringify(payload ?? {})
    }).toString()
  });
}

export function fetchExportJobStatus(id: string) {
  return request<{ job: ExportJobStatus }>("/api/exports/jobs/" + encodeURIComponent(id));
}

export function downloadExportJob(id: string) {
  const downloadUrl = API_BASE + "/api/exports/jobs/" + encodeURIComponent(id) + "/download";
  const hosted = getHostedContext();
  if (hosted.embed) {
    void downloadExportBlob(downloadUrl, `export-${id}.xlsx`);
    return;
  }
  ensureDownloadFrame().src = downloadUrl;
}
