import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildStudioCatalogItemLookup,
  filterStudioLibraryItems,
  getStudioObjectScopeLabel,
  isStudioItemVisibleToCurrentUser,
  type CatalogSummaryItem,
  type StudioDocument
} from "@studio/shared";
import { fetchStudioRefreshJob, fetchStudioSources, startStudioRefresh, type StudioSourceSummary } from "../lib/studioApi";
import { getProfileIdsForCatalogItem, typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { CatalogCard } from "./CatalogCard";
import { RefreshOverlay } from "./RefreshOverlay";

function formatTimestamp(value?: string) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatCard({ label, value, detail, accent }: {
  label: string; value: string | number; detail?: string; accent?: boolean;
}) {
  return (
    <div style={{
      display: "grid",
      gap: "0.375rem",
      padding: "1.25rem 1.25rem 1rem",
      borderRadius: 16,
      background: accent ? "var(--brand-light)" : "var(--surface)",
      border: accent ? "1px solid var(--brand-border, var(--brand-light))" : "1px solid var(--border)",
      boxShadow: "0 2px 8px rgba(22,39,31,0.05)",
    }}>
      <span style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent ? "var(--brand)" : "var(--text-soft)" }}>
        {label}
      </span>
      <strong style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.025em", color: accent ? "var(--brand-deep)" : "var(--text)", lineHeight: 1.1 }}>
        {value}
      </strong>
      {detail ? <span style={{ fontSize: "0.8rem", color: "var(--text-soft)", lineHeight: 1.4 }}>{detail}</span> : null}
    </div>
  );
}

function SectionCard({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="card home-section-card">
      <div className="card-head">
        <div>
          <strong>{title}</strong>
          {subtitle ? <div className="micro">{subtitle}</div> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon, message, action }: { icon: string; message: string; action?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 1rem", display: "grid", gap: "0.75rem", justifyItems: "center" }}>
      <span style={{ fontSize: "2.5rem", lineHeight: 1 }}>{icon}</span>
      <span className="micro" style={{ fontSize: "0.875rem", maxWidth: 300 }}>{message}</span>
      {action ? action : null}
    </div>
  );
}

export function HomePage({
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
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const [startingRefresh, setStartingRefresh] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<{ tone: "warn" | "danger"; message: string } | null>(null);
  const [postgresSources, setPostgresSources] = useState<StudioSourceSummary[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  // Load actual Postgres source data on mount — this is what's really in the database
  useEffect(() => {
    setSourcesLoading(true);
    fetchStudioSources()
      .then((result) => setPostgresSources(result.sources || []))
      .catch(() => {})
      .finally(() => setSourcesLoading(false));
  }, []);

  const currentUserId = String(studioDocument?.session.currentUserId || "").trim();
  const activeQuickbaseProfileId = studioDocument?.activeQuickbaseProfileId || studioDocument?.quickbaseProfiles[0]?.id || "";
  const platformName = studioDocument?.branding.platformName || studioDocument?.branding.homeLabel || "Reporting Portal";

  const catalogLookup = useMemo(
    () => buildStudioCatalogItemLookup(objects, studioDocument?.bundle.objects),
    [objects, studioDocument]
  );
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(objects, { currentUserId }),
    [currentUserId, objects]
  );
  const sharedObjects = useMemo(
    () => [...visibleObjects.filter((item) => item.scope !== "personal")].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ),
    [visibleObjects]
  );
  const personalObjects = useMemo(
    () => [...visibleObjects.filter((item) => item.scope === "personal")].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ),
    [visibleObjects]
  );

  const reports = sharedObjects.filter((o) => o.type === "report");
  const dashboards = sharedObjects.filter((o) => o.type === "dashboard");

  const recentSharedObjects = recentIds
    .map((id) => catalogLookup.get(id))
    .filter((item): item is CatalogSummaryItem =>
      Boolean(item) && item!.scope !== "personal" && isStudioItemVisibleToCurrentUser(item!, currentUserId)
    )
    .slice(0, 6);

  const favoriteSharedObjects = (studioDocument?.favorites || [])
    .map((id) => catalogLookup.get(id))
    .filter((item): item is CatalogSummaryItem =>
      Boolean(item) && item!.scope !== "personal" && isStudioItemVisibleToCurrentUser(item!, currentUserId)
    )
    .slice(0, 6);

  const personalHighlights = Array.from(new Map(
    [
      ...(studioDocument?.favorites || []).map((id) => catalogLookup.get(id)).filter(
        (item): item is CatalogSummaryItem => Boolean(item) && item!.scope === "personal" && isStudioItemVisibleToCurrentUser(item!, currentUserId)
      ),
      ...recentIds.map((id) => catalogLookup.get(id)).filter(
        (item): item is CatalogSummaryItem => Boolean(item) && item!.scope === "personal" && isStudioItemVisibleToCurrentUser(item!, currentUserId)
      ),
      ...personalObjects
    ].map((item) => [item.id, item])
  ).values()).slice(0, 6);

  const appBrowseGroups = useMemo(() => {
    const profiles = studioDocument?.quickbaseProfiles || [];
    const grouped = profiles.map((profile) => ({
      id: profile.id,
      label: profile.label || "Quickbase App",
      items: sharedObjects.filter((item) => getProfileIdsForCatalogItem(item, studioDocument).includes(profile.id)).slice(0, 8)
    })).filter((g) => g.items.length > 0);
    const unassigned = sharedObjects.filter((item) => getProfileIdsForCatalogItem(item, studioDocument).length === 0).slice(0, 8);
    if (unassigned.length) grouped.push({ id: "general", label: "General", items: unassigned });
    return grouped;
  }, [sharedObjects, studioDocument]);

  const recentOrLatest = recentSharedObjects.length ? recentSharedObjects : sharedObjects.slice(0, 6);
  const favoritesOrFeatured = favoriteSharedObjects.length ? favoriteSharedObjects : [...dashboards, ...reports].slice(0, 6);
  const appProfiles = studioDocument?.quickbaseProfiles || [];

  const totalCachedRows = postgresSources.reduce((sum, s) => sum + (s.rowCount || 0), 0);
  const lastRefreshAt = studioDocument?.sync.refreshStatus.lastSuccessAt;
  const nextRefreshAt = studioDocument?.sync.refreshStatus.nextRunAt;
  const refreshRunning = studioDocument?.sync.refreshStatus.running;
  const hasContent = objects.length > 0;

  const settingsRoute = useMemo(() => {
    const route = buildHostedRoute("/studio");
    return { ...route, search: route.search ? `${route.search}&panel=settings` : "?panel=settings" };
  }, []);

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
    <section className="surface home-page">
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

      <div className="home-shell">

        {/* ── Hero ── */}
        <section className="home-hero-panel">
          <div className="home-hero-copy">
            <span className="badge brand">Home</span>
            <h1>{platformName}</h1>
            <p>
              {hasContent
                ? `${objects.length} report${objects.length === 1 ? "" : "s"} and dashboard${dashboards.length === 1 ? "" : "s"} ready to open.`
                : "Welcome. Get started by opening a report below or browsing the full library."}
            </p>
          </div>
          <div className="home-hero-actions">
            <Link className="ghost-button btn-system" to={buildHostedRoute("/viewer")}>Browse all reports &amp; dashboards</Link>
            <button className="ghost-button btn-system" onClick={() => { void startFullRefresh(); }} disabled={startingRefresh || Boolean(refreshJob)}>
              {refreshRunning ? "Refreshing…" : "Refresh now"}
            </button>
            <Link className="ghost-button btn-create" to={buildHostedRoute("/studio")}>Build something new</Link>
            <Link className="ghost-button btn-help" to={buildHostedRoute("/help")}>Help &amp; guide</Link>
          </div>
          <div className="home-highlight-grid">
            <StatCard
              label="Data in Database"
              value={totalCachedRows > 0 ? `${totalCachedRows.toLocaleString()} rows` : postgresSources.length > 0 ? "No data yet" : "No sources yet"}
              detail={postgresSources.length > 0 ? `${postgresSources.length} source${postgresSources.length === 1 ? "" : "s"} in database · Last synced ${formatTimestamp(lastRefreshAt)}` : "Import an Excel file or connect Quickbase to get started"}
              accent
            />
            <StatCard
              label="Reports & dashboards"
              value={objects.length > 0 ? objects.length : "None yet"}
              detail={objects.length > 0
                ? `${reports.length} report${reports.length === 1 ? "" : "s"} · ${dashboards.length} dashboard${dashboards.length === 1 ? "" : "s"}`
                : "Go to Building to create your first report"}
            />
            <StatCard
              label="Auto-Sync Schedule"
              value={nextRefreshAt ? formatTimestamp(nextRefreshAt) : "Not configured"}
              detail={appProfiles.length ? `${appProfiles.length} data connection${appProfiles.length === 1 ? "" : "s"}` : "Set up in Settings → Data Refresh"}
            />
          </div>
        </section>

        <section className="home-main-grid">
          <div className="home-column home-column-wide">

            {/* Recent / Latest */}
            <SectionCard
              title={recentSharedObjects.length ? "Recently Opened" : "Latest Content"}
              subtitle={recentSharedObjects.length ? "Pick up where you left off" : "The most recently updated reports and dashboards"}
              action={<Link className="ghost-button" to={buildHostedRoute("/viewer")} style={{ fontSize: "0.8rem", minHeight: 30, padding: "0 10px", boxShadow: "none" }}>See all</Link>}
            >
              {recentOrLatest.length ? (
                <div className="viewer-grid home-object-grid">
                  {recentOrLatest.map((object) => (
                    <CatalogCard
                      key={object.id}
                      className="home-object-card"
                      object={object}
                      studioDocument={studioDocument}
                      openLinksInNewTab={openLinksInNewTab}
                      isFavorite={(studioDocument?.favorites || []).includes(object.id)}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="📊"
                  message="No reports or dashboards have been created yet."
                  action={<Link className="ghost-button btn-create" to={buildHostedRoute("/studio")} style={{ fontSize: "0.875rem" }}>Create your first report</Link>}
                />
              )}
            </SectionCard>

            {/* Favorites / Featured */}
            <SectionCard
              title={favoriteSharedObjects.length ? "Your Favorites" : "Featured"}
              subtitle={favoriteSharedObjects.length ? "Reports and dashboards you starred" : "Top shared content across all connected apps"}
            >
              {favoritesOrFeatured.length ? (
                <div className="viewer-grid home-object-grid">
                  {favoritesOrFeatured.map((object) => (
                    <CatalogCard
                      key={object.id}
                      className="home-object-card"
                      object={object}
                      studioDocument={studioDocument}
                      openLinksInNewTab={openLinksInNewTab}
                      isFavorite={(studioDocument?.favorites || []).includes(object.id)}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="⭐"
                  message="Star any report or dashboard to pin it here for quick access."
                />
              )}
            </SectionCard>

            {/* Personal items */}
            {personalObjects.length > 0 ? (
              <SectionCard
                title="My Personal Items"
                subtitle="Only you can see these — they are not shared with anyone else"
              >
                <div className="viewer-grid home-object-grid">
                  {personalHighlights.map((object) => (
                    <CatalogCard
                      key={object.id}
                      className="home-object-card"
                      object={object}
                      studioDocument={studioDocument}
                      openLinksInNewTab={openLinksInNewTab}
                      isFavorite={(studioDocument?.favorites || []).includes(object.id)}
                      onToggleFavorite={onToggleFavorite}
                    />
                  ))}
                </div>
              </SectionCard>
            ) : null}

            {/* Browse by app */}
            {appBrowseGroups.length > 0 ? (
              <SectionCard
                title="Browse by Connected App"
                subtitle="Reports and dashboards organized by their connected data source"
              >
                <div className="home-app-browser">
                  {appBrowseGroups.map((group) => (
                    <div className="home-app-browse-card" key={group.id}>
                      <div className="home-app-browse-head">
                        <strong>{group.label}</strong>
                        <span className="micro">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                      </div>
                      <div className="home-app-browse-links">
                        {group.items.map((object) => (
                          <Link
                            key={object.id}
                            className="home-app-browse-link"
                            to={buildHostedRoute(`/${object.type}/${object.id}`)}
                            target={openLinksInNewTab ? "_blank" : undefined}
                            rel={openLinksInNewTab ? "noreferrer" : undefined}
                          >
                            <span className="badge">{typeLabel(object.type)}</span>
                            <span className="badge">{getStudioObjectScopeLabel(object)}</span>
                            <strong>{object.name}</strong>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}
          </div>

          {/* ── Right sidebar ── */}
          <div className="home-column">

            <SectionCard title="Data Status" subtitle="Connected data sources and sync status">
              <div className="home-status-list">
                <div className="home-status-item">
                  <strong>Rows in database</strong>
                  <span>{sourcesLoading ? "Loading…" : totalCachedRows > 0 ? totalCachedRows.toLocaleString() : "None yet"}</span>
                </div>
                <div className="home-status-item">
                  <strong>Sources loaded</strong>
                  <span>{sourcesLoading ? "Loading…" : postgresSources.length > 0 ? `${postgresSources.length} source${postgresSources.length === 1 ? "" : "s"}` : "No sources yet"}</span>
                </div>
                <div className="home-status-item">
                  <strong>Last synced</strong>
                  <span>{formatTimestamp(lastRefreshAt) === "Not yet" ? "Never — run a refresh to pull data" : formatTimestamp(lastRefreshAt)}</span>
                </div>
                <div className="home-status-item">
                  <strong>Next automatic update</strong>
                  <span>{nextRefreshAt ? formatTimestamp(nextRefreshAt) : "No schedule set — configure one in Settings"}</span>
                </div>
                {studioDocument?.sync.refreshStatus.message ? (
                  <div className="home-status-item">
                    <strong>Status message</strong>
                    <span>{studioDocument.sync.refreshStatus.message}</span>
                  </div>
                ) : null}
                <div className="home-status-item">
                  <strong>Your favorites</strong>
                  <span>{(studioDocument?.favorites || []).length === 0 ? "None starred yet — click ★ on any report" : `${(studioDocument?.favorites || []).length} saved`}</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Connected Data Sources" subtitle="Refresh status for each data connection">
              {appProfiles.length ? (
                <div className="home-app-list">
                  {appProfiles.map((profile) => (
                    <div className="home-app-item" key={profile.id}>
                      <div className="home-app-head">
                        <strong>{profile.label || "Quickbase"}</strong>
                        <span className="badge">{profile.liveMode ? "Live" : "Cached"}</span>
                      </div>
                      <span className="micro">Last update: {formatTimestamp(profile.refreshStatus.lastSuccessAt)}</span>
                      <span className="micro">Next update: {profile.refreshStatus.nextRunAt ? formatTimestamp(profile.refreshStatus.nextRunAt) : "Not scheduled"}</span>
                      {(profile.refreshStatus.cachedRowCount || 0) > 0 ? (
                        <span className="micro">{(profile.refreshStatus.cachedRowCount || 0).toLocaleString()} rows ready for instant loading</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="🔗"
                  message="No data sources connected yet. Go to Settings to connect your first Quickbase app or import an Excel file."
                  action={<Link className="ghost-button btn-neutral" to={settingsRoute} style={{ fontSize: "0.875rem" }}>Open Settings</Link>}
                />
              )}
            </SectionCard>

          </div>
        </section>
      </div>
    </section>
  );
}
