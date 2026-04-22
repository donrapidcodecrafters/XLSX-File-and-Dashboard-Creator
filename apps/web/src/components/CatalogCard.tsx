import { Link } from "react-router-dom";
import { getStudioObjectScopeLabel, type CatalogSummaryItem, type StudioDocument } from "@studio/shared";
import { getProfileLabelsForCatalogItem, typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";

function AppBadgeRow({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="badge-row">
      {labels.slice(0, 3).map((label) => (
        <span className="badge" key={label}>{label}</span>
      ))}
    </div>
  );
}

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
  return (
    <article className={className}>
      <div className="catalog-card-head">
        <div className="badge-row">
          <span className="badge">{typeLabel(object.type)}</span>
          <span className="badge">{getStudioObjectScopeLabel(object)}</span>
        </div>
        {onToggleFavorite ? (
          <button
            type="button"
            className="ghost-button catalog-favorite-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onToggleFavorite(object.id);
            }}
          >
            {isFavorite ? "Unfavorite" : "Favorite"}
          </button>
        ) : null}
      </div>
      <Link
        className="catalog-card-link"
        to={buildHostedRoute(`/${object.type}/${object.id}`)}
        target={openLinksInNewTab ? "_blank" : undefined}
        rel={openLinksInNewTab ? "noreferrer" : undefined}
      >
        <AppBadgeRow labels={getProfileLabelsForCatalogItem(object, studioDocument)} />
        <strong>{object.name}</strong>
        <span>{object.description || "No description yet."}</span>
        <span className="micro">{object.folder} · {object.category}</span>
      </Link>
    </article>
  );
}
