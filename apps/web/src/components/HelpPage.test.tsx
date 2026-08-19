import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
  it("shows the sidebar nav and every manual section, with accurate content", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Platform Manual", level: 1 })).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary");
    // The sidebar's own header must not repeat the page's "Platform Manual" title —
    // it identifies the sidebar as navigation, not a second copy of the page heading.
    expect(within(sidebar).getByText("Contents")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Platform Manual")).not.toBeInTheDocument();

    expect(within(sidebar).getByRole("link", { name: "Home" }).getAttribute("href")).toMatch(/^#?\/$/);
    expect(within(sidebar).getByRole("link", { name: "Browse reports" }).getAttribute("href")).toMatch(/^#?\/viewer$/);
    expect(within(sidebar).getByRole("link", { name: "Builder" }).getAttribute("href")).toMatch(/^#?\/studio$/);

    const nav = screen.getByRole("navigation", { name: "Manual sections" });
    const sectionTitles = [
      "Signing In & 2FA",
      "Initial Setup Guide",
      "Accepting an Invitation",
      "Navigating the Platform",
      "Data Sources",
      "Creating a Report",
      "Creating a Dashboard",
      "Viewing Reports & Dashboards",
      "Scheduled Email Reports",
      "Managing Users",
      "Roles & Permissions",
      "Platform Settings",
      "Common Problems & Fixes"
    ];
    for (const title of sectionTitles) {
      expect(within(nav).getByRole("button", { name: new RegExp(title) })).toBeInTheDocument();
    }

    // Spot-check a few facts that must stay accurate — these numbers come straight
    // from the auth code (apps/api/src/auth/session-auth.ts), not guesses. Both
    // the Signing In and Troubleshooting sections restate them, so expect 2 hits.
    expect(screen.getAllByText(/10 consecutive failed sign-in attempts/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/locked for.*5 minutes|5 minutes.*after 10/).length).toBeGreaterThanOrEqual(1);
    // The doc correctly explains no such link exists — assert there's no actual
    // link/button by that name (the explanatory sentence itself contains the phrase).
    expect(screen.queryByRole("link", { name: /Forgot password/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Forgot password/ })).not.toBeInTheDocument();
  });
});
