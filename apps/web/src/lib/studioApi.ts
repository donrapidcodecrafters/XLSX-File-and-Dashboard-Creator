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

export interface QuickbaseRealmApp {
  id: string;
  name: string;
}

export interface StudioWorkbookImportResult {
  document: StudioDocument;
  primaryObjectId: string;
  importedObjectIds: string[];
  importedTableIds: string[];
  warnings: string[];
  review: {
    workbookName: string;
    importedAt: string;
    importedSheetCount: number;
    skippedSheetCount: number;
    dashboardCreated: boolean;
    sheets: Array<{
      sheetName: string;
      status: "imported" | "skipped";
      headerRowNumber: number;
      rowCount: number;
      columnCount: number;
      importedTableId?: string;
      importedReportId?: string;
      notes: string[];
      substitutions: string[];
      layout?: {
        state: "visible" | "hidden" | "veryHidden";
        tabColor: string;
        accentColor: string;
        title: string;
        titleRowNumber: number;
        headingRowCount: number;
        headerSource: "heuristic" | "auto-filter" | "table";
        frozenRows: number;
        frozenColumns: number;
        hiddenRowCount: number;
        hiddenColumnCount: number;
        hiddenFieldLabels: string[];
        visibleColumnCount: number;
        autoFilterRange: string;
        printArea: string;
        tableName: string;
        tableRange: string;
        tableStyle: string;
        totalsRow: boolean;
        tableRowStripes: boolean;
        tableColumnStripes: boolean;
        viewStyle: "normal" | "pageLayout" | "pageBreakPreview";
        showGridLines: boolean;
        zoomScale: number;
        centeredHorizontally: boolean;
        centeredVertically: boolean;
        fitToWidth: number;
        fitToHeight: number;
        headerFooterText: string;
        imageCount: number;
        tableFocused: boolean;
        wideLayout: boolean;
        landscape: boolean;
        mergedTitle: boolean;
      };
    }>;
  };
  sync?: QuickbaseSyncResult;
}

function buildSavePayload(document: StudioDocument): StudioDocument {
  return {
    ...document,
    bundle: {
      ...document.bundle,
      // Cached table rows stay on the server; saves should only send workspace metadata.
      data: {}
    }
  };
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = typeof init?.body === "string" && init.body.length > 0;
  const mergedHeaders = {
    ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers || {})
  };
  const response = await fetch(API_BASE + path, {
    headers: mergedHeaders,
    ...init
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with status ${response.status}`);
  }
  return body as T;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function fetchStudioDocument() {
  return request<{ document: StudioDocument }>("/api/studio/document");
}

export function saveStudioDocument(document: StudioDocument) {
  return request<{ document: StudioDocument; sync?: QuickbaseSyncResult }>("/api/studio/document", {
    method: "PUT",
    body: JSON.stringify({ document: buildSavePayload(document) })
  });
}

export function saveStudioUserSettings(payload: {
  favorites?: string[];
  recent?: string[];
  personalOverrides?: StudioDocument["personalOverrides"];
}) {
  return request<{ settings: { favorites: string[]; recent: string[]; personalOverrides: StudioDocument["personalOverrides"] }; sync?: QuickbaseSyncResult }>("/api/studio/user-settings", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function updateStudioSession(session: Partial<StudioDocument["session"]>) {
  return request<{ session: StudioDocument["session"] }>("/api/studio/session", {
    method: "PATCH",
    body: JSON.stringify({ session })
  });
}

export async function importStudioWorkbook(file: File) {
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  return request<StudioWorkbookImportResult>("/api/studio/import/xlsx", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      base64
    })
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
    method: "POST",
    body: JSON.stringify({})
  });
}

export function startStudioObjectRefresh(objectId: string) {
  return request<{ job: RefreshJobStatus }>(`/api/studio/objects/${encodeURIComponent(objectId)}/refresh/start`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function fetchStudioRefreshJob(id: string) {
  return request<{ job: RefreshJobStatus }>(`/api/studio/refresh/jobs/${encodeURIComponent(id)}`);
}

export function cancelStudioRefreshJob(id: string) {
  return request<{ job: RefreshJobStatus }>(`/api/studio/refresh/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });
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

export function fetchQuickbaseApps(config: Pick<StudioDocument["quickbase"], "realmHostname" | "userToken" | "appToken">) {
  return request<{ apps: QuickbaseRealmApp[] }>("/api/quickbase/apps", {
    method: "POST",
    body: JSON.stringify({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken
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
