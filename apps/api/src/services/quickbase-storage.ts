import { XMLParser } from "fast-xml-parser";
import { buildStudioDocument, normalizeStudioDocument, type DataRow, type FieldType, type QuickbaseBootstrapStatus, type StudioDocument, type StudioObject, type StudioVersionRecord, type TableDefinition } from "@studio/shared";
import { loadQuickbaseSchema, type QuickbaseAppSchema } from "./quickbase-schema.js";

interface QuickbaseUser {
  id: string;
  login: string;
  email: string;
  name: string;
}

type QuickbaseRecord = Record<string, { value: unknown }>;

interface QuickbaseSyncSummary {
  enabled: boolean;
  ok: boolean;
  message: string;
  savedObjects: number;
  savedSettings: number;
  savedVersions: number;
  savedStorageConfig: number;
}

interface QuickbaseQueryResult {
  data: Array<Record<string, { value: unknown }>>;
  metadata?: {
    totalRecords?: number;
    numRecords?: number;
    skip?: number;
    top?: number;
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value",
  trimValues: true
});

const STORAGE_CONFIG_KEY = "__studioStorageConfig__";
const USER_SETTINGS_KEY = "__studioUserSettings__";
const MAX_SYNCED_VERSIONS_PER_OBJECT = 10;
const MAX_LOADED_VERSIONS_PER_OBJECT = 10;
const QUICKBASE_REST_WRITE_BATCH_SIZE = 25;
const QUICKBASE_REST_WRITE_BATCH_BYTES = 2 * 1024 * 1024;
const QUICKBASE_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const QUICKBASE_CACHE_TTL_MS = 60_000;
const STORAGE_TABLE_NAMES = {
  objects: "Saved Reports and Dashboards",
  settings: "Studio User Settings",
  versions: "Studio Version History"
} as const;
const STORAGE_FIELD_SPECS = {
  objects: [
    { key: "objectKeyFieldId", label: "Object ID", type: "text" },
    { key: "objectTypeFieldId", label: "Type", type: "text" },
    { key: "objectNameFieldId", label: "Name", type: "text" },
    { key: "objectConfigFieldId", label: "JSON Config", type: "text-multi-line" },
    { key: "objectOwnerFieldId", label: "Owner", type: "text" },
    { key: "objectPersonalOwnerFieldId", label: "Personal Report Owner", type: "text" },
    { key: "objectUpdatedAtFieldId", label: "Updated At", type: "text" },
    { key: "objectUpdatedByFieldId", label: "Updated By", type: "text" }
  ],
  settings: [
    { key: "settingsUserFieldId", label: "User", type: "text" },
    { key: "settingsObjectFieldId", label: "Object Record", type: "text" },
    { key: "settingsObjectKeyFieldId", label: "Object ID", type: "text" },
    { key: "settingsJsonFieldId", label: "Settings JSON", type: "text-multi-line" },
    { key: "settingsUpdatedByFieldId", label: "Updated By", type: "text" }
  ],
  versions: [
    { key: "versionObjectFieldId", label: "Object Record", type: "text" },
    { key: "versionObjectKeyFieldId", label: "Object ID", type: "text" },
    { key: "versionSnapshotFieldId", label: "Snapshot JSON", type: "text-multi-line" },
    { key: "versionChangedAtFieldId", label: "Changed At", type: "text" },
    { key: "versionChangedByFieldId", label: "Changed By", type: "text" },
    { key: "versionUpdatedByFieldId", label: "Updated By", type: "text" }
  ]
} as const;

type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

const bootstrapRowsCache = new Map<string, CacheEntry<Array<Record<string, { value: unknown }>>>>();
const currentUserCache = new Map<string, CacheEntry<QuickbaseUser>>();
const storedObjectsCache = new Map<string, CacheEntry<StudioObject[]>>();
const schemaCache = new Map<string, CacheEntry<Awaited<ReturnType<typeof loadQuickbaseSchema>> | null>>();
const SEEDED_OBJECT_IDS = new Set(Object.keys(buildStudioDocument().bundle.objects || {}));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOrCreateCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string, loader: () => Promise<T>) {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }
  const pending = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, {
    expiresAt: now + QUICKBASE_CACHE_TTL_MS,
    value: pending
  });
  return pending;
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return 0;
}

function normalizeHostname(value: string) {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function normalizeQuickbaseLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeXml(value: string) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    const text = (value as Record<string, unknown>).value;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function qbFieldId(fid: string) {
  const number = Number(fid);
  return Number.isFinite(number) ? number : fid;
}

function qbFieldKey(fid: string) {
  return String(qbFieldId(fid));
}

function quickbaseDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => quickbaseDisplayText(entry))
      .filter(Boolean);
    return parts.join(", ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["displayValue", "label", "name", "text", "value"];
    for (const key of preferredKeys) {
      const next = record[key];
      if (next === undefined || next === null) continue;
      const text = quickbaseDisplayText(next);
      if (text) return text;
    }
  }
  return "";
}

function qbFieldValue(record: Record<string, any>, fid: string) {
  if (!record || !fid) return "";
  const entry = record[qbFieldKey(fid)] || record[String(fid)];
  if (!entry) return "";
  if (entry && typeof entry === "object" && "displayValue" in entry) {
    const display = quickbaseDisplayText((entry as Record<string, unknown>).displayValue);
    if (display) return display;
  }
  if (entry && typeof entry === "object" && "value" in entry) {
    const rawValue = (entry as Record<string, unknown>).value;
    const display = quickbaseDisplayText(rawValue);
    if (display) return display;
    if (typeof rawValue === "number" || typeof rawValue === "boolean") return rawValue;
    if (rawValue === null) return null;
    if (Array.isArray(rawValue)) {
      return rawValue.map((item) => quickbaseDisplayText(item)).filter(Boolean);
    }
    return "";
  }
  return quickbaseDisplayText(entry);
}

function qbSetField(record: QuickbaseRecord, fid: string, value: unknown) {
  if (!fid) return;
  record[qbFieldKey(fid)] = { value: value ?? "" };
}

function escapeQueryValue(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function buildWhere(clauses: Array<{ fid: string; value: unknown; operator?: string }>) {
  return (clauses || [])
    .filter((clause) => clause && clause.fid && clause.value !== undefined && clause.value !== null && clause.value !== "")
    .map((clause) => `{'${qbFieldId(clause.fid)}'.${clause.operator || "EX"}.'${escapeQueryValue(clause.value)}'}`)
    .join("AND");
}

function makeCompositeKey(values: unknown[]) {
  return values.map((value) => String(value ?? "")).join("::");
}

function hasQuickbaseConnection(config: StudioDocument["quickbase"]) {
  return Boolean(normalizeHostname(config.realmHostname) && config.userToken && config.appId);
}

function hasObjectStorage(config: StudioDocument["quickbase"]) {
  return Boolean(
    config.objectTableId &&
    config.objectKeyFieldId &&
    config.objectTypeFieldId &&
    config.objectNameFieldId &&
    config.objectConfigFieldId
  );
}

function hasSettingsStorage(config: StudioDocument["quickbase"]) {
  return Boolean(
    config.settingsTableId &&
    config.settingsUserFieldId &&
    config.settingsObjectKeyFieldId &&
    config.settingsJsonFieldId
  );
}

function hasVersionStorage(config: StudioDocument["quickbase"]) {
  return Boolean(
    config.versionTableId &&
    config.versionObjectKeyFieldId &&
    config.versionSnapshotFieldId &&
    config.versionChangedAtFieldId
  );
}

function getMissingStorageMappings(config: StudioDocument["quickbase"]) {
  const missing: string[] = [];
  if (!hasObjectStorage(config)) missing.push("saved reports and dashboards table mappings");
  if (!hasSettingsStorage(config)) missing.push("user settings table mappings");
  if (!hasVersionStorage(config)) missing.push("version history table mappings");
  return missing;
}

function getInvalidStorageMappings(config: StudioDocument["quickbase"]) {
  const invalidMappings: string[] = [];
  if (config.objectKeyFieldId && isRecordIdField(config.objectKeyFieldId)) {
    invalidMappings.push("saved reports and dashboards key field FID cannot be 3 (Record ID#)");
  }
  if (config.settingsObjectKeyFieldId && isRecordIdField(config.settingsObjectKeyFieldId)) {
    invalidMappings.push("user settings object key field FID cannot be 3 (Record ID#)");
  }
  if (config.versionObjectKeyFieldId && isRecordIdField(config.versionObjectKeyFieldId)) {
    invalidMappings.push("version history object key field FID cannot be 3 (Record ID#)");
  }
  return invalidMappings;
}

function buildBootstrapStatus(
  config: StudioDocument["quickbase"],
  options: {
    checkedAt?: string;
    autoProvisioned?: boolean;
    error?: string;
    message?: string;
  } = {}
): QuickbaseBootstrapStatus {
  const missing = getMissingStorageMappings(config);
  const warnings = getInvalidStorageMappings(config);
  const ready = hasQuickbaseConnection(config) && !missing.length && !warnings.length && !options.error;

  return {
    ready,
    checkedAt: options.checkedAt || new Date().toISOString(),
    autoProvisioned: options.autoProvisioned === true,
    missing,
    warnings,
    message: options.message
      || (options.error
        ? "Quickbase support table bootstrap failed."
        : !hasQuickbaseConnection(config)
          ? "Quickbase connection is not configured."
          : ready
            ? "Quickbase support tables are ready."
            : "Quickbase support tables still need attention."),
    error: options.error
  };
}

function uniqueFieldIds(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function payloadUpdatedAt(payload: any) {
  const candidate = Date.parse(String(payload?.updatedAt || payload?.changedAt || ""));
  return Number.isNaN(candidate) ? 0 : candidate;
}

function selectLatestPayload<T extends Record<string, any>>(items: T[], predicate: (item: T) => boolean) {
  return items
    .filter(predicate)
    .sort((left, right) => payloadUpdatedAt(right) - payloadUpdatedAt(left))[0];
}

function isRecordIdField(fid: string) {
  return String(fid || "").trim() === "3";
}

function usingDirectQuickbaseApi(config: StudioDocument["quickbase"]) {
  return String(config.apiBaseUrl || "").trim().replace(/\/$/, "") === "https://api.quickbase.com/v1";
}

function quickbaseConfigCacheKey(config: StudioDocument["quickbase"]) {
  return [
    normalizeHostname(config.realmHostname),
    config.appId || "",
    config.objectTableId || "",
    config.settingsTableId || "",
    config.versionTableId || "",
    usingDirectQuickbaseApi(config) ? "rest" : "xml"
  ].join("::");
}

function invalidateQuickbaseCaches(config: StudioDocument["quickbase"]) {
  const prefix = quickbaseConfigCacheKey(config);
  [bootstrapRowsCache, currentUserCache, storedObjectsCache, schemaCache].forEach((cache) => {
    for (const key of cache.keys()) {
      if (key === prefix || key.startsWith(prefix + "::")) {
        cache.delete(key);
      }
    }
  });
}

async function quickbaseRestRequest(
  config: StudioDocument["quickbase"],
  path: string,
  options: { method?: string; body?: unknown } = {}
) {
  const baseUrl = String(config.apiBaseUrl || "https://api.quickbase.com/v1").trim().replace(/\/$/, "");
  const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (config.realmHostname) headers["QB-Realm-Hostname"] = normalizeHostname(config.realmHostname);
  if (config.userToken) headers.Authorization = `QB-USER-TOKEN ${config.userToken}`;
  if (config.appId) headers["X-Quickbase-App-Id"] = config.appId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }

    if (response.ok) {
      return body;
    }

    if (QUICKBASE_RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const delayMs = retryAfterMs || 500 * Math.pow(2, attempt);
      await sleep(delayMs);
      continue;
    }

    throw new Error(body?.message || body?.description || `Quickbase REST request failed with status ${response.status}.`);
  }

  throw new Error("Quickbase REST request failed after retries.");
}

async function quickbaseListFieldIds(config: StudioDocument["quickbase"], tableId: string) {
  if (!tableId) return [] as string[];
  if (usingDirectQuickbaseApi(config)) {
    const fields = await quickbaseRestRequest(
      config,
      `/fields?tableId=${encodeURIComponent(tableId)}`
    ) as Array<{ id: number | string }>;
    return fields.map((field) => String(field.id));
  }
  return [] as string[];
}

async function quickbaseXmlRequest(
  config: StudioDocument["quickbase"],
  dbid: string,
  action: string,
  innerXml = ""
) {
  const hostname = normalizeHostname(config.realmHostname);
  const body = [
    "<qdbapi>",
    `<usertoken>${escapeXml(config.userToken)}</usertoken>`,
    config.appToken ? `<apptoken>${escapeXml(config.appToken)}</apptoken>` : "",
    innerXml,
    "</qdbapi>"
  ].join("");
  const endpoints = [
    {
      url: `https://${hostname}/db/${encodeURIComponent(dbid)}`,
      headers: {
        Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
        "Content-Type": "application/xml; charset=UTF-8",
        "QUICKBASE-ACTION": action
      } as Record<string, string>
    },
    {
      url: `https://${hostname}/db/${encodeURIComponent(dbid)}?a=${encodeURIComponent(action)}`,
      headers: {
        Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
        "Content-Type": "application/xml; charset=UTF-8"
      } as Record<string, string>
    }
  ];

  const failures: string[] = [];
  for (const candidate of endpoints) {
    const response = await fetch(candidate.url, {
      method: "POST",
      headers: candidate.headers,
      body
    });

    const xml = await response.text();
    if (!response.ok) {
      failures.push(`${response.status} from ${candidate.url}`);
      if (![404, 405].includes(response.status)) {
        throw new Error(`Quickbase ${action} failed for table ${dbid}. ${response.status} from ${candidate.url}.`);
      }
      continue;
    }

    const parsed = parser.parse(xml) as any;
    const api = parsed?.qdbapi;
    const errcode = Number(api?.errcode ?? 0);
    if (Number.isFinite(errcode) && errcode !== 0) {
      throw new Error(api?.errtext || `Quickbase ${action} failed for table ${dbid}.`);
    }
    return api;
  }

  throw new Error(
    `Quickbase ${action} failed for table ${dbid}. Tried ${failures.join(" then ")}. Confirm the DBID belongs to a real Quickbase table in realm ${hostname}.`
  );
}

async function quickbaseCreateTableXml(
  config: StudioDocument["quickbase"],
  tableName: string,
  pluralNoun = "Records"
) {
  const api = await quickbaseXmlRequest(
    config,
    config.appId,
    "API_CreateTable",
    [
      `<tname>${escapeXml(tableName)}</tname>`,
      `<pnoun>${escapeXml(pluralNoun)}</pnoun>`
    ].join("")
  );
  return String(textValue(api?.newdbid) || "");
}

async function quickbaseAddFieldXml(
  config: StudioDocument["quickbase"],
  tableId: string,
  label: string,
  type: string
) {
  const api = await quickbaseXmlRequest(
    config,
    tableId,
    "API_AddField",
    [
      `<label>${escapeXml(label)}</label>`,
      `<type>${escapeXml(type)}</type>`
    ].join("")
  );
  return String(textValue(api?.fid) || "");
}

async function quickbaseQueryRecordsXml(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; skip?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
): Promise<QuickbaseQueryResult> {
  const fields = Array.from(new Set((select || []).filter(Boolean).map(qbFieldId)));
  const sortBy = Array.isArray(options.sortBy) ? options.sortBy.filter(Boolean) : [];
  const sortFieldIds = Array.from(new Set(sortBy.map((item) => qbFieldId(item.fieldId))));
  const optionParts = ["num-" + Math.max(1, Number(options.top) || 200)];
  if (Number(options.skip) > 0) optionParts.push("skp-" + Number(options.skip));
  if (sortBy.length) {
    optionParts.push("sortorder-" + sortBy.map((item) => String(item.order || "ASC").toUpperCase() === "DESC" ? "D" : "A").join(""));
  }
  const api = await quickbaseXmlRequest(
    config,
    tableId,
    "API_DoQuery",
    [
      where ? `<query>${escapeXml(where)}</query>` : "",
      fields.length ? `<clist>${escapeXml(fields.join("."))}</clist>` : "",
      sortFieldIds.length ? `<slist>${escapeXml(sortFieldIds.join("."))}</slist>` : "",
      `<options>${escapeXml(optionParts.join("."))}</options>`,
      "<fmt>structured</fmt>"
    ].join("")
  );

  const records = asArray(api?.records?.record).map((record) => {
    const row: Record<string, { value: unknown }> = {};
    asArray(record?.f).forEach((field: any) => {
      const fieldId = String(field?.id ?? "").trim();
      if (!fieldId) return;
      row[fieldId] = { value: textValue(field) };
    });
    return row;
  });

  return { data: records } satisfies QuickbaseQueryResult;
}

async function quickbaseQueryRecordsBySavedReportXml(
  config: StudioDocument["quickbase"],
  tableId: string,
  reportId: string,
  options: { top?: number; skip?: number } = {}
): Promise<QuickbaseQueryResult> {
  const optionParts = ["num-" + Math.max(1, Number(options.top) || 200)];
  if (Number(options.skip) > 0) optionParts.push("skp-" + Number(options.skip));
  const api = await quickbaseXmlRequest(
    config,
    tableId,
    "API_DoQuery",
    [
      `<qid>${escapeXml(String(reportId))}</qid>`,
      "<clist>3.a</clist>",
      `<options>${escapeXml(optionParts.join("."))}</options>`,
      "<fmt>structured</fmt>"
    ].join("")
  );

  const records = asArray(api?.records?.record).map((record) => {
    const row: Record<string, { value: unknown }> = {};
    asArray(record?.f).forEach((field: any) => {
      const fieldId = String(field?.id ?? "").trim();
      if (!fieldId) return;
      row[fieldId] = { value: textValue(field) };
    });
    return row;
  });

  return { data: records } satisfies QuickbaseQueryResult;
}

async function quickbaseRunReportRest(
  config: StudioDocument["quickbase"],
  tableId: string,
  reportId: string,
  options: { top?: number; skip?: number } = {}
): Promise<QuickbaseQueryResult> {
  const top = Math.max(1, Math.min(Number(options.top) || 1000, 1000));
  const skip = Math.max(0, Number(options.skip) || 0);
  const query = new URLSearchParams({
    tableId: String(tableId),
    skip: String(skip),
    top: String(top)
  });
  return quickbaseRestRequest(config, `/reports/${encodeURIComponent(reportId)}/run?${query.toString()}`, {
    method: "POST"
  }) as Promise<QuickbaseQueryResult>;
}

async function quickbaseQueryRecordsRest(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; skip?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
): Promise<QuickbaseQueryResult> {
  const payload: Record<string, unknown> = {
    from: tableId,
    select: Array.from(new Set((select || []).filter(Boolean).map(qbFieldId))),
    options: {
      top: options.top || 200,
      skip: options.skip || 0
    }
  };
  if (where) payload.where = where;
  if (options.sortBy?.length) payload.sortBy = options.sortBy;
  return quickbaseRestRequest(config, "/records/query", {
    method: "POST",
    body: payload
  }) as Promise<QuickbaseQueryResult>;
}

async function quickbaseQueryRecords(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; skip?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
): Promise<QuickbaseQueryResult> {
  if (usingDirectQuickbaseApi(config)) {
    return quickbaseQueryRecordsRest(config, tableId, select, where, options);
  }
  return quickbaseQueryRecordsXml(config, tableId, select, where, options);
}

async function quickbaseFetchAllRecords(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
) {
  const rows: Array<Record<string, { value: unknown }>> = [];
  const top = Math.max(1, Number(options.top) || 200);
  let skip = 0;
  while (true) {
    const response = await quickbaseQueryRecords(config, tableId, select, where, {
      top,
      skip,
      sortBy: options.sortBy
    });
    rows.push(...response.data);
    if (response.data.length < top) break;
    skip += top;
  }
  return rows;
}

export async function fetchQuickbaseTablePage(
  config: StudioDocument["quickbase"],
  tableId: string,
  fieldIds: string[],
  options: {
    top?: number;
    skip?: number;
    where?: string;
    sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }>;
  } = {}
): Promise<{ rows: DataRow[]; totalRecords: number | null }> {
  if (!hasQuickbaseConnection(config) || !tableId) {
    return { rows: [], totalRecords: 0 };
  }
  const requestedFieldIds = Array.from(new Set((fieldIds || []).filter(Boolean).map(String)));
  if (!requestedFieldIds.length) {
    return { rows: [], totalRecords: 0 };
  }
  const select = Array.from(new Set(["3", ...requestedFieldIds.filter((fieldId) => fieldId !== "3")])).slice(0, 30);
  const response = await quickbaseQueryRecords(
    config,
    tableId,
    select,
    options.where || "",
    {
      top: Math.max(1, Math.min(Number(options.top) || 250, 1000)),
      skip: Math.max(0, Number(options.skip) || 0),
      sortBy: options.sortBy || []
    }
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "Quickbase table preview failed.";
    throw new Error(`Quickbase table preview failed for table ${tableId}. ${message}`);
  });

  return {
    rows: response.data.map((row) => {
      const data: DataRow = {
        __recordId: String(qbFieldValue(row, "3") || "")
      };
      requestedFieldIds.forEach((fieldId) => {
        data[fieldId] = qbFieldValue(row, fieldId);
      });
      return data;
    }),
    totalRecords: Number.isFinite(Number(response.metadata?.totalRecords))
      ? Number(response.metadata?.totalRecords)
      : null
  };
}

export async function fetchQuickbaseTableRows(
  config: StudioDocument["quickbase"],
  tableId: string,
  fieldIds: string[],
  options: {
    top?: number;
    skip?: number;
    where?: string;
    sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }>;
  } = {}
): Promise<DataRow[]> {
  const response = await fetchQuickbaseTablePage(config, tableId, fieldIds, options);
  return response.rows;
}

export async function fetchQuickbaseSavedReportPage(
  config: StudioDocument["quickbase"],
  tableId: string,
  reportId: string,
  options: { top?: number; skip?: number } = {}
): Promise<{ rows: DataRow[]; totalRecords: number | null }> {
  if (!hasQuickbaseConnection(config) || !tableId || !reportId) {
    return { rows: [], totalRecords: 0 };
  }
  const fetchSavedReport = async () => {
    if (usingDirectQuickbaseApi(config)) {
      return quickbaseRunReportRest(config, tableId, reportId, {
        top: Math.max(1, Math.min(Number(options.top) || 1000, 1000)),
        skip: Math.max(0, Number(options.skip) || 0)
      });
    }
    return quickbaseQueryRecordsBySavedReportXml(config, tableId, reportId, {
      top: Math.max(1, Math.min(Number(options.top) || 1000, 1000)),
      skip: Math.max(0, Number(options.skip) || 0)
    });
  };
  const response = await fetchSavedReport().catch((error) => {
    const message = error instanceof Error ? error.message : "Quickbase saved report query failed.";
    throw new Error(`Quickbase saved report ${reportId} failed for table ${tableId}. ${message}`);
  });

  return {
    rows: response.data.map((row) => {
      const data: DataRow = {
        __recordId: String(qbFieldValue(row, "3") || "")
      };
      Object.keys(row).forEach((fieldId) => {
        data[fieldId] = qbFieldValue(row, fieldId);
      });
      return data;
    }),
    totalRecords: Number.isFinite(Number(response.metadata?.totalRecords))
      ? Number(response.metadata?.totalRecords)
      : null
  };
}

export async function fetchQuickbaseRowsBySavedReport(
  config: StudioDocument["quickbase"],
  tableId: string,
  reportId: string,
  options: { top?: number; skip?: number } = {}
): Promise<DataRow[]> {
  const response = await fetchQuickbaseSavedReportPage(config, tableId, reportId, options);
  return response.rows;
}

async function quickbaseWriteRecordsXml(
  config: StudioDocument["quickbase"],
  tableId: string,
  rows: QuickbaseRecord[]
) {
  const savedRows: QuickbaseRecord[] = [];
  for (const row of rows || []) {
    const recordId = qbFieldValue(row, "3");
    const fieldXml = Object.entries(row || {})
      .filter(([fid, entry]) => String(fid) !== "3" && entry && typeof entry === "object" && "value" in entry && entry.value !== undefined && entry.value !== null)
      .map(([fid, entry]) => `<field fid="${escapeXml(fid)}">${escapeXml(String(entry.value ?? ""))}</field>`)
      .join("");
    const api = await quickbaseXmlRequest(
      config,
      tableId,
      recordId ? "API_EditRecord" : "API_AddRecord",
      [
        recordId ? `<rid>${escapeXml(String(recordId))}</rid>` : "",
        "<ignoreError>1</ignoreError>",
        "<clist>3</clist>",
        fieldXml
      ].join("")
    );
    const savedRecordId = textValue(api?.rid) || recordId;
    savedRows.push({
      "3": { value: savedRecordId ? String(savedRecordId) : "" }
    });
  }
  return { data: savedRows };
}

async function quickbaseWriteRecordsRest(
  config: StudioDocument["quickbase"],
  tableId: string,
  rows: QuickbaseRecord[]
) {
  const savedRows: QuickbaseRecord[] = [];
  let batch: QuickbaseRecord[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const response = await quickbaseRestRequest(config, "/records", {
      method: "POST",
      body: {
        to: tableId,
        data: batch,
        fieldsToReturn: [3]
      }
    }) as { data: QuickbaseRecord[] };
    savedRows.push(...(response.data || []));
    batch = [];
    batchBytes = 0;
  };
  for (const row of rows || []) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row || {}), "utf8");
    if (batch.length && (batch.length >= QUICKBASE_REST_WRITE_BATCH_SIZE || batchBytes + rowBytes > QUICKBASE_REST_WRITE_BATCH_BYTES)) {
      await flush();
    }
    batch.push(row);
    batchBytes += rowBytes;
  }
  await flush();
  return { data: savedRows };
}

async function quickbaseWriteRecords(
  config: StudioDocument["quickbase"],
  tableId: string,
  rows: QuickbaseRecord[]
) {
  if (usingDirectQuickbaseApi(config)) {
    return quickbaseWriteRecordsRest(config, tableId, rows);
  }
  return quickbaseWriteRecordsXml(config, tableId, rows);
}

async function quickbaseDeleteRecordsXml(
  config: StudioDocument["quickbase"],
  tableId: string,
  recordIds: string[]
) {
  for (const recordId of recordIds) {
    if (!recordId) continue;
    await quickbaseXmlRequest(
      config,
      tableId,
      "API_DeleteRecord",
      `<rid>${escapeXml(String(recordId))}</rid>`
    );
  }
  return { numberDeleted: recordIds.length };
}

async function quickbaseDeleteRecordsRest(
  config: StudioDocument["quickbase"],
  tableId: string,
  recordIds: string[]
) {
  if (!recordIds.length) return { numberDeleted: 0 };
  const where = recordIds
    .map((recordId) => `{'3'.EX.'${escapeQueryValue(recordId)}'}`)
    .join("OR");
  return quickbaseRestRequest(config, "/records", {
    method: "DELETE",
    body: {
      from: tableId,
      where
    }
  }) as Promise<{ numberDeleted?: number }>;
}

async function quickbaseDeleteRecords(
  config: StudioDocument["quickbase"],
  tableId: string,
  recordIds: string[]
) {
  if (!recordIds.length) return { numberDeleted: 0 };
  if (usingDirectQuickbaseApi(config)) {
    return quickbaseDeleteRecordsRest(config, tableId, recordIds);
  }
  return quickbaseDeleteRecordsXml(config, tableId, recordIds);
}

async function quickbaseFetchRecordIdMap(
  config: StudioDocument["quickbase"],
  tableId: string,
  keyFieldIds: string[],
  options: { where?: string } = {}
) {
  const rows = await quickbaseFetchAllRecords(config, tableId, ["3", ...keyFieldIds], options.where || "");
  const map = new Map<string, string>();
  rows.forEach((row) => {
    const key = makeCompositeKey(keyFieldIds.map((fieldId) => qbFieldValue(row, fieldId)));
    const recordId = qbFieldValue(row, "3");
    if (key && recordId) {
      map.set(key, String(recordId));
    }
  });
  return map;
}

async function quickbaseFetchCurrentUser(config: StudioDocument["quickbase"]): Promise<QuickbaseUser> {
  return getOrCreateCacheValue(currentUserCache, quickbaseConfigCacheKey(config), async () => {
    try {
      const api = await quickbaseXmlRequest(config, "main", "API_GetUserInfo");
      const user = api?.user || {};
      const firstName = textValue(user?.firstName);
      const lastName = textValue(user?.lastName);
      const login = textValue(user?.login);
      const email = textValue(user?.email);
      return {
        id: String(user?.id || ""),
        login,
        email,
        name: [firstName, lastName].filter(Boolean).join(" ").trim() || login || email || String(user?.id || "")
      };
    } catch {
      return {
        id: "",
        login: "",
        email: "",
        name: ""
      };
    }
  });
}

function quickbaseUserValue(user: QuickbaseUser) {
  return user.email || user.login || user.id || "hosted-platform";
}

function quickbaseUserName(user: QuickbaseUser) {
  return user.name || user.email || user.login || user.id || "Hosted Platform";
}

function parseJsonValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text || !(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeQuickbaseConfig(
  current: StudioDocument["quickbase"],
  loaded?: Partial<StudioDocument["quickbase"]> | null,
  options: { allowEmpty?: boolean } = {}
) {
  if (!loaded) return current;
  const next = { ...current };
  Object.entries(loaded).forEach(([key, value]) => {
    if (value === undefined || value === null || (!options.allowEmpty && value === "")) return;
    next[key as keyof StudioDocument["quickbase"]] = String(value) as never;
  });
  return next;
}

async function loadQuickbaseBootstrapRows(config: StudioDocument["quickbase"]) {
  if (!hasQuickbaseConnection(config) || !config.settingsTableId) return [];
  bootstrapRowsCache.delete(`${quickbaseConfigCacheKey(config)}::bootstrap`);
  const availableFieldIds: string[] = await quickbaseListFieldIds(config, config.settingsTableId).catch(() => []);
  const candidateFieldIds = uniqueFieldIds([
    "3",
    config.settingsUserFieldId,
    config.settingsObjectFieldId,
    config.settingsObjectKeyFieldId,
    config.settingsJsonFieldId,
    config.settingsUpdatedByFieldId,
    "6",
    "7",
    "8",
    "9",
    "10"
  ]).filter((fieldId) => !availableFieldIds.length || availableFieldIds.includes(fieldId));
  if (!candidateFieldIds.length) return [];
  const response = await quickbaseQueryRecords(config, config.settingsTableId, candidateFieldIds, "", { top: 100 });
  return response.data;
}

async function resolveStoredQuickbaseConfig(
  config: StudioDocument["quickbase"]
): Promise<{
  config: StudioDocument["quickbase"];
  bootstrapRows: Array<Record<string, { value: unknown }>>;
}> {
  let bootstrapConfig = config;
  let detectedConfig: Partial<StudioDocument["quickbase"]> | null = null;
  if (hasQuickbaseConnection(config)) {
    const schema = await loadQuickbaseSchema({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken,
      appId: config.appId
    }).catch(() => null);
    if (schema) {
      detectedConfig = detectQuickbaseStorageConfig(schema);
      bootstrapConfig = mergeQuickbaseConfig(config, detectedConfig);
    }
  }
  const bootstrapRows = await loadQuickbaseBootstrapRows(bootstrapConfig).catch(() => []);
  const scope = `${normalizeHostname(bootstrapConfig.realmHostname)}::${bootstrapConfig.appId}`;
  const storagePayload = selectLatestPayload(
    bootstrapRows
      .map((row) => uniqueFieldIds(["8", bootstrapConfig.settingsJsonFieldId, "7"]).map((fid) => parseJsonValue(qbFieldValue(row, fid))).find(Boolean))
      .filter((payload): payload is { storage?: Partial<StudioDocument["quickbase"]>; type?: string; scope?: string } => Boolean(payload && typeof payload === "object")),
    (payload) => payload.type === "storageConfig" && (!payload.scope || payload.scope === scope)
  );

  return {
    config: mergeQuickbaseConfig(
      mergeQuickbaseConfig(config, detectedConfig),
      storagePayload?.storage || null,
      { allowEmpty: true }
    ),
    bootstrapRows
  };
}

async function loadStoredObjects(config: StudioDocument["quickbase"]) {
  if (!hasObjectStorage(config)) return [] as StudioObject[];
  return getOrCreateCacheValue(
    storedObjectsCache,
    `${quickbaseConfigCacheKey(config)}::objects`,
    async () => {
      const select = uniqueFieldIds([
        "3",
        config.objectKeyFieldId,
        config.objectTypeFieldId,
        config.objectNameFieldId,
        config.objectConfigFieldId,
        config.objectOwnerFieldId,
        config.objectPersonalOwnerFieldId,
        "6",
        "7",
        "8",
        "12",
        "13"
      ]);
      const rows = await quickbaseFetchAllRecords(config, config.objectTableId, select, "", { top: 200 });
      const objects: StudioObject[] = [];
      rows.forEach((row) => {
        const payload = [config.objectConfigFieldId, "8", "7"]
          .map((fid) => parseJsonValue(qbFieldValue(row, fid)))
          .find(Boolean) as Partial<StudioObject> | undefined;
        if (!payload || (payload.type !== "report" && payload.type !== "dashboard")) return;
        const object = payload as StudioObject;
        if (!object.id) {
          object.id = String(
            qbFieldValue(row, config.objectKeyFieldId)
            || qbFieldValue(row, "12")
            || qbFieldValue(row, "13")
            || qbFieldValue(row, "3")
            || ""
          );
        }
        if (!object.name) {
          object.name = String(qbFieldValue(row, config.objectNameFieldId) || qbFieldValue(row, "7") || object.id || "Saved Object");
        }
        if (!object.updatedAt) {
          object.updatedAt = new Date().toISOString();
        }
        const storedCreatorUserId = String(qbFieldValue(row, config.objectOwnerFieldId) || "").trim();
        const storedPersonalOwnerUserId = String(qbFieldValue(row, config.objectPersonalOwnerFieldId) || "").trim();
        object.createdByUserId = storedCreatorUserId;
        if (object.scope === "personal" && storedPersonalOwnerUserId) {
          object.ownerUserId = storedPersonalOwnerUserId;
        } else if (object.scope !== "personal") {
          object.ownerUserId = "";
        }
        objects.push(object);
      });
      return objects;
    }
  );
}

async function loadStoredVersions(config: StudioDocument["quickbase"]) {
  if (!hasVersionStorage(config)) return {} as Record<string, StudioVersionRecord[]>;
  const select = uniqueFieldIds([
    "3",
    config.versionObjectKeyFieldId,
    config.versionSnapshotFieldId,
    config.versionChangedAtFieldId,
    "6",
    "7",
    "8",
    "10"
  ]);
  const rows = await quickbaseFetchAllRecords(config, config.versionTableId, select, "", { top: 200 });
  const versions: Record<string, StudioVersionRecord[]> = {};
  rows.forEach((row) => {
    const payload = [config.versionSnapshotFieldId, "7", "8"]
      .map((fid) => parseJsonValue(qbFieldValue(row, fid)))
      .find(Boolean);
    const objectId = String(
      qbFieldValue(row, config.versionObjectKeyFieldId)
      || qbFieldValue(row, "10")
      || payload?.snapshot?.id
      || ""
    ).trim();
    if (!objectId) return;
    if (!payload?.snapshot) return;
    const version: StudioVersionRecord = {
      id: String(payload.id || qbFieldValue(row, "3") || `version-${Math.random().toString(36).slice(2, 10)}`),
      label: String(payload.label || "Version"),
      savedAt: String(payload.changedAt || qbFieldValue(row, config.versionChangedAtFieldId) || qbFieldValue(row, "8") || new Date().toISOString()),
      object: payload.snapshot
    };
    versions[objectId] ||= [];
    versions[objectId].push(version);
  });
  Object.values(versions).forEach((entries) => {
    entries.sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
    entries.splice(MAX_LOADED_VERSIONS_PER_OBJECT);
  });
  return versions;
}

function loadUserSettingsFromRows(
  rows: Array<Record<string, { value: unknown }>>,
  config: StudioDocument["quickbase"],
  user: QuickbaseUser
) {
  const userValue = quickbaseUserValue(user);
  const parsedRows = rows.map((row) => {
    const payload = uniqueFieldIds(["8", config.settingsJsonFieldId, "7"]).map((fid) => parseJsonValue(qbFieldValue(row, fid))).find(Boolean);
    return {
      row,
      payload
    };
  }).filter((entry) => entry.payload && typeof entry.payload === "object") as Array<{
    row: Record<string, { value: unknown }>;
    payload: any;
  }>;

  const exact = parsedRows
    .filter((entry) => entry.payload?.type === "userSettings" && String(qbFieldValue(entry.row, config.settingsUserFieldId || "6")) === userValue)
    .sort((left, right) => payloadUpdatedAt(right.payload) - payloadUpdatedAt(left.payload))[0];
  const fallback = parsedRows
    .filter((entry) => entry.payload?.type === "userSettings")
    .sort((left, right) => payloadUpdatedAt(right.payload) - payloadUpdatedAt(left.payload))[0];
  return exact?.payload || fallback?.payload || null;
}

function findQuickbaseTableByNames(tables: QuickbaseAppSchema["tables"], names: string[]) {
  const wanted = names.map(normalizeQuickbaseLabel);
  return tables.find((table) => wanted.includes(normalizeQuickbaseLabel(table.name))) || null;
}

function findQuickbaseFieldIdByLabels(fields: QuickbaseAppSchema["tables"][number]["fields"], labels: string[]) {
  const wanted = labels.map(normalizeQuickbaseLabel);
  const match = fields.find((field) => wanted.includes(normalizeQuickbaseLabel(field.label)));
  return match ? String(match.fid) : "";
}

function detectQuickbaseStorageConfig(schema: QuickbaseAppSchema) {
  const detected: Partial<StudioDocument["quickbase"]> = {};

  const objectTable = findQuickbaseTableByNames(schema.tables, [
    STORAGE_TABLE_NAMES.objects,
    "Saved Reports",
    "Studio Items",
    "Reporting Studio Items",
    "Saved Studio Items"
  ]);
  if (objectTable) {
    detected.objectTableId = objectTable.id;
    detected.objectKeyFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Platform Key", "Object ID", "Studio Item Key", "Studio Item ID", "Item Key", "Report ID"]);
    detected.objectTypeFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Type", "Object Type"]);
    detected.objectNameFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Name", "Object Name", "Report Name"]);
    detected.objectConfigFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["JSON Config", "Config JSON", "Json", "Configuration"]);
    detected.objectOwnerFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, [
      "Owner",
      "Object Owner",
      "Owner User ID",
      "Owner User",
      "Created By"
    ]);
    detected.objectPersonalOwnerFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, [
      "Personal Report Owner",
      "Personal Dashboard Owner",
      "Personal Owner",
      "Private Owner"
    ]);
    detected.objectUpdatedAtFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Updated", "Updated At", "Modified", "Modified At"]);
    detected.objectUpdatedByFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Updated By", "Modified By"]);
  }

  const settingsTable = findQuickbaseTableByNames(schema.tables, [
    STORAGE_TABLE_NAMES.settings,
    "User Report Settings",
    "User Settings",
    "Report User Settings"
  ]);
  if (settingsTable) {
    detected.settingsTableId = settingsTable.id;
    detected.settingsUserFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["User", "User ID", "Email"]);
    detected.settingsObjectFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Object Record", "Studio Item Record"]);
    detected.settingsObjectKeyFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Platform Key", "Object", "Object ID", "Studio Item Key", "Report ID"]);
    detected.settingsJsonFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Json", "JSON", "Settings JSON"]);
    detected.settingsUpdatedByFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Updated By", "Modified By"]);
  }

  const versionTable = findQuickbaseTableByNames(schema.tables, [
    STORAGE_TABLE_NAMES.versions,
    "Report Version History",
    "Version History",
    "Saved Report Version History"
  ]);
  if (versionTable) {
    detected.versionTableId = versionTable.id;
    detected.versionObjectFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Object Record", "Studio Item Record"]);
    detected.versionObjectKeyFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Platform Key", "Object", "Object ID", "Studio Item Key", "Report ID", "Version"]);
    detected.versionSnapshotFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Json", "JSON", "Snapshot JSON"]);
    detected.versionChangedAtFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Changed At", "Updated At", "Updated", "Modified At"]);
    detected.versionChangedByFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Changed By", "Updated By", "Modified By"]);
    detected.versionUpdatedByFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Updated By", "Changed By", "Modified By"]);
  }

  return detected;
}

function mapQuickbaseFieldType(fieldType: string, baseType: string): FieldType {
  const normalized = `${fieldType || ""} ${baseType || ""}`.toLowerCase();
  if (normalized.includes("currency")) return "currency";
  if (normalized.includes("date") && normalized.includes("time")) return "datetime";
  if (normalized.includes("datetime") || normalized.includes("timestamp")) return "datetime";
  if (normalized.includes("date")) return "date";
  if (normalized.includes("user")) return "user";
  if (normalized.includes("multi")) return "multiselect";
  if (
    normalized.includes("numeric") ||
    normalized.includes("number") ||
    normalized.includes("percent") ||
    normalized.includes("rating") ||
    normalized.includes("duration") ||
    normalized.includes("record id")
  ) {
    return "number";
  }
  return "text";
}

export function convertQuickbaseSchemaToTables(
  schema: Awaited<ReturnType<typeof loadQuickbaseSchema>>,
  profileId = "",
  appId = ""
): TableDefinition[] {
  return schema.tables.map((table) => ({
    id: profileId ? `${profileId}:${table.id}` : table.id,
    name: table.name,
    description: table.description || "Quickbase table",
    quickbaseProfileId: profileId,
    quickbaseTableId: table.id,
    quickbaseAppId: appId,
    fields: table.fields.map((field) => ({
      id: field.fid,
      label: field.label,
      type: mapQuickbaseFieldType(field.fieldType, field.baseType)
    }))
  }));
}

function remapTableId(tableId: string, tables: TableDefinition[]) {
  if (!tableId) return tableId;
  if (tables.some((table) => table.id === tableId)) {
    return tableId;
  }
  const matched = tables.find((table) => table.quickbaseTableId === tableId);
  return matched?.id || tableId;
}

function remapObjectTableIds(object: StudioObject, tables: TableDefinition[]): StudioObject {
  if (object.type === "report") {
    return {
      ...object,
      sourceTableId: remapTableId(object.sourceTableId, tables)
    };
  }
  return {
    ...object,
    tabs: object.tabs.map((tab) => ({
      ...tab,
      widgets: tab.widgets.map((widget) => ({
        ...widget,
        snapshot: widget.snapshot
          ? {
              ...widget.snapshot,
              sourceTableId: remapTableId(widget.snapshot.sourceTableId, tables)
            }
          : widget.snapshot
      }))
    }))
  };
}

function hasRefreshSourceConfig(profile: { refreshSource?: { tableIds?: string[]; reportIds?: Record<string, string> } } | null | undefined) {
  const tableIds = Array.isArray(profile?.refreshSource?.tableIds) ? profile!.refreshSource!.tableIds.filter(Boolean) : [];
  const reportIds = Object.values(profile?.refreshSource?.reportIds || {}).filter((value) => String(value || "").trim());
  return tableIds.length > 0 || reportIds.length > 0;
}

function mergeProfileRefreshSource(
  baseProfile: { refreshSource?: { tableIds?: string[]; reportIds?: Record<string, string> } } | undefined,
  loadedProfile: { refreshSource?: { tableIds?: string[]; reportIds?: Record<string, string> } }
) {
  if (hasRefreshSourceConfig(loadedProfile) || !hasRefreshSourceConfig(baseProfile)) {
    return {
      tableIds: [...(loadedProfile.refreshSource?.tableIds || [])],
      reportIds: { ...(loadedProfile.refreshSource?.reportIds || {}) }
    };
  }
  return {
    tableIds: [...(baseProfile?.refreshSource?.tableIds || [])],
    reportIds: { ...(baseProfile?.refreshSource?.reportIds || {}) }
  };
}

function normalizeStoredObjectOwnerUserId(
  object: StudioObject,
  currentSessionUserId: string,
  quickbaseUser: QuickbaseUser
) {
  if (object.scope !== "personal") return object;
  const normalizedSessionUserId = String(currentSessionUserId || "").trim();
  const normalizedOwnerUserId = String(object.ownerUserId || "").trim();
  const quickbaseAliases = new Set(
    [quickbaseUser.id, quickbaseUser.email, quickbaseUser.login]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  if (
    normalizedSessionUserId
    && (
      !normalizedOwnerUserId
      || normalizedOwnerUserId === "demo.user"
      || quickbaseAliases.has(normalizedOwnerUserId)
    )
  ) {
    return {
      ...object,
      ownerUserId: normalizedSessionUserId
    };
  }
  return object;
}

export async function hydrateStudioDocumentFromQuickbase(document: StudioDocument): Promise<StudioDocument> {
  const base = normalizeStudioDocument(document);
  const baseProfilesById = new Map(base.quickbaseProfiles.map((profile) => [profile.id, profile]));
  const bootstrapConfig =
    (base.quickbaseProfiles.find((profile) => profile.id === base.activeQuickbaseProfileId && hasQuickbaseConnection(profile.quickbase))?.quickbase)
    || (base.quickbaseProfiles.find((profile) => hasQuickbaseConnection(profile.quickbase))?.quickbase)
    || (hasQuickbaseConnection(base.quickbase) ? base.quickbase : null);
  if (!bootstrapConfig) {
    return base;
  }

  const { config: resolvedConfig, bootstrapRows } = await resolveStoredQuickbaseConfig(bootstrapConfig);
  const user = await quickbaseFetchCurrentUser(resolvedConfig);
  const storedUserSettings = loadUserSettingsFromRows(bootstrapRows, resolvedConfig, user);
  const profileSeed = Array.isArray(storedUserSettings?.quickbaseProfiles) && storedUserSettings.quickbaseProfiles.length
    ? storedUserSettings.quickbaseProfiles
    : base.quickbaseProfiles;
  const activeQuickbaseProfileId = String(storedUserSettings?.activeQuickbaseProfileId || base.activeQuickbaseProfileId || "");
  let normalizedProfiles = normalizeStudioDocument({
    ...base,
    quickbaseProfiles: profileSeed,
    activeQuickbaseProfileId
  }).quickbaseProfiles.map((profile) => ({
    ...profile,
    quickbase: mergeQuickbaseConfig({
      ...(baseProfilesById.get(profile.id)?.quickbase || {}),
      ...profile.quickbase,
      realmHostname: profile.quickbase.realmHostname || resolvedConfig.realmHostname,
      userToken: profile.quickbase.userToken || resolvedConfig.userToken,
      appToken: profile.quickbase.appToken || resolvedConfig.appToken,
      apiBaseUrl: profile.quickbase.apiBaseUrl || resolvedConfig.apiBaseUrl
    }, null)
  }));

  normalizedProfiles = await Promise.all(
    normalizedProfiles.map(async (profile) => {
      if (!hasQuickbaseConnection(profile.quickbase)) return profile;
      try {
        const { config } = await resolveStoredQuickbaseConfig(profile.quickbase);
        return {
          ...profile,
          quickbase: mergeQuickbaseConfig(
            mergeQuickbaseConfig(baseProfilesById.get(profile.id)?.quickbase || profile.quickbase, profile.quickbase),
            config,
            { allowEmpty: true }
          )
        };
      } catch {
        return profile;
      }
    })
  );

  const loadedTablesByProfile = await Promise.all(
    normalizedProfiles.map(async (profile) => {
      if (!hasQuickbaseConnection(profile.quickbase)) return [] as TableDefinition[];
      const loadedSchema = await getOrCreateCacheValue(
        schemaCache,
        `${quickbaseConfigCacheKey(profile.quickbase)}::schema`,
        async () => loadQuickbaseSchema({
          realmHostname: profile.quickbase.realmHostname,
          userToken: profile.quickbase.userToken,
          appToken: profile.quickbase.appToken,
          appId: profile.quickbase.appId
        }).catch(() => null)
      );
      return loadedSchema ? convertQuickbaseSchemaToTables(loadedSchema, profile.id, profile.quickbase.appId) : [];
    })
  );
  const loadedTables = loadedTablesByProfile.flat();
  const storedByProfile = await Promise.all(
    normalizedProfiles.map(async (profile) => {
      if (!hasQuickbaseConnection(profile.quickbase)) {
        return { objects: [] as StudioObject[], versions: {} as Record<string, StudioVersionRecord[]> };
      }
      const [objects, versions] = await Promise.all([
        loadStoredObjects(profile.quickbase).catch(() => [] as StudioObject[]),
        loadStoredVersions(profile.quickbase).catch(() => ({} as Record<string, StudioVersionRecord[]>))
      ]);
      return { objects, versions };
    })
  );
  const mergedObjects = new Map<string, StudioObject>();
  storedByProfile.flatMap((entry) => entry.objects).forEach((object) => {
    const normalizedObject = normalizeStoredObjectOwnerUserId(object, base.session.currentUserId, user);
    const current = mergedObjects.get(normalizedObject.id);
    if (!current || String(normalizedObject.updatedAt || "") >= String(current.updatedAt || "")) {
      mergedObjects.set(normalizedObject.id, normalizedObject);
    }
  });
  const mergedVersions: Record<string, StudioVersionRecord[]> = {};
  storedByProfile.forEach((entry) => {
    Object.entries(entry.versions).forEach(([objectId, versions]) => {
      mergedVersions[objectId] ||= [];
      mergedVersions[objectId].push(...versions);
      mergedVersions[objectId].sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
    });
  });
  const nextTables = loadedTables.length ? loadedTables : base.bundle.tables;
  const remappedObjects = Array.from(mergedObjects.values()).map((object) => remapObjectTableIds(object, nextTables));
  const hasStoredWorkspace = mergedObjects.size > 0 || Object.keys(mergedVersions).length > 0 || Boolean(storedUserSettings);
  const nextObjects = mergedObjects.size
    ? Object.fromEntries(remappedObjects.map((object) => [object.id, object]))
    : (hasStoredWorkspace ? {} : base.bundle.objects);
  const nextOrder = mergedObjects.size
    ? remappedObjects
        .slice()
        .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
        .map((object) => object.id)
    : (hasStoredWorkspace ? [] : base.bundle.order);

  const next = normalizeStudioDocument({
    ...base,
    quickbase: mergeQuickbaseConfig(base.quickbase, resolvedConfig, { allowEmpty: true }),
    quickbaseProfiles: normalizedProfiles,
    activeQuickbaseProfileId,
    bundle: {
      ...base.bundle,
      tables: nextTables,
      data: Object.fromEntries(nextTables.map((table) => [table.id, base.bundle.data[table.id] || base.bundle.data[table.quickbaseTableId || ""] || []])),
      objects: nextObjects,
      order: nextOrder
    },
    branding: storedUserSettings?.branding ? {
      platformName: String(storedUserSettings.branding.platformName || base.branding.platformName),
      navigationLabel: String(storedUserSettings.branding.navigationLabel || base.branding.navigationLabel),
      homeLabel: String(storedUserSettings.branding.homeLabel || base.branding.homeLabel),
      openLinksInNewTab: storedUserSettings.branding.openLinksInNewTab === true
        ? true
        : base.branding.openLinksInNewTab === true
    } : base.branding,
    favorites: Array.isArray(storedUserSettings?.favorites) ? storedUserSettings.favorites.map(String) : base.favorites,
    recent: Array.isArray(storedUserSettings?.recent) ? storedUserSettings.recent.map(String) : base.recent,
    personalOverrides: storedUserSettings?.personalOverrides || base.personalOverrides,
    sync: {
      ...base.sync,
      ...(storedUserSettings?.sync || {}),
      refreshSchedule: {
        ...base.sync.refreshSchedule,
        ...(storedUserSettings?.sync?.refreshSchedule || {})
      },
      refreshStatus: base.sync.refreshStatus,
      lastLoadedAt: new Date().toISOString()
    },
    versions: Object.keys(mergedVersions).length ? mergedVersions : base.versions
  });

  next.quickbaseProfiles = next.quickbaseProfiles.map((profile) => ({
    ...profile,
    refreshSource: mergeProfileRefreshSource(
      base.quickbaseProfiles.find((item) => item.id === profile.id),
      profile
    ),
    refreshStatus: base.quickbaseProfiles.find((item) => item.id === profile.id)?.refreshStatus || profile.refreshStatus
  }));

  return next;
}

async function ensureQuickbaseStorageForConfig(config: StudioDocument["quickbase"]): Promise<{
  config: StudioDocument["quickbase"];
  bootstrap: QuickbaseBootstrapStatus;
}> {
  if (!hasQuickbaseConnection(config)) {
    return {
      config,
      bootstrap: buildBootstrapStatus(config)
    };
  }

  if (!getMissingStorageMappings(config).length && !getInvalidStorageMappings(config).length) {
    return {
      config,
      bootstrap: buildBootstrapStatus(config)
    };
  }

  let autoProvisioned = false;

  try {
    let schema = await loadQuickbaseSchema({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken,
      appId: config.appId
    });
    let detected = detectQuickbaseStorageConfig(schema);

    if (!detected.objectTableId) {
      await quickbaseCreateTableXml(config, STORAGE_TABLE_NAMES.objects, "Saved Items");
      autoProvisioned = true;
    }
    if (!detected.settingsTableId) {
      await quickbaseCreateTableXml(config, STORAGE_TABLE_NAMES.settings, "Settings");
      autoProvisioned = true;
    }
    if (!detected.versionTableId) {
      await quickbaseCreateTableXml(config, STORAGE_TABLE_NAMES.versions, "Versions");
      autoProvisioned = true;
    }

    schema = await loadQuickbaseSchema({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken,
      appId: config.appId
    });
    detected = detectQuickbaseStorageConfig(schema);

    const objectTable = schema.tables.find((table) => table.id === detected.objectTableId);
    const settingsTable = schema.tables.find((table) => table.id === detected.settingsTableId);
    const versionTable = schema.tables.find((table) => table.id === detected.versionTableId);

    if (objectTable) {
      for (const field of STORAGE_FIELD_SPECS.objects) {
        if (!(detected as Record<string, unknown>)[field.key]) {
          await quickbaseAddFieldXml(config, objectTable.id, field.label, field.type);
          autoProvisioned = true;
        }
      }
    }
    if (settingsTable) {
      for (const field of STORAGE_FIELD_SPECS.settings) {
        if (!(detected as Record<string, unknown>)[field.key]) {
          await quickbaseAddFieldXml(config, settingsTable.id, field.label, field.type);
          autoProvisioned = true;
        }
      }
    }
    if (versionTable) {
      for (const field of STORAGE_FIELD_SPECS.versions) {
        if (!(detected as Record<string, unknown>)[field.key]) {
          await quickbaseAddFieldXml(config, versionTable.id, field.label, field.type);
          autoProvisioned = true;
        }
      }
    }

    const refreshedSchema = await loadQuickbaseSchema({
      realmHostname: config.realmHostname,
      userToken: config.userToken,
      appToken: config.appToken,
      appId: config.appId
    });
    schemaCache.delete(`${quickbaseConfigCacheKey(config)}::schema`);
    const merged = mergeQuickbaseConfig(config, detectQuickbaseStorageConfig(refreshedSchema) || null);
    return {
      config: merged,
      bootstrap: buildBootstrapStatus(merged, {
        autoProvisioned,
        message: autoProvisioned ? "Quickbase support tables were created or repaired automatically." : undefined
      })
    };
  } catch (error) {
    return {
      config,
      bootstrap: buildBootstrapStatus(config, {
        autoProvisioned,
        error: error instanceof Error ? error.message : "Unknown Quickbase bootstrap error."
      })
    };
  }
}

export async function ensureQuickbaseStorageForProfiles(document: StudioDocument): Promise<StudioDocument> {
  const next = normalizeStudioDocument(document);
  next.quickbaseProfiles = await Promise.all(
    next.quickbaseProfiles.map(async (profile) => {
      const ensured = await ensureQuickbaseStorageForConfig(profile.quickbase);
      return {
        ...profile,
        quickbase: ensured.config,
        bootstrap: ensured.bootstrap
      };
    })
  );
  const active = next.quickbaseProfiles.find((profile) => profile.id === next.activeQuickbaseProfileId) || next.quickbaseProfiles[0];
  if (active) {
    next.quickbase = active.quickbase;
    next.sync.refreshSchedule = active.refreshSchedule;
  }
  return normalizeStudioDocument(next);
}

async function syncObjectRecords(document: StudioDocument, user: QuickbaseUser, removedObjectIds: string[] = []) {
  const config = document.quickbase;
  if (!hasObjectStorage(config)) return { count: 0, objectRecordIds: {} as Record<string, string> };
  try {
    const existing = await quickbaseFetchRecordIdMap(config, config.objectTableId, [config.objectKeyFieldId]);
    const rows: QuickbaseRecord[] = [];
    const objects = Object.values(document.bundle.objects || {}).filter((object) => !SEEDED_OBJECT_IDS.has(object.id));
    objects.forEach((object) => {
      const launchUserId = String(document.session.currentUserId || "").trim();
      const effectiveCreatorUserId = String(object.createdByUserId || launchUserId || quickbaseUserValue(user)).trim();
      const effectivePersonalOwnerUserId = object.scope === "personal"
        ? String(launchUserId || object.ownerUserId || quickbaseUserValue(user)).trim()
        : "";
      const objectPayload: StudioObject = object.scope === "personal"
        ? {
            ...object,
            createdByUserId: effectiveCreatorUserId,
            ownerUserId: effectivePersonalOwnerUserId
          }
        : {
            ...object,
            createdByUserId: effectiveCreatorUserId,
            ownerUserId: ""
          };
      const record: QuickbaseRecord = {};
      const existingRecordId = existing.get(makeCompositeKey([object.id]));
      if (existingRecordId) qbSetField(record, "3", existingRecordId);
      qbSetField(record, config.objectKeyFieldId, objectPayload.id);
      qbSetField(record, config.objectTypeFieldId, objectPayload.type);
      qbSetField(record, config.objectNameFieldId, objectPayload.name);
      qbSetField(record, config.objectConfigFieldId, JSON.stringify(objectPayload));
      qbSetField(record, config.objectOwnerFieldId, effectiveCreatorUserId);
      qbSetField(record, config.objectPersonalOwnerFieldId, effectivePersonalOwnerUserId);
      qbSetField(record, config.objectUpdatedAtFieldId, objectPayload.updatedAt || new Date().toISOString());
      qbSetField(record, config.objectUpdatedByFieldId, quickbaseUserValue(user));
      rows.push(record);
    });

    await quickbaseWriteRecords(config, config.objectTableId, rows);
    const deletedKeys = new Set(removedObjectIds.map((objectId) => makeCompositeKey([objectId])));
    const deletedRecordIds = Array.from(existing.entries())
      .filter(([key]) => deletedKeys.has(key))
      .map(([, recordId]) => recordId)
      .filter(Boolean);
    if (deletedRecordIds.length) {
      await quickbaseDeleteRecords(config, config.objectTableId, deletedRecordIds);
    }
    const verified = await quickbaseFetchRecordIdMap(config, config.objectTableId, [config.objectKeyFieldId]);
    const objectRecordIds: Record<string, string> = {};
    objects.forEach((object, index) => {
      const rid = verified.get(makeCompositeKey([object.id])) || existing.get(makeCompositeKey([object.id]));
      if (rid) objectRecordIds[object.id] = String(rid);
    });
    const verifiedCount = Object.keys(objectRecordIds).length;
    if (objects.length && !verifiedCount) {
      throw new Error(`Quickbase accepted the save request but no records could be verified afterward in table ${config.objectTableId}.`);
    }
    return { count: verifiedCount, objectRecordIds };
  } catch (error) {
    throw new Error(
      `Saving reports and dashboards to table ${config.objectTableId} failed. ${error instanceof Error ? error.message : "Unknown Quickbase error."}`
    );
  }
}

async function syncSettingsRecords(document: StudioDocument, user: QuickbaseUser) {
  const config = document.quickbase;
  if (!hasSettingsStorage(config)) return { count: 0, storageConfigCount: 0 };
  try {
    const userValue = quickbaseUserValue(user);
    const where = buildWhere([{ fid: config.settingsUserFieldId, value: userValue }]);
    const existing = await quickbaseFetchRecordIdMap(config, config.settingsTableId, [config.settingsUserFieldId, config.settingsObjectKeyFieldId], { where });
    const rows: QuickbaseRecord[] = [];

    const storageConfigRecord: QuickbaseRecord = {};
    const storageRecordId = existing.get(makeCompositeKey([userValue, STORAGE_CONFIG_KEY]));
    if (storageRecordId) qbSetField(storageConfigRecord, "3", storageRecordId);
    qbSetField(storageConfigRecord, config.settingsUserFieldId, userValue);
    qbSetField(storageConfigRecord, config.settingsObjectFieldId, "");
    qbSetField(storageConfigRecord, config.settingsObjectKeyFieldId, STORAGE_CONFIG_KEY);
    qbSetField(storageConfigRecord, config.settingsJsonFieldId, JSON.stringify({
      type: "storageConfig",
      scope: `${normalizeHostname(config.realmHostname)}::${config.appId}`,
      storage: {
        helpdeskAppDbid: config.helpdeskAppDbid,
        helpdeskTicketsTableDbid: config.helpdeskTicketsTableDbid,
        helpdeskParentTableDbid: config.helpdeskParentTableDbid,
        helpdeskParentAppIdFid: config.helpdeskParentAppIdFid,
        objectTableId: config.objectTableId,
        objectKeyFieldId: config.objectKeyFieldId,
        objectTypeFieldId: config.objectTypeFieldId,
        objectNameFieldId: config.objectNameFieldId,
        objectConfigFieldId: config.objectConfigFieldId,
        objectOwnerFieldId: config.objectOwnerFieldId,
        objectPersonalOwnerFieldId: config.objectPersonalOwnerFieldId,
        objectUpdatedAtFieldId: config.objectUpdatedAtFieldId,
        objectUpdatedByFieldId: config.objectUpdatedByFieldId,
        rosterTableId: config.rosterTableId,
        rosterUserIdFieldId: config.rosterUserIdFieldId,
        rosterEmployeeNameFieldId: config.rosterEmployeeNameFieldId,
        rosterEmployeeEmailFieldId: config.rosterEmployeeEmailFieldId,
        rosterEmployeeRecordIdFieldId: config.rosterEmployeeRecordIdFieldId,
        settingsTableId: config.settingsTableId,
        settingsUserFieldId: config.settingsUserFieldId,
        settingsObjectFieldId: config.settingsObjectFieldId,
        settingsObjectKeyFieldId: config.settingsObjectKeyFieldId,
        settingsJsonFieldId: config.settingsJsonFieldId,
        settingsUpdatedByFieldId: config.settingsUpdatedByFieldId,
        versionTableId: config.versionTableId,
        versionObjectFieldId: config.versionObjectFieldId,
        versionObjectKeyFieldId: config.versionObjectKeyFieldId,
        versionSnapshotFieldId: config.versionSnapshotFieldId,
        versionChangedAtFieldId: config.versionChangedAtFieldId,
        versionChangedByFieldId: config.versionChangedByFieldId,
        versionUpdatedByFieldId: config.versionUpdatedByFieldId
      },
      updatedAt: new Date().toISOString(),
      updatedBy: userValue
    }));
    qbSetField(storageConfigRecord, config.settingsUpdatedByFieldId, userValue);
    rows.push(storageConfigRecord);

    const userSettingsRecord: QuickbaseRecord = {};
    const userSettingsRecordId = existing.get(makeCompositeKey([userValue, USER_SETTINGS_KEY]));
    if (userSettingsRecordId) qbSetField(userSettingsRecord, "3", userSettingsRecordId);
    qbSetField(userSettingsRecord, config.settingsUserFieldId, userValue);
    qbSetField(userSettingsRecord, config.settingsObjectFieldId, "");
    qbSetField(userSettingsRecord, config.settingsObjectKeyFieldId, USER_SETTINGS_KEY);
    qbSetField(userSettingsRecord, config.settingsJsonFieldId, JSON.stringify({
      type: "userSettings",
      branding: document.branding,
      favorites: document.favorites,
      recent: document.recent,
      personalOverrides: document.personalOverrides,
      quickbaseProfiles: document.quickbaseProfiles,
      activeQuickbaseProfileId: document.activeQuickbaseProfileId,
      sync: {
        refreshSchedule: document.sync.refreshSchedule
      },
      updatedAt: new Date().toISOString(),
      updatedBy: userValue
    }));
    qbSetField(userSettingsRecord, config.settingsUpdatedByFieldId, userValue);
    rows.push(userSettingsRecord);

    await quickbaseWriteRecords(config, config.settingsTableId, rows);
    const verified = await quickbaseFetchRecordIdMap(config, config.settingsTableId, [config.settingsUserFieldId, config.settingsObjectKeyFieldId], { where });
    const verifiedStorage = verified.get(makeCompositeKey([userValue, STORAGE_CONFIG_KEY])) ? 1 : 0;
    const verifiedUserSettings = verified.get(makeCompositeKey([userValue, USER_SETTINGS_KEY])) ? 1 : 0;
    const verifiedCount = verifiedStorage + verifiedUserSettings;
    if (!verifiedCount) {
      throw new Error(`Quickbase accepted the save request but no user settings rows could be verified afterward in table ${config.settingsTableId}.`);
    }
    return { count: verifiedCount, storageConfigCount: verifiedStorage };
  } catch (error) {
    throw new Error(
      `Saving user settings to table ${config.settingsTableId} failed. ${error instanceof Error ? error.message : "Unknown Quickbase error."}`
    );
  }
}

async function syncVersionRecords(document: StudioDocument, user: QuickbaseUser, objectRecordIds: Record<string, string>) {
  const config = document.quickbase;
  if (!hasVersionStorage(config)) return { count: 0 };
  try {
    const existing = await quickbaseFetchRecordIdMap(config, config.versionTableId, [config.versionObjectKeyFieldId, config.versionChangedAtFieldId]);
    const rows: QuickbaseRecord[] = [];

    Object.entries(document.versions || {}).forEach(([objectId, versions]) => {
      const recentVersions = [...(versions || [])]
        .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")))
        .slice(0, MAX_SYNCED_VERSIONS_PER_OBJECT);
      recentVersions.forEach((entry) => {
        const changedAt = entry.savedAt || new Date().toISOString();
        const payload = {
          id: entry.id,
          label: entry.label,
          changedAt,
          changedBy: quickbaseUserName(user),
          snapshot: entry.object
        };
        const record: QuickbaseRecord = {};
        const existingRecordId = existing.get(makeCompositeKey([objectId, changedAt]));
        if (existingRecordId) qbSetField(record, "3", existingRecordId);
        qbSetField(record, config.versionObjectFieldId, objectRecordIds[objectId] || "");
        qbSetField(record, config.versionObjectKeyFieldId, objectId);
        qbSetField(record, config.versionSnapshotFieldId, JSON.stringify(payload));
        qbSetField(record, config.versionChangedAtFieldId, changedAt);
        qbSetField(record, config.versionChangedByFieldId, quickbaseUserName(user));
        qbSetField(record, config.versionUpdatedByFieldId, quickbaseUserValue(user));
        rows.push(record);
      });
    });

    if (!rows.length) return { count: 0 };
    await quickbaseWriteRecords(config, config.versionTableId, rows);
    const verified = await quickbaseFetchRecordIdMap(config, config.versionTableId, [config.versionObjectKeyFieldId, config.versionChangedAtFieldId]);
    let verifiedCount = 0;
    Object.entries(document.versions || {}).forEach(([objectId, versions]) => {
      const recentVersions = [...(versions || [])]
        .sort((left, right) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")))
        .slice(0, MAX_SYNCED_VERSIONS_PER_OBJECT);
      recentVersions.forEach((entry) => {
        const changedAt = entry.savedAt || "";
        if (changedAt && verified.get(makeCompositeKey([objectId, changedAt]))) {
          verifiedCount += 1;
        }
      });
    });
    return { count: verifiedCount };
  } catch (error) {
    throw new Error(
      `Saving version history to table ${config.versionTableId} failed. ${error instanceof Error ? error.message : "Unknown Quickbase error."}`
    );
  }
}

export async function syncStudioUserSettingsToQuickbase(document: StudioDocument): Promise<QuickbaseSyncSummary> {
  const provisionedDocument = await ensureQuickbaseStorageForProfiles(document);
  const connectedProfiles = provisionedDocument.quickbaseProfiles.filter((profile) => hasQuickbaseConnection(profile.quickbase));
  if (!connectedProfiles.length) {
    return {
      enabled: false,
      ok: true,
      message: "Quickbase sync is not configured.",
      savedObjects: 0,
      savedSettings: 0,
      savedVersions: 0,
      savedStorageConfig: 0
    };
  }

  let savedSettings = 0;
  let savedStorageConfig = 0;
  for (const profile of connectedProfiles) {
    const config = profile.quickbase;
    if (!hasSettingsStorage(config)) continue;
    if (isRecordIdField(config.settingsObjectKeyFieldId)) {
      throw new Error("user settings object key field FID cannot be 3 (Record ID#). Use a separate text field to store user settings keys.");
    }
    const user = await quickbaseFetchCurrentUser(config);
    const profileDocument = normalizeStudioDocument({
      ...provisionedDocument,
      quickbase: config,
      activeQuickbaseProfileId: profile.id
    });
    const syncedSettings = await syncSettingsRecords(profileDocument, user);
    savedSettings += syncedSettings.count;
    savedStorageConfig += syncedSettings.storageConfigCount;
    invalidateQuickbaseCaches(config);
  }

  const allVerified = savedSettings > 0 || savedStorageConfig > 0;
  return {
    enabled: true,
    ok: allVerified,
    message: allVerified ? "Saved user settings to Quickbase." : "Quickbase user-settings save completed, but no rows could be verified afterward.",
    savedObjects: 0,
    savedSettings,
    savedVersions: 0,
    savedStorageConfig
  };
}

export async function syncStudioDocumentToQuickbase(document: StudioDocument, options?: { removedObjectIds?: string[] }): Promise<QuickbaseSyncSummary> {
  const provisionedDocument = await ensureQuickbaseStorageForProfiles(document);
  const connectedProfiles = provisionedDocument.quickbaseProfiles.filter((profile) => hasQuickbaseConnection(profile.quickbase));
  if (!connectedProfiles.length) {
    return {
      enabled: false,
      ok: true,
      message: "Quickbase sync is not configured.",
      savedObjects: 0,
      savedSettings: 0,
      savedVersions: 0,
      savedStorageConfig: 0
    };
  }

  let savedObjects = 0;
  let savedSettings = 0;
  let savedVersions = 0;
  let savedStorageConfig = 0;
  const warnings: string[] = [];

  for (const profile of connectedProfiles) {
    const config = profile.quickbase;
    const missing: string[] = [];
    if (!hasObjectStorage(config)) missing.push("saved reports and dashboards table mappings");
    if (!hasSettingsStorage(config)) missing.push("user settings table mappings");
    if (!hasVersionStorage(config)) missing.push("version history table mappings");
    if (missing.length) continue;

    const invalidMappings: string[] = [];
    if (isRecordIdField(config.objectKeyFieldId)) {
      invalidMappings.push("saved reports and dashboards key field FID cannot be 3 (Record ID#)");
    }
    if (isRecordIdField(config.settingsObjectKeyFieldId)) {
      invalidMappings.push("user settings object key field FID cannot be 3 (Record ID#)");
    }
    if (isRecordIdField(config.versionObjectKeyFieldId)) {
      invalidMappings.push("version history object key field FID cannot be 3 (Record ID#)");
    }
    if (invalidMappings.length) {
      throw new Error(invalidMappings.join(". ") + ". Use separate text fields to store report/dashboard object IDs.");
    }

    const user = await quickbaseFetchCurrentUser(config);
    const profileDocument = normalizeStudioDocument({
      ...provisionedDocument,
      quickbase: config,
      activeQuickbaseProfileId: profile.id
    });
    const syncedObjects = await syncObjectRecords(profileDocument, user, options?.removedObjectIds || []);
    const syncedSettings = await syncSettingsRecords(profileDocument, user);
    let syncedVersions = { count: 0 };
    try {
      syncedVersions = await syncVersionRecords(profileDocument, user, syncedObjects.objectRecordIds);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Version history sync failed.");
    }
    savedObjects += syncedObjects.count;
    savedSettings += syncedSettings.count;
    savedVersions += syncedVersions.count;
    savedStorageConfig += syncedSettings.storageConfigCount;
    invalidateQuickbaseCaches(config);
  }

  const allVerified = savedObjects > 0 || savedSettings > 0 || savedVersions > 0 || savedStorageConfig > 0;

  return {
    enabled: true,
    ok: allVerified,
    message: warnings.length
      ? `${allVerified ? "Saved reports, dashboards, and settings to Quickbase." : "Quickbase save requests completed, but no rows could be verified afterward."} Version history needs attention: ${warnings.join(" ")}`
      : (allVerified ? "Saved to Quickbase tables." : "Quickbase save requests completed, but no rows could be verified afterward."),
    savedObjects,
    savedSettings,
    savedVersions,
    savedStorageConfig
  };
}
