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

export interface StudioSourceSummary {
  sourceId: string;
  sourceName: string;
  sourceType: "quickbase" | "xlsx" | "manual";
  rowCount: number;
  fieldCount: number;
  metadata: Record<string, unknown>;
  refreshedAt: string;
  updatedAt: string;
  table: TableDefinition | null;
}

export interface StudioWorkbookSourceImportResult {
  document: StudioDocument;
  sources: Array<{
    sourceId: string;
    sourceName: string;
    table: TableDefinition;
    rowCount: number;
    fieldCount: number;
    upsert?: { added: number; updated: number };
  }>;
  warnings: string[];
  review: StudioWorkbookImportResult["review"];
}

export class AuthRequiredError extends Error {
  readonly status = 401;
  constructor() {
    super("Authentication required.");
    this.name = "AuthRequiredError";
  }
}

function buildSavePayload(document: StudioDocument): StudioDocument {
  return {
    ...document,
    // Version history is loaded on demand from the dedicated versions endpoint.
    versions: {},
    exportJobs: [],
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
    credentials: "include",
    headers: mergedHeaders,
    ...init
  });
  if (response.status === 401) throw new AuthRequiredError();
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with status ${response.status}`);
  }
  return body as T;
}

// ── Scheduled email report configs ───────────────────────────────────────────

export interface ReportConfig {
  id: string;
  object_id: string;
  object_type: "report" | "dashboard";
  enabled: boolean;
  cron_expression: string;
  time_zone: string;
  send_to: string[];
  sendgrid_template_id: string;
  export_format: string;
  config: Record<string, unknown>;
  email_subject: string;
  email_body: string;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listReportConfigs() {
  return request<{ configs: ReportConfig[] }>("/api/report-configs");
}

export function createReportConfig(payload: {
  object_id: string;
  object_type: "report" | "dashboard";
  enabled?: boolean;
  cron_expression?: string;
  time_zone?: string;
  send_to?: string[];
  sendgrid_template_id?: string;
  email_subject?: string;
  email_body?: string;
}) {
  return request<{ config: ReportConfig }>("/api/report-configs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateReportConfig(id: string, payload: {
  object_id?: string;
  object_type?: "report" | "dashboard";
  enabled?: boolean;
  cron_expression?: string;
  time_zone?: string;
  send_to?: string[];
  sendgrid_template_id?: string;
  email_subject?: string;
  email_body?: string;
}) {
  return request<{ config: ReportConfig }>(`/api/report-configs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteReportConfig(id: string) {
  return request<{ ok: boolean }>(`/api/report-configs/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function testReportConfig(id: string) {
  return request<{ ok: boolean; message: string }>(`/api/report-configs/${encodeURIComponent(id)}/test`, {
    method: "POST"
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function checkAuth(): Promise<{ required: boolean; authenticated: boolean; email?: string }> {
  try {
    const response = await fetch(API_BASE + "/api/auth/me", { credentials: "include" });
    if (response.status === 401) return { required: true, authenticated: false };
    if (!response.ok) {
      // 404 means the API is up but auth middleware not registered → treat as no-auth dev mode
      // Any other error → assume auth required and unauthenticated (safe default)
      if (response.status === 404) return { required: false, authenticated: true };
      return { required: true, authenticated: false };
    }
    const body = await response.json() as { authenticated?: boolean; user?: { email?: string } };
    // Explicit false from server = not authenticated
    if (body?.authenticated === false) return { required: true, authenticated: false };
    return { required: true, authenticated: Boolean(body?.authenticated), email: body?.user?.email };
  } catch {
    // Network error / API not running → show login so user can see the error
    return { required: true, authenticated: false };
  }
}

export type LoginStep = "2fa_required" | "2fa_setup_required";

export interface LoginStepResponse {
  step: LoginStep;
  pendingToken: string;
}

/** Step 1: Validate email + password. Returns a pendingToken — no session yet. */
export async function loginWithPassword(email: string, password: string): Promise<LoginStepResponse> {
  const response = await fetch(API_BASE + "/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json() as { message?: string; step?: LoginStep; pendingToken?: string };
  if (!response.ok) throw new Error(body?.message || "Invalid email or password.");
  return { step: body.step!, pendingToken: body.pendingToken! };
}

/** Step 2a: Fetch the QR code for first-time 2FA setup. */
export async function get2FASetup(pendingToken: string): Promise<{
  pendingToken: string;
  qrCodeDataUrl: string;
  secret: string;
  issuer: string;
  email: string;
}> {
  const response = await fetch(
    `${API_BASE}/api/auth/2fa/setup?pendingToken=${encodeURIComponent(pendingToken)}`,
    { credentials: "include" }
  );
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body?.message || "Failed to load QR code."));
  return body as ReturnType<typeof get2FASetup> extends Promise<infer T> ? T : never;
}

/** Step 2b: Confirm first-time setup — verify code and create session. */
export async function complete2FASetup(pendingToken: string, code: string): Promise<{ user: { email: string; role: string } }> {
  const response = await fetch(API_BASE + "/api/auth/2fa/setup/complete", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken, code })
  });
  const body = await response.json() as { message?: string; user?: { email: string; role: string } };
  if (!response.ok) throw new Error(body?.message || "Incorrect code. Please try again.");
  return { user: body.user! };
}

/** Step 2c: Verify 6-digit code for existing 2FA and create session. */
export async function verify2FACode(pendingToken: string, code: string): Promise<{ user: { email: string; role: string } }> {
  const response = await fetch(API_BASE + "/api/auth/2fa/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingToken, code })
  });
  const body = await response.json() as { message?: string; user?: { email: string; role: string } };
  if (!response.ok) throw new Error(body?.message || "Incorrect code. Please try again.");
  return { user: body.user! };
}

export async function logoutSession(): Promise<void> {
  await fetch(API_BASE + "/api/auth/logout", {
    method: "POST",
    credentials: "include"
  }).catch(() => {});
}

// ── User management ───────────────────────────────────────────────────────────

export interface PlatformUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "editor" | "viewer" | "developer" | string;
  active: boolean;
  theme?: string;
  preferences?: Record<string, unknown>;
  createdAt?: string;
  lastLoginAt?: string | null;
  systemNotificationsEnabled?: boolean;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  displayName: string;
  expiresAt: string;
  token?: string;
}

export function listUsers() {
  return request<{ users: PlatformUser[] }>("/api/users");
}

export function inviteUser(payload: { email: string; role: string; displayName: string }) {
  return request<{ invitation: PendingInvitation }>("/api/users/invite", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function sendPasswordReset(userId: string) {
  return request<{ ok: boolean; message: string }>(`/api/users/${encodeURIComponent(userId)}/reset-password`, { method: "POST" });
}

export function deleteUser(id: string) {
  return request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function verifyPasswordResetToken(token: string) {
  return request<{ valid: boolean; email: string }>(`/api/auth/reset-password/${encodeURIComponent(token)}`);
}

export async function completePasswordReset(token: string, password: string) {
  return request<{ ok: boolean }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}

export function deleteInvitation(id: string) {
  return request<{ ok: boolean }>(`/api/users/invite/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function updateInvitation(id: string, payload: { role?: string; displayName?: string }) {
  return request<{ invitation: PendingInvitation }>(`/api/users/invite/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function updateUserRole(id: string, role: string) {
  return request<{ user: PlatformUser }>(`/api/users/${encodeURIComponent(id)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role })
  });
}

export function updateUser(id: string, payload: { displayName?: string; active?: boolean; systemNotificationsEnabled?: boolean }) {
  return request<{ user: PlatformUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deactivateUser(id: string) {
  return request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function impersonateUser(id: string) {
  return request<{ user: PlatformUser }>(`/api/users/${encodeURIComponent(id)}/impersonate`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function stopImpersonating() {
  return request<{ ok: boolean }>("/api/users/impersonate", {
    method: "DELETE"
  });
}

// ── Current user / profile ────────────────────────────────────────────────────

export function getMyProfile() {
  return request<{ user: PlatformUser }>("/api/me");
}

export function updateMyPreferences(payload: { theme?: string; displayName?: string; preferences?: Record<string, unknown> }) {
  return request<{ user: PlatformUser }>("/api/me/preferences", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function changeMyPassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean }>("/api/me/password", {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

// ── Workbook import profiles ──────────────────────────────────────────────────

export interface WorkbookProfile {
  id: string;
  workbookName: string;
  dataSheets: string[];
  sourceIds: string[];
  objectIds: string[];
  lastImportedAt: string | null;
}

export function getWorkbookProfile(id: string): Promise<{ profile: WorkbookProfile }> {
  return request<{ profile: WorkbookProfile }>(`/api/workbook-profiles/${encodeURIComponent(id)}`);
}

export function saveWorkbookProfile(id: string, data: Partial<WorkbookProfile>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/workbook-profiles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

// ── Custom roles ──────────────────────────────────────────────────────────────

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  color: string;
  permissions: Record<string, boolean>;
  isSystem: boolean;
  createdAt: string;
}

export interface BuiltInRole {
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
  isBuiltIn: true;
  [key: string]: unknown;
}

export function listRoles() {
  return request<{ builtIn: BuiltInRole[]; custom: CustomRole[] }>("/api/roles");
}

export function createRole(payload: { name: string; description: string; color: string; permissions: Record<string, boolean> }) {
  return request<{ role: CustomRole }>("/api/roles", { method: "POST", body: JSON.stringify(payload) });
}

export function updateRole(id: string, payload: { name?: string; description?: string; color?: string; permissions?: Record<string, boolean> }) {
  return request<{ role: CustomRole }>(`/api/roles/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteRole(id: string) {
  return request<{ ok: boolean }>(`/api/roles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getMyPermissions() {
  return request<{ permissions: Record<string, boolean>; role: string; isDeveloper: boolean }>("/api/me/permissions");
}

export interface PlatformConfig {
  postgres: {
    connected: boolean;
    urlSanitized: string;
    ssl: boolean;
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    statementTimeoutMs: number;
    legacyRowLoadLimit: number;
    autoMigrate: boolean;
  };
  auth: { enabled: boolean; sessionTtlHours: number; userCount: number };
  server: { publicUrl: string; host: string; port: number };
  automation: { enabled: boolean; cronExpression: string; sendgridConfigured: boolean; fromEmail: string };
  isDeveloper: boolean;
}

export function getAdminConfig() {
  return request<PlatformConfig>("/api/admin/config");
}

/** Public endpoint — returns session TTL for the inactivity timer. No auth required. */
export async function getSessionTtlHours(): Promise<number> {
  try {
    const cfg = await getAdminConfig();
    return cfg.auth.sessionTtlHours ?? 24;
  } catch {
    return 24; // safe default
  }
}

// ── Invitations ───────────────────────────────────────────────────────────────

export async function getInvitation(token: string) {
  const response = await fetch(API_BASE + `/api/invitations/${encodeURIComponent(token)}`, { credentials: "include" });
  const body = await response.json() as { invitation?: PendingInvitation; message?: string; reason?: string };
  if (!response.ok) {
    const err = new Error(body?.message || `Request failed with status ${response.status}`) as Error & { reason?: string };
    err.reason = body?.reason;
    throw err;
  }
  return body as { invitation: PendingInvitation };
}

export function acceptInvitation(token: string, payload: { displayName: string; password: string }) {
  return request<{ user: PlatformUser }>(`/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

let studioDocumentRequest: Promise<{ document: StudioDocument }> | null = null;

export function fetchStudioDocument(options: { dedupe?: boolean } = {}) {
  if (options.dedupe !== false && studioDocumentRequest) {
    return studioDocumentRequest;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 18_000);
  const requestPromise = request<{ document: StudioDocument }>("/api/studio/document", {
    signal: controller.signal
  }).finally(() => {
    window.clearTimeout(timeout);
    if (studioDocumentRequest === requestPromise) {
      studioDocumentRequest = null;
    }
  });
  if (options.dedupe !== false) {
    studioDocumentRequest = requestPromise;
  }
  return requestPromise;
}

export function saveStudioDocument(document: StudioDocument, options?: { removedObjectIds?: string[]; removedFolderIds?: string[] }) {
  return request<{ document: StudioDocument; sync?: QuickbaseSyncResult }>("/api/studio/document", {
    method: "PUT",
    body: JSON.stringify({
      document: buildSavePayload(document),
      removedObjectIds: options?.removedObjectIds || [],
      removedFolderIds: options?.removedFolderIds || []
    })
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

export interface XlsxSheetPeek {
  name: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  looksLikeData: boolean;
  /** 1-based row number the header-detection heuristic picked for this sheet. */
  detectedHeaderRow: number;
}

export interface XlsxHeaderDiff {
  addedLabels: string[];
  removedLabels: string[];
}

export async function peekXlsxFile(file: File, options: { sourceId?: string } = {}): Promise<{
  filename: string;
  sheetNames: string[];
  sheets: XlsxSheetPeek[];
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  headerDiff: XlsxHeaderDiff | null;
  existingKeyFieldIds: string[];
  existingHeaderSkipRows: number;
}> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const params = new URLSearchParams();
  if (options.sourceId) params.set("sourceId", options.sourceId);
  const response = await fetch(API_BASE + `/api/studio/sources/xlsx/peek${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "POST",
    credentials: "include",
    body: formData
  });
  if (response.status === 401) throw new AuthRequiredError();
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body?.message || "Preview failed."));
  return body as {
    filename: string; sheetNames: string[]; sheets: XlsxSheetPeek[]; headers: string[];
    rows: Record<string, unknown>[]; rowCount: number; headerDiff: XlsxHeaderDiff | null;
    existingKeyFieldIds: string[]; existingHeaderSkipRows: number;
  };
}

export function fetchSourceFields(sourceId: string) {
  return request<{ sourceId: string; fields: Array<{ id: string; label: string; type: string }>; keyFieldIds: string[]; headerSkipRows: number }>(
    `/api/studio/sources/${encodeURIComponent(sourceId)}/fields`
  );
}

export async function importStudioWorkbook(file: File, options?: { maxRowsPerSheet?: number }) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const url = new URL(API_BASE + "/api/studio/import/xlsx", window.location.href);
  if (options?.maxRowsPerSheet) url.searchParams.set("maxRowsPerSheet", String(options.maxRowsPerSheet));
  const response = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    body: formData
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with status ${response.status}`);
  }
  return body as StudioWorkbookImportResult;
}

export function fetchSourcePreview(sourceId: string, limit = 5) {
  return request<{ summary: StudioSourceSummary; rows: Record<string, unknown>[] }>(
    `/api/studio/sources/${encodeURIComponent(sourceId)}/preview?limit=${limit}`
  );
}

export function fetchStudioSources() {
  return request<{ sources: StudioSourceSummary[] }>("/api/studio/sources");
}

export function fetchFieldUniqueValues(sourceId: string, fieldId: string) {
  return request<{ values: string[] }>(`/api/studio/sources/${encodeURIComponent(sourceId)}/field-values/${encodeURIComponent(fieldId)}`);
}

// ── Data management ───────────────────────────────────────────────────────────

export function renameSource(sourceId: string, sourceName: string) {
  return request<{ ok: boolean }>(`/api/studio/sources/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    body: JSON.stringify({ sourceName })
  });
}

export function updateSourceKeyField(sourceId: string, keyFieldId: string) {
  return request<{ sourceId: string; keyFieldId: string }>(`/api/studio/sources/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    body: JSON.stringify({ keyFieldId })
  });
}

export function updateSourceKeyFields(sourceId: string, keyFieldIds: string[]) {
  return request<{ sourceId: string; keyFieldIds: string[] }>(`/api/studio/sources/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    body: JSON.stringify({ keyFieldIds })
  });
}

export function deleteSource(sourceId: string) {
  return request<{ ok: boolean }>(`/api/studio/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE"
  });
}

export function clearSourceData(sourceId: string) {
  return request<{ ok: boolean }>(`/api/studio/sources/${encodeURIComponent(sourceId)}/records`, {
    method: "DELETE"
  });
}

export async function importStudioWorkbookSource(file: File, options: { sourceId?: string; sourceName?: string; dataSheets?: string[]; keyFieldIds?: string[]; allowDuplicates?: boolean; headerSkipRows?: number } = {}) {
  const params = new URLSearchParams();
  if (options.sourceId) params.set("sourceId", options.sourceId);
  if (options.sourceName) params.set("sourceName", options.sourceName);
  if (options.dataSheets && options.dataSheets.length > 0) params.set("dataSheets", options.dataSheets.join(","));
  if (options.keyFieldIds && options.keyFieldIds.length > 0) params.set("keyFieldIds", options.keyFieldIds.join(","));
  if (options.allowDuplicates) params.set("allowDuplicates", "1");
  if (options.headerSkipRows !== undefined) params.set("headerSkipRows", String(options.headerSkipRows));
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(API_BASE + `/api/studio/sources/xlsx${params.toString() ? `?${params.toString()}` : ""}`, {
    method: "POST",
    credentials: "include",
    body: formData
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with status ${response.status}`);
  }
  return body as StudioWorkbookSourceImportResult;
}

export async function recreateWorkbookFromDataSource(
  file: File,
  options: { sourceId?: string; sourceName?: string; dataSheets?: string[]; keyFieldIds?: string[]; allowDuplicates?: boolean; headerSkipRows?: number } = {}
): Promise<StudioWorkbookSourceImportResult & { reports: unknown[]; dashboard: unknown | null }> {
  const params = new URLSearchParams();
  if (options.sourceId) params.set("sourceId", options.sourceId);
  if (options.sourceName) params.set("sourceName", options.sourceName);
  if (options.dataSheets && options.dataSheets.length > 0) params.set("dataSheets", options.dataSheets.join(","));
  if (options.keyFieldIds && options.keyFieldIds.length > 0) params.set("keyFieldIds", options.keyFieldIds.join(","));
  if (options.allowDuplicates) params.set("allowDuplicates", "1");
  if (options.headerSkipRows !== undefined) params.set("headerSkipRows", String(options.headerSkipRows));
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(
    API_BASE + `/api/studio/sources/xlsx/recreate${params.toString() ? `?${params.toString()}` : ""}`,
    { method: "POST", credentials: "include", body: formData }
  );
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw new Error(body?.message || `Request failed with status ${response.status}`);
  return body as StudioWorkbookSourceImportResult & { reports: unknown[]; dashboard: unknown | null };
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

export function startStudioRefresh(profileId = "") {
  return request<{ job: RefreshJobStatus }>("/api/studio/refresh/start", {
    method: "POST",
    body: JSON.stringify({ profileId })
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
