import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildStudioCatalogItemLookup, buildStudioDocument, normalizeStudioDocument } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

vi.mock("../lib/studioApi", () => ({
  fetchStudioRefreshJob: vi.fn(),
  startStudioRefresh: vi.fn(),
  fetchStudioSources: vi.fn().mockResolvedValue({ sources: [] })
}));

function buildHomeProps() {
  const seededDocument = buildStudioDocument();
  const studioDocument = normalizeStudioDocument({
    ...seededDocument,
    session: {
      ...seededDocument.session,
      currentUserId: "demo.user"
    },
    favorites: ["dashboard-executive-pulse", "report-my-active-projects"],
    recent: ["report-project-portfolio", "report-my-active-projects"]
  });
  const objects = Array.from(buildStudioCatalogItemLookup([], studioDocument.bundle.objects).values());
  return {
    objects,
    studioDocument,
    recentIds: ["report-project-portfolio", "report-my-active-projects"],
    onRefreshComplete: vi.fn().mockResolvedValue(undefined),
    onToggleFavorite: vi.fn().mockResolvedValue(undefined)
  };
}

describe("HomePage", () => {
  it("keeps personal content separate from shared sections", () => {
    const props = buildHomeProps();
    const personalReportName = props.studioDocument.bundle.objects["report-my-active-projects"].name;

    render(
      <MemoryRouter>
        <HomePage {...props} />
      </MemoryRouter>
    );

    const personalSection = screen.getByText("My Personal Items").closest(".home-section-card");
    expect(personalSection).toBeTruthy();
    expect(within(personalSection as HTMLElement).getByText(personalReportName)).toBeInTheDocument();

    const sharedSection = screen.getByText("Recently Opened").closest(".home-section-card");
    expect(sharedSection).toBeTruthy();
    expect(within(sharedSection as HTMLElement).queryByText(personalReportName)).not.toBeInTheDocument();
  });

  it("shows shared app browse groups and forwards favorite actions", async () => {
    const user = userEvent.setup();
    const props = buildHomeProps();
    const browseByAppSection = () => screen.getByText("Browse by Connected App").closest(".home-section-card") as HTMLElement;
    const personalReportName = props.studioDocument.bundle.objects["report-my-active-projects"].name;

    render(
      <MemoryRouter>
        <HomePage {...props} />
      </MemoryRouter>
    );

    expect(screen.getByText("Browse by Connected App")).toBeInTheDocument();
    expect(within(browseByAppSection()).getByText("Executive Pulse")).toBeInTheDocument();
    expect(within(browseByAppSection()).queryByText(personalReportName)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Remove from favorites" })[0]);

    expect(props.onToggleFavorite).toHaveBeenCalled();
  });
});
