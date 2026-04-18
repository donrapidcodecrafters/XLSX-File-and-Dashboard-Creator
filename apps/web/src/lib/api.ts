import type {
  CatalogSummaryItem,
  DashboardRunResult,
  ReportRunResult,
  StudioObject,
  TableDefinition
} from "@studio/shared";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

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

export function runReport(id: string, filters: Array<{ fieldId: string; value: string; operator?: string }> = []) {
  return request<ReportRunResult>("/api/reports/" + encodeURIComponent(id) + "/run", {
    method: "POST",
    body: JSON.stringify({ filters, page: 1, pageSize: 100 })
  });
}

export function runReportPage(
  id: string,
  page: number,
  pageSize: number,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = []
) {
  return request<ReportRunResult>("/api/reports/" + encodeURIComponent(id) + "/page", {
    method: "POST",
    body: JSON.stringify({ filters, page, pageSize })
  });
}

export async function fetchAllReportRows(
  id: string,
  filters: Array<{ fieldId: string; value: string; operator?: string }> = [],
  pageSize = 500
) {
  try {
    const response = await request<{ rows: ReportRunResult["rows"] }>("/api/reports/" + encodeURIComponent(id) + "/export-rows", {
      method: "POST",
      body: JSON.stringify({ filters })
    });
    return response.rows;
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

export function renderDashboard(id: string, runtimeFilters: Record<string, string>) {
  return request<DashboardRunResult>("/api/dashboards/" + encodeURIComponent(id) + "/render", {
    method: "POST",
    body: JSON.stringify({ runtimeFilters })
  });
}
