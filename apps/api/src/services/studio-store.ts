import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildStudioDocument, normalizeStudioDocument, type StudioDocument, type StudioObject, type StudioVersionRecord } from "@studio/shared";
import { isPostgresEnabled } from "../config/env.js";
import { pgQuery } from "../db/postgres.js";

const STORAGE_PATH = resolve(process.cwd(), ".data/studio-document.json");
const CACHE_PATH = resolve(process.cwd(), ".data/studio-cache.json");
const CACHE_META_PATH = resolve(process.cwd(), ".data/studio-cache-meta.json");
const DISK_RELOAD_TTL_MS = 250;
export const CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;

type PersistedCacheMetaEntry = {
  cachedAt: string;
  expiresAt: string;
  rowCount: number;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stripCachedRows(document: StudioDocument): StudioDocument {
  const importedTableIds = new Set(
    (document.bundle.tables || [])
      .filter((table) => !table.quickbaseTableId && !table.quickbaseProfileId)
      .map((table) => table.id)
  );
  return {
    ...document,
    bundle: {
      ...document.bundle,
      // Keep locally imported workbook rows available to the client while omitting cached Quickbase rows.
      data: Object.fromEntries(
        Object.entries(document.bundle.data || {}).filter(([tableId]) => importedTableIds.has(tableId))
      )
    }
  };
}

function loadPersistedCache(): StudioDocument["bundle"]["data"] {
  try {
    const raw = readFileSync(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed || {}).map(([tableId, rows]) => [tableId, Array.isArray(rows) ? rows : []])
    );
  } catch {
    return {};
  }
}

function loadPersistedCacheMeta(): Record<string, PersistedCacheMetaEntry> {
  try {
    const raw = readFileSync(CACHE_META_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, PersistedCacheMetaEntry>;
    return Object.fromEntries(
      Object.entries(parsed || {}).map(([tableId, entry]) => [
        tableId,
        {
          cachedAt: String(entry?.cachedAt || ""),
          expiresAt: String(entry?.expiresAt || ""),
          rowCount: Number(entry?.rowCount || 0)
        }
      ])
    );
  } catch {
    return {};
  }
}

function loadPersistedDocument(): StudioDocument | null {
  try {
    const raw = readFileSync(STORAGE_PATH, "utf8");
    return normalizeStudioDocument(JSON.parse(raw) as StudioDocument);
  } catch {
    return null;
  }
}

async function loadDocumentFromPostgres(): Promise<StudioDocument | null> {
  if (!isPostgresEnabled()) return null;
  try {
    const result = await pgQuery<{ document: unknown }>(
      "SELECT document FROM studio_document WHERE id = 1"
    );
    if (!result.rows[0]) return null;
    return normalizeStudioDocument(result.rows[0].document as StudioDocument);
  } catch {
    return null;
  }
}

async function saveDocumentToPostgres(document: StudioDocument): Promise<void> {
  if (!isPostgresEnabled()) return;
  try {
    await pgQuery(
      `INSERT INTO studio_document (id, document, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
      [JSON.stringify(stripCachedRows(document))]
    );
  } catch {
    // Non-blocking — disk is fallback
  }
}

function resolveCachedTableEntry(
  document: StudioDocument,
  cacheMeta: Record<string, PersistedCacheMetaEntry>,
  table: StudioDocument["bundle"]["tables"][number]
) {
  const candidateKeys = [table.id, table.quickbaseTableId].filter((key): key is string => Boolean(key));
  for (const key of candidateKeys) {
    const rows = document.bundle.data[key];
    const rowCount = Number(cacheMeta[key]?.rowCount || 0) || (Array.isArray(rows) ? rows.length : 0);
    if (rowCount > 0) {
      return {
        cacheKey: key,
        rowCount,
        cachedAt: String(cacheMeta[key]?.cachedAt || "")
      };
    }
  }
  return null;
}

function reconcileRefreshStatusWithCache(
  document: StudioDocument,
  cacheMeta: Record<string, PersistedCacheMetaEntry>
) {
  const quickbaseTables = (document.bundle.tables || []).filter((table) => table.quickbaseProfileId || table.quickbaseTableId);
  const cachedEntries = quickbaseTables
    .map((table) => {
      const cache = resolveCachedTableEntry(document, cacheMeta, table);
      return cache ? { table, cache } : null;
    })
    .filter((entry): entry is {
      table: StudioDocument["bundle"]["tables"][number];
      cache: { cacheKey: string; rowCount: number; cachedAt: string };
    } => Boolean(entry));

  const globalCachedTableIds = cachedEntries.map((entry) => entry.cache.cacheKey);
  const globalCachedRowCount = cachedEntries.reduce((sum, entry) => sum + entry.cache.rowCount, 0);
  const globalLastSuccessAt = cachedEntries
    .map((entry) => Date.parse(entry.cache.cachedAt || ""))
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => right - left)[0];

  document.sync.refreshStatus.cachedTableIds = globalCachedTableIds;
  document.sync.refreshStatus.cachedRowCount = globalCachedRowCount;
  if (!document.sync.refreshStatus.lastSuccessAt && globalLastSuccessAt) {
    document.sync.refreshStatus.lastSuccessAt = new Date(globalLastSuccessAt).toISOString();
  }

  document.quickbaseProfiles.forEach((profile) => {
    const profileEntries = cachedEntries.filter((entry) => entry.table.quickbaseProfileId === profile.id);
    profile.refreshStatus.cachedTableIds = profileEntries.map((entry) => entry.cache.cacheKey);
    profile.refreshStatus.cachedRowCount = profileEntries.reduce((sum, entry) => sum + entry.cache.rowCount, 0);
    const profileLastSuccessAt = profileEntries
      .map((entry) => Date.parse(entry.cache.cachedAt || ""))
      .filter((value) => !Number.isNaN(value))
      .sort((left, right) => right - left)[0];
    if (!profile.refreshStatus.lastSuccessAt && profileLastSuccessAt) {
      profile.refreshStatus.lastSuccessAt = new Date(profileLastSuccessAt).toISOString();
    }
  });
}

export class StudioStore {
  private document: StudioDocument;
  private cacheMeta: Record<string, PersistedCacheMetaEntry> = {};
  private lastHydratedAt = 0;
  private lastReloadedFromDiskAt = 0;
  private pgInitialized = false;

  constructor() {
    this.document = this.load();
    this.cacheMeta = loadPersistedCacheMeta();
    reconcileRefreshStatusWithCache(this.document, this.cacheMeta);
    this.lastHydratedAt = Date.parse(this.document.sync?.lastLoadedAt || "") || 0;
    this.lastReloadedFromDiskAt = Date.now();
  }

  private load(): StudioDocument {
    const persisted = loadPersistedDocument();
    if (persisted) return persisted;
    const seed = buildStudioDocument();
    this.persist(seed);
    return seed;
  }

  private persist(document: StudioDocument, options: { skipCacheWrite?: boolean } = {}) {
    mkdirSync(dirname(STORAGE_PATH), { recursive: true });
    reconcileRefreshStatusWithCache(document, this.cacheMeta);
    writeFileSync(STORAGE_PATH, JSON.stringify(stripCachedRows(document), null, 2));
    if (!options.skipCacheWrite && Object.keys(document.bundle.data || {}).length) {
      writeFileSync(CACHE_PATH, JSON.stringify(document.bundle.data || {}, null, 2));
    }
    writeFileSync(CACHE_META_PATH, JSON.stringify(this.cacheMeta || {}, null, 2));
    this.lastReloadedFromDiskAt = Date.now();
    void saveDocumentToPostgres(document);
  }

  private reloadFromDisk(force = false) {
    if (!force && this.lastReloadedFromDiskAt && Date.now() - this.lastReloadedFromDiskAt < DISK_RELOAD_TTL_MS) {
      return;
    }
    const persisted = loadPersistedDocument();
    this.lastReloadedFromDiskAt = Date.now();
    if (!persisted) return;
    this.document = persisted;
    this.cacheMeta = loadPersistedCacheMeta();
    reconcileRefreshStatusWithCache(this.document, this.cacheMeta);
    this.lastHydratedAt = Date.parse(this.document.sync?.lastLoadedAt || "") || this.lastHydratedAt;
  }

  private buildCacheMetaEntry(rowCount: number, cachedAt = new Date().toISOString()): PersistedCacheMetaEntry {
    const base = new Date(cachedAt);
    const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
    return {
      cachedAt: safeBase.toISOString(),
      expiresAt: new Date(safeBase.getTime() + CACHE_RETENTION_MS).toISOString(),
      rowCount
    };
  }

  getDocument(includeData = false): StudioDocument {
    this.reloadFromDisk();
    return clone(includeData ? this.document : stripCachedRows(this.document));
  }

  getLiveDocument(): StudioDocument {
    this.reloadFromDisk();
    return this.document;
  }

  async initializeFromPostgres() {
    if (this.pgInitialized || !isPostgresEnabled()) return;
    this.pgInitialized = true;
    const pgDoc = await loadDocumentFromPostgres();
    if (pgDoc) {
      this.document = pgDoc;
      this.cacheMeta = loadPersistedCacheMeta();
      reconcileRefreshStatusWithCache(this.document, this.cacheMeta);
      this.lastHydratedAt = Date.parse(this.document.sync?.lastLoadedAt || "") || this.lastHydratedAt;
      this.lastReloadedFromDiskAt = Date.now();
      try {
        mkdirSync(dirname(STORAGE_PATH), { recursive: true });
        writeFileSync(STORAGE_PATH, JSON.stringify(stripCachedRows(pgDoc), null, 2));
      } catch {
        // Non-fatal
      }
    }
  }

  async hydrateFromQuickbase(_force = false) {
    // Document is now persisted in Postgres/disk. QB is only a data source for record sync.
    this.reloadFromDisk();
    return this.getDocument();
  }

  getBundle() {
    this.reloadFromDisk();
    return this.document.bundle;
  }

  getCachedRows(tableIds: string[], limit = 1000): StudioDocument["bundle"]["data"][string] {
    const keys = tableIds.map((value) => String(value || "").trim()).filter(Boolean);
    if (!keys.length) return [];
    for (const key of keys) {
      const inMemoryRows = this.document.bundle.data[key];
      if (Array.isArray(inMemoryRows) && inMemoryRows.length) {
        return clone(inMemoryRows.slice(0, Math.max(1, limit)));
      }
    }
    const cache = loadPersistedCache();
    for (const key of keys) {
      const rows = cache[key];
      if (Array.isArray(rows) && rows.length) {
        return clone(rows.slice(0, Math.max(1, limit)));
      }
    }
    return [];
  }

  getCacheMeta(tableId: string): PersistedCacheMetaEntry | null {
    this.reloadFromDisk();
    const entry = this.cacheMeta[tableId];
    return entry ? clone(entry) : null;
  }

  getAllCacheMeta() {
    this.reloadFromDisk();
    return clone(this.cacheMeta);
  }

  isCacheFresh(tableId: string) {
    this.reloadFromDisk();
    const entry = this.cacheMeta[tableId];
    if (!entry) {
      return Array.isArray(this.document.bundle.data[tableId]);
    }
    const expiresAt = Date.parse(entry.expiresAt || "");
    return !Number.isNaN(expiresAt) && expiresAt > Date.now();
  }

  touchCacheEntry(tableId: string, rowCount: number, cachedAt = new Date().toISOString()) {
    this.cacheMeta[tableId] = this.buildCacheMetaEntry(rowCount, cachedAt);
  }

  touchCacheEntriesFromDocument(document: StudioDocument, tableIds: string[], cachedAt = new Date().toISOString()) {
    tableIds.forEach((tableId) => {
      const rows = document.bundle.data[tableId] || [];
      this.touchCacheEntry(tableId, rows.length, cachedAt);
    });
  }

  saveDocument(document: StudioDocument, options: { markSavedAt?: boolean } = {}) {
    this.document = normalizeStudioDocument(clone(document));
    if (options.markSavedAt !== false) {
      this.document.sync.lastSavedAt = new Date().toISOString();
    }
    this.lastHydratedAt = Date.now();
    this.persist(this.document);
    return this.getDocument();
  }

  saveSession(session: StudioDocument["session"], options: { persist?: boolean } = {}) {
    this.document = normalizeStudioDocument({
      ...this.document,
      session
    });
    if (options.persist) {
      this.persist(this.document);
    }
    return clone(this.document.session);
  }

  flushCurrent(options: { markSavedAt?: boolean } = {}) {
    if (options.markSavedAt !== false) {
      this.document.sync.lastSavedAt = new Date().toISOString();
    }
    this.lastHydratedAt = Date.now();
    this.persist(this.document);
    return this.getDocument();
  }

  flushDocument(document: StudioDocument, options: { markSavedAt?: boolean; skipCacheWrite?: boolean } = {}) {
    this.document = document;
    if (options.markSavedAt !== false) {
      this.document.sync.lastSavedAt = new Date().toISOString();
    }
    this.lastHydratedAt = Date.now();
    this.persist(this.document, { skipCacheWrite: options.skipCacheWrite });
    return this.getDocument();
  }

  snapshotObject(objectId: string, label = "Manual snapshot") {
    const object = this.document.bundle.objects[objectId];
    if (!object) {
      throw new Error("Object not found.");
    }
    const version: StudioVersionRecord = {
      id: `version-${Math.random().toString(36).slice(2, 10)}`,
      label,
      savedAt: new Date().toISOString(),
      object: clone(object)
    };
    const versions = this.document.versions[objectId] || [];
    this.document.versions[objectId] = [version, ...versions].slice(0, 30);
    this.persist(this.document);
    return version;
  }

  listVersions(objectId: string) {
    return clone(this.document.versions[objectId] || []);
  }

  restoreVersion(objectId: string, versionId: string) {
    const version = (this.document.versions[objectId] || []).find((item) => item.id === versionId);
    if (!version) {
      throw new Error("Version not found.");
    }
    const restored = clone(version.object);
    restored.updatedAt = new Date().toISOString();
    this.document.bundle.objects[objectId] = restored as StudioObject;
    if (!this.document.bundle.order.includes(objectId)) {
      this.document.bundle.order.unshift(objectId);
    }
    this.persist(this.document);
    return clone(restored);
  }
}

export const studioStore = new StudioStore();
