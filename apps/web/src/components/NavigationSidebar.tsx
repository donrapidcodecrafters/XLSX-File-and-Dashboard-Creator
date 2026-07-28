import { useState, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { groupStudioLibraryItemsByFolder, type FolderDefinition } from "@studio/shared";
import type { PlatformUser } from "../lib/studioApi";
import { useReaderToolsNode } from "../contexts/ReaderToolsContext";
import { useFolderCollapseState } from "../lib/folders";

const DEVELOPER_EMAIL = "don@rapidcodecrafters.com";
const SIDEBAR_PINNED_KEY = "sidebar-pinned";
const DRAG_OBJECT_ID_MIME = "application/x-studio-object-id";

interface NavObject {
  id: string;
  type: "report" | "dashboard" | string;
  name: string;
  folderId: string;
  category?: string;
}

export interface NavigationSidebarProps {
  currentUser: PlatformUser | null;
  onSignOut: () => void;
  onOpenSettings?: () => void;
  onPinnedChange?: (pinned: boolean) => void;
  objects?: NavObject[];
  folders?: FolderDefinition[];
  onMoveToFolder?: (objectId: string, folderId: string) => void;
  onCreateFolder?: (name: string) => Promise<string | undefined>;
  /** When false (auth disabled / dev mode) show all nav items regardless of role */
  authRequired?: boolean;
  /** Effective permission map for this user — used to hide inaccessible nav items */
  permissions?: Record<string, boolean>;
}

// ── Accordion sub-group (Dashboards / Reports) ───────────────────────────────
function AccordionGroup({
  label,
  items,
  foldersById,
  scopeKey,
  openLinksInNewTab,
  onMoveToFolder,
}: {
  label: string;
  items: NavObject[];
  foldersById: Record<string, FolderDefinition>;
  scopeKey: string;
  openLinksInNewTab: boolean;
  onMoveToFolder?: (objectId: string, folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { toggleFolder, isCollapsed } = useFolderCollapseState(scopeKey);
  if (!items.length) return null;

  const { unfoldered, byFolderId } = groupStudioLibraryItemsByFolder(items);
  const folderIds = Object.keys(byFolderId);

  function renderItem(obj: NavObject) {
    return (
      <Link
        key={obj.id}
        to={`/${obj.type}/${obj.id}`}
        className="nav-accordion-item"
        target={openLinksInNewTab ? "_blank" : undefined}
        rel={openLinksInNewTab ? "noreferrer" : undefined}
        title={obj.name}
        draggable={Boolean(onMoveToFolder)}
        onDragStart={(event) => event.dataTransfer.setData(DRAG_OBJECT_ID_MIME, obj.id)}
      >
        <span className="nav-accordion-item-name">{obj.name}</span>
        {obj.category && (
          <span className="nav-accordion-item-meta">{obj.category}</span>
        )}
      </Link>
    );
  }

  return (
    <div className="nav-accordion-group">
      {/* Sub-group toggle */}
      <button
        type="button"
        className="nav-accordion-group-toggle"
        onClick={() => setOpen((o) => !o)}
        title={`${open ? "Collapse" : "Expand"} ${label}`}
      >
        <span className="nav-accordion-group-chevron">{open ? "▾" : "▸"}</span>
        <span className="nav-accordion-group-label">{label}</span>
        <span className="nav-accordion-group-count">{items.length}</span>
      </button>

      {/* Items — animated via grid trick */}
      <div className={`nav-accordion-group-body${open ? " open" : ""}`}>
        <div>
          {folderIds.map((folderId) => {
            const folderName = foldersById[folderId]?.name || "Untitled folder";
            const collapsed = isCollapsed(folderId);
            return (
              <div key={folderId}>
                <button
                  type="button"
                  className="nav-accordion-folder"
                  onClick={() => toggleFolder(folderId)}
                  onDragOver={(event) => { if (onMoveToFolder) event.preventDefault(); }}
                  onDrop={(event) => {
                    const objectId = event.dataTransfer.getData(DRAG_OBJECT_ID_MIME);
                    if (objectId) onMoveToFolder?.(objectId, folderId);
                  }}
                  title={`${collapsed ? "Expand" : "Collapse"} ${folderName}`}
                >
                  <span className="nav-accordion-group-chevron">{collapsed ? "▸" : "▾"}</span>
                  <span>{folderName}</span>
                  <span className="nav-accordion-group-count">{byFolderId[folderId].length}</span>
                </button>
                {!collapsed && byFolderId[folderId].map(renderItem)}
              </div>
            );
          })}
          {unfoldered.map(renderItem)}
        </div>
      </div>
    </div>
  );
}

// ── Main NavigationSidebar ───────────────────────────────────────────────────
export function NavigationSidebar({
  currentUser,
  onSignOut,
  onOpenSettings,
  onPinnedChange,
  objects = [],
  folders = [],
  onMoveToFolder,
  onCreateFolder,
  authRequired = true,
  permissions = {},
}: NavigationSidebarProps) {
  useLocation(); // re-render on route change for active state
  const [pinned, setPinned] = useState<boolean>(() => {
    try { return window.localStorage.getItem(SIDEBAR_PINNED_KEY) === "true"; } catch { return false; }
  });
  const [contentOpen, setContentOpen] = useState(false);

  const isDeveloper = currentUser?.email === DEVELOPER_EMAIL;
  // When auth is disabled (dev mode), treat every visitor as admin so all nav items show
  const isAdmin = !authRequired || currentUser?.role === "admin" || currentUser?.role === "developer" || isDeveloper;

  // Permission check — always true when auth is off or user is admin/dev
  function can(key: string): boolean {
    if (!authRequired || isAdmin) return true;
    return permissions[key] === true;
  }

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? "true" : "false"); } catch {}
    onPinnedChange?.(pinned);
  }, [pinned, onPinnedChange]);

  const initial = currentUser
    ? (currentUser.displayName || currentUser.email).charAt(0).toUpperCase()
    : "?";
  const name = currentUser
    ? (currentUser.displayName || currentUser.email.split("@")[0])
    : "";
  const role = currentUser?.role
    ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)
    : "";

  const avatarColors = ["#0d7c66", "#2563EB", "#7C3AED", "#DC2626", "#D97706", "#0891B2"];
  const avatarColor = currentUser
    ? avatarColors[currentUser.email.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0) % avatarColors.length]
    : "#0d7c66";

  const itemClass = (isActive: boolean) => `nav-sidebar-item${isActive ? " active" : ""}`;

  const toolsNode = useReaderToolsNode();
  const dashboards = objects.filter((o) => o.type === "dashboard");
  const reports = objects.filter((o) => o.type === "report");
  const foldersById = Object.fromEntries(folders.map((folder) => [folder.id, folder]));
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  return (
    <nav className={`nav-sidebar${pinned ? " pinned" : ""}`} aria-label="Main navigation">

      {/* ── Header ── */}
      <div className="nav-sidebar-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden", flex: 1, minWidth: 0 }}>
          <div className="nav-sidebar-logo">⚡</div>
          <span className="nav-sidebar-title">Platform</span>
        </div>
        <button
          className="nav-sidebar-pin"
          type="button"
          onClick={() => setPinned((p) => !p)}
          title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
        >
          {pinned ? "◀" : "▶"}
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="nav-sidebar-scroll">

        {/* Main */}
        <div className="nav-sidebar-section">
          <div className="nav-sidebar-section-label">Main</div>
          {can("home.view") && (
            <NavLink to="/" end className={({ isActive }) => itemClass(isActive)} title="Home">
              <span className="nav-sidebar-icon">🏠</span>
              <span className="nav-sidebar-label">Home</span>
            </NavLink>
          )}
          {can("viewing.view") && (
            <NavLink to="/viewer" className={({ isActive }) => itemClass(isActive)} title="Viewing">
              <span className="nav-sidebar-icon">👁</span>
              <span className="nav-sidebar-label">Viewing</span>
            </NavLink>
          )}
          {can("building.view") && (
            <NavLink to="/studio" className={({ isActive }) => itemClass(isActive)} title="Building">
              <span className="nav-sidebar-icon">🔨</span>
              <span className="nav-sidebar-label">Building</span>
            </NavLink>
          )}
        </div>

        {/* Reports & Dashboards accordion — inside the nav */}
        <div className="nav-sidebar-divider" />
        <div className="nav-sidebar-section">
          <div className="nav-sidebar-section-label">Content</div>

          {/* Top-level accordion toggle */}
          <button
            type="button"
            className={`nav-sidebar-item nav-sidebar-accordion-toggle${contentOpen ? " active" : ""}`}
            onClick={() => setContentOpen((o) => !o)}
            title="Reports & Dashboards"
          >
            <span className="nav-sidebar-icon">📊</span>
            <span className="nav-sidebar-label">Reports &amp; Dashboards</span>
            <span className="nav-sidebar-accordion-chevron">{contentOpen ? "▾" : "▸"}</span>
          </button>

          {/* Accordion body — expands vertically */}
          <div className={`nav-sidebar-accordion-body${contentOpen ? " open" : ""}`}>
            <div>
              {onCreateFolder ? (
                creatingFolder ? (
                  <form
                    className="nav-new-folder-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = newFolderName.trim();
                      if (name) void onCreateFolder(name);
                      setNewFolderName("");
                      setCreatingFolder(false);
                    }}
                  >
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(event) => setNewFolderName(event.target.value)}
                      onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(false); }}
                      placeholder="Folder name"
                    />
                  </form>
                ) : (
                  <button type="button" className="nav-accordion-new-folder" onClick={() => setCreatingFolder(true)}>
                    + New folder
                  </button>
                )
              ) : null}
              {!objects.length ? (
                <div className="nav-accordion-empty">No content yet</div>
              ) : (
                <>
                  <AccordionGroup label="Dashboards" items={dashboards} foldersById={foldersById} scopeKey="nav-dashboards" openLinksInNewTab={false} onMoveToFolder={onMoveToFolder} />
                  <AccordionGroup label="Reports" items={reports} foldersById={foldersById} scopeKey="nav-reports" openLinksInNewTab={false} onMoveToFolder={onMoveToFolder} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Data — only shown if user can view data or scheduled reports */}
        {(can("data.view") || isAdmin) && (
          <>
            <div className="nav-sidebar-divider" />
            <div className="nav-sidebar-section">
              <div className="nav-sidebar-section-label">Data</div>
              {can("data.view") && (
                <NavLink to="/data" className={({ isActive }) => itemClass(isActive)} title="Data Sources">
                  <span className="nav-sidebar-icon">🗄</span>
                  <span className="nav-sidebar-label">Data Sources</span>
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/reports" className={({ isActive }) => itemClass(isActive)} title="Scheduled Reports">
                  <span className="nav-sidebar-icon">📅</span>
                  <span className="nav-sidebar-label">Scheduled Reports</span>
                </NavLink>
              )}
            </div>
          </>
        )}

        {/* Tools — only shown when viewing a report or dashboard */}
        {toolsNode ? (
          <>
            <div className="nav-sidebar-divider" />
            <div className="nav-sidebar-section">
              <div className="nav-sidebar-section-label">Tools</div>
              {toolsNode}
            </div>
          </>
        ) : null}

        {/* Manage — only shown if user has at least one management permission */}
        {(can("users.view") || can("roles.view")) && (
          <>
            <div className="nav-sidebar-divider" />
            <div className="nav-sidebar-section">
              <div className="nav-sidebar-section-label">Manage</div>
              {can("users.view") && (
                <NavLink to="/users" className={({ isActive }) => itemClass(isActive)} title="Users">
                  <span className="nav-sidebar-icon">👥</span>
                  <span className="nav-sidebar-label">Users</span>
                </NavLink>
              )}
              {can("roles.view") && (
                <NavLink to="/roles" className={({ isActive }) => itemClass(isActive)} title="Roles">
                  <span className="nav-sidebar-icon">🎭</span>
                  <span className="nav-sidebar-label">Roles</span>
                </NavLink>
              )}
            </div>
          </>
        )}

        {/* System */}
        <div className="nav-sidebar-divider" />
        <div className="nav-sidebar-section">
          <div className="nav-sidebar-section-label">System</div>
          {can("settings.view") && (
            <NavLink to="/settings" className={({ isActive }) => itemClass(isActive)} title="Settings">
              <span className="nav-sidebar-icon">⚙</span>
              <span className="nav-sidebar-label">Settings</span>
            </NavLink>
          )}
          <NavLink to="/help" className={({ isActive }) => itemClass(isActive)} title="Help">
            <span className="nav-sidebar-icon">❓</span>
            <span className="nav-sidebar-label">Help</span>
          </NavLink>
          {isDeveloper && (
            <div className="nav-sidebar-item" style={{ cursor: "default" }} title="Developer mode active">
              <span className="nav-sidebar-icon">⚡</span>
              <span className="nav-sidebar-label" style={{ fontStyle: "italic", fontSize: 11, fontWeight: 700, color: "#7C3AED" }}>DEV MODE</span>
            </div>
          )}
        </div>

      </div>

      {/* ── User profile + sign out ── */}
      <div className="nav-sidebar-user-section">
        <div className="nav-sidebar-divider" />
        <button
          type="button"
          className="nav-sidebar-item"
          onClick={() => onOpenSettings?.()}
          title={name ? `${name} — Account settings` : "Account settings"}
          style={{ gap: 8 }}
        >
          <span className="nav-sidebar-icon">
            <span className="nav-sidebar-avatar" style={{ background: avatarColor, color: "#fff", fontSize: 11, fontWeight: 800, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {initial}
            </span>
          </span>
          <span className="nav-sidebar-label" style={{ overflow: "hidden", minWidth: 0, textAlign: "left" }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <span style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
              {role && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "var(--brand-light, #ECFDF5)", color: "var(--brand-deep, #065F46)", border: "1px solid var(--brand-border, #A7F3D0)" }}>
                  {role}
                </span>
              )}
              {isDeveloper && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(124,58,237,0.1)", color: "#5B21B6", border: "1px solid rgba(124,58,237,0.25)", fontStyle: "italic" }}>
                  Dev
                </span>
              )}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="nav-sidebar-item btn-danger"
          onClick={onSignOut}
          title="Sign out"
          style={{ width: "100%", marginTop: 2 }}
        >
          <span className="nav-sidebar-icon">→</span>
          <span className="nav-sidebar-label">Sign out</span>
        </button>
      </div>

    </nav>
  );
}
