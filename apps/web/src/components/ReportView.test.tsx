import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildStudioDocument, runReport, type ReportDefinition, type TableDefinition } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "./ReportView";
import { ReaderToolsProvider, useReaderToolsNode } from "../contexts/ReaderToolsContext";

// ReportView no longer renders its own tools panel; it registers tool buttons
// (Reset view, Save view, export actions, focus-mode switcher) into
// ReaderToolsContext, which a layout component (NavigationSidebar) renders
// elsewhere in the tree. Mount a minimal consumer here so those tools are
// present in the DOM for this test, mirroring the real app's wiring.
function ToolsHost() {
  const toolsNode = useReaderToolsNode();
  return <div data-testid="reader-tools">{toolsNode}</div>;
}

function buildFixture() {
  const document = buildStudioDocument();
  const seededReport = document.bundle.objects["report-project-portfolio"] as ReportDefinition;
  const report: ReportDefinition = {
    ...seededReport,
    view: {
      ...seededReport.view,
      mode: "table",
      showChartInTable: true,
      showDetails: true
    }
  };
  const table = document.bundle.tables.find((item) => item.id === report.sourceTableId) as TableDefinition;
  return {
    report,
    table,
    result: runReport(report, table, document.bundle.data[report.sourceTableId] || [])
  };
}

describe("ReportView", () => {
  it("supports saved views, reset, and focused chart/details inspection", async () => {
    const user = userEvent.setup();
    const fixture = buildFixture();
    const onPageChange = vi.fn();
    const onSaveView = vi.fn();
    const onDeleteView = vi.fn();
    const onStateChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("Chart Bookmark");

    render(
      <ReaderToolsProvider>
        <MemoryRouter>
          <ReportView
            report={fixture.report}
            table={fixture.table}
            result={fixture.result}
            loading={false}
            currentPage={2}
            onPageChange={onPageChange}
            onRefresh={vi.fn()}
            savedViews={[{
              id: "saved-report-view",
              name: "Saved Chart",
              currentPage: 1,
              focusMode: "chart",
              focusedSection: "chart",
              updatedAt: new Date().toISOString()
            }]}
            onSaveView={onSaveView}
            onDeleteView={onDeleteView}
            onStateChange={onStateChange}
          />
          <ToolsHost />
        </MemoryRouter>
      </ReaderToolsProvider>
    );

    // Sidebar tool buttons render an icon glyph glued directly in front of the
    // label (no separating whitespace in the DOM), so their accessible name
    // includes that glyph — match on the label text instead of an exact string.
    expect(screen.getByRole("button", { name: /Download xlsx/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save view/ }));
    expect(onSaveView).toHaveBeenCalledWith(expect.objectContaining({ name: "Chart Bookmark" }));

    await user.click(screen.getByRole("button", { name: "Saved Chart" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Focus chart" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    // The sidebar's focus-mode switcher has a button labeled "Details"
    // (icon-prefixed, like the other sidebar tools above); it's distinct from
    // the "Focus details" button rendered inline in the Details card.
    await user.click(screen.getByRole("button", { name: /Details/ }));
    await user.click(screen.getByRole("button", { name: "Focus details" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: /Reset view/ }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDeleteView).toHaveBeenCalledWith("saved-report-view");
  });
});
