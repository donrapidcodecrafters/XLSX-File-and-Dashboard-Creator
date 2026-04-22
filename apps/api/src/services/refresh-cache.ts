import type { FastifyBaseLogger } from "fastify";
import type { DataRow, RefreshScheduleConfig, ReportDefinition, StudioDocument, TableDefinition } from "@studio/shared";
import { fetchQuickbaseRowsBySavedReport, fetchQuickbaseTablePage } from "./quickbase-storage.js";
import { studioStore } from "./studio-store.js";
import { refreshJobStore } from "./refresh-jobs.js";

const REFRESH_CHECK_INTERVAL_MS = 60_000;

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function getUsedTableIds(document: StudioDocument) {
  const ids = new Set<string>();
  Object.values(document.bundle.objects || {}).forEach((object) => {
    if (object.type === "report") {
      ids.add(object.sourceTableId);
      return;
    }
    object.tabs.forEach((tab) => {
      tab.widgets.forEach((widget) => {
        if (widget.snapshot?.sourceTableId) {
          ids.add(widget.snapshot.sourceTableId);
          return;
        }
        const linked = document.bundle.objects[widget.reportId];
        if (linked?.type === "report") {
          ids.add(linked.sourceTableId);
        }
      });
    });
  });
  return Array.from(ids).filter(Boolean);
}

function getObjectTableIds(document: StudioDocument, objectId: string) {
  const object = document.bundle.objects[objectId];
  if (!object) return [] as string[];
  if (object.type === "report") {
    return object.sourceTableId ? [object.sourceTableId] : [];
  }
  const ids = new Set<string>();
  object.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      if (widget.snapshot?.sourceTableId) {
        ids.add(widget.snapshot.sourceTableId);
        return;
      }
      const linked = document.bundle.objects[widget.reportId];
      if (linked?.type === "report" && linked.sourceTableId) {
        ids.add(linked.sourceTableId);
      }
    });
  });
  return Array.from(ids);
}

function getTable(document: StudioDocument, tableId: string) {
  return document.bundle.tables.find((table) => table.id === tableId || table.quickbaseTableId === tableId);
}

function getQuickbaseConfigForTable(document: StudioDocument, table: TableDefinition) {
  const profileId = table.quickbaseProfileId || "";
  const profile = profileId ? document.quickbaseProfiles.find((item) => item.id === profileId) : null;
  return profile?.quickbase || document.quickbase;
}

function getQuickbaseTableId(table: TableDefinition) {
  return table.quickbaseTableId || table.id;
}

function getUsedTableIdsForProfile(document: StudioDocument, profileId: string) {
  return getUsedTableIds(document).filter((tableId) => {
    const table = getTable(document, tableId);
    return table?.quickbaseProfileId === profileId;
  });
}

function getRefreshTableIdsForProfile(document: StudioDocument, profileId: string) {
  const profile = document.quickbaseProfiles.find((item) => item.id === profileId);
  const configured = Array.isArray(profile?.refreshSource?.tableIds) ? profile.refreshSource.tableIds.filter(Boolean) : [];
  if (!configured.length) {
    return getUsedTableIdsForProfile(document, profileId);
  }
  return Array.from(new Set(
    configured.map((tableId) => getTable(document, tableId)?.id || tableId)
  ));
}

function getSavedReportIdForTable(document: StudioDocument, table: TableDefinition) {
  const profileId = table.quickbaseProfileId || "";
  if (!profileId) return "";
  const profile = document.quickbaseProfiles.find((item) => item.id === profileId);
  const tableKey = getQuickbaseTableId(table);
  return String(profile?.refreshSource?.reportIds?.[tableKey] || "");
}

function getObjectOverrideReportIdForTable(document: StudioDocument, objectId: string, table: TableDefinition) {
  const object = document.bundle.objects[objectId];
  if (!object) return "";
  const tableKeys = [getQuickbaseTableId(table), table.id].filter(Boolean);
  const readOverride = (overrides?: Record<string, string>) => {
    for (const key of tableKeys) {
      const value = String(overrides?.[key] || "").trim();
      if (value) return value;
    }
    return "";
  };

  if (object.type === "report") {
    return readOverride(object.sourceReportOverrides);
  }

  const dashboardOverride = readOverride(object.sourceReportOverrides);
  if (dashboardOverride) return dashboardOverride;

  for (const tab of object.tabs) {
    for (const widget of tab.widgets) {
      const report = widget.mode === "copied" && widget.snapshot
        ? widget.snapshot
        : document.bundle.objects[widget.reportId];
      if (report?.type !== "report") continue;
      if (report.sourceTableId !== table.id && report.sourceTableId !== table.quickbaseTableId) continue;
      const reportOverride = readOverride(report.sourceReportOverrides);
      if (reportOverride) return reportOverride;
    }
  }

  return "";
}

function getProfilesForTableIds(document: StudioDocument, tableIds: string[]) {
  return Array.from(new Set(
    tableIds
      .map((tableId) => getTable(document, tableId)?.quickbaseProfileId || "")
      .filter(Boolean)
  ));
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[String(parts.weekday)] ?? 0
  };
}

function dailyKey(parts: ReturnType<typeof getZonedParts>) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function weeklyKey(parts: ReturnType<typeof getZonedParts>) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function monthlyKey(parts: ReturnType<typeof getZonedParts>) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function scheduleWindowKey(schedule: RefreshScheduleConfig, date: Date) {
  const parts = getZonedParts(date, schedule.timeZone || "UTC");
  if (schedule.cadence === "weekly") return weeklyKey(parts);
  if (schedule.cadence === "monthly") return monthlyKey(parts);
  return dailyKey(parts);
}

function scheduleMatchesNow(schedule: RefreshScheduleConfig, now: Date) {
  if (!schedule.enabled) return false;
  const parts = getZonedParts(now, schedule.timeZone || "UTC");
  const [hourText, minuteText] = String(schedule.timeOfDay || "00:00").split(":");
  const targetHour = Math.max(0, Math.min(23, Number(hourText) || 0));
  const targetMinute = Math.max(0, Math.min(59, Number(minuteText) || 0));
  if (parts.hour !== targetHour || parts.minute !== targetMinute) return false;
  if (schedule.cadence === "weekly" && parts.weekday !== Number(schedule.dayOfWeek || 0)) return false;
  if (schedule.cadence === "monthly" && parts.day !== Number(schedule.dayOfMonth || 1)) return false;
  return true;
}

function computeNextRunAt(schedule: RefreshScheduleConfig, from = new Date()) {
  if (!schedule.enabled) return "";
  let cursor = new Date(from.getTime() + 60_000);
  for (let index = 0; index < 60 * 24 * 40; index += 1) {
    if (scheduleMatchesNow(schedule, cursor)) {
      return cursor.toISOString();
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return "";
}

function isScheduleDue(schedule: RefreshScheduleConfig, nextRunAt: string, now = new Date()) {
  if (!schedule.enabled || !nextRunAt) return false;
  const dueAt = new Date(nextRunAt);
  if (Number.isNaN(dueAt.getTime())) return false;
  return now.getTime() >= dueAt.getTime();
}

type TableRefreshProgress = {
  loadedRows: number;
  fetchedPages: number;
  message: string;
};

function persistRefreshProgress(
  document: StudioDocument,
  progress: number,
  message: string,
  profileIds: string[],
  extras?: { estimatedSecondsRemaining?: number; rowCount?: number; tableIds?: string[] }
) {
  document.sync.refreshStatus.progress = progress;
  document.sync.refreshStatus.message = message;
  document.sync.refreshStatus.estimatedSecondsRemaining = extras?.estimatedSecondsRemaining;
  if (extras?.tableIds) {
    document.sync.refreshStatus.cachedTableIds = extras.tableIds;
  }
  if (typeof extras?.rowCount === "number") {
    document.sync.refreshStatus.cachedRowCount = extras.rowCount;
  }
  profileIds.forEach((profileId) => {
    syncProfileRefreshStatus(document, profileId, (status) => {
      status.progress = progress;
      status.message = message;
      status.estimatedSecondsRemaining = extras?.estimatedSecondsRemaining;
      if (extras?.tableIds) {
        status.cachedTableIds = extras.tableIds.filter((tableId) => getTable(document, tableId)?.quickbaseProfileId === profileId);
      }
      if (typeof extras?.rowCount === "number") {
        status.cachedRowCount = status.cachedTableIds.reduce((sum, tableId) => sum + (document.bundle.data[tableId]?.length || 0), 0);
      }
    });
  });
  studioStore.flushDocument(document, { markSavedAt: false });
}

async function fetchAllTableRows(
  document: StudioDocument,
  table: TableDefinition,
  onProgress?: (progress: TableRefreshProgress) => void,
  options: { objectId?: string } = {}
) {
  const quickbase = getQuickbaseConfigForTable(document, table);
  const savedReportId = (options.objectId ? getObjectOverrideReportIdForTable(document, options.objectId, table) : "") || getSavedReportIdForTable(document, table);
  if (savedReportId) {
    const pageSize = 250;
    let skip = 0;
    const merged = new Map<string, DataRow>();
    let fetchedPages = 0;
    let previousPageSignature = "";
    while (true) {
      const page = await fetchQuickbaseRowsBySavedReport(quickbase, getQuickbaseTableId(table), savedReportId, {
        top: pageSize,
        skip
      });
      if (!page.length) break;
      fetchedPages += 1;
      const beforeSize = merged.size;
      page.forEach((row) => {
        const recordId = String(row.__recordId || "");
        const existing = merged.get(recordId) || { __recordId: recordId };
        Object.assign(existing, row);
        merged.set(recordId, existing);
      });
      document.bundle.data[table.id] = Array.from(merged.values());
      studioStore.touchCacheEntry(table.id, merged.size);
      onProgress?.({
        loadedRows: merged.size,
        fetchedPages,
        message: `Loading ${table.name}: ${merged.size.toLocaleString()} rows saved so far`
      });
      const currentPageSignature = `${page[0]?.__recordId || ""}:${page[page.length - 1]?.__recordId || ""}:${page.length}`;
      if (page.length < pageSize) break;
      if (merged.size === beforeSize || currentPageSignature === previousPageSignature) {
        throw new Error(`Refresh could not move past the same saved report page for ${table.name}. Check Quickbase source report ${savedReportId} and make sure it returns all records in a stable order.`);
      }
      previousPageSignature = currentPageSignature;
      skip += page.length;
    }
    return Array.from(merged.values());
  }
  const fieldIds = table.fields.map((field) => field.id).filter(Boolean);
  const chunks = chunk(fieldIds, 30);
  const merged = new Map<string, DataRow>();
  let fetchedPages = 0;
  for (const fieldChunk of chunks) {
    let skip = 0;
    while (true) {
      const page = await fetchQuickbaseTablePage(quickbase, getQuickbaseTableId(table), fieldChunk, {
        top: 1000,
        skip
      });
      if (!page.rows.length) break;
      page.rows.forEach((row) => {
        const recordId = String(row.__recordId || "");
        const existing = merged.get(recordId) || { __recordId: recordId };
        Object.assign(existing, row);
        merged.set(recordId, existing);
      });
      document.bundle.data[table.id] = Array.from(merged.values());
      studioStore.touchCacheEntry(table.id, merged.size);
      fetchedPages += 1;
      onProgress?.({
        loadedRows: merged.size,
        fetchedPages,
        message: `Loading ${table.name}: ${merged.size.toLocaleString()} rows saved so far`
      });
      if (page.rows.length < 1000) break;
      skip += page.rows.length;
    }
  }
  return Array.from(merged.values());
}

export async function ensureTableRowsAvailable(tableId: string, options: { objectId?: string } = {}) {
  await studioStore.hydrateFromQuickbase();
  const document = studioStore.getLiveDocument();
  const table = getTable(document, tableId);
  if (!table) return [] as DataRow[];

  const existing = document.bundle.data[table.id]
    || (table.quickbaseTableId ? document.bundle.data[table.quickbaseTableId] : undefined)
    || document.bundle.data[tableId]
    || [];
  if (existing.length) {
    return existing;
  }

  const quickbase = getQuickbaseConfigForTable(document, table);
  if (!quickbase.realmHostname || !quickbase.userToken || !quickbase.appId) {
    return existing;
  }

  const rows = await fetchAllTableRows(document, table, undefined, options);
  document.bundle.data[table.id] = rows;
  if (table.quickbaseTableId) {
    document.bundle.data[table.quickbaseTableId] = rows;
    studioStore.touchCacheEntry(table.quickbaseTableId, rows.length);
  }
  studioStore.touchCacheEntry(table.id, rows.length);
  studioStore.flushDocument(document, { markSavedAt: false });
  return rows;
}

export function updateRefreshScheduleMetadata(document: StudioDocument) {
  const nextRuns: string[] = [];
  document.quickbaseProfiles = (document.quickbaseProfiles || []).map((profile) => ({
    ...profile,
    refreshStatus: {
      ...profile.refreshStatus,
      nextRunAt: computeNextRunAt(profile.refreshSchedule)
    }
  }));
  document.quickbaseProfiles.forEach((profile) => {
    if (profile.refreshStatus.nextRunAt) {
      nextRuns.push(profile.refreshStatus.nextRunAt);
    }
  });
  document.sync.refreshStatus.nextRunAt = nextRuns.sort()[0] || "";
}

function syncProfileRefreshStatus(
  document: StudioDocument,
  profileId: string,
  updater: (status: StudioDocument["quickbaseProfiles"][number]["refreshStatus"]) => void
) {
  const profile = document.quickbaseProfiles.find((item) => item.id === profileId);
  if (!profile) return;
  updater(profile.refreshStatus);
}

export function updateLegacyActiveQuickbase(document: StudioDocument) {
  const active = document.quickbaseProfiles.find((profile) => profile.id === document.activeQuickbaseProfileId);
  if (active) {
    document.quickbase = active.quickbase;
    document.sync.refreshSchedule = active.refreshSchedule;
  }
}

export async function refreshAllCachedData(reason: "manual" | "scheduled" = "manual", profileId = "") {
  await studioStore.hydrateFromQuickbase(true);
  const startDocument = studioStore.getLiveDocument();
  updateRefreshScheduleMetadata(startDocument);
  updateLegacyActiveQuickbase(startDocument);
  startDocument.sync.refreshStatus.running = true;
  startDocument.sync.refreshStatus.activeJobId = startDocument.sync.refreshStatus.activeJobId || "";
  startDocument.sync.refreshStatus.progress = 1;
  startDocument.sync.refreshStatus.message = "Preparing refresh";
  startDocument.sync.refreshStatus.estimatedSecondsRemaining = undefined;
  startDocument.sync.refreshStatus.lastStartedAt = new Date().toISOString();
  startDocument.sync.refreshStatus.lastError = "";
  studioStore.flushDocument(startDocument, { markSavedAt: false });

  try {
    const latest = studioStore.getLiveDocument();
    const profileTableIds = profileId
      ? getRefreshTableIdsForProfile(latest, profileId)
      : latest.quickbaseProfiles.flatMap((profile) => getRefreshTableIdsForProfile(latest, profile.id));
    const tableIds = Array.from(new Set((profileTableIds.length ? profileTableIds : getUsedTableIds(latest)).filter(Boolean)));
    const nextDocument = latest;
    let totalRows = 0;
    for (const tableId of tableIds) {
      const table = getTable(nextDocument, tableId);
      if (!table) continue;
      const rows = await fetchAllTableRows(nextDocument, table);
      nextDocument.bundle.data[tableId] = rows;
      totalRows += rows.length;
    }
    nextDocument.sync.refreshStatus.running = false;
    nextDocument.sync.refreshStatus.activeJobId = "";
    nextDocument.sync.refreshStatus.progress = 100;
    nextDocument.sync.refreshStatus.message = "Refresh complete";
    nextDocument.sync.refreshStatus.estimatedSecondsRemaining = 0;
    nextDocument.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    nextDocument.sync.refreshStatus.lastSuccessAt = nextDocument.sync.refreshStatus.lastCompletedAt;
    nextDocument.sync.refreshStatus.lastError = "";
    nextDocument.sync.refreshStatus.cachedTableIds = tableIds;
    nextDocument.sync.refreshStatus.cachedRowCount = totalRows;
    const profilesToUpdate = profileId
      ? nextDocument.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : nextDocument.quickbaseProfiles;
    profilesToUpdate.forEach((profile) => {
      syncProfileRefreshStatus(nextDocument, profile.id, (status) => {
        status.running = false;
        status.activeJobId = "";
        status.progress = 100;
        status.message = "Refresh complete";
        status.estimatedSecondsRemaining = 0;
        status.lastCompletedAt = nextDocument.sync.refreshStatus.lastCompletedAt;
        status.lastSuccessAt = nextDocument.sync.refreshStatus.lastSuccessAt;
        status.lastError = "";
        status.cachedTableIds = tableIds.filter((tableId) => getTable(nextDocument, tableId)?.quickbaseProfileId === profile.id);
        status.cachedRowCount = status.cachedTableIds.reduce((sum, tableId) => sum + (nextDocument.bundle.data[tableId]?.length || 0), 0);
      });
    });
    updateRefreshScheduleMetadata(nextDocument);
    updateLegacyActiveQuickbase(nextDocument);
    studioStore.flushDocument(nextDocument, { markSavedAt: false });
    return {
      ok: true,
      reason,
      tableCount: tableIds.length,
      rowCount: totalRows,
      document: studioStore.getDocument()
    };
  } catch (error) {
    const failed = studioStore.getLiveDocument();
    failed.sync.refreshStatus.running = false;
    failed.sync.refreshStatus.activeJobId = "";
    failed.sync.refreshStatus.message = error instanceof Error ? error.message : "Refresh failed.";
    failed.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    failed.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    failed.sync.refreshStatus.lastError = error instanceof Error ? error.message : "Refresh failed.";
    const failedProfilesToUpdate = profileId
      ? failed.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : failed.quickbaseProfiles;
    failedProfilesToUpdate.forEach((profile) => {
      syncProfileRefreshStatus(failed, profile.id, (status) => {
        status.running = false;
        status.activeJobId = "";
        status.message = failed.sync.refreshStatus.lastError;
        status.estimatedSecondsRemaining = undefined;
        status.lastCompletedAt = failed.sync.refreshStatus.lastCompletedAt;
        status.lastError = failed.sync.refreshStatus.lastError;
      });
    });
    updateRefreshScheduleMetadata(failed);
    updateLegacyActiveQuickbase(failed);
    studioStore.flushDocument(failed, { markSavedAt: false });
    throw error;
  }
}

export async function refreshAllCachedDataWithProgress(
  reason: "manual" | "scheduled" = "manual",
  onProgress?: (progress: number, message: string, extras?: { tableCount?: number; rowCount?: number; estimatedSecondsRemaining?: number }) => void,
  profileId = "",
  activeJobId = ""
) {
  await studioStore.hydrateFromQuickbase(true);
  const startDocument = studioStore.getLiveDocument();
  updateRefreshScheduleMetadata(startDocument);
  updateLegacyActiveQuickbase(startDocument);
  startDocument.sync.refreshStatus.running = true;
  startDocument.sync.refreshStatus.activeJobId = activeJobId || startDocument.sync.refreshStatus.activeJobId || "";
  startDocument.sync.refreshStatus.progress = 1;
  startDocument.sync.refreshStatus.message = "Preparing refresh";
  startDocument.sync.refreshStatus.estimatedSecondsRemaining = undefined;
  startDocument.sync.refreshStatus.lastStartedAt = new Date().toISOString();
  startDocument.sync.refreshStatus.lastError = "";
  const startupProfiles = profileId
    ? startDocument.quickbaseProfiles.filter((profile) => profile.id === profileId)
    : startDocument.quickbaseProfiles;
  startupProfiles.forEach((profile) => {
    profile.refreshStatus.running = true;
    profile.refreshStatus.activeJobId = activeJobId || profile.refreshStatus.activeJobId || "";
    profile.refreshStatus.progress = 1;
    profile.refreshStatus.message = "Preparing refresh";
    profile.refreshStatus.estimatedSecondsRemaining = undefined;
    profile.refreshStatus.lastStartedAt = startDocument.sync.refreshStatus.lastStartedAt;
    profile.refreshStatus.lastError = "";
  });
  studioStore.flushDocument(startDocument, { markSavedAt: false });

  try {
    const latest = studioStore.getLiveDocument();
    const profileTableIds = profileId
      ? getRefreshTableIdsForProfile(latest, profileId)
      : latest.quickbaseProfiles.flatMap((profile) => getRefreshTableIdsForProfile(latest, profile.id));
    const tableIds = Array.from(new Set((profileTableIds.length ? profileTableIds : getUsedTableIds(latest)).filter(Boolean)));
    const nextDocument = latest;
    let totalRows = 0;
    const totalTables = Math.max(tableIds.length, 1);
    const startedAt = Date.now();
    const profilesToTrack = profileId ? [profileId] : nextDocument.quickbaseProfiles.map((profile) => profile.id);
    const updateDocumentProgress = (
      progress: number,
      message: string,
      extras?: { tableCount?: number; rowCount?: number; estimatedSecondsRemaining?: number }
    ) => {
      persistRefreshProgress(nextDocument, progress, message, profilesToTrack, {
        estimatedSecondsRemaining: extras?.estimatedSecondsRemaining,
        rowCount: extras?.rowCount,
        tableIds
      });
      onProgress?.(progress, message, extras);
    };

    updateDocumentProgress(4, "Preparing refresh", { tableCount: tableIds.length, rowCount: 0 });
    for (const [index, tableId] of tableIds.entries()) {
      const table = getTable(nextDocument, tableId);
      if (!table) continue;
      const startedTables = index;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const estimatedSecondsRemaining = startedTables > 0
        ? Math.max(0, Math.round((elapsedSeconds / startedTables) * (tableIds.length - startedTables)))
        : undefined;
      updateDocumentProgress(5 + Math.round((index / totalTables) * 80), `Refreshing ${table.name}`, {
        tableCount: tableIds.length,
        rowCount: totalRows,
        estimatedSecondsRemaining
      });
      const rows = await fetchAllTableRows(nextDocument, table, ({ loadedRows, message }) => {
        const tableShare = 80 / totalTables;
        const withinTable = Math.min(0.92, loadedRows / Math.max(loadedRows + 10000, 1));
        updateDocumentProgress(
          5 + Math.round((index / totalTables) * 80 + tableShare * withinTable),
          message,
          {
            tableCount: tableIds.length,
            rowCount: totalRows + loadedRows
          }
        );
      });
      nextDocument.bundle.data[tableId] = rows;
      studioStore.touchCacheEntry(tableId, rows.length);
      totalRows += rows.length;
      const completedTables = index + 1;
      const elapsedAfterTable = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const remainingTables = tableIds.length - completedTables;
      const tableEta = remainingTables > 0
        ? Math.max(0, Math.round((elapsedAfterTable / completedTables) * remainingTables))
        : 0;
      updateDocumentProgress(5 + Math.round((completedTables / totalTables) * 80), `Refreshed ${table.name}`, {
        tableCount: tableIds.length,
        rowCount: totalRows,
        estimatedSecondsRemaining: tableEta
      });
    }
    nextDocument.sync.refreshStatus.running = false;
    nextDocument.sync.refreshStatus.activeJobId = "";
    nextDocument.sync.refreshStatus.progress = 100;
    nextDocument.sync.refreshStatus.message = "Refresh complete";
    nextDocument.sync.refreshStatus.estimatedSecondsRemaining = 0;
    nextDocument.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    nextDocument.sync.refreshStatus.lastSuccessAt = nextDocument.sync.refreshStatus.lastCompletedAt;
    nextDocument.sync.refreshStatus.lastError = "";
    nextDocument.sync.refreshStatus.cachedTableIds = tableIds;
    nextDocument.sync.refreshStatus.cachedRowCount = totalRows;
    const profilesToUpdate = profileId
      ? nextDocument.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : nextDocument.quickbaseProfiles;
    profilesToUpdate.forEach((profile) => {
      syncProfileRefreshStatus(nextDocument, profile.id, (status) => {
        status.running = false;
        status.activeJobId = "";
        status.progress = 100;
        status.message = "Refresh complete";
        status.estimatedSecondsRemaining = 0;
        status.lastCompletedAt = nextDocument.sync.refreshStatus.lastCompletedAt;
        status.lastSuccessAt = nextDocument.sync.refreshStatus.lastSuccessAt;
        status.lastError = "";
        status.cachedTableIds = tableIds.filter((tableId) => getTable(nextDocument, tableId)?.quickbaseProfileId === profile.id);
        status.cachedRowCount = status.cachedTableIds.reduce((sum, tableId) => sum + (nextDocument.bundle.data[tableId]?.length || 0), 0);
      });
    });
    studioStore.touchCacheEntriesFromDocument(nextDocument, tableIds, nextDocument.sync.refreshStatus.lastSuccessAt);
    updateRefreshScheduleMetadata(nextDocument);
    updateLegacyActiveQuickbase(nextDocument);
    studioStore.flushDocument(nextDocument, { markSavedAt: false });
    onProgress?.(100, "Refresh complete", { tableCount: tableIds.length, rowCount: totalRows });
    return {
      ok: true,
      reason,
      tableCount: tableIds.length,
      rowCount: totalRows,
      document: studioStore.getDocument()
    };
  } catch (error) {
    const failed = studioStore.getLiveDocument();
    failed.sync.refreshStatus.running = false;
    failed.sync.refreshStatus.activeJobId = "";
    failed.sync.refreshStatus.message = error instanceof Error ? error.message : "Refresh failed.";
    failed.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    failed.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    failed.sync.refreshStatus.lastError = error instanceof Error ? error.message : "Refresh failed.";
    const failedProfilesToUpdate = profileId
      ? failed.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : failed.quickbaseProfiles;
    failedProfilesToUpdate.forEach((profile) => {
      syncProfileRefreshStatus(failed, profile.id, (status) => {
        status.running = false;
        status.activeJobId = "";
        status.message = failed.sync.refreshStatus.lastError;
        status.estimatedSecondsRemaining = undefined;
        status.lastCompletedAt = failed.sync.refreshStatus.lastCompletedAt;
        status.lastError = failed.sync.refreshStatus.lastError;
      });
    });
    updateRefreshScheduleMetadata(failed);
    updateLegacyActiveQuickbase(failed);
    studioStore.flushDocument(failed, { markSavedAt: false });
    throw error;
  }
}

export async function refreshObjectCachedDataWithProgress(
  objectId: string,
  onProgress?: (progress: number, message: string, extras?: { tableCount?: number; rowCount?: number; estimatedSecondsRemaining?: number }) => void,
  activeJobId = ""
) {
  await studioStore.hydrateFromQuickbase(true);
  const startDocument = studioStore.getLiveDocument();
  updateRefreshScheduleMetadata(startDocument);
  updateLegacyActiveQuickbase(startDocument);
  startDocument.sync.refreshStatus.running = true;
  startDocument.sync.refreshStatus.activeJobId = activeJobId || startDocument.sync.refreshStatus.activeJobId || "";
  startDocument.sync.refreshStatus.progress = 1;
  startDocument.sync.refreshStatus.message = "Preparing object refresh";
  startDocument.sync.refreshStatus.estimatedSecondsRemaining = undefined;
  startDocument.sync.refreshStatus.lastStartedAt = new Date().toISOString();
  startDocument.sync.refreshStatus.lastError = "";
  const startupTableIds = getObjectTableIds(startDocument, objectId);
  const startupProfiles = getProfilesForTableIds(startDocument, startupTableIds);
  startupProfiles.forEach((profileId) => {
    syncProfileRefreshStatus(startDocument, profileId, (status) => {
      status.running = true;
      status.activeJobId = activeJobId || status.activeJobId || "";
      status.progress = 1;
      status.message = "Preparing object refresh";
      status.estimatedSecondsRemaining = undefined;
      status.lastStartedAt = startDocument.sync.refreshStatus.lastStartedAt;
      status.lastError = "";
    });
  });
  studioStore.flushDocument(startDocument, { markSavedAt: false });

  try {
    const latest = studioStore.getLiveDocument();
    const tableIds = getObjectTableIds(latest, objectId);
    const affectedProfiles = getProfilesForTableIds(latest, tableIds);
    const nextDocument = latest;
    const totalTables = Math.max(tableIds.length, 1);
    const startedAt = Date.now();
    let totalRows = 0;
    const profilesToTrack = affectedProfiles;

    const updateDocumentProgress = (
      progress: number,
      message: string,
      extras?: { tableCount?: number; rowCount?: number; estimatedSecondsRemaining?: number }
    ) => {
      persistRefreshProgress(nextDocument, progress, message, profilesToTrack, {
        estimatedSecondsRemaining: extras?.estimatedSecondsRemaining,
        rowCount: extras?.rowCount,
        tableIds: Array.from(new Set([
          ...(nextDocument.sync.refreshStatus.cachedTableIds || []),
          ...tableIds
        ]))
      });
      onProgress?.(progress, message, extras);
    };

    updateDocumentProgress(4, "Preparing object refresh", { tableCount: tableIds.length, rowCount: 0 });
    for (const [index, tableId] of tableIds.entries()) {
      const table = getTable(nextDocument, tableId);
      if (!table) continue;
      const startedTables = index;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const estimatedSecondsRemaining = startedTables > 0
        ? Math.max(0, Math.round((elapsedSeconds / startedTables) * (tableIds.length - startedTables)))
        : undefined;
      updateDocumentProgress(5 + Math.round((index / totalTables) * 80), `Refreshing ${table.name}`, {
        tableCount: tableIds.length,
        rowCount: totalRows,
        estimatedSecondsRemaining
      });
      const rows = await fetchAllTableRows(nextDocument, table, ({ loadedRows, message }) => {
        const tableShare = 80 / totalTables;
        const withinTable = Math.min(0.92, loadedRows / Math.max(loadedRows + 10000, 1));
        updateDocumentProgress(
          5 + Math.round((index / totalTables) * 80 + tableShare * withinTable),
          message,
          {
            tableCount: tableIds.length,
            rowCount: totalRows + loadedRows
          }
        );
      }, { objectId });
      nextDocument.bundle.data[tableId] = rows;
      studioStore.touchCacheEntry(tableId, rows.length);
      totalRows += rows.length;
      const completedTables = index + 1;
      const elapsedAfterTable = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const remainingTables = tableIds.length - completedTables;
      const tableEta = remainingTables > 0
        ? Math.max(0, Math.round((elapsedAfterTable / completedTables) * remainingTables))
        : 0;
      updateDocumentProgress(5 + Math.round((completedTables / totalTables) * 80), `Refreshed ${table.name}`, {
        tableCount: tableIds.length,
        rowCount: totalRows,
        estimatedSecondsRemaining: tableEta
      });
    }

    nextDocument.sync.refreshStatus.running = false;
    nextDocument.sync.refreshStatus.activeJobId = "";
    nextDocument.sync.refreshStatus.progress = 100;
    nextDocument.sync.refreshStatus.message = "Object refresh complete";
    nextDocument.sync.refreshStatus.estimatedSecondsRemaining = 0;
    nextDocument.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    nextDocument.sync.refreshStatus.lastSuccessAt = nextDocument.sync.refreshStatus.lastCompletedAt;
    nextDocument.sync.refreshStatus.lastError = "";
    nextDocument.sync.refreshStatus.cachedTableIds = Array.from(new Set([
      ...(nextDocument.sync.refreshStatus.cachedTableIds || []),
      ...tableIds
    ]));
    nextDocument.sync.refreshStatus.cachedRowCount = Object.values(nextDocument.bundle.data || {}).reduce((sum, rows) => sum + rows.length, 0);

    affectedProfiles.forEach((profileId) => {
      syncProfileRefreshStatus(nextDocument, profileId, (status) => {
        status.running = false;
        status.activeJobId = "";
        status.progress = 100;
        status.message = "Object refresh complete";
        status.estimatedSecondsRemaining = 0;
        status.lastCompletedAt = nextDocument.sync.refreshStatus.lastCompletedAt;
        status.lastSuccessAt = nextDocument.sync.refreshStatus.lastSuccessAt;
        status.lastError = "";
        status.cachedTableIds = Array.from(new Set([...(status.cachedTableIds || []), ...tableIds.filter((tableId) => getTable(nextDocument, tableId)?.quickbaseProfileId === profileId)]));
        status.cachedRowCount = status.cachedTableIds.reduce((sum, tableId) => sum + (nextDocument.bundle.data[tableId]?.length || 0), 0);
      });
    });

    studioStore.touchCacheEntriesFromDocument(nextDocument, tableIds, nextDocument.sync.refreshStatus.lastSuccessAt);
    updateRefreshScheduleMetadata(nextDocument);
    updateLegacyActiveQuickbase(nextDocument);
    studioStore.flushDocument(nextDocument, { markSavedAt: false });
    onProgress?.(100, "Object refresh complete", { tableCount: tableIds.length, rowCount: totalRows });
    return {
      ok: true,
      reason: "manual" as const,
      tableCount: tableIds.length,
      rowCount: totalRows,
      document: studioStore.getDocument()
    };
  } catch (error) {
    const failed = studioStore.getLiveDocument();
    failed.sync.refreshStatus.running = false;
    failed.sync.refreshStatus.activeJobId = "";
    failed.sync.refreshStatus.message = error instanceof Error ? error.message : "Object refresh failed.";
    failed.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    failed.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    failed.sync.refreshStatus.lastError = error instanceof Error ? error.message : "Object refresh failed.";
    updateRefreshScheduleMetadata(failed);
    updateLegacyActiveQuickbase(failed);
    studioStore.flushDocument(failed, { markSavedAt: false });
    throw error;
  }
}

let schedulerStarted = false;

export function startRefreshScheduler(logger?: FastifyBaseLogger) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(async () => {
    await studioStore.hydrateFromQuickbase();
    const document = studioStore.getLiveDocument();
    updateRefreshScheduleMetadata(document);
    updateLegacyActiveQuickbase(document);
    studioStore.flushDocument(document, { markSavedAt: false });
    const now = new Date();
    for (const profile of document.quickbaseProfiles || []) {
      const schedule = profile.refreshSchedule;
      if (!schedule.enabled || document.sync.refreshStatus.running || profile.refreshStatus.running || !isScheduleDue(schedule, profile.refreshStatus.nextRunAt, now)) {
        continue;
      }
      const lastSuccessAt = profile.refreshStatus.lastSuccessAt ? new Date(profile.refreshStatus.lastSuccessAt) : null;
      if (lastSuccessAt && scheduleWindowKey(schedule, lastSuccessAt) === scheduleWindowKey(schedule, now)) {
        continue;
      }
      try {
        logger?.info({ profileId: profile.id }, "Starting scheduled app refresh");
        const job = refreshJobStore.createJob("scheduled", async ({ jobId, update }) => {
          await refreshAllCachedDataWithProgress("scheduled", (progress, message, extras) => update(progress, message, extras), profile.id, jobId);
        });
        logger?.info({ profileId: profile.id }, "Scheduled app refresh queued");
      } catch (error) {
        logger?.error(error, "Scheduled refresh failed");
      }
      break;
    }
  }, REFRESH_CHECK_INTERVAL_MS).unref();
}
