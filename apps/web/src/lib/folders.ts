import { useEffect, useState } from "react";

const FOLDER_EXPANDED_KEY_PREFIX = "folder-expanded:";

/**
 * Per-folder expand/collapse state, persisted to localStorage (same convention as the
 * sidebar's own pin state) so it survives reloads. scopeKey namespaces storage per surface
 * (e.g. "nav-sidebar" vs "studio-home") so expanding a folder in one list doesn't affect
 * another. Default (nothing stored yet) is collapsed — a folder's contents only show once
 * a user explicitly opens it.
 */
export function useFolderCollapseState(scopeKey: string) {
  const storageKey = FOLDER_EXPANDED_KEY_PREFIX + scopeKey;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(expandedIds)));
    } catch {
      // Non-fatal — expand state just won't persist this session.
    }
  }, [expandedIds, storageKey]);

  function toggleFolder(folderId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function isCollapsed(folderId: string) {
    return !expandedIds.has(folderId);
  }

  return { toggleFolder, isCollapsed };
}
