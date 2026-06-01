import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { filterStudioLibraryItems, type CatalogSummaryItem, type StudioDocument } from "@studio/shared";
import { fetchStudioRefreshJob, startStudioRefresh } from "../lib/studioApi";
import { getProfileIdsForCatalogItem, getProfileLabelsForCatalogItem } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { CatalogCard } from "./CatalogCard";
import { ClearableInputField } from "./ClearableInputField";
import { RefreshOverlay } from "./RefreshOverlay";

export function ViewerPage({
  objects,
  studioDocument,
  recentIds,
  refreshAllSignal = 0,
  openLinksInNewTab = false,
  onRefreshComplete,
  onToggleFavorite
}: {
  objects: CatalogSummaryItem[];
  studioDocument: StudioDocument | null;
  recentIds: string[];
  refreshAllSignal?: number;
  openLinksInNewTab?: boolean;
  onRefreshComplete: (options?: { skipWhenLocalDirty?: boolean }) => Promise<void>;
  onToggleFavorite: (objectId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "report" | "dashboard">("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "selected" | "personal">("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const [startingRefresh, setStartingRefresh] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{ tone: "warn" | "danger"; message: string } | null>(null);

  const favorites = studioDocument?.favorites || [];
  const currentUserId = String(studioDocument?.session.currentUserId || "").trim();
  const activeQuickbaseProfileId = studioDocument?.activeQuickbaseProfileId || studioDocument?.quickbaseProfiles[0]?.id || "";

  const sourceObjects = useMemo(
    () => studioDocument
      ? (studioDocument.bundle.order || [])
          .map((id) => studioDocument.bundle.objects[id])
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((object) => ({
            id: object.id, type: object.type, schemaVersion: object.schemaVersion,
            name: object.name, description: object.description, folder: object.folder,
            category: object.category, tags: object.tags, scope: object.scope,
            ownerUserId: object.ownerUserId, sharedUserIds: object.sharedUserIds,
            updatedAt: object.updatedAt
          }))
      : objects,
    [objects, studioDocument]
  );

  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(sourceObjects, { currentUserId }),
    [currentUserId, sourceObjects]
  );

  const filtered = useMemo(() => {
    return filterStudioLibraryItems(visibleObjects, {
      currentUserId, favorites, recentIds, query, typeFilter, scopeFilter, favoritesOnly, recentOnly,
      includeItem: (object) => profileFilter === "all" || getProfileIdsForCatalogItem(object, studioDocument).includes(profileFilter),
      resolveSearchText: (object) =>
        [object.name, object.description, object.folder, object.category, object.tags.join(" "), getProfileLabelsForCatalogItem(object, studioDocument).join(" ")].join(" ")
    });
  }, [currentUserId, favorites, favoritesOnly, profileFilter, query, recentIds, recentOnly, scopeFilter, studioDocument, typeFilter, visibleObjects]);

  const profileOptions = studioDocument?.quickbaseProfiles || [];
  const isFiltered = query || typeFilter !== "all" || scopeFilter !== "all" || profileFilter !== "all" || favoritesOnly || recentOnly;

  useEffect(() => {
    if (!refreshJob || ["complete", "failed", "cancelled"].includes(refreshJob.status)) return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then(async (response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshFeedback(null);
            setRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
            await onRefreshComplete({ skipWhenLocalDirty: true });
            setRefreshJob(null);
          } else if (response.job.status === "failed") {
            setRefreshFeedback({ tone: "danger", message: response.job.error || response.job.message || "Refresh failed." });
          } else if (response.job.status === "cancelled") {
            setRefreshFeedback({ tone: "warn", message: response.job.message || "Refresh cancelled." });
          }
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(handle);
  }, [onRefreshComplete, refreshJob]);

  useEffect(() => {
    if (!refreshAllSignal) return;
    void startFullRefresh();
  }, [refreshAllSignal]);

  async function startFullRefresh() {
    setStartingRefresh(true);
    setRefreshFeedback(null);
    try {
      const response = await startStudioRefresh(activeQuickbaseProfileId);
      setRefreshJob(response.job);
      if (response.job.status === "complete") {
        setRefreshFeedback(null);
        setRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
        await onRefreshComplete({ skipWhenLocalDirty: true });
        setRefreshJob(null);
      }
    } catch (error) {
      setRefreshFeedback({ tone: "danger", message: error instanceof Error ? error.message : "Refresh failed to start." });
    } finally {
      window.setTimeout(() => setStartingRefresh(false), 700);
    }
  }

  return (
    <section className="surface stack viewer-page">
      {startingRefresh && !refreshJob ? (
        <RefreshOverlay title="Starting refresh" indeterminate job={{ message: "Pulling fresh data from all connected sources…" }} />
      ) : null}
      {refreshJob ? (
        <RefreshOverlay
          title={refreshJob.status === "complete" ? "Refresh complete" : refreshJob.status === "failed" ? "Refresh failed" : refreshJob.status === "cancelled" ? "Refresh cancelled" : "Refreshing data"}
          job={refreshJob} status={refreshJob.status} onDismiss={() => setRefreshJob(null)}
        />
      ) : null}
      {refreshFeedback ? (
        <div className="sync-status sync-status-warn">
          <strong>{refreshFeedback.tone === "danger" ? "Refresh failed" : "Refresh stopped"}</strong>
          <span>{refreshFeedback.message}</span>
        </div>
      ) : null}

      {/* ── Header ── */}
      <div className="hero viewer-hero">
        <div>
          <span className="badge brand">Viewing</span>
          <h1>Your Reports &amp; Dashboards</h1>
          <p>Search and filter to find what you need, then click any card to open it.</p>
        </div>
        <div className="link-toolbar viewer-actions">
          <Link className="ghost-button btn-help" to={buildHostedRoute("/help")}>Help &amp; guide</Link>
          <Link className="ghost-button btn-create" to={buildHostedRoute("/studio")}>Build something new</Link>
        </div>
      </div>

      {/* Scope notice */}
      {scopeFilter === "global" && visibleObjects.some((item) => item.scope !== "global") ? (
        <div className="sync-status sync-status-ok">
          <strong>Showing shared content only</strong>
          <span>Switch the Access filter to "All visible" to also see items shared with specific users and your personal items.</span>
        </div>
      ) : null}

      {/* ── Filter bar ── */}
      <div className="viewer-filter-bar">
        <div className="viewer-search-field">
          <ClearableInputField
            label="Search"
            id="viewer-search"
            name="viewerSearch"
            value={query}
            onChange={setQuery}
            placeholder="Search by name, description, folder, or tag…"
          />
        </div>
        <label className="field compact-field">
          <span>Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <option value="all">All types</option>
            <option value="report">Reports only</option>
            <option value="dashboard">Dashboards only</option>
          </select>
        </label>
        <label className="field compact-field">
          <span>Access</span>
          <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}>
            <option value="all">All visible</option>
            <option value="global">Shared with everyone</option>
            <option value="selected">Shared with selected people</option>
            <option value="personal">My personal items</option>
          </select>
        </label>
        {profileOptions.length > 0 && (
          <label className="field compact-field">
            <span>Data source</span>
            <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
              <option value="all">All sources</option>
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label || profile.quickbase.appId || profile.id}</option>
              ))}
            </select>
          </label>
        )}
        <label className="toggle-row">
          <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
          Favorites only
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
          Recently opened
        </label>
      </div>

      {/* Result count */}
      {filtered.length > 0 ? (
        <div className="micro" style={{ color: "var(--text-soft)" }}>
          {filtered.length} result{filtered.length === 1 ? "" : "s"}
          {isFiltered ? " matching your filters" : ""}
        </div>
      ) : null}

      {/* ── Results grid ── */}
      <div className="viewer-grid">
        {filtered.map((object) => (
          <CatalogCard
            key={object.id}
            className="viewer-card"
            object={object}
            studioDocument={studioDocument}
            openLinksInNewTab={openLinksInNewTab}
            isFavorite={favorites.includes(object.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>

      {/* Empty state */}
      {!filtered.length ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", display: "grid", gap: "1rem", justifyItems: "center" }}>
          <span style={{ fontSize: "3rem" }}>{isFiltered ? "🔍" : "📋"}</span>
          <strong style={{ fontSize: "1.1rem" }}>
            {isFiltered ? "No results match your filters" : "Nothing here yet"}
          </strong>
          <p className="micro" style={{ maxWidth: 360, fontSize: "0.9rem" }}>
            {isFiltered
              ? "Try clearing some filters, or change the search term to broaden the results."
              : "Reports and dashboards will appear here once they have been created. Go to the Building area to create your first one."}
          </p>
          {isFiltered ? (
            <button
              className="ghost-button btn-neutral"
              onClick={() => { setQuery(""); setTypeFilter("all"); setScopeFilter("all"); setProfileFilter("all"); setFavoritesOnly(false); setRecentOnly(false); }}
            >
              Clear all filters
            </button>
          ) : (
            <Link className="ghost-button btn-system" to={buildHostedRoute("/studio")}>
              Go to Building area
            </Link>
          )}
        </div>
      ) : null}
    </section>
  );
}
