import { useEffect, useState } from "react";

const FOLDER_COLLAPSE_KEY_PREFIX = "folder-collapsed:";

/**
 * Per-folder expand/collapse state, persisted to localStorage (same convention as the
 * sidebar's own pin state) so it survives reloads. scopeKey namespaces storage per surface
 * (e.g. "nav-sidebar" vs "studio-library") so collapsing a folder in one list doesn't affect
 * another. Default (nothing stored yet) is "expanded" — matches the always-visible behavior
 * these lists had before folders existed.
 */
export function useFolderCollapseState(scopeKey: string) {
  const storageKey = FOLDER_COLLAPSE_KEY_PREFIX + scopeKey;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(collapsedIds)));
    } catch {
      // Non-fatal — collapse state just won't persist this session.
    }
  }, [collapsedIds, storageKey]);

  function toggleFolder(folderId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function isCollapsed(folderId: string) {
    return collapsedIds.has(folderId);
  }

  return { toggleFolder, isCollapsed };
}
