import type { CatalogSummaryItem, StudioDocument, StudioObject, TableDefinition } from "@studio/shared";

export function typeLabel(type: "report" | "dashboard") {
  return type === "report" ? "Report" : "Dashboard";
}

export function resolveTableDefinition(tables: TableDefinition[], tableId: string) {
  return tables.find((item) => item.id === tableId || item.quickbaseTableId === tableId);
}

export function getProfileIdsForObject(object: StudioObject | null, tables: TableDefinition[], studioDocument: StudioDocument | null) {
  if (!object || !studioDocument) return [] as string[];
  const ids = new Set<string>();
  if (object.type === "report") {
    const table = resolveTableDefinition(tables, object.sourceTableId);
    if (table?.quickbaseProfileId) ids.add(table.quickbaseProfileId);
    return Array.from(ids);
  }
  object.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const report = widget.mode === "copied" && widget.snapshot
        ? widget.snapshot
        : studioDocument.bundle.objects[widget.reportId];
      if (report?.type !== "report") return;
      const table = resolveTableDefinition(tables, report.sourceTableId);
      if (table?.quickbaseProfileId) ids.add(table.quickbaseProfileId);
    });
  });
  return Array.from(ids);
}

export function getProfileIdsForCatalogItem(item: CatalogSummaryItem, studioDocument: StudioDocument | null) {
  if (!studioDocument) return [] as string[];
  const object = studioDocument.bundle.objects[item.id];
  if (!object) return [] as string[];
  return getProfileIdsForObject(object, studioDocument.bundle.tables || [], studioDocument);
}

export function getProfileLabelsForCatalogItem(item: CatalogSummaryItem, studioDocument: StudioDocument | null) {
  if (!studioDocument) return [] as string[];
  const labels = getProfileIdsForCatalogItem(item, studioDocument)
    .map((profileId) => studioDocument.quickbaseProfiles.find((profile) => profile.id === profileId)?.label || profileId)
    .filter(Boolean);
  return Array.from(new Set(labels));
}

export function toggleFavoriteIds(current: string[], objectId: string) {
  if (!objectId) return current;
  return current.includes(objectId)
    ? current.filter((item) => item !== objectId)
    : [objectId, ...current];
}
