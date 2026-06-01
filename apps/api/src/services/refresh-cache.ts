import type { FastifyBaseLogger } from "fastify";
import type { DataRow, RefreshJobStatus, RefreshScheduleConfig, ReportDefinition, StudioDocument, TableDefinition } from "@studio/shared";
import { loadQuickbaseSchema } from "./quickbase-schema.js";
import { convertQuickbaseSchemaToTables, fetchQuickbaseSavedReportPage, fetchQuickbaseTablePage } from "./quickbase-storage.js";
import { replaceSourceRecords } from "./eav-record-store.js";
import { invalidateSourceCaches } from "./report-runner.js";
import { studioStore } from "./studio-store.js";
import { RefreshCancelledError, refreshJobStore } from "./refresh-jobs.js";

const REFRESH_CHECK_INTERVAL_MS = 60_000;

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function persistQuickbaseRowsToEnterpriseStore(
  document: StudioDocument,
  table: TableDefinition,
  rows: DataRow[],
  metadata: Record<string, unknown> = {}
) {
  await replaceSourceRecords({
    sourceId: table.id,
    sourceName: table.name || table.quickbaseTableId || table.id,
    sourceType: "quickbase",
    fields: table.fields || [],
    rows,
    quickbaseProfileId: table.quickbaseProfileId || "",
    quickbaseTableId: getQuickbaseTableId(table),
    quickbaseReportId: getSavedReportIdForTable(document, table),
    metadata: {
      quickbaseAppId: table.quickbaseAppId || "",
      ...metadata
    }
  });
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
  return Array.from(ids).filter((tableId) => Boolean(tableId) && isQuickbaseRefreshableTable(document, tableId));
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
  return Array.from(ids).filter((tableId) => isQuickbaseRefreshableTable(document, tableId));
}

function getTable(document: StudioDocument, tableId: string) {
  return document.bundle.tables.find((table) => table.id === tableId || table.quickbaseTableId === tableId);
}

function extractQuickbaseTableId(tableId: string) {
  const trimmed = String(tableId || "").trim();
  if (!trimmed) return "";
  const [, quickbaseTableId = trimmed] = trimmed.split(":");
  return quickbaseTableId || trimmed;
}

function inferQuickbaseProfileIdForTable(document: StudioDocument, tableId: string) {
  const existing = getTable(document, tableId);
  if (existing?.quickbaseProfileId) return existing.quickbaseProfileId;
  const quickbaseTableId = extractQuickbaseTableId(tableId);
  const sourceAppIdMatch = String(tableId || "").match(/^app-([^:]+):/i);
  const sourceAppId = String(sourceAppIdMatch?.[1] || "").trim().toLowerCase();
  const matchingProfile = document.quickbaseProfiles.find((profile) =>
    String(profile.quickbase.appId || "").trim().toLowerCase() === sourceAppId
  );
  if (matchingProfile?.id) return matchingProfile.id;
  const profileFromReports = Object.values(document.bundle.objects || {}).find((object) =>
    object.type === "report"
      && (object.sourceTableId === tableId || extractQuickbaseTableId(object.sourceTableId) === quickbaseTableId)
  );
  if (profileFromReports?.type === "report") {
    const reportTable = getTable(document, profileFromReports.sourceTableId);
    if (reportTable?.quickbaseProfileId) return reportTable.quickbaseProfileId;
  }
  if (document.quickbaseProfiles.length === 1) {
    return document.quickbaseProfiles[0]?.id || "";
  }
  return "";
}

function buildSyntheticRefreshTable(document: StudioDocument, tableId: string) {
  const quickbaseTableId = extractQuickbaseTableId(tableId);
  const quickbaseProfileId = inferQuickbaseProfileIdForTable(document, tableId);
  const profile = document.quickbaseProfiles.find((item) => item.id === quickbaseProfileId);
  if (!profile || !quickbaseTableId) return null;
  return {
    id: tableId,
    name: quickbaseTableId,
    description: "Synthesized refresh table definition",
    quickbaseProfileId,
    quickbaseTableId,
    quickbaseAppId: profile.quickbase.appId,
    fields: []
  } satisfies TableDefinition;
}

function resolveRefreshTable(document: StudioDocument, tableId: string) {
  return getTable(document, tableId) || buildSyntheticRefreshTable(document, tableId);
}

function getQuickbaseConfigForTable(document: StudioDocument, table: TableDefinition) {
  const profileId = table.quickbaseProfileId || "";
  const profile = profileId ? document.quickbaseProfiles.find((item) => item.id === profileId) : null;
  return profile?.quickbase || document.quickbase;
}

function getQuickbaseTableId(table: TableDefinition) {
  return table.quickbaseTableId || table.id;
}

function isQuickbaseRefreshableTable(document: StudioDocument, tableId: string) {
  const table = resolveRefreshTable(document, tableId);
  if (!table) return false;
  const quickbase = getQuickbaseConfigForTable(document, table);
  return Boolean(
    String(table.quickbaseTableId || "").trim()
    && String(quickbase.realmHostname || "").trim()
    && String(quickbase.userToken || "").trim()
    && String(quickbase.appId || "").trim()
  );
}

function getUsedTableIdsForProfile(document: StudioDocument, profileId: string) {
  return getUsedTableIds(document).filter((tableId) => {
    const table = resolveRefreshTable(document, tableId);
    return table?.quickbaseProfileId === profileId && isQuickbaseRefreshableTable(document, tableId);
  });
}

function getRefreshTableIdsForProfile(document: StudioDocument, profileId: string) {
  const profile = document.quickbaseProfiles.find((item) => item.id === profileId);
  const configured = Array.isArray(profile?.refreshSource?.tableIds) ? profile.refreshSource.tableIds.filter(Boolean) : [];
  const configuredFromReportIds = Object.keys(profile?.refreshSource?.reportIds || {}).filter(Boolean);
  const preferred = configured.length ? configured : configuredFromReportIds;
  if (!preferred.length) {
    return getUsedTableIdsForProfile(document, profileId);
  }
  return Array.from(new Set(
    preferred.map((tableId) => resolveRefreshTable(document, tableId)?.id || tableId)
  )).filter((tableId) => {
    const table = resolveRefreshTable(document, tableId);
    return table?.quickbaseProfileId === profileId && isQuickbaseRefreshableTable(document, tableId);
  });
}

function hasRosterConfig(profile: StudioDocument["quickbaseProfiles"][number]) {
  const config = profile.quickbase;
  return Boolean(
    String(config.rosterTableId || "").trim()
    && String(config.rosterUserIdFieldId || "").trim()
    && String(config.rosterEmployeeNameFieldId || "").trim()
    && String(config.rosterEmployeeEmailFieldId || "").trim()
  );
}

async function loadRosterRowsForProfiles(
  profiles: StudioDocument["quickbaseProfiles"],
  onProgress?: (message: string, rowCount: number) => void
) {
  let totalRows = 0;
  for (const profile of profiles) {
    if (!hasRosterConfig(profile)) continue;
    const config = profile.quickbase;
    const fieldIds = [
      config.rosterUserIdFieldId,
      config.rosterEmployeeNameFieldId,
      config.rosterEmployeeEmailFieldId,
      config.rosterEmployeeRecordIdFieldId
    ].filter(Boolean);
    let skip = 0;
    while (true) {
      const page = await fetchQuickbaseTablePage(config, config.rosterTableId, fieldIds, {
        top: 1000,
        skip
      });
      totalRows += page.rows.length;
      onProgress?.(`Loaded roster: ${totalRows.toLocaleString()} users`, totalRows);
      if (page.rows.length < 1000) break;
      skip += page.rows.length;
    }
  }
  return totalRows;
}

function getSavedReportIdForTable(document: StudioDocument, table: TableDefinition) {
  const profileId = table.quickbaseProfileId || "";
  if (!profileId) return "";
  const profile = document.quickbaseProfiles.find((item) => item.id === profileId);
  const tableKeys = [getQuickbaseTableId(table), table.id].filter(Boolean);
  for (const key of tableKeys) {
    const value = String(profile?.refreshSource?.reportIds?.[key] || "").trim();
    if (value) return value;
  }
  return "";
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
      .map((tableId) => resolveRefreshTable(document, tableId)?.quickbaseProfileId || "")
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
  totalRowsHint?: number | null;
  currentBatchSize?: number;
  rowsPerSecond?: number;
  message: string;
};

function estimateRefreshProgress(
  index: number,
  totalTables: number,
  tableProgress: TableRefreshProgress,
  totalRowsSoFar: number,
  elapsedSinceRefreshStartSeconds: number
) {
  const tableShare = 80 / totalTables;
  const hintedTotal = typeof tableProgress.totalRowsHint === "number" && tableProgress.totalRowsHint > 0
    ? tableProgress.totalRowsHint
    : null;
  const withinTable = hintedTotal
    ? Math.min(0.96, tableProgress.loadedRows / Math.max(hintedTotal, 1))
    : Math.min(0.92, tableProgress.loadedRows / Math.max(tableProgress.loadedRows + 10000, 1));
  const perCompletedTableSeconds = index > 0 ? elapsedSinceRefreshStartSeconds / index : 0;
  const remainingTablesAfterCurrent = Math.max(0, totalTables - index - 1);
  const currentTableEta = hintedTotal && tableProgress.rowsPerSecond
    ? Math.max(0, Math.round((hintedTotal - tableProgress.loadedRows) / Math.max(tableProgress.rowsPerSecond, 1)))
    : undefined;
  const estimatedSecondsRemaining = currentTableEta !== undefined
    ? currentTableEta + Math.round((perCompletedTableSeconds || currentTableEta) * remainingTablesAfterCurrent)
    : undefined;

  return {
    progress: 5 + Math.round((index / totalTables) * 80 + tableShare * withinTable),
    rowCount: totalRowsSoFar + tableProgress.loadedRows,
    estimatedSecondsRemaining
  };
}

function savedReportRowSignature(row: DataRow) {
  const recordId = String(row.__recordId || "").trim();
  if (recordId) return `rid:${recordId}`;
  const entries = Object.entries(row)
    .filter(([key]) => key !== "__recordId")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value ?? "")}`);
  return entries.join("|");
}

function savedReportPageSignature(rows: DataRow[]) {
  if (!rows.length) return "empty";
  return JSON.stringify({
    length: rows.length,
    first: rows.slice(0, 3).map(savedReportRowSignature),
    last: rows.slice(-3).map(savedReportRowSignature)
  });
}

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
  // Skip rewriting the large row cache on every progress tick — rows are in Postgres.
  // The cache file is written once at the end of a successful refresh.
  studioStore.flushDocument(document, { markSavedAt: false, skipCacheWrite: true });
}

function getTrackedRefreshStatuses(document: StudioDocument, profileIds: string[] = []) {
  const statuses = [document.sync.refreshStatus];
  profileIds.forEach((profileId) => {
    const profile = document.quickbaseProfiles.find((item) => item.id === profileId);
    if (profile) statuses.push(profile.refreshStatus);
  });
  return statuses;
}

function markRefreshAsRunning(document: StudioDocument, activeJobId: string, message: string, profileIds: string[] = []) {
  getTrackedRefreshStatuses(document, profileIds).forEach((status) => {
    status.running = true;
    status.activeJobId = activeJobId;
    status.cancelRequested = false;
    status.progress = Math.max(status.progress || 0, 1);
    status.message = message;
    status.estimatedSecondsRemaining = undefined;
    status.lastStartedAt = new Date().toISOString();
    status.lastError = "";
  });
}

function markRefreshAsCancelled(document: StudioDocument, jobId: string, message = "Refresh cancelled.", profileIds: string[] = []) {
  const cancelledAt = new Date().toISOString();
  getTrackedRefreshStatuses(document, profileIds).forEach((status) => {
    if (status.activeJobId && status.activeJobId !== jobId && status.running) return;
    status.running = false;
    status.cancelRequested = false;
    status.activeJobId = "";
    status.message = message;
    status.estimatedSecondsRemaining = 0;
    status.lastCompletedAt = cancelledAt;
    status.lastCancelledAt = cancelledAt;
    status.lastError = "";
  });
}

function clearStaleRunningRefresh(document: StudioDocument, jobId: string, message = "Previous refresh ended unexpectedly.") {
  const completedAt = new Date().toISOString();
  const statuses = [
    document.sync.refreshStatus,
    ...document.quickbaseProfiles.map((profile) => profile.refreshStatus)
  ];
  let changed = false;
  statuses.forEach((status) => {
    if (!status.running) return;
    if (status.activeJobId && status.activeJobId !== jobId) return;
    status.running = false;
    status.cancelRequested = false;
    status.activeJobId = "";
    status.message = message;
    status.estimatedSecondsRemaining = 0;
    status.lastCompletedAt = completedAt;
    status.lastError = message;
    changed = true;
  });
  if (changed) {
    studioStore.flushDocument(document, { markSavedAt: false });
  }
  return changed;
}

function getPersistedRefreshStatus(jobId?: string): RefreshJobStatus | null {
  const document = studioStore.getLiveDocument();
  const statuses = [
    document.sync.refreshStatus,
    ...document.quickbaseProfiles.map((profile) => profile.refreshStatus)
  ];
  const runningStatus = statuses.find((status) => status.running && (!jobId || !status.activeJobId || status.activeJobId === jobId));
  const status = runningStatus || statuses.find((item) => item.lastStartedAt || item.lastCompletedAt || item.lastCancelledAt) || null;
  if (!status) return null;
  const effectiveJobId = jobId || status.activeJobId || randomJobFallbackId(status);
  if (!effectiveJobId) return null;
  if (status.cancelRequested) {
    return {
      id: effectiveJobId,
      status: "cancelled",
      progress: Math.max(status.progress || 1, 1),
      message: status.message || "Cancelling refresh…",
      reason: "manual",
      createdAt: status.lastStartedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: status.lastStartedAt || undefined,
      completedAt: status.lastCancelledAt || undefined,
      estimatedSecondsRemaining: 0,
      tableCount: status.cachedTableIds?.length || undefined,
      rowCount: status.cachedRowCount || undefined
    };
  }
  if (status.running) {
    return {
      id: effectiveJobId,
      status: "running",
      progress: status.progress || 0,
      message: status.message || "Refreshing…",
      reason: "manual",
      createdAt: status.lastStartedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: status.lastStartedAt || undefined,
      estimatedSecondsRemaining: status.estimatedSecondsRemaining,
      tableCount: status.cachedTableIds?.length || undefined,
      rowCount: status.cachedRowCount || undefined
    };
  }
  const terminalStatus: RefreshJobStatus["status"] = status.lastCancelledAt
    ? "cancelled"
    : (status.lastError ? "failed" : "complete");
  return {
    id: effectiveJobId,
    status: terminalStatus,
    progress: terminalStatus === "failed" ? Math.max(status.progress || 1, 1) : 100,
    message: status.message || (terminalStatus === "cancelled" ? "Refresh cancelled." : terminalStatus === "failed" ? "Refresh failed." : "Refresh complete"),
    error: status.lastError || undefined,
    reason: "manual",
    createdAt: status.lastStartedAt || status.lastCompletedAt || status.lastCancelledAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: status.lastStartedAt || undefined,
    completedAt: status.lastCompletedAt || status.lastCancelledAt || undefined,
    estimatedSecondsRemaining: terminalStatus === "complete" || terminalStatus === "cancelled" ? 0 : status.estimatedSecondsRemaining,
    tableCount: status.cachedTableIds?.length || undefined,
    rowCount: status.cachedRowCount || undefined
  };
}

function randomJobFallbackId(status: StudioDocument["sync"]["refreshStatus"]) {
  const stamp = status.lastStartedAt || status.lastCompletedAt || status.lastCancelledAt || "";
  return stamp ? `persisted-${stamp}` : "";
}

async function ensureQuickbaseTablesLoaded(document: StudioDocument, profileIds: string[] = []) {
  const targetProfiles = (profileIds.length
    ? document.quickbaseProfiles.filter((profile) => profileIds.includes(profile.id))
    : document.quickbaseProfiles
  ).filter((profile) =>
    Boolean(
      String(profile.quickbase.realmHostname || "").trim()
      && String(profile.quickbase.userToken || "").trim()
      && String(profile.quickbase.appId || "").trim()
    )
  );

  if (!targetProfiles.length) return document;

  let changed = false;
  for (const profile of targetProfiles) {
    const currentTables = document.bundle.tables.filter((table) => table.quickbaseProfileId === profile.id);
    const referencedTableIds = new Set([
      ...(profile.refreshSource?.tableIds || []),
      ...Object.keys(profile.refreshSource?.reportIds || {})
    ].filter(Boolean));
    const hasAllReferencedTables = Array.from(referencedTableIds).every((tableId) => Boolean(getTable(document, tableId)));
    if (currentTables.length > 0 && hasAllReferencedTables) {
      continue;
    }
    const schema = await loadQuickbaseSchema({
      realmHostname: profile.quickbase.realmHostname,
      userToken: profile.quickbase.userToken,
      appToken: profile.quickbase.appToken,
      appId: profile.quickbase.appId
    }).catch(() => null);
    if (!schema) continue;
    const loadedTables = convertQuickbaseSchemaToTables(schema, profile.id, profile.quickbase.appId);
    if (!loadedTables.length) continue;
    document.bundle.tables = [
      ...document.bundle.tables.filter((table) => table.quickbaseProfileId !== profile.id),
      ...loadedTables
    ];
    document.bundle.data = {
      ...document.bundle.data,
      ...Object.fromEntries(loadedTables.map((table) => [table.id, document.bundle.data[table.id] || document.bundle.data[table.quickbaseTableId || ""] || []]))
    };
    changed = true;
  }
  if (changed) {
    studioStore.flushDocument(document, { markSavedAt: false });
  }
  return document;
}

function assertRefreshNotCancelled(jobId: string, profileIds: string[] = []) {
  if (!jobId) return;
  const document = studioStore.getLiveDocument();
  const statuses = getTrackedRefreshStatuses(document, profileIds);
  const matching = statuses.filter((status) => !status.activeJobId || status.activeJobId === jobId);
  if (matching.some((status) => status.cancelRequested)) {
    throw new RefreshCancelledError();
  }
}

export async function primeRefreshJob(jobId: string, options: { objectId?: string; profileId?: string; message?: string } = {}) {
  const document = studioStore.getLiveDocument();
  const tableIds = options.objectId ? getObjectTableIds(document, options.objectId) : (
    options.profileId ? getRefreshTableIdsForProfile(document, options.profileId) : getUsedTableIds(document)
  );
  const profileIds = options.profileId
    ? [options.profileId]
    : (getProfilesForTableIds(document, tableIds).length ? getProfilesForTableIds(document, tableIds) : document.quickbaseProfiles.map((profile) => profile.id));
  markRefreshAsRunning(
    document,
    jobId,
    options.message || (options.objectId ? "Preparing object refresh" : "Preparing refresh"),
    profileIds
  );
  studioStore.flushDocument(document, { markSavedAt: false });
  return getPersistedRefreshStatus(jobId);
}

export async function cancelRefreshJob(jobId: string, message = "Cancelling refresh…") {
  const document = studioStore.getLiveDocument();
  const statuses = [
    document.sync.refreshStatus,
    ...document.quickbaseProfiles.map((profile) => profile.refreshStatus)
  ];
  let matched = false;
  statuses.forEach((status) => {
    if (!status.running) return;
    if (status.activeJobId && status.activeJobId !== jobId) return;
    status.cancelRequested = true;
    status.message = message;
    matched = true;
  });
  const cancelled = refreshJobStore.cancelJob(jobId, message);
  if (!matched) {
    if (cancelled) return cancelled;
    return getPersistedRefreshStatus(jobId);
  }
  studioStore.flushDocument(document, { markSavedAt: false });
  return cancelled || getPersistedRefreshStatus(jobId);
}

export function getTrackedRefreshJob(jobId: string) {
  const inMemory = refreshJobStore.getJob(jobId);
  const persisted = getPersistedRefreshStatus(jobId) || getPersistedRefreshStatus();
  return inMemory || persisted;
}

export function getActiveRefreshJob() {
  const document = studioStore.getLiveDocument();
  const activeJobId =
    document.sync.refreshStatus.activeJobId
    || document.quickbaseProfiles.find((profile) => profile.refreshStatus.activeJobId)?.refreshStatus.activeJobId
    || "";
  if (!activeJobId) return null;
  const inMemory = refreshJobStore.getJob(activeJobId);
  if (!inMemory) {
    clearStaleRunningRefresh(document, activeJobId);
    return null;
  }
  return getTrackedRefreshJob(activeJobId);
}

async function fetchAllTableRows(
  document: StudioDocument,
  table: TableDefinition,
  onProgress?: (progress: TableRefreshProgress) => void,
  options: { objectId?: string; activeJobId?: string } = {}
) {
  const quickbase = getQuickbaseConfigForTable(document, table);
  const tableStartedAt = Date.now();
  const savedReportId = (options.objectId ? getObjectOverrideReportIdForTable(document, options.objectId, table) : "") || getSavedReportIdForTable(document, table);
  const profileIds = table.quickbaseProfileId ? [table.quickbaseProfileId] : [];
  const hasQuickbaseSource = Boolean(
    String(table.quickbaseTableId || "").trim()
    && String(quickbase.realmHostname || "").trim()
    && String(quickbase.userToken || "").trim()
    && String(quickbase.appId || "").trim()
  );
  if (savedReportId) {
    const pageSize = 1000;
    let skip = 0;
    const merged = new Map<string, DataRow>();
    let fetchedPages = 0;
    let previousPageSignature = "";
    let totalRowsHint: number | null = null;
    while (true) {
      assertRefreshNotCancelled(options.activeJobId || "", profileIds);
      const page = await fetchQuickbaseSavedReportPage(quickbase, getQuickbaseTableId(table), savedReportId, {
        top: pageSize,
        skip
      });
      if (!page.rows.length && skip === 0) {
        throw new Error(`Quickbase source report ${savedReportId} returned 0 rows for ${table.name}. Check that QID ${savedReportId} belongs to table ${getQuickbaseTableId(table)} and that the report has records for this user.`);
      }
      if (!page.rows.length) break;
      fetchedPages += 1;
      const beforeSize = merged.size;
      if (typeof page.totalRecords === "number" && page.totalRecords > 0) {
        totalRowsHint = page.totalRecords;
      }
      page.rows.forEach((row, rowIndex) => {
        const recordId = String(row.__recordId || "").trim();
        const mergedKey = recordId || `offset:${skip + rowIndex}`;
        const existing = merged.get(mergedKey) || { __recordId: recordId };
        Object.assign(existing, row);
        merged.set(mergedKey, existing);
      });
      document.bundle.data[table.id] = Array.from(merged.values());
      studioStore.touchCacheEntry(table.id, merged.size);
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - tableStartedAt) / 1000));
      const rowsPerSecond = merged.size / elapsedSeconds;
      onProgress?.({
        loadedRows: merged.size,
        fetchedPages,
        totalRowsHint,
        currentBatchSize: page.rows.length,
        rowsPerSecond,
        message: totalRowsHint
          ? `Syncing ${table.name}: ${merged.size.toLocaleString()} of ${totalRowsHint.toLocaleString()} rows`
          : `Syncing ${table.name}: ${merged.size.toLocaleString()} rows`
      });
      const currentPageSignature = savedReportPageSignature(page.rows);
      if (page.rows.length < pageSize) break;
      if (merged.size === beforeSize || currentPageSignature === previousPageSignature) {
        throw new Error(`Data sync stalled on the same page for ${table.name}. Check the saved report configuration in Settings and try again.`);
      }
      previousPageSignature = currentPageSignature;
      skip += page.rows.length;
    }
    return Array.from(merged.values());
  }
  if (hasQuickbaseSource) {
    const tableLabel = table.name || table.quickbaseTableId || table.id;
    throw new Error(
      options.objectId
        ? `No saved report ID is configured for "${tableLabel}". Go to Settings → Data Refresh to add one.`
        : `No saved report ID is configured for "${tableLabel}". Go to Settings → Data Refresh to set it up.`
    );
  }
  const fieldIds = table.fields.map((field) => field.id).filter(Boolean);
  const chunks = chunk(fieldIds, 30);
  const merged = new Map<string, DataRow>();
  let fetchedPages = 0;
  let totalRowsHint: number | null = null;
  for (const fieldChunk of chunks) {
    let skip = 0;
    while (true) {
      assertRefreshNotCancelled(options.activeJobId || "", profileIds);
      const page = await fetchQuickbaseTablePage(quickbase, getQuickbaseTableId(table), fieldChunk, {
        top: 1000,
        skip
      });
      if (!page.rows.length) break;
      if (typeof page.totalRecords === "number" && page.totalRecords > 0) {
        totalRowsHint = page.totalRecords;
      }
      page.rows.forEach((row) => {
        const recordId = String(row.__recordId || "");
        const existing = merged.get(recordId) || { __recordId: recordId };
        Object.assign(existing, row);
        merged.set(recordId, existing);
      });
      document.bundle.data[table.id] = Array.from(merged.values());
      studioStore.touchCacheEntry(table.id, merged.size);
      fetchedPages += 1;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - tableStartedAt) / 1000));
      onProgress?.({
        loadedRows: merged.size,
        fetchedPages,
        totalRowsHint,
        currentBatchSize: page.rows.length,
        rowsPerSecond: merged.size / elapsedSeconds,
        message: totalRowsHint
          ? `Syncing ${table.name}: ${merged.size.toLocaleString()} of ${totalRowsHint.toLocaleString()} rows`
          : `Syncing ${table.name}: ${merged.size.toLocaleString()} rows`
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
  await ensureQuickbaseTablesLoaded(document);
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
  await persistQuickbaseRowsToEnterpriseStore(document, table, rows, {
    trigger: "ensure-table-rows-available",
    objectId: options.objectId || ""
  });
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
  await ensureQuickbaseTablesLoaded(startDocument, profileId ? [profileId] : []);
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
    if (!tableIds.length) {
      throw new Error(profileId
        ? "No data tables are selected for this connection. Go to Settings → Data Refresh to choose which tables to sync."
        : "No data sources are configured yet. Go to Settings → Connect Quickbase to set up a data connection.");
    }
    const nextDocument = latest;
    let totalRows = 0;
    for (const tableId of tableIds) {
      const table = resolveRefreshTable(nextDocument, tableId);
      if (!table) continue;
      const rows = await fetchAllTableRows(nextDocument, table);
      nextDocument.bundle.data[tableId] = rows;
      await persistQuickbaseRowsToEnterpriseStore(nextDocument, table, rows, {
        trigger: "refresh-all",
        reason,
        profileId
      });
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
  const initialDocument = studioStore.getLiveDocument();
  const initialProfileIds = profileId ? [profileId] : initialDocument.quickbaseProfiles.map((profile) => profile.id);
  markRefreshAsRunning(initialDocument, activeJobId || initialDocument.sync.refreshStatus.activeJobId || "", "Preparing refresh", initialProfileIds);
  studioStore.flushDocument(initialDocument, { markSavedAt: false });
  onProgress?.(1, "Preparing refresh", { tableCount: 0, rowCount: 0 });
  try {
    await studioStore.hydrateFromQuickbase(true);
    const startDocument = studioStore.getLiveDocument();
    await ensureQuickbaseTablesLoaded(startDocument, profileId ? [profileId] : []);
    updateRefreshScheduleMetadata(startDocument);
    updateLegacyActiveQuickbase(startDocument);
    startDocument.sync.refreshStatus.running = true;
    startDocument.sync.refreshStatus.activeJobId = activeJobId || startDocument.sync.refreshStatus.activeJobId || "";
    startDocument.sync.refreshStatus.cancelRequested = false;
    startDocument.sync.refreshStatus.progress = 1;
    startDocument.sync.refreshStatus.message = "Preparing refresh";
    startDocument.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    startDocument.sync.refreshStatus.lastStartedAt = new Date().toISOString();
    startDocument.sync.refreshStatus.lastCancelledAt = "";
    startDocument.sync.refreshStatus.lastError = "";
    const startupProfiles = profileId
      ? startDocument.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : startDocument.quickbaseProfiles;
    startupProfiles.forEach((profile) => {
      profile.refreshStatus.running = true;
      profile.refreshStatus.activeJobId = activeJobId || profile.refreshStatus.activeJobId || "";
      profile.refreshStatus.cancelRequested = false;
      profile.refreshStatus.progress = 1;
      profile.refreshStatus.message = "Preparing refresh";
      profile.refreshStatus.estimatedSecondsRemaining = undefined;
      profile.refreshStatus.lastStartedAt = startDocument.sync.refreshStatus.lastStartedAt;
      profile.refreshStatus.lastCancelledAt = "";
      profile.refreshStatus.lastError = "";
    });
    studioStore.flushDocument(startDocument, { markSavedAt: false });

    const rosterProfiles = profileId
      ? startDocument.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : startDocument.quickbaseProfiles;
    await loadRosterRowsForProfiles(rosterProfiles, (message) => {
      onProgress?.(3, message, { tableCount: 0, rowCount: 0 });
    });

    const latest = studioStore.getLiveDocument();
    const profileTableIds = profileId
      ? getRefreshTableIdsForProfile(latest, profileId)
      : latest.quickbaseProfiles.flatMap((profile) => getRefreshTableIdsForProfile(latest, profile.id));
    const tableIds = Array.from(new Set((profileTableIds.length ? profileTableIds : getUsedTableIds(latest)).filter(Boolean)));
    if (!tableIds.length) {
      throw new Error(profileId
        ? "No data tables are selected for this connection. Go to Settings → Data Refresh to choose which tables to sync."
        : "No data sources are configured yet. Go to Settings → Connect Quickbase to set up a data connection.");
    }
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
      const table = resolveRefreshTable(nextDocument, tableId);
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
      const rows = await fetchAllTableRows(nextDocument, table, (tableProgress) => {
        const elapsedSinceRefreshStartSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const progress = estimateRefreshProgress(index, totalTables, tableProgress, totalRows, elapsedSinceRefreshStartSeconds);
        updateDocumentProgress(progress.progress, tableProgress.message, {
          tableCount: tableIds.length,
          rowCount: progress.rowCount,
          estimatedSecondsRemaining: progress.estimatedSecondsRemaining
        });
      }, { activeJobId });
      nextDocument.bundle.data[tableId] = rows;
      await persistQuickbaseRowsToEnterpriseStore(nextDocument, table, rows, {
        trigger: "refresh-all-progress",
        reason,
        profileId,
        activeJobId
      });
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
    nextDocument.sync.refreshStatus.cancelRequested = false;
    nextDocument.sync.refreshStatus.progress = 100;
    nextDocument.sync.refreshStatus.message = "Refresh complete";
    nextDocument.sync.refreshStatus.estimatedSecondsRemaining = 0;
    nextDocument.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    nextDocument.sync.refreshStatus.lastCancelledAt = "";
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
        status.cancelRequested = false;
        status.progress = 100;
        status.message = "Refresh complete";
        status.estimatedSecondsRemaining = 0;
        status.lastCompletedAt = nextDocument.sync.refreshStatus.lastCompletedAt;
        status.lastCancelledAt = "";
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
    // Evict stale report/dashboard cache entries so the new data is served immediately.
    invalidateSourceCaches(...tableIds);
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
    const failedProfilesToUpdate = profileId
      ? failed.quickbaseProfiles.filter((profile) => profile.id === profileId)
      : failed.quickbaseProfiles;
    if (error instanceof RefreshCancelledError) {
      markRefreshAsCancelled(failed, activeJobId || failed.sync.refreshStatus.activeJobId || "", error.message, failedProfilesToUpdate.map((profile) => profile.id));
      updateRefreshScheduleMetadata(failed);
      updateLegacyActiveQuickbase(failed);
      studioStore.flushDocument(failed, { markSavedAt: false });
      throw error;
    }
    failed.sync.refreshStatus.running = false;
    failed.sync.refreshStatus.activeJobId = "";
    failed.sync.refreshStatus.cancelRequested = false;
    failed.sync.refreshStatus.message = error instanceof Error ? error.message : "Refresh failed.";
    failed.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    failed.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    failed.sync.refreshStatus.lastCancelledAt = "";
    failed.sync.refreshStatus.lastError = error instanceof Error ? error.message : "Refresh failed.";
    failedProfilesToUpdate.forEach((profile) => {
      syncProfileRefreshStatus(failed, profile.id, (status) => {
        status.running = false;
        status.activeJobId = "";
        status.cancelRequested = false;
        status.message = failed.sync.refreshStatus.lastError;
        status.estimatedSecondsRemaining = undefined;
        status.lastCompletedAt = failed.sync.refreshStatus.lastCompletedAt;
        status.lastCancelledAt = "";
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
  const initialDocument = studioStore.getLiveDocument();
  const initialProfiles = getProfilesForTableIds(initialDocument, getObjectTableIds(initialDocument, objectId));
  markRefreshAsRunning(initialDocument, activeJobId || initialDocument.sync.refreshStatus.activeJobId || "", "Preparing object refresh", initialProfiles);
  studioStore.flushDocument(initialDocument, { markSavedAt: false });
  onProgress?.(1, "Preparing object refresh", { tableCount: 0, rowCount: 0 });
  try {
    await studioStore.hydrateFromQuickbase(true);
    const startDocument = studioStore.getLiveDocument();
    await ensureQuickbaseTablesLoaded(startDocument);
    updateRefreshScheduleMetadata(startDocument);
    updateLegacyActiveQuickbase(startDocument);
    startDocument.sync.refreshStatus.running = true;
    startDocument.sync.refreshStatus.activeJobId = activeJobId || startDocument.sync.refreshStatus.activeJobId || "";
    startDocument.sync.refreshStatus.cancelRequested = false;
    startDocument.sync.refreshStatus.progress = 1;
    startDocument.sync.refreshStatus.message = "Preparing object refresh";
    startDocument.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    startDocument.sync.refreshStatus.lastStartedAt = new Date().toISOString();
    startDocument.sync.refreshStatus.lastCancelledAt = "";
    startDocument.sync.refreshStatus.lastError = "";
    const startupTableIds = getObjectTableIds(startDocument, objectId);
    const startupProfiles = getProfilesForTableIds(startDocument, startupTableIds);
    startupProfiles.forEach((profileId) => {
      syncProfileRefreshStatus(startDocument, profileId, (status) => {
        status.running = true;
        status.activeJobId = activeJobId || status.activeJobId || "";
        status.cancelRequested = false;
        status.progress = 1;
        status.message = "Preparing object refresh";
        status.estimatedSecondsRemaining = undefined;
        status.lastStartedAt = startDocument.sync.refreshStatus.lastStartedAt;
        status.lastCancelledAt = "";
        status.lastError = "";
      });
    });
    studioStore.flushDocument(startDocument, { markSavedAt: false });

    const latest = studioStore.getLiveDocument();
    const tableIds = getObjectTableIds(latest, objectId);
    if (!tableIds.length) {
      throw new Error("No data tables are configured for this item. Go to Settings → Data Refresh to add them.");
    }
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
      const table = resolveRefreshTable(nextDocument, tableId);
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
      const rows = await fetchAllTableRows(nextDocument, table, (tableProgress) => {
        const elapsedSinceRefreshStartSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const progress = estimateRefreshProgress(index, totalTables, tableProgress, totalRows, elapsedSinceRefreshStartSeconds);
        updateDocumentProgress(progress.progress, tableProgress.message, {
          tableCount: tableIds.length,
          rowCount: progress.rowCount,
          estimatedSecondsRemaining: progress.estimatedSecondsRemaining
        });
      }, { objectId, activeJobId });
      nextDocument.bundle.data[tableId] = rows;
      await persistQuickbaseRowsToEnterpriseStore(nextDocument, table, rows, {
        trigger: "refresh-object-progress",
        objectId,
        activeJobId
      });
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
    nextDocument.sync.refreshStatus.cancelRequested = false;
    nextDocument.sync.refreshStatus.progress = 100;
    nextDocument.sync.refreshStatus.message = "Object refresh complete";
    nextDocument.sync.refreshStatus.estimatedSecondsRemaining = 0;
    nextDocument.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    nextDocument.sync.refreshStatus.lastCancelledAt = "";
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
        status.cancelRequested = false;
        status.progress = 100;
        status.message = "Object refresh complete";
        status.estimatedSecondsRemaining = 0;
        status.lastCompletedAt = nextDocument.sync.refreshStatus.lastCompletedAt;
        status.lastCancelledAt = "";
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
    const affectedProfiles = getProfilesForTableIds(failed, getObjectTableIds(failed, objectId));
    if (error instanceof RefreshCancelledError) {
      markRefreshAsCancelled(failed, activeJobId || failed.sync.refreshStatus.activeJobId || "", error.message, affectedProfiles);
      updateRefreshScheduleMetadata(failed);
      updateLegacyActiveQuickbase(failed);
      studioStore.flushDocument(failed, { markSavedAt: false });
      throw error;
    }
    failed.sync.refreshStatus.running = false;
    failed.sync.refreshStatus.activeJobId = "";
    failed.sync.refreshStatus.cancelRequested = false;
    failed.sync.refreshStatus.message = error instanceof Error ? error.message : "Object refresh failed.";
    failed.sync.refreshStatus.estimatedSecondsRemaining = undefined;
    failed.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    failed.sync.refreshStatus.lastCancelledAt = "";
    failed.sync.refreshStatus.lastError = error instanceof Error ? error.message : "Object refresh failed.";
    updateRefreshScheduleMetadata(failed);
    updateLegacyActiveQuickbase(failed);
    studioStore.flushDocument(failed, { markSavedAt: false });
    throw error;
  }
}

let schedulerStarted = false;

// Exported so pg-boss workers can call it directly.
export async function checkAndTriggerScheduledRefreshes(logger?: FastifyBaseLogger) {
  await studioStore.hydrateFromQuickbase();
  const document = studioStore.getLiveDocument();
  updateRefreshScheduleMetadata(document);
  updateLegacyActiveQuickbase(document);
  studioStore.flushDocument(document, { markSavedAt: false });
  const now = new Date();
  for (const profile of document.quickbaseProfiles || []) {
    const schedule = profile.refreshSchedule;
    if (
      !schedule.enabled ||
      document.sync.refreshStatus.running ||
      profile.refreshStatus.running ||
      !isScheduleDue(schedule, profile.refreshStatus.nextRunAt, now)
    ) {
      continue;
    }
    const lastSuccessAt = profile.refreshStatus.lastSuccessAt
      ? new Date(profile.refreshStatus.lastSuccessAt)
      : null;
    if (lastSuccessAt && scheduleWindowKey(schedule, lastSuccessAt) === scheduleWindowKey(schedule, now)) {
      continue;
    }
    try {
      logger?.info({ profileId: profile.id }, "Starting scheduled data sync");
      refreshJobStore.createJob("scheduled", async ({ jobId, update }) => {
        await refreshAllCachedDataWithProgress(
          "scheduled",
          (progress, message, extras) => update(progress, message, extras),
          profile.id,
          jobId
        );
      });
      logger?.info({ profileId: profile.id }, "Scheduled data sync queued");
    } catch (error) {
      logger?.error(error, "Scheduled data sync failed");
    }
    break;
  }
}

export function startRefreshScheduler(logger?: FastifyBaseLogger, pgBossRunning = false) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  if (pgBossRunning) {
    // Cron scheduling is handled by pg-boss — no in-process fallback needed.
    logger?.info("refresh-scheduler: pg-boss is active, cron scheduling delegated to Postgres");
    return;
  }
  // Fallback for environments without Postgres/pg-boss.
  setInterval(() => {
    checkAndTriggerScheduledRefreshes(logger).catch((err) => {
      logger?.error(err, "refresh-scheduler: schedule check failed");
    });
  }, REFRESH_CHECK_INTERVAL_MS).unref();
  logger?.info({ intervalMs: REFRESH_CHECK_INTERVAL_MS }, "refresh-scheduler: started (in-process fallback)");
}
