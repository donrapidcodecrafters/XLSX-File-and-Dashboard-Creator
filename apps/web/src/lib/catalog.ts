import {
  normalizeStudioAppId,
  normalizeStudioRealmHostname,
  type CatalogSummaryItem,
  type StudioDocument,
  type StudioLaunchContext,
  type StudioObject,
  type TableDefinition
} from "@studio/shared";

export function typeLabel(type: "report" | "dashboard") {
  return type === "report" ? "Report" : "Dashboard";
}

export function resolveTableDefinition(tables: TableDefinition[], tableId: string) {
  return tables.find((item) => item.id === tableId || item.quickbaseTableId === tableId);
}

function isQuickbaseLaunchScoped(launchContext: StudioLaunchContext | null | undefined) {
  return launchContext?.launchSource === "quickbase-button"
    && Boolean(normalizeStudioRealmHostname(launchContext.launchRealmHostname))
    && Boolean(normalizeStudioAppId(launchContext.launchAppId))
    && Boolean(String(launchContext.currentUserId || "").trim());
}

function tableMatchesLaunchScope(table: TableDefinition | undefined, studioDocument: StudioDocument | null, launchContext: StudioLaunchContext | null | undefined) {
  if (!table || !studioDocument || !isQuickbaseLaunchScoped(launchContext)) return true;
  const launchRealmHostname = normalizeStudioRealmHostname(launchContext?.launchRealmHostname);
  const launchAppId = normalizeStudioAppId(launchContext?.launchAppId);
  const explicitTableAppId = normalizeStudioAppId(table.quickbaseAppId);
  if (table.quickbaseProfileId) {
    const profile = studioDocument.quickbaseProfiles.find((item) => item.id === table.quickbaseProfileId);
    if (!profile) return false;
    return normalizeStudioRealmHostname(profile.quickbase.realmHostname) === launchRealmHostname
      && normalizeStudioAppId(profile.quickbase.appId) === launchAppId;
  }
  if (explicitTableAppId) {
    return normalizeStudioRealmHostname(studioDocument.quickbase.realmHostname) === launchRealmHostname
      && explicitTableAppId === launchAppId;
  }
  return false;
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

export function getMatchingQuickbaseProfileIds(studioDocument: StudioDocument | null, launchContext: StudioLaunchContext | null | undefined) {
  if (!studioDocument || !isQuickbaseLaunchScoped(launchContext)) return [] as string[];
  const launchRealmHostname = normalizeStudioRealmHostname(launchContext?.launchRealmHostname);
  const launchAppId = normalizeStudioAppId(launchContext?.launchAppId);
  return studioDocument.quickbaseProfiles
    .filter((profile) =>
      normalizeStudioRealmHostname(profile.quickbase.realmHostname) === launchRealmHostname
      && normalizeStudioAppId(profile.quickbase.appId) === launchAppId
    )
    .map((profile) => profile.id);
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

export function isObjectInLaunchScope(
  object: StudioObject | null | undefined,
  tables: TableDefinition[],
  studioDocument: StudioDocument | null,
  launchContext: StudioLaunchContext | null | undefined
): boolean {
  if (!object || !studioDocument || !isQuickbaseLaunchScoped(launchContext)) return true;
  if (object.type === "report") {
    return tableMatchesLaunchScope(resolveTableDefinition(tables, object.sourceTableId), studioDocument, launchContext);
  }
  return object.tabs.some((tab) =>
    tab.widgets.some((widget) => {
      const report = widget.mode === "copied" && widget.snapshot
        ? widget.snapshot
        : studioDocument.bundle.objects[widget.reportId];
      return report?.type === "report"
        ? isObjectInLaunchScope(report, tables, studioDocument, launchContext)
        : false;
    })
  );
}

export function isCatalogItemInLaunchScope(
  item: CatalogSummaryItem,
  studioDocument: StudioDocument | null,
  launchContext: StudioLaunchContext | null | undefined
): boolean {
  if (!studioDocument || !isQuickbaseLaunchScoped(launchContext)) return true;
  return isObjectInLaunchScope(
    studioDocument.bundle.objects[item.id],
    studioDocument.bundle.tables || [],
    studioDocument,
    launchContext
  );
}

export function filterTablesForLaunchScope(
  tables: TableDefinition[],
  studioDocument: StudioDocument | null,
  launchContext: StudioLaunchContext | null | undefined
): TableDefinition[] {
  if (!studioDocument || !isQuickbaseLaunchScoped(launchContext)) return tables;
  return tables.filter((table) => tableMatchesLaunchScope(table, studioDocument, launchContext));
}

export function applyLaunchScopeToDocument(studioDocument: StudioDocument | null, launchContext: StudioLaunchContext | null | undefined) {
  if (!studioDocument || !isQuickbaseLaunchScoped(launchContext)) return studioDocument;
  const filteredTables = filterTablesForLaunchScope(studioDocument.bundle.tables || [], studioDocument, launchContext);
  const filteredObjects = Object.fromEntries(
    Object.entries(studioDocument.bundle.objects || {}).filter(([, object]) =>
      isObjectInLaunchScope(object, studioDocument.bundle.tables || [], studioDocument, launchContext)
    )
  );
  const matchingProfileIds = new Set(getMatchingQuickbaseProfileIds(studioDocument, launchContext));
  return {
    ...studioDocument,
    bundle: {
      ...studioDocument.bundle,
      tables: filteredTables,
      objects: filteredObjects,
      order: (studioDocument.bundle.order || []).filter((id) => Boolean(filteredObjects[id]))
    },
    quickbaseProfiles: (studioDocument.quickbaseProfiles || []).filter((profile) => matchingProfileIds.has(profile.id)),
    activeQuickbaseProfileId: matchingProfileIds.has(studioDocument.activeQuickbaseProfileId)
      ? studioDocument.activeQuickbaseProfileId
      : filteredTables[0]?.quickbaseProfileId || ""
  };
}

export function toggleFavoriteIds(current: string[], objectId: string) {
  if (!objectId) return current;
  return current.includes(objectId)
    ? current.filter((item) => item !== objectId)
    : [objectId, ...current];
}
