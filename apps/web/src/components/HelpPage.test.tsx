import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HelpPage } from "./HelpPage";

describe("HelpPage", () => {
  it("shows direct navigation and task-based manual sections for first-time users", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Platform Manual" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" }).getAttribute("href")).toMatch(/^#?\/$/);
    expect(screen.getByRole("link", { name: "Go to Viewing" }).getAttribute("href")).toMatch(/^#?\/viewer$/);
    expect(screen.getByRole("link", { name: "Go to Building" }).getAttribute("href")).toMatch(/^#?\/studio$/);
    expect(screen.getByRole("link", { name: "First Day Setup" })).toHaveAttribute("href", "#first-day");
    expect(screen.getByText(/Open the platform from your Quickbase dashboard button/i)).toBeInTheDocument();
    expect(screen.getAllByText("Admin Setup And Connected Apps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Move And Resize Dashboard Cards").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Use Multiple Apps Together").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Import And Export XLSX").length).toBeGreaterThan(0);
  });
});
