import { Link } from "react-router-dom";
import { getStudioObjectScopeLabel, type CatalogSummaryItem, type StudioDocument } from "@studio/shared";
import { getProfileLabelsForCatalogItem, typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";

export function CatalogCard({
  object,
  studioDocument,
  openLinksInNewTab = false,
  isFavorite = false,
  onToggleFavorite,
  className
}: {
  object: CatalogSummaryItem;
  studioDocument: StudioDocument | null;
  openLinksInNewTab?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (objectId: string) => void | Promise<void>;
  className: string;
}) {
  const appLabels = getProfileLabelsForCatalogItem(object, studioDocument).slice(0, 2);
  const scope = getStudioObjectScopeLabel(object);
  const isDashboard = object.type === "dashboard";

  return (
    <article
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative" }}
    >
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
        {(object.folder || object.category) ? (
          <span style={{ fontSize: "0.72rem", color: "rgba(23,49,38,0.35)", marginTop: "auto", paddingTop: 4 }}>
            {[object.folder, object.category].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </Link>
    </article>
  );
}
