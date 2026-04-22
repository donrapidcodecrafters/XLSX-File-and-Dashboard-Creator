import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import {
  filterStudioLibraryItems,
  getStudioObjectScopeLabel,
  normalizeStudioDocument,
  resolveStudioSessionStatus,
  touchStudioSession,
  type CatalogSummaryItem,
  type RefreshJobStatus,
  type ReportDefinition,
  type ReportFocusMode,
  type StudioDocument,
  type StudioObject,
  type TableDefinition
} from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { HelpPage } from "./components/HelpPage";
import { HomePage } from "./components/HomePage";
import { RefreshOverlay } from "./components/RefreshOverlay";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { ViewerPage } from "./components/ViewerPage";
import { fetchCatalog, fetchObject, fetchTables, runReport, runReportPage } from "./lib/api";
import { getProfileIdsForCatalogItem, getProfileIdsForObject, resolveTableDefinition, toggleFavoriteIds, typeLabel } from "./lib/catalog";
import { getHostedContext } from "./lib/embed";
import type { QuickbaseTableLinkContext } from "./lib/quickbaseLinks";
import { cancelStudioRefreshJob, fetchStudioDocument, fetchStudioRefreshJob, saveStudioUserSettings, startStudioObjectRefresh, updateStudioSession } from "./lib/studioApi";

const SESSION_RECENT_KEY = "studio-session-recent";

function getQuickbaseLinkContextForTable(table: TableDefinition | undefined, studioDocument: StudioDocument | null): QuickbaseTableLinkContext | null {
  if (!table || !studioDocument) return null;
  const profile = studioDocument.quickbaseProfiles.find((item) => item.id === table.quickbaseProfileId);
  const quickbase = profile?.quickbase || studioDocument.quickbase;
  const realmHostname = String(quickbase.realmHostname || "").trim();
  const tableId = String(table.quickbaseTableId || table.id || "").trim();
  if (!realmHostname || !tableId) return null;
  return {
    realmHostname,
    tableId
  };
}

function useCatalog() {
  const [objects, setObjects] = useState<CatalogSummaryItem[]>([]);
  const [tables, setTables] = useState<TableDefinition[]>([]);
  const [studioDocument, setStudioDocument] = useState<StudioDocument | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = window.sessionStorage.getItem(SESSION_RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });

  const reloadCatalog = useCallback(async () => {
    const [catalogResponse, tablesResponse, studioResponse] = await Promise.all([
      fetchCatalog(),
      fetchTables(),
      fetchStudioDocument().catch(() => null)
    ]);
    setObjects(catalogResponse.objects);
    setTables(tablesResponse.tables);
    if (studioResponse?.document) {
      setStudioDocument(normalizeStudioDocument(studioResponse.document));
    }
  }, []);

  const updateUserSettings = useCallback(async (payload: {
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  }) => {
    const response = await saveStudioUserSettings(payload);
    setStudioDocument(normalizeStudioDocument(response.document));
  }, []);

  const persistSession = useCallback(async (session: Partial<StudioDocument["session"]>) => {
    const response = await updateStudioSession(session);
    setStudioDocument(normalizeStudioDocument(response.document));
  }, []);

  const markObjectAsRecent = useCallback((objectId: string) => {
    if (!objectId) return;
    setRecentIds((current) => {
      const next = [objectId, ...current.filter((item) => item !== objectId)].slice(0, 10);
      try {
        window.sessionStorage.setItem(SESSION_RECENT_KEY, JSON.stringify(next));
      } catch {}
      void updateUserSettings({ recent: next });
      return next;
    });
  }, [updateUserSettings]);

  useEffect(() => {
    void reloadCatalog();
  }, []);

  return { objects, tables, studioDocument, recentIds, reloadCatalog, markObjectAsRecent, updateUserSettings, persistSession, setStudioDocument };
}

function formatTimestamp(value?: string) {
  if (!value) return "Not available yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sessionsMatch(left: StudioDocument["session"] | null | undefined, right: StudioDocument["session"] | null | undefined) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function getDashboardPersonalOverride(dashboardId: string, studioDocument: StudioDocument | null) {
  if (!dashboardId || !studioDocument) return null;
  return studioDocument.personalOverrides.dashboards[dashboardId] || null;
}

function getReportPersonalOverride(reportId: string, studioDocument: StudioDocument | null) {
  if (!reportId || !studioDocument) return null;
  return studioDocument.personalOverrides.reports[reportId] || null;
}

function ObjectPage({
  tables,
  platformName,
  studioDocument,
  openLinksInNewTab = false,
  onObjectViewed,
  onUserSettingsChange,
  onToggleFavorite
}: {
  tables: TableDefinition[];
  platformName: string;
  studioDocument: StudioDocument | null;
  openLinksInNewTab?: boolean;
  onObjectViewed: (objectId: string) => void;
  onUserSettingsChange: (payload: {
    favorites?: string[];
    recent?: string[];
    personalOverrides?: StudioDocument["personalOverrides"];
  }) => Promise<void>;
  onToggleFavorite: (objectId: string) => Promise<void>;
}) {
  const params = useParams();
  const [object, setObject] = useState<StudioObject | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const pageSize = 100;
  const liveModeEnabled = useMemo(
    () => getProfileIdsForObject(object, tables, studioDocument)
      .some((profileId) => studioDocument?.quickbaseProfiles.find((profile) => profile.id === profileId)?.liveMode === true),
    [object, studioDocument, tables]
  );

  async function reloadObject(targetObjectId = params.objectId) {
    if (!targetObjectId) return;
    setLoading(true);
    try {
      const response = await fetchObject(targetObjectId);
      setObject(response.object);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!params.objectId) return;
    let active = true;
    setLoading(true);
    setRefreshNonce(0);
    setRefreshJob(null);
    fetchObject(params.objectId)
      .then((response) => {
        if (!active) return;
        const reportOverride = response.object.type === "report" && response.object.scope === "global"
          ? getReportPersonalOverride(response.object.id, studioDocument)
          : null;
        setPage(reportOverride?.currentPage || 1);
        setObject(response.object);
        setResult(null);
        onObjectViewed(response.object.id);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onObjectViewed, params.objectId]);

  useEffect(() => {
    if (object) {
      document.title = object.name + " · " + platformName;
    }
  }, [object, platformName]);

  useEffect(() => {
    if (!object || object.type !== "report" || object.scope !== "global") return;
    const reportOverride = getReportPersonalOverride(object.id, studioDocument);
    const overridePage = Math.max(1, reportOverride?.currentPage || 1);
    if (overridePage !== page) {
      setPage(overridePage);
    }
  }, [object?.id, object?.scope, object?.type, studioDocument]);

  useEffect(() => {
    if (!object || object.type !== "report") return;
    let active = true;
    setLoading(true);
    const fetcher = page === 1
      ? runReport(object.id, [], { forceLive: liveModeEnabled })
      : runReportPage(object.id, page, pageSize, [], { forceLive: liveModeEnabled });
    fetcher
      .then((reportResult) => {
        if (!active) return;
        setRefreshJob(reportResult.refreshJob || null);
        setResult((current: any) => page === 1 || !current
          ? reportResult
          : {
              ...current,
              rows: reportResult.rows,
              totalRows: reportResult.totalRows,
              page: reportResult.page,
              pageSize: reportResult.pageSize,
              totalPages: reportResult.totalPages,
              hasNextPage: reportResult.hasNextPage
            });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [liveModeEnabled, object?.id, object?.type, page, refreshNonce]);

  useEffect(() => {
    if (!refreshJob || refreshJob.status === "complete" || refreshJob.status === "failed" || refreshJob.status === "cancelled") return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then((response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshJob(null);
            setRefreshNonce((current) => current + 1);
            setLoading(true);
          } else if (response.job.status === "cancelled") {
            setRefreshJob(null);
            setLoading(false);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [refreshJob]);

  async function startObjectRefresh() {
    if (!object) return;
    const response = await startStudioObjectRefresh(object.id);
    setRefreshJob(response.job);
  }

  async function cancelObjectRefresh() {
    if (!refreshJob?.id) return;
    const refreshJobId = refreshJob.id;
    setRefreshJob(null);
    setLoading(false);
    await cancelStudioRefreshJob(refreshJobId).catch(() => undefined);
  }

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;
  if (object.scope === "personal" && String(studioDocument?.session.currentUserId || "").trim() !== String(object.ownerUserId || "").trim()) {
    return <div className="empty-page">That personal report or dashboard is not available for this session.</div>;
  }

  if (object.type === "report") {
    const table = resolveTableDefinition(tables, object.sourceTableId);
    const quickbaseLinkContext = getQuickbaseLinkContextForTable(table, studioDocument);
    const personalOverride = object.scope === "global" ? getReportPersonalOverride(object.id, studioDocument) : null;
    return (
      <>
        {liveModeEnabled ? (
          <div className="sync-status sync-status-warn">
            <strong>Live mode enabled</strong>
            <span>This report is loading live Quickbase data directly, so loading can take significantly longer.</span>
          </div>
        ) : null}
        {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
          <RefreshOverlay title="Refreshing this report" job={refreshJob} onCancel={() => { void cancelObjectRefresh(); }} />
        ) : null}
        <ReportView
          report={object as ReportDefinition}
          table={table}
          quickbaseLinkContext={quickbaseLinkContext}
          result={result}
          loading={loading}
          currentPage={page}
          onPageChange={setPage}
          onRefresh={() => { void startObjectRefresh(); }}
          initialFocusMode={(personalOverride?.focusMode || "default") as ReportFocusMode}
          initialFocusedSection={personalOverride?.focusedSection || ""}
          savedViews={personalOverride?.savedViews || []}
          onSaveView={(view) => {
            if (object.scope !== "global" || !studioDocument) return;
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage: Math.max(1, page || 1),
                  focusMode: personalOverride?.focusMode || "default",
                  focusedSection: personalOverride?.focusedSection || "",
                  savedViews: [...(personalOverride?.savedViews || []), { ...view, updatedAt: new Date().toISOString() }],
                  updatedAt: new Date().toISOString()
                }
              }
            };
            void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
          }}
          onDeleteView={(viewId) => {
            if (object.scope !== "global" || !studioDocument) return;
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage: Math.max(1, personalOverride?.currentPage || 1),
                  focusMode: (personalOverride?.focusMode || "default") as ReportFocusMode,
                  focusedSection: personalOverride?.focusedSection || "",
                  savedViews: (personalOverride?.savedViews || []).filter((view) => view.id !== viewId),
                  updatedAt: new Date().toISOString()
                }
              }
            };
            void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
          }}
          onStateChange={(state) => {
            if (object.scope !== "global" || !studioDocument) return;
            const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
              ...studioDocument.personalOverrides,
              reports: {
                ...studioDocument.personalOverrides.reports,
                [object.id]: {
                  currentPage: Math.max(1, state.currentPage || 1),
                  focusMode: state.focusMode,
                  focusedSection: state.focusedSection,
                  savedViews: personalOverride?.savedViews || [],
                  updatedAt: new Date().toISOString()
                }
              }
            };
            void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
          }}
          isFavorite={(studioDocument?.favorites || []).includes(object.id)}
          onToggleFavorite={() => { void onToggleFavorite(object.id); }}
          openLinksInNewTab={openLinksInNewTab}
        />
      </>
    );
  }

  const personalOverride = object.scope === "global" ? getDashboardPersonalOverride(object.id, studioDocument) : null;

  return (
    <>
      {liveModeEnabled ? (
        <div className="sync-status sync-status-warn">
          <strong>Live mode enabled</strong>
          <span>This dashboard is loading live Quickbase data directly, so loading can take significantly longer.</span>
        </div>
      ) : null}
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
        <RefreshOverlay title="Refreshing this dashboard" job={refreshJob} onCancel={() => { void cancelObjectRefresh(); }} />
      ) : null}
      <DashboardView
        dashboard={object}
        tables={tables}
        getQuickbaseLinkContext={(tableId) => getQuickbaseLinkContextForTable(resolveTableDefinition(tables, tableId), studioDocument)}
        refreshNonce={refreshNonce}
        onRefresh={() => { void startObjectRefresh(); }}
        initialRuntimeFilters={personalOverride?.runtimeFilters}
        initialActiveTabId={personalOverride?.activeTabId}
        initialFocusedWidgetId={personalOverride?.focusedWidgetId}
        savedViews={personalOverride?.savedViews || []}
        onSaveView={(view) => {
          if (object.scope !== "global" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: personalOverride?.runtimeFilters || {},
                activeTabId: personalOverride?.activeTabId || "",
                focusedWidgetId: personalOverride?.focusedWidgetId || "",
                savedViews: [...(personalOverride?.savedViews || []), { ...view, updatedAt: new Date().toISOString() }],
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        onDeleteView={(viewId) => {
          if (object.scope !== "global" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: personalOverride?.runtimeFilters || {},
                activeTabId: personalOverride?.activeTabId || "",
                focusedWidgetId: personalOverride?.focusedWidgetId || "",
                savedViews: (personalOverride?.savedViews || []).filter((view) => view.id !== viewId),
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        isFavorite={(studioDocument?.favorites || []).includes(object.id)}
        onToggleFavorite={() => { void onToggleFavorite(object.id); }}
        onStateChange={(state) => {
          if (object.scope !== "global" || !studioDocument) return;
          const nextPersonalOverrides: StudioDocument["personalOverrides"] = {
            ...studioDocument.personalOverrides,
            dashboards: {
              ...studioDocument.personalOverrides.dashboards,
              [object.id]: {
                runtimeFilters: state.runtimeFilters,
                activeTabId: state.activeTabId,
                focusedWidgetId: state.focusedWidgetId,
                savedViews: personalOverride?.savedViews || [],
                updatedAt: new Date().toISOString()
              }
            }
          };
          void onUserSettingsChange({ personalOverrides: nextPersonalOverrides });
        }}
        forceLive={liveModeEnabled}
        openLinksInNewTab={openLinksInNewTab}
        onRefreshJobDetected={(job: RefreshJobStatus | null) => setRefreshJob(job)}
      />
    </>
  );
}

export function App() {
  const { objects, tables, studioDocument, recentIds, reloadCatalog, markObjectAsRecent, updateUserSettings, persistSession, setStudioDocument } = useCatalog();
  const location = useLocation();
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const lastSessionTouchAt = useRef(0);
  const currentUserId = String(studioDocument?.session.currentUserId || "").trim();
  const sessionStatus = useMemo(
    () => studioDocument ? resolveStudioSessionStatus(studioDocument) : null,
    [studioDocument]
  );
  const bootstrapIssues = useMemo(
    () => (studioDocument?.quickbaseProfiles || []).filter((profile) => !profile.bootstrap.ready || profile.bootstrap.autoProvisioned || profile.bootstrap.error),
    [studioDocument]
  );
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(objects, { currentUserId }),
    [currentUserId, objects]
  );
  const [studioSettingsSignal, setStudioSettingsSignal] = useState(0);
  const [studioRefreshSignal, setStudioRefreshSignal] = useState(0);
  const [viewerRefreshSignal, setViewerRefreshSignal] = useState(0);
  const [homeRefreshSignal, setHomeRefreshSignal] = useState(0);
  const homeRoute = location.pathname === "/";
  const helpRoute = location.pathname === "/help";
  const studioRoute = location.pathname.startsWith("/studio");
  const viewerRoute = location.pathname === "/viewer";
  const readerRoute = /^\/(report|dashboard)\//.test(location.pathname);
  const platformName = studioDocument?.branding.platformName || "Reporting Portal";
  const openLinksInNewTab = studioDocument?.branding.openLinksInNewTab === true;
  const navLabel = studioDocument?.branding.navigationLabel || "Reports and Dashboards";
  const readerFullScreen = readerRoute || hosted.mode === "viewer" || hosted.embed;
  const hideSidebar = hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute || helpRoute;
  const toggleFavorite = useCallback(async (objectId: string) => {
    if (!studioDocument) return;
    const next = toggleFavoriteIds(studioDocument.favorites || [], objectId);
    await updateUserSettings({ favorites: next });
  }, [studioDocument, updateUserSettings]);

  useEffect(() => {
    void reloadCatalog();
  }, [location.pathname, reloadCatalog]);

  useEffect(() => {
    if (!studioDocument || !hosted.launchSource) return;
    const nextSession = touchStudioSession(studioDocument.session, {
      now: Date.now(),
      relaunch: true,
      launchSource: hosted.launchSource,
      currentUserId: hosted.userId || studioDocument.session.currentUserId,
      requiresLaunch: true
    });
    if (sessionsMatch(studioDocument.session, nextSession)) return;
    setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: nextSession }) : current);
    void persistSession(nextSession).catch(() => undefined);
  }, [hosted.launchSource, hosted.userId, persistSession, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (!studioDocument || !sessionStatus?.valid) return;
    const touch = () => {
      const now = Date.now();
      if (now - lastSessionTouchAt.current < 60_000) return;
      lastSessionTouchAt.current = now;
      const nextSession = touchStudioSession(studioDocument.session, { now });
      setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: nextSession }) : current);
      void persistSession(nextSession).catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") touch();
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [persistSession, sessionStatus?.valid, setStudioDocument, studioDocument]);

  useEffect(() => {
    if (readerRoute) return;
    if (homeRoute) {
      document.title = `${platformName} · Home`;
      return;
    }
    if (studioRoute) {
      document.title = `${platformName} · Building`;
      return;
    }
    if (helpRoute) {
      document.title = `${platformName} · Help`;
      return;
    }
    if (viewerRoute || location.pathname === "/") {
      document.title = `${platformName} · Viewing`;
      return;
    }
    document.title = platformName;
  }, [helpRoute, homeRoute, location.pathname, platformName, readerRoute, studioRoute, viewerRoute]);

  if (studioDocument && sessionStatus && !sessionStatus.valid) {
    return (
      <div className="app-shell">
        <main className="content">
          <div className="empty-page">
            <h1>Session expired</h1>
            <p>{sessionStatus.message}</p>
            <p>Last activity: {formatTimestamp(studioDocument.session.lastActivityAt)}</p>
            <p>Expired: {formatTimestamp(sessionStatus.expiresAt)}</p>
            {studioDocument.session.launchSource === "local-dev" ? (
              <button
                onClick={() => {
                  const nextSession = touchStudioSession(studioDocument.session, {
                    now: Date.now(),
                    relaunch: true,
                    launchSource: "local-dev",
                    currentUserId: studioDocument.session.currentUserId
                  });
                  setStudioDocument((current) => current ? normalizeStudioDocument({ ...current, session: nextSession }) : current);
                  void persistSession(nextSession).catch(() => undefined);
                }}
              >
                Resume local session
              </button>
            ) : null}
            <p className="micro">Production relaunches should come from the Quickbase dashboard button so the platform receives fresh launch context.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell ${hosted.embed ? "embed-shell" : ""} ${readerFullScreen ? "reader-shell" : ""}`}>
      {hosted.embed || readerRoute ? null : (
        <header className="topbar">
          <div>
            <div className="eyebrow">{homeRoute ? "Home" : studioRoute ? "Building" : viewerRoute ? "Viewing" : helpRoute ? "Help" : "Viewer"}</div>
            <h1>{platformName}</h1>
          </div>
          <div className="topbar-meta">
            <div className="topbar-nav">
              <NavLink end className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/">Home</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/studio">Building</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/viewer">Viewing</NavLink>
            </div>
            {studioRoute ? (
              <>
                <button className="ghost-button topbar-action" onClick={() => setStudioRefreshSignal((value) => value + 1)}>Refresh all</button>
                <button className="ghost-button topbar-action" onClick={() => setStudioSettingsSignal((value) => value + 1)}>Settings</button>
              </>
            ) : null}
            {homeRoute ? (
              <button className="ghost-button topbar-action" onClick={() => setHomeRefreshSignal((value) => value + 1)}>Refresh all</button>
            ) : null}
            {viewerRoute ? (
              <button className="ghost-button topbar-action" onClick={() => setViewerRefreshSignal((value) => value + 1)}>Refresh all</button>
            ) : null}
            {!helpRoute ? <Link className="ghost-button topbar-action" to="/help">Help</Link> : null}
            <span className="badge">{hosted.mode === "viewer" ? "Full-screen view" : navLabel}</span>
            <span className="badge brand">{visibleObjects.length} saved views</span>
          </div>
        </header>
      )}

      <div className={`main-layout ${hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute ? "embed-layout" : ""} ${readerRoute ? "reader-layout" : ""}`}>
        {hideSidebar ? null : (
          <aside className="sidebar">
            <div className="sidebar-head">
              <strong>{navLabel}</strong>
              <span className="micro">Open a report or dashboard directly.</span>
            </div>
            <nav className="nav-list">
              {visibleObjects.map((object) => (
                <Link key={object.id} className="nav-card" to={`/${object.type}/${object.id}`} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
                  <span className="badge">{typeLabel(object.type)}</span>
                  <span className="badge">{getStudioObjectScopeLabel(object)}</span>
                  <strong>{object.name}</strong>
                  <span className="micro">{object.folder} · {object.category}</span>
                </Link>
              ))}
            </nav>
          </aside>
        )}

        <main className={`content ${readerRoute ? "reader-content" : ""}`}>
          {bootstrapIssues.length ? (
            <section className={`sync-status ${bootstrapIssues.some((profile) => profile.bootstrap.error || !profile.bootstrap.ready) ? "sync-status-warn" : "sync-status-ok"}`}>
              <strong>{bootstrapIssues.some((profile) => profile.bootstrap.error || !profile.bootstrap.ready) ? "Quickbase setup needs attention" : "Quickbase setup updated"}</strong>
              <div className="stack">
                {bootstrapIssues.map((profile) => (
                  <div key={profile.id}>
                    <strong>{profile.label}</strong>
                    <span>{` ${profile.bootstrap.message}`}</span>
                    {profile.bootstrap.missing.length ? <div className="micro">Missing: {profile.bootstrap.missing.join(", ")}</div> : null}
                    {profile.bootstrap.warnings.length ? <div className="micro">Warnings: {profile.bootstrap.warnings.join(", ")}</div> : null}
                    {profile.bootstrap.error ? <div className="micro">Error: {profile.bootstrap.error}</div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <Routes>
            <Route path="/" element={<HomePage objects={objects} studioDocument={studioDocument} recentIds={recentIds} refreshAllSignal={homeRefreshSignal} openLinksInNewTab={openLinksInNewTab} onRefreshComplete={reloadCatalog} onToggleFavorite={toggleFavorite} />} />
            <Route path="/viewer" element={<ViewerPage objects={objects} studioDocument={studioDocument} recentIds={recentIds} refreshAllSignal={viewerRefreshSignal} openLinksInNewTab={openLinksInNewTab} onRefreshComplete={reloadCatalog} onToggleFavorite={toggleFavorite} />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/studio" element={<StudioPage openSettingsSignal={studioSettingsSignal} refreshAllSignal={studioRefreshSignal} />} />
            <Route path="/studio/:objectId" element={<StudioPage openSettingsSignal={studioSettingsSignal} refreshAllSignal={studioRefreshSignal} />} />
            <Route path="/:type/:objectId" element={<ObjectPage tables={tables} platformName={platformName} studioDocument={studioDocument} openLinksInNewTab={openLinksInNewTab} onObjectViewed={markObjectAsRecent} onUserSettingsChange={updateUserSettings} onToggleFavorite={toggleFavorite} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
