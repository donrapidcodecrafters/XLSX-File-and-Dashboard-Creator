import type { RefreshJobStatus, ReportDefinition, ReportRunResult, StudioDocument, StudioVersionRecord, TableDefinition } from "@studio/shared";

export interface QuickbaseSyncResult {
  enabled: boolean;
  ok: boolean;
  message: string;
  savedObjects: number;
  savedSettings: number;
  savedVersions: number;
  savedStorageConfig: number;
}

export interface QuickbaseFieldSchema {
  fid: string;
  label: string;
  fieldType: string;
  baseType: string;
}

export interface QuickbaseTableSchema {
  id: string;
  name: string;
  description: string;
  fields: QuickbaseFieldSchema[];
}

export interface QuickbaseAppSchema {
  id: string;
  name: string;
  description: string;
  tables: QuickbaseTableSchema[];
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with status ${response.status}`);
  }
  return body as T;
}

export function fetchStudioDocument() {
  return request<{ document: StudioDocument }>("/api/studio/document");
}

export function saveStudioDocument(document: StudioDocument) {
  return request<{ document: StudioDocument; sync?: QuickbaseSyncResult }>("/api/studio/document", {
    method: "PUT",
    body: JSON.stringify({ document })
  });
}

export function fetchStudioVersions(objectId: string) {
  return request<{ versions: StudioVersionRecord[] }>(`/api/studio/objects/${encodeURIComponent(objectId)}/versions`);
}

export function createStudioSnapshot(objectId: string, label: string) {
  return request<{ version: StudioVersionRecord }>(`/api/studio/objects/${encodeURIComponent(objectId)}/snapshot`, {
    method: "POST",
    body: JSON.stringify({ label })
  });
}

export function restoreStudioVersion(objectId: string, versionId: string) {
  return request<{ object: unknown }>(`/api/studio/objects/${encodeURIComponent(objectId)}/restore/${encodeURIComponent(versionId)}`, {
    method: "POST"
  });
}

export function startStudioRefresh() {
  return request<{ job: RefreshJobStatus }>("/api/studio/refresh/start", {
    method: "POST"
  });
}

export function fetchStudioRefreshJob(id: string) {
  return request<{ job: RefreshJobStatus }>(`/api/studio/refresh/jobs/${encodeURIComponent(id)}`);
}

export function fetchQuickbaseSchema(config: StudioDocument["quickbase"]) {
  return request<{ schema: QuickbaseAppSchema }>("/api/quickbase/schema", {
    method: "POST",
    body: JSON.stringify({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken,
      appId: config.appId
    })
  });
}

export function fetchQuickbaseTablePreview(
  config: StudioDocument["quickbase"],
  tableId: string,
  fieldIds: string[],
  top = 250
) {
  return request<{ rows: Record<string, unknown>[] }>("/api/quickbase/table-preview", {
    method: "POST",
    body: JSON.stringify({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken,
      appId: config.appId,
      tableId,
      fieldIds,
      top
    })
  });
}

export function fetchQuickbaseReportPreview(
  config: StudioDocument["quickbase"],
  report: ReportDefinition,
  table: TableDefinition
) {
  return request<{ result: ReportRunResult }>("/api/quickbase/report-preview", {
    method: "POST",
    body: JSON.stringify({
      quickbase: {
        realmHostname: config.realmHostname,
        userToken: config.userToken,
        appToken: config.appToken,
        appId: config.appId
      },
      report,
      table
    })
  });
}
