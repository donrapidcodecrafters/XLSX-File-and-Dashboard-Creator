import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildStudioCatalogItemLookup, buildStudioDocument, normalizeStudioDocument } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { ViewerPage } from "./ViewerPage";

vi.mock("../lib/studioApi", () => ({
  fetchStudioRefreshJob: vi.fn(),
  startStudioRefresh: vi.fn()
}));

function buildViewerProps() {
  const seededDocument = buildStudioDocument();
  const studioDocument = normalizeStudioDocument({
    ...seededDocument,
    session: {
      ...seededDocument.session,
      currentUserId: "demo.user"
    },
    favorites: ["dashboard-executive-pulse"],
    recent: ["report-project-portfolio"]
  });
  const objects = Array.from(buildStudioCatalogItemLookup([], studioDocument.bundle.objects).values());
  return {
    objects,
    studioDocument,
    recentIds: ["report-project-portfolio"],
    onRefreshComplete: vi.fn().mockResolvedValue(undefined),
    onToggleFavorite: vi.fn().mockResolvedValue(undefined)
  };
}

describe("ViewerPage", () => {
  it("defaults to the shared library and can switch to personal content", async () => {
    const user = userEvent.setup();
    const props = buildViewerProps();
    const personalReportName = props.studioDocument.bundle.objects["report-my-active-projects"].name;

    render(
      <MemoryRouter>
        <ViewerPage {...props} />
      </MemoryRouter>
    );

    expect(screen.getByText("Shared library view")).toBeInTheDocument();
    expect(screen.queryByText(personalReportName)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Scope"), "personal");

    expect(screen.getByText(personalReportName)).toBeInTheDocument();
    expect(screen.queryByText("Shared library view")).not.toBeInTheDocument();
  });

  it("filters by search and favorites and forwards favorite clicks", async () => {
    const user = userEvent.setup();
    const props = buildViewerProps();
    const favoriteDashboard = props.studioDocument.bundle.objects["dashboard-executive-pulse"];

    render(
      <MemoryRouter>
        <ViewerPage {...props} />
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText("Search reports, dashboards, folders, tags, or app labels"), "executive");
    await user.click(screen.getByLabelText(/favorites/i));

    expect(screen.getByText(favoriteDashboard.name)).toBeInTheDocument();
    expect(screen.queryByText("No reports or dashboards match this search.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unfavorite" }));

    expect(props.onToggleFavorite).toHaveBeenCalledWith(favoriteDashboard.id);
  });
});
