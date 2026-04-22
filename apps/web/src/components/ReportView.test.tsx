import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildStudioDocument, runReport, type ReportDefinition, type TableDefinition } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "./ReportView";

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
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "Save view" }));
    expect(onSaveView).toHaveBeenCalledWith(expect.objectContaining({ name: "Chart Bookmark" }));

    await user.click(screen.getByRole("button", { name: "Saved Chart" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Focus chart" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Focus details" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDeleteView).toHaveBeenCalledWith("saved-report-view");
  });
});
