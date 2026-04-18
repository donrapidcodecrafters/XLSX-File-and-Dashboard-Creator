import { XMLParser } from "fast-xml-parser";
import type { DataRow, StudioDocument } from "@studio/shared";

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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value",
  trimValues: true
});

const STORAGE_CONFIG_KEY = "__studioStorageConfig__";
const USER_SETTINGS_KEY = "__studioUserSettings__";
const QUICKBASE_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function qbFieldValue(record: Record<string, any>, fid: string) {
  if (!record || !fid) return "";
  const entry = record[qbFieldKey(fid)] || record[String(fid)];
  return entry && typeof entry === "object" && "value" in entry ? entry.value : "";
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

function isRecordIdField(fid: string) {
  return String(fid || "").trim() === "3";
}

function usingDirectQuickbaseApi(config: StudioDocument["quickbase"]) {
  return String(config.apiBaseUrl || "").trim().replace(/\/$/, "") === "https://api.quickbase.com/v1";
}

async function quickbaseRestRequest(
  config: StudioDocument["quickbase"],
  path: string,
  options: { method?: string; body?: unknown } = {}
) {
  const baseUrl = String(config.apiBaseUrl || "https://api.quickbase.com/v1").trim().replace(/\/$/, "");
  const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };
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

async function quickbaseQueryRecordsXml(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; skip?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
) {
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

  return { data: records };
}

async function quickbaseQueryRecordsRest(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; skip?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
) {
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
  }) as Promise<{ data: Array<Record<string, { value: unknown }>> }>;
}

async function quickbaseQueryRecords(
  config: StudioDocument["quickbase"],
  tableId: string,
  select: string[],
  where = "",
  options: { top?: number; skip?: number; sortBy?: Array<{ fieldId: string; order?: "ASC" | "DESC" }> } = {}
) {
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

export async function fetchQuickbaseTableRows(
  config: StudioDocument["quickbase"],
  tableId: string,
  fieldIds: string[],
  options: { top?: number } = {}
): Promise<DataRow[]> {
  if (!hasQuickbaseConnection(config) || !tableId) return [];
  const select = Array.from(new Set((fieldIds || []).filter(Boolean).map(String))).slice(0, 30);
  if (!select.length) return [];
  const rows = await quickbaseFetchAllRecords(config, tableId, select, "", { top: options.top || 250 }).catch((error) => {
    const message = error instanceof Error ? error.message : "Quickbase table preview failed.";
    throw new Error(`Quickbase table preview failed for table ${tableId}. ${message}`);
  });
  return rows.map((row) => {
    const data: DataRow = {
      __recordId: String(qbFieldValue(row, "3") || "")
    };
    select.forEach((fieldId) => {
      data[fieldId] = qbFieldValue(row, fieldId);
    });
    return data;
  });
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
  return quickbaseRestRequest(config, "/records", {
    method: "POST",
    body: {
      to: tableId,
      data: rows,
      fieldsToReturn: [3]
    }
  }) as Promise<{ data: QuickbaseRecord[] }>;
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
}

function quickbaseUserValue(user: QuickbaseUser) {
  return user.email || user.login || user.id || "hosted-platform";
}

function quickbaseUserName(user: QuickbaseUser) {
  return user.name || user.email || user.login || user.id || "Hosted Platform";
}

async function syncObjectRecords(document: StudioDocument, user: QuickbaseUser) {
  const config = document.quickbase;
  if (!hasObjectStorage(config)) return { count: 0, objectRecordIds: {} as Record<string, string> };
  try {
    const existing = await quickbaseFetchRecordIdMap(config, config.objectTableId, [config.objectKeyFieldId]);
    const rows: QuickbaseRecord[] = [];
    const objects = Object.values(document.bundle.objects || {});
    objects.forEach((object) => {
      const record: QuickbaseRecord = {};
      const existingRecordId = existing.get(makeCompositeKey([object.id]));
      if (existingRecordId) qbSetField(record, "3", existingRecordId);
      qbSetField(record, config.objectKeyFieldId, object.id);
      qbSetField(record, config.objectTypeFieldId, object.type);
      qbSetField(record, config.objectNameFieldId, object.name);
      qbSetField(record, config.objectConfigFieldId, JSON.stringify(object));
      qbSetField(record, config.objectOwnerFieldId, quickbaseUserValue(user));
      qbSetField(record, config.objectUpdatedAtFieldId, object.updatedAt || new Date().toISOString());
      qbSetField(record, config.objectUpdatedByFieldId, quickbaseUserValue(user));
      rows.push(record);
    });

    await quickbaseWriteRecords(config, config.objectTableId, rows);
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
        objectTableId: config.objectTableId,
        objectKeyFieldId: config.objectKeyFieldId,
        objectTypeFieldId: config.objectTypeFieldId,
        objectNameFieldId: config.objectNameFieldId,
        objectConfigFieldId: config.objectConfigFieldId,
        objectOwnerFieldId: config.objectOwnerFieldId,
        objectUpdatedAtFieldId: config.objectUpdatedAtFieldId,
        objectUpdatedByFieldId: config.objectUpdatedByFieldId,
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
      (versions || []).forEach((entry) => {
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
      (versions || []).forEach((entry) => {
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

export async function syncStudioDocumentToQuickbase(document: StudioDocument): Promise<QuickbaseSyncSummary> {
  const config = document.quickbase;
  if (!hasQuickbaseConnection(config)) {
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

  const missing: string[] = [];
  if (!hasObjectStorage(config)) missing.push("saved reports and dashboards table mappings");
  if (!hasSettingsStorage(config)) missing.push("user settings table mappings");
  if (!hasVersionStorage(config)) missing.push("version history table mappings");
  if (missing.length) {
    return {
      enabled: true,
      ok: false,
      message: `Quickbase sync is configured but missing ${missing.join(", ")}.`,
      savedObjects: 0,
      savedSettings: 0,
      savedVersions: 0,
      savedStorageConfig: 0
    };
  }

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
    return {
      enabled: true,
      ok: false,
      message: invalidMappings.join(". ") + ". Use separate text fields to store report/dashboard object IDs.",
      savedObjects: 0,
      savedSettings: 0,
      savedVersions: 0,
      savedStorageConfig: 0
    };
  }

  const user = await quickbaseFetchCurrentUser(config);
  const { count: savedObjects, objectRecordIds } = await syncObjectRecords(document, user);
  const { count: savedSettings, storageConfigCount: savedStorageConfig } = await syncSettingsRecords(document, user);
  const { count: savedVersions } = await syncVersionRecords(document, user, objectRecordIds);

  const allVerified = savedObjects > 0 || savedSettings > 0 || savedVersions > 0;

  return {
    enabled: true,
    ok: allVerified,
    message: allVerified ? "Saved to Quickbase tables." : "Quickbase save requests completed, but no rows could be verified afterward.",
    savedObjects,
    savedSettings,
    savedVersions,
    savedStorageConfig
  };
}
