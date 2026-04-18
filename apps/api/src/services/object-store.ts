import {
  buildSeedBundle,
  type CatalogSummaryItem,
  type DashboardDefinition,
  type ReportDefinition,
  type SeedBundle,
  type StudioObject,
  type TableDefinition,
  type WidgetDefinition
} from "@studio/shared";

export class ObjectStore {
  private readonly bundle: SeedBundle;

  constructor(bundle: SeedBundle = buildSeedBundle()) {
    this.bundle = bundle;
  }

  getAppInfo() {
    return this.bundle.app;
  }

  listTables(): TableDefinition[] {
    return this.bundle.tables;
  }

  getTable(tableId: string): TableDefinition | undefined {
    return this.bundle.tables.find((table) => table.id === tableId);
  }

  getRows(tableId: string) {
    return this.bundle.data[tableId] || [];
  }

  listCatalog(): CatalogSummaryItem[] {
    return this.bundle.order
      .map((id) => this.bundle.objects[id])
      .filter((object): object is StudioObject => Boolean(object))
      .map((object) => ({
        id: object.id,
        type: object.type,
        name: object.name,
        description: object.description,
        folder: object.folder,
        category: object.category,
        tags: object.tags,
        updatedAt: object.updatedAt
      }));
  }

  getObject(id: string): StudioObject | undefined {
    return this.bundle.objects[id];
  }

  getReport(id: string): ReportDefinition | undefined {
    const object = this.bundle.objects[id];
    return object?.type === "report" ? object : undefined;
  }

  getDashboard(id: string): DashboardDefinition | undefined {
    const object = this.bundle.objects[id];
    return object?.type === "dashboard" ? object : undefined;
  }

  resolveWidgetReport(widget: WidgetDefinition): ReportDefinition | undefined {
    if (widget.mode === "copied" && widget.snapshot) return widget.snapshot;
    return this.getReport(widget.reportId);
  }
}

export const objectStore = new ObjectStore();
