import type {
  CatalogSummaryItem,
  DashboardRunResult,
  ExportJobStatus,
  ReportRunResult,
  StudioObject,
  TableDefinition
} from "@studio/shared";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20_000;
const DASHBOARD_RENDER_TIMEOUT_MS = 120_000;

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

async function downloadExportBlob(url: string, fallbackFilename: string, popupWindow?: Window | null) {
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
  if (popupWindow && !popupWindow.closed) {
    try {
      popupWindow.document.open();
      popupWindow.document.write(`
        <title>Download ready</title>
        <body style="font-family: sans-serif; padding: 20px;">
          <p>Your export is ready.</p>
          <p><a id="download-link" href="${objectUrl}" download="${filename}">Click here if the download did not start automatically.</a></p>
        </body>
      `);
      popupWindow.document.close();
      const popupLink = popupWindow.document.getElementById("download-link") as HTMLAnchorElement | null;
      popupLink?.click();
    } catch {
      // If the popup document is no longer scriptable, the main-window anchor click above is the fallback.
    }
  }
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

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const response = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init,
    signal: controller.signal
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }).finally(() => {
    window.clearTimeout(timeoutHandle);
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
  options: { forceLive?: boolean; report?: unknown } = {}
) {
  return request<ReportRunResult>("/api/reports/" + encodeURIComponent(id) + "/run", {
    method: "POST",
    body: JSON.stringify({
      filters,
      page: 1,
      pageSize: 100,
      forceLive: options.forceLive === true,
      report: options.report
    })
  });
}

export function runReportPage(
  id: string,
  page: number,
  pageSize: number,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = [],
  options: { forceLive?: boolean; report?: unknown } = {}
) {
  return request<ReportRunResult>("/api/reports/" + encodeURIComponent(id) + "/page", {
    method: "POST",
    body: JSON.stringify({
      filters,
      page,
      pageSize,
      forceLive: options.forceLive === true,
      report: options.report
    })
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

export function renderDashboard(
  id: string,
  runtimeFilters: Record<string, string>,
  activeTabId = "",
  options: { forceLive?: boolean; dashboard?: unknown } = {}
) {
  return request<DashboardRunResult>("/api/dashboards/" + encodeURIComponent(id) + "/render", {
    method: "POST",
    body: JSON.stringify({
      runtimeFilters,
      activeTabId,
      forceLive: options.forceLive === true,
      dashboard: options.dashboard
    }),
    timeoutMs: DASHBOARD_RENDER_TIMEOUT_MS
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

export function fetchExportJobs() {
  return request<{ jobs: ExportJobStatus[] }>("/api/exports/jobs");
}

export function downloadExportJob(id: string, options: { directDownload?: boolean; popupWindow?: Window | null } = {}) {
  const downloadUrl = API_BASE + "/api/exports/jobs/" + encodeURIComponent(id) + "/download";
  if (options.directDownload) {
    void downloadExportBlob(downloadUrl, `export-${id}.xlsx`, options.popupWindow);
    return;
  }
  if (options.popupWindow && !options.popupWindow.closed) {
    options.popupWindow.location.href = downloadUrl;
    return;
  }
  ensureDownloadFrame().src = downloadUrl;
}
