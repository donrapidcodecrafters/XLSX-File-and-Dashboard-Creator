import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildStudioDocument, normalizeStudioDocument, type StudioDocument, type StudioObject, type StudioVersionRecord } from "@studio/shared";
import { hydrateStudioDocumentFromQuickbase } from "./quickbase-storage.js";

const STORAGE_PATH = resolve(process.cwd(), ".data/studio-document.json");
const CACHE_PATH = resolve(process.cwd(), ".data/studio-cache.json");
const CACHE_META_PATH = resolve(process.cwd(), ".data/studio-cache-meta.json");
const HYDRATE_TTL_MS = 24 * 60 * 60 * 1000;
const HYDRATE_TIMEOUT_MS = 8_000;
const DISK_RELOAD_TTL_MS = 250;
export const CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;

type PersistedCacheMetaEntry = {
  cachedAt: string;
  expiresAt: string;
  rowCount: number;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    const document = normalizeStudioDocument(JSON.parse(raw) as StudioDocument);
    document.bundle.data = loadPersistedCache();
    return document;
  } catch {
    return null;
  }
}

export class StudioStore {
  private document: StudioDocument;
  private cacheMeta: Record<string, PersistedCacheMetaEntry> = {};
  private hydratePromise: Promise<StudioDocument> | null = null;
  private lastHydratedAt = 0;
  private lastReloadedFromDiskAt = 0;

  constructor() {
    this.document = this.load();
    this.cacheMeta = loadPersistedCacheMeta();
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

  private persist(document: StudioDocument) {
    mkdirSync(dirname(STORAGE_PATH), { recursive: true });
    writeFileSync(STORAGE_PATH, JSON.stringify(stripCachedRows(document), null, 2));
    writeFileSync(CACHE_PATH, JSON.stringify(document.bundle.data || {}, null, 2));
    writeFileSync(CACHE_META_PATH, JSON.stringify(this.cacheMeta || {}, null, 2));
    this.lastReloadedFromDiskAt = Date.now();
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

  async hydrateFromQuickbase(force = false) {
    this.reloadFromDisk();
    if (!force && this.lastHydratedAt && Date.now() - this.lastHydratedAt < HYDRATE_TTL_MS) {
      return this.getDocument();
    }
    if (this.hydratePromise) {
      return this.hydratePromise;
    }
    let expired = false;
    const hydrateTask = hydrateStudioDocumentFromQuickbase(this.document)
      .then((document) => {
        if (expired) return this.getDocument();
        this.document = document;
        this.lastHydratedAt = Date.now();
        this.persist(this.document);
        return this.getDocument();
      })
      .catch(() => this.getDocument());
    const timeoutTask = new Promise<StudioDocument>((resolve) => {
      setTimeout(() => {
        expired = true;
        resolve(this.getDocument());
      }, HYDRATE_TIMEOUT_MS);
    });
    this.hydratePromise = Promise.race([hydrateTask, timeoutTask]).finally(() => {
      this.hydratePromise = null;
    });
    return this.hydratePromise;
  }

  getBundle() {
    this.reloadFromDisk();
    return this.document.bundle;
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

  flushDocument(document: StudioDocument, options: { markSavedAt?: boolean } = {}) {
    this.document = document;
    if (options.markSavedAt !== false) {
      this.document.sync.lastSavedAt = new Date().toISOString();
    }
    this.lastHydratedAt = Date.now();
    this.persist(this.document);
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
