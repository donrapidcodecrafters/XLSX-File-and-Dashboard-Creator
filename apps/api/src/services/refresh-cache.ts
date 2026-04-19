import type { FastifyBaseLogger } from "fastify";
import type { DataRow, RefreshScheduleConfig, ReportDefinition, StudioDocument, TableDefinition } from "@studio/shared";
import { fetchQuickbaseTablePage } from "./quickbase-storage.js";
import { studioStore } from "./studio-store.js";

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

function getTable(document: StudioDocument, tableId: string) {
  return document.bundle.tables.find((table) => table.id === tableId);
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

async function fetchAllTableRows(document: StudioDocument, table: TableDefinition) {
  const fieldIds = table.fields.map((field) => field.id).filter(Boolean);
  const chunks = chunk(fieldIds, 30);
  const merged = new Map<string, DataRow>();
  for (const fieldChunk of chunks) {
    let skip = 0;
    while (true) {
      const page = await fetchQuickbaseTablePage(document.quickbase, table.id, fieldChunk, {
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
      if (page.rows.length < 1000) break;
      skip += page.rows.length;
    }
  }
  return Array.from(merged.values());
}

export function updateRefreshScheduleMetadata(document: StudioDocument) {
  document.sync.refreshStatus.nextRunAt = computeNextRunAt(document.sync.refreshSchedule);
}

export async function refreshAllCachedData(reason: "manual" | "scheduled" = "manual") {
  const hydrated = await studioStore.hydrateFromQuickbase(true);
  const startDocument = JSON.parse(JSON.stringify(hydrated)) as StudioDocument;
  updateRefreshScheduleMetadata(startDocument);
  startDocument.sync.refreshStatus.running = true;
  startDocument.sync.refreshStatus.lastStartedAt = new Date().toISOString();
  startDocument.sync.refreshStatus.lastError = "";
  studioStore.saveDocument(startDocument, { markSavedAt: false });

  try {
    const latest = studioStore.getDocument();
    const tableIds = getUsedTableIds(latest);
    const nextDocument = JSON.parse(JSON.stringify(latest)) as StudioDocument;
    let totalRows = 0;
    for (const tableId of tableIds) {
      const table = getTable(nextDocument, tableId);
      if (!table) continue;
      const rows = await fetchAllTableRows(nextDocument, table);
      nextDocument.bundle.data[tableId] = rows;
      totalRows += rows.length;
    }
    nextDocument.sync.refreshStatus.running = false;
    nextDocument.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    nextDocument.sync.refreshStatus.lastSuccessAt = nextDocument.sync.refreshStatus.lastCompletedAt;
    nextDocument.sync.refreshStatus.lastError = "";
    nextDocument.sync.refreshStatus.cachedTableIds = tableIds;
    nextDocument.sync.refreshStatus.cachedRowCount = totalRows;
    updateRefreshScheduleMetadata(nextDocument);
    studioStore.saveDocument(nextDocument, { markSavedAt: false });
    return {
      ok: true,
      reason,
      tableCount: tableIds.length,
      rowCount: totalRows,
      document: studioStore.getDocument()
    };
  } catch (error) {
    const failed = studioStore.getDocument();
    failed.sync.refreshStatus.running = false;
    failed.sync.refreshStatus.lastCompletedAt = new Date().toISOString();
    failed.sync.refreshStatus.lastError = error instanceof Error ? error.message : "Refresh failed.";
    updateRefreshScheduleMetadata(failed);
    studioStore.saveDocument(failed, { markSavedAt: false });
    throw error;
  }
}

let schedulerStarted = false;

export function startRefreshScheduler(logger?: FastifyBaseLogger) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(async () => {
    const document = studioStore.getDocument();
    updateRefreshScheduleMetadata(document);
    studioStore.saveDocument(document, { markSavedAt: false });
    const schedule = document.sync.refreshSchedule;
    if (!schedule.enabled || document.sync.refreshStatus.running || !scheduleMatchesNow(schedule, new Date())) {
      return;
    }
    const lastSuccessAt = document.sync.refreshStatus.lastSuccessAt ? new Date(document.sync.refreshStatus.lastSuccessAt) : null;
    if (lastSuccessAt && scheduleWindowKey(schedule, lastSuccessAt) === scheduleWindowKey(schedule, new Date())) {
      return;
    }
    try {
      logger?.info("Starting scheduled refresh");
      await refreshAllCachedData("scheduled");
      logger?.info("Scheduled refresh completed");
    } catch (error) {
      logger?.error(error, "Scheduled refresh failed");
    }
  }, REFRESH_CHECK_INTERVAL_MS).unref();
}
