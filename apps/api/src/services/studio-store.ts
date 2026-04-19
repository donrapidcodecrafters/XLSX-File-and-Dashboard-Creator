import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildStudioDocument, normalizeStudioDocument, type StudioDocument, type StudioObject, type StudioVersionRecord } from "@studio/shared";
import { hydrateStudioDocumentFromQuickbase } from "./quickbase-storage.js";

const STORAGE_PATH = resolve(process.cwd(), ".data/studio-document.json");
const CACHE_PATH = resolve(process.cwd(), ".data/studio-cache.json");
const HYDRATE_TTL_MS = 60_000;
const HYDRATE_TIMEOUT_MS = 8_000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripCachedRows(document: StudioDocument): StudioDocument {
  return {
    ...document,
    bundle: {
      ...document.bundle,
      data: {}
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

export class StudioStore {
  private document: StudioDocument;
  private hydratePromise: Promise<StudioDocument> | null = null;
  private lastHydratedAt = 0;

  constructor() {
    this.document = this.load();
    this.lastHydratedAt = Date.parse(this.document.sync?.lastLoadedAt || "") || 0;
  }

  private load(): StudioDocument {
    try {
      const raw = readFileSync(STORAGE_PATH, "utf8");
      const document = normalizeStudioDocument(JSON.parse(raw) as StudioDocument);
      document.bundle.data = loadPersistedCache();
      return document;
    } catch {
      const seed = buildStudioDocument();
      this.persist(seed);
      return seed;
    }
  }

  private persist(document: StudioDocument) {
    mkdirSync(dirname(STORAGE_PATH), { recursive: true });
    writeFileSync(STORAGE_PATH, JSON.stringify(stripCachedRows(document), null, 2));
    writeFileSync(CACHE_PATH, JSON.stringify(document.bundle.data || {}, null, 2));
  }

  getDocument(includeData = false): StudioDocument {
    return clone(includeData ? this.document : stripCachedRows(this.document));
  }

  getLiveDocument(): StudioDocument {
    return this.document;
  }

  async hydrateFromQuickbase(force = false) {
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
    return this.document.bundle;
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

  flushCurrent(options: { markSavedAt?: boolean } = {}) {
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
