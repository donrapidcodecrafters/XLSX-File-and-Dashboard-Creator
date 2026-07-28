import { useRef, useState, type ChangeEvent } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildStudioDocument, isStudioItemVisibleToCurrentUser, normalizeStudioDocument, type StudioObject, type StudioTemplateRecord } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { StudioLibrarySidebar } from "./StudioLibrarySidebar";

function SidebarHarness() {
  const document = normalizeStudioDocument({
    ...buildStudioDocument(),
    session: {
      ...buildStudioDocument().session,
      currentUserId: "demo.user"
    }
  });
  const importInputRef = useRef<HTMLInputElement>(null);
  const importXlsxInputRef = useRef<HTMLInputElement>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "report" | "dashboard">("all");
  const [libraryScopeFilter, setLibraryScopeFilter] = useState<"all" | "global" | "selected" | "personal">("global");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const currentUserId = String(document.session.currentUserId || "").trim();
  const objects = document.bundle.order
    .map((id) => document.bundle.objects[id])
    .filter((object): object is StudioObject => Boolean(object))
    .filter((object) => isStudioItemVisibleToCurrentUser(object, currentUserId))
    .filter((object) => libraryFilter === "all" || object.type === libraryFilter)
    .filter((object) => libraryScopeFilter === "all" || object.scope === libraryScopeFilter)
    .filter((object) => {
      if (!libraryQuery.trim()) return true;
      return `${object.name} ${object.description} ${object.category}`.toLowerCase().includes(libraryQuery.toLowerCase());
    });
  const templates: StudioTemplateRecord[] = [...document.templates.layouts, ...document.templates.yaml];

  return (
    <MemoryRouter>
      <StudioLibrarySidebar
        homeLabel={document.branding.homeLabel}
        navigationLabel={document.branding.navigationLabel}
        libraryQuery={libraryQuery}
        onLibraryQueryChange={setLibraryQuery}
        libraryFilter={libraryFilter}
        onLibraryFilterChange={setLibraryFilter}
        libraryScopeFilter={libraryScopeFilter}
        onLibraryScopeFilterChange={setLibraryScopeFilter}
        favoritesOnly={favoritesOnly}
        onFavoritesOnlyChange={setFavoritesOnly}
        recentOnly={recentOnly}
        onRecentOnlyChange={setRecentOnly}
        hasPersonalObjects={document.bundle.order.some((id) => document.bundle.objects[id]?.scope === "personal")}
        filteredObjects={objects}
        activeObjectId="dashboard-executive-pulse"
        templates={templates}
        xlsxImporting={false}
        importInputRef={importInputRef}
        importXlsxInputRef={importXlsxInputRef}
        onImportJsonChange={(_event: ChangeEvent<HTMLInputElement>) => undefined}
        onImportXlsxChange={(_event: ChangeEvent<HTMLInputElement>) => undefined}
        onApplyTemplate={vi.fn()}
        onOpenCreateReport={vi.fn()}
        onOpenCreateDashboard={vi.fn()}
        onOpenTemplates={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("StudioLibrarySidebar", () => {
  it("defaults to shared objects and can switch to personal scope", async () => {
    const user = userEvent.setup();

    render(<SidebarHarness />);

    expect(screen.getByText("Shared builder library")).toBeInTheDocument();
    expect(screen.queryByText("My Active Projects")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Scope"), "personal");

    expect(screen.getByText("My Active Projects")).toBeInTheDocument();
    expect(screen.queryByText("Shared builder library")).not.toBeInTheDocument();
  });

  it("filters the visible builder library by search text", async () => {
    const user = userEvent.setup();

    render(<SidebarHarness />);

    await user.type(screen.getByPlaceholderText("Search reports, dashboards, fields, tags"), "invoice");

    expect(screen.getByText("Invoice Health")).toBeInTheDocument();
    expect(screen.queryByText("Task Pipeline")).not.toBeInTheDocument();
  });
});
