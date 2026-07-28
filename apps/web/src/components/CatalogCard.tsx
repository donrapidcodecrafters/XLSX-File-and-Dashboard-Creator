import { useState } from "react";
import { Link } from "react-router-dom";
import { getStudioObjectScopeLabel, type CatalogSummaryItem, type FolderDefinition, type StudioDocument } from "@studio/shared";
import { getProfileLabelsForCatalogItem, typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";

const DRAG_OBJECT_ID_MIME = "application/x-studio-object-id";

export function FolderTile({
  folder,
  itemCount,
  onOpen,
  onMoveToFolder
}: {
  folder: FolderDefinition;
  itemCount: number;
  onOpen: () => void;
  onMoveToFolder?: (objectId: string, folderId: string) => void | Promise<void>;
}) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  return (
    <button
      type="button"
      className={`viewer-card folder-tile${isDropTarget ? " is-drop-target" : ""}`}
      onClick={onOpen}
      onDragOver={(event) => { if (onMoveToFolder) event.preventDefault(); }}
      onDragEnter={(event) => { if (onMoveToFolder) { event.preventDefault(); setIsDropTarget(true); } }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropTarget(false);
        const objectId = event.dataTransfer.getData(DRAG_OBJECT_ID_MIME);
        if (objectId) void onMoveToFolder?.(objectId, folder.id);
      }}
    >
      <span className="folder-tile-icon">📁</span>
      <strong className="folder-tile-name">{folder.name}</strong>
      <span className="folder-tile-count">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
    </button>
  );
}

export function CatalogCard({
  object,
  studioDocument,
  openLinksInNewTab = false,
  isFavorite = false,
  onToggleFavorite,
  folders,
  onMoveToFolder,
  onCopyToFolder,
  className
}: {
  object: CatalogSummaryItem;
  studioDocument: StudioDocument | null;
  openLinksInNewTab?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (objectId: string) => void | Promise<void>;
  folders?: FolderDefinition[];
  onMoveToFolder?: (objectId: string, folderId: string) => void | Promise<void>;
  onCopyToFolder?: (objectId: string, folderId: string) => unknown;
  className: string;
}) {
  const appLabels = getProfileLabelsForCatalogItem(object, studioDocument).slice(0, 2);
  const scope = getStudioObjectScopeLabel(object);
  const isDashboard = object.type === "dashboard";
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);

  return (
    <article
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative" }}
      draggable={Boolean(onMoveToFolder)}
      onDragStart={(event) => { if (onMoveToFolder) event.dataTransfer.setData(DRAG_OBJECT_ID_MIME, object.id); }}
    >
      {/* Move-to-folder menu — top-right, left of the favorite star */}
      {onMoveToFolder && folders ? (
        <div style={{ position: "absolute", top: 12, right: onToggleFavorite ? 44 : 12 }}>
          <button
            type="button"
            className="folder-menu-trigger"
            aria-label="Move to folder"
            title="Move to folder"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFolderMenuOpen((current) => !current); }}
          >
            ⋯
          </button>
          {folderMenuOpen ? (
            <div className="folder-menu" onClick={(e) => e.stopPropagation()}>
              <div className="folder-menu-section-label">Move to</div>
              <button
                type="button"
                className="folder-menu-item"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onMoveToFolder(object.id, ""); setFolderMenuOpen(false); }}
              >
                No folder
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="folder-menu-item"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onMoveToFolder(object.id, folder.id); setFolderMenuOpen(false); }}
                >
                  {folder.name}
                </button>
              ))}
              {onCopyToFolder && folders.length ? (
                <>
                  <div className="folder-menu-divider" />
                  <div className="folder-menu-section-label">Copy to</div>
                  {folders.map((folder) => (
                    <button
                      key={`copy-${folder.id}`}
                      type="button"
                      className="folder-menu-item"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onCopyToFolder(object.id, folder.id); setFolderMenuOpen(false); }}
                    >
                      {folder.name}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Favorite button — top-right */}
      {onToggleFavorite ? (
        <button
          type="button"
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onToggleFavorite(object.id); }}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            minHeight: 0,
            width: 28,
            height: 28,
            padding: 0,
            border: "none",
            background: "transparent",
            boxShadow: "none",
            fontSize: isFavorite ? "1.05rem" : "1rem",
            color: isFavorite ? "#e2a923" : "rgba(23,49,38,0.25)",
            cursor: "pointer",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "color 120ms ease, transform 120ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = isFavorite ? "#c9941c" : "rgba(23,49,38,0.5)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = isFavorite ? "#e2a923" : "rgba(23,49,38,0.25)")}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      ) : null}

      <Link
        className="catalog-card-link"
        to={buildHostedRoute(`/${object.type}/${object.id}`)}
        target={openLinksInNewTab ? "_blank" : undefined}
        rel={openLinksInNewTab ? "noreferrer" : undefined}
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "16px", flex: 1, textDecoration: "none", color: "inherit" }}
      >
        {/* Type + scope badges */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            height: 20,
            padding: "0 7px",
            borderRadius: 5,
            fontSize: "0.68rem",
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            background: isDashboard ? "rgba(91,124,250,0.1)" : "rgba(13,124,102,0.1)",
            color: isDashboard ? "#3d5bd9" : "var(--brand-deep)",
            border: isDashboard ? "1px solid rgba(91,124,250,0.2)" : "1px solid rgba(13,124,102,0.2)",
          }}>
            {typeLabel(object.type)}
          </span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            height: 20,
            padding: "0 7px",
            borderRadius: 5,
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.03em",
            background: "rgba(23,49,38,0.05)",
            color: "var(--text-soft)",
            border: "1px solid rgba(23,49,38,0.1)",
          }}>
            {scope}
          </span>
          {appLabels.map((label) => (
            <span key={label} style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 7px",
              borderRadius: 5,
              fontSize: "0.68rem",
              fontWeight: 700,
              background: "rgba(216,141,61,0.08)",
              color: "#8a5a00",
              border: "1px solid rgba(216,141,61,0.18)",
            }}>
              {label}
            </span>
          ))}
        </div>

        {/* Title */}
        <strong style={{
          fontSize: "0.925rem",
          fontWeight: 700,
          color: "var(--text)",
          lineHeight: 1.25,
          letterSpacing: "-0.01em",
          display: "block",
          paddingRight: onToggleFavorite ? "32px" : 0,
        }}>
          {object.name}
        </strong>

        {/* Description */}
        {object.description ? (
          <span style={{
            fontSize: "0.8rem",
            color: "var(--text-soft)",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {object.description}
          </span>
        ) : null}

        {/* Folder / category */}
        {(object.folderName || object.category) ? (
          <span style={{ fontSize: "0.72rem", color: "rgba(23,49,38,0.35)", marginTop: "auto", paddingTop: 4 }}>
            {[object.folderName, object.category].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </Link>
    </article>
  );
}
