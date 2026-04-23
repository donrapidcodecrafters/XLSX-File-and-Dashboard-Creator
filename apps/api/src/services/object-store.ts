import {
  type CatalogSummaryItem,
  type DashboardDefinition,
  type ReportDefinition,
  type StudioObject,
  type TableDefinition,
  type WidgetDefinition
} from "@studio/shared";
import { studioStore } from "./studio-store.js";

export class ObjectStore {
  getAppInfo() {
    return studioStore.getBundle().app;
  }

  listTables(): TableDefinition[] {
    return studioStore.getBundle().tables;
  }

  getTable(tableId: string): TableDefinition | undefined {
    return studioStore.getBundle().tables.find((table) => table.id === tableId || table.quickbaseTableId === tableId);
  }

  getRows(tableId: string) {
    const bundle = studioStore.getBundle();
    const table = this.getTable(tableId);
    const keys = Array.from(new Set([tableId, table?.id || "", table?.quickbaseTableId || ""].filter(Boolean)));
    for (const key of keys) {
      if (bundle.data[key] && studioStore.isCacheFresh(key)) {
        return bundle.data[key];
      }
    }
    for (const key of keys) {
      if (bundle.data[key]) {
        return bundle.data[key];
      }
    }
    return [];
  }

  listCatalog(): CatalogSummaryItem[] {
    const bundle = studioStore.getBundle();
    return bundle.order
      .map((id) => bundle.objects[id])
      .filter((object): object is StudioObject => Boolean(object))
      .map((object) => ({
        id: object.id,
        type: object.type,
        schemaVersion: object.schemaVersion,
        name: object.name,
        description: object.description,
        folder: object.folder,
        category: object.category,
        tags: object.tags,
        scope: object.scope,
        createdByUserId: object.createdByUserId,
        ownerUserId: object.ownerUserId,
        sharedUserIds: object.sharedUserIds,
        updatedAt: object.updatedAt
      }));
  }

  getObject(id: string): StudioObject | undefined {
    return studioStore.getBundle().objects[id];
  }

  getReport(id: string): ReportDefinition | undefined {
    const object = studioStore.getBundle().objects[id];
    return object?.type === "report" ? object : undefined;
  }

  getDashboard(id: string): DashboardDefinition | undefined {
    const object = studioStore.getBundle().objects[id];
    return object?.type === "dashboard" ? object : undefined;
  }

  resolveWidgetReport(widget: WidgetDefinition): ReportDefinition | undefined {
    if (widget.mode === "copied" && widget.snapshot) return widget.snapshot;
    return this.getReport(widget.reportId);
  }
}

export const objectStore = new ObjectStore();
