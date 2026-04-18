import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildStudioDocument, normalizeStudioDocument, type StudioDocument, type StudioObject, type StudioVersionRecord } from "@studio/shared";

const STORAGE_PATH = resolve(process.cwd(), ".data/studio-document.json");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class StudioStore {
  private document: StudioDocument;

  constructor() {
    this.document = this.load();
  }

  private load(): StudioDocument {
    try {
      const raw = readFileSync(STORAGE_PATH, "utf8");
      return normalizeStudioDocument(JSON.parse(raw) as StudioDocument);
    } catch {
      const seed = buildStudioDocument();
      this.persist(seed);
      return seed;
    }
  }

  private persist(document: StudioDocument) {
    mkdirSync(dirname(STORAGE_PATH), { recursive: true });
    writeFileSync(STORAGE_PATH, JSON.stringify(document, null, 2));
  }

  getDocument(): StudioDocument {
    return clone(this.document);
  }

  getBundle() {
    return this.document.bundle;
  }

  saveDocument(document: StudioDocument) {
    this.document = normalizeStudioDocument(clone(document));
    this.document.sync.lastSavedAt = new Date().toISOString();
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
