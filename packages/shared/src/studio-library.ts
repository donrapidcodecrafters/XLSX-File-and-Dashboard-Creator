import type { CatalogSummaryItem, StudioObject, StudioObjectScope, StudioObjectType } from "./models.js";

export type StudioLibraryScopeFilter = "all" | StudioObjectScope;
export type StudioLibraryTypeFilter = "all" | StudioObjectType;

type StudioLibraryItem = Pick<
  CatalogSummaryItem,
  "id" | "type" | "name" | "description" | "folder" | "category" | "tags" | "scope" | "ownerUserId" | "sharedUserIds"
>;

export interface FilterStudioLibraryItemsOptions<T extends StudioLibraryItem> {
  currentUserId?: string;
  favorites?: string[];
  recentIds?: string[];
  query?: string;
  typeFilter?: StudioLibraryTypeFilter;
  scopeFilter?: StudioLibraryScopeFilter;
  favoritesOnly?: boolean;
  recentOnly?: boolean;
  includeItem?: (item: T) => boolean;
  resolveSearchText?: (item: T) => string;
}

function normalizeUserId(value?: string) {
  return String(value || "").trim();
}

export function isStudioItemVisibleToCurrentUser(
  item: Pick<StudioLibraryItem, "scope" | "ownerUserId" | "sharedUserIds">,
  currentUserId?: string
) {
  const normalizedCurrentUserId = normalizeUserId(currentUserId);
  if (item.scope === "personal") {
    return Boolean(normalizedCurrentUserId) && normalizedCurrentUserId === normalizeUserId(item.ownerUserId);
  }
  if (item.scope === "selected") {
    return Boolean(normalizedCurrentUserId)
      && (item.sharedUserIds || []).map(normalizeUserId).includes(normalizedCurrentUserId);
  }
  return true;
}

export function filterStudioLibraryItems<T extends StudioLibraryItem>(
  items: T[],
  options: FilterStudioLibraryItemsOptions<T> = {}
) {
  const {
    currentUserId = "",
    favorites = [],
    recentIds = [],
    query = "",
    typeFilter = "all",
    scopeFilter = "all",
    favoritesOnly = false,
    recentOnly = false,
    includeItem,
    resolveSearchText
  } = options;
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => {
    if (!isStudioItemVisibleToCurrentUser(item, currentUserId)) return false;
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
    if (favoritesOnly && !favorites.includes(item.id)) return false;
    if (recentOnly && !recentIds.includes(item.id)) return false;
    if (includeItem && !includeItem(item)) return false;
    if (!normalizedQuery) return true;
    const searchText = resolveSearchText
      ? resolveSearchText(item)
      : [item.name, item.description, item.folder, item.category, item.tags.join(" ")].join(" ");
    return searchText.toLowerCase().includes(normalizedQuery);
  });
}

export function buildStudioCatalogItemLookup(
  items: CatalogSummaryItem[],
  objects?: Record<string, StudioObject> | null
) {
  const map = new Map<string, CatalogSummaryItem>();
  items.forEach((item) => map.set(item.id, item));
  Object.values(objects || {}).forEach((object) => {
    if (map.has(object.id)) return;
    map.set(object.id, {
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
    });
  });
  return map;
}

export function getStudioObjectScopeLabel(item: Pick<StudioLibraryItem, "scope">) {
  if (item.scope === "personal") return "Personal";
  if (item.scope === "selected") return "Shared with selected users";
  return "Shared";
}
