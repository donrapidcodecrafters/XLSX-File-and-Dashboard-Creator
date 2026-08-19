import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { buildDashboardResult, buildStudioDocument, runReport, type DashboardDefinition, type TableDefinition, type ReportDefinition } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "./DashboardView";
import { renderDashboard } from "../lib/api";
import { ReaderToolsProvider, useReaderToolsNode } from "../contexts/ReaderToolsContext";

// DashboardView pushes its "tools" actions (save view, reset view, export, etc.)
// into the shared reader tools sidebar via context instead of rendering them
// inline. Mirror that consumer here so the tests can reach those controls.
function ToolsPanel() {
  const toolsNode = useReaderToolsNode();
  return <div data-testid="tools-panel">{toolsNode}</div>;
}

vi.mock("../lib/api", () => ({
  renderDashboard: vi.fn(),
  runReportPage: vi.fn(),
  startDashboardExportJob: vi.fn(),
  fetchExportJobStatus: vi.fn(),
  downloadExportJob: vi.fn()
}));

function buildFixture() {
  const document = buildStudioDocument();
  const dashboard = document.bundle.objects["dashboard-executive-pulse"] as DashboardDefinition;
  const widgets = dashboard.tabs.flatMap((tab) =>
    tab.widgets.map((widget) => {
      const report = (widget.mode === "copied" && widget.snapshot ? widget.snapshot : document.bundle.objects[widget.reportId]) as ReportDefinition;
      const table = document.bundle.tables.find((item) => item.id === report.sourceTableId) as TableDefinition;
      return {
        widgetId: widget.id,
        widget,
        report,
        result: runReport(report, table, document.bundle.data[report.sourceTableId] || []),
        status: "complete" as const,
        message: "Ready"
      };
    })
  );
  return {
    dashboard,
    tables: document.bundle.tables,
    result: buildDashboardResult(dashboard, widgets)
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function resultForTab(fixture: ReturnType<typeof buildFixture>, tabId: string) {
  return {
    ...fixture.result,
    tabs: fixture.result.tabs.map((tab) => ({
      ...tab,
      widgets: tab.id === tabId ? tab.widgets : []
    }))
  };
}

describe("DashboardView", () => {
  it("supports saved views, reset, and focused card inspection", async () => {
    const user = userEvent.setup();
    const fixture = buildFixture();
    const onSaveView = vi.fn();
    const onDeleteView = vi.fn();
    const onStateChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("Finance Focus");
    vi.mocked(renderDashboard).mockResolvedValue(fixture.result);

    render(
      <MemoryRouter>
        <ReaderToolsProvider>
          <DashboardView
            dashboard={fixture.dashboard}
            tables={fixture.tables}
            initialRuntimeFilters={{ "runtime-status": "Open" }}
            savedViews={[{
              id: "saved-dashboard-view",
              name: "Saved Overview",
              runtimeFilters: { "runtime-status": "Blocked" },
              activeTabId: fixture.dashboard.tabs[0].id,
              focusedWidgetId: fixture.dashboard.tabs[0].widgets[0].id,
              updatedAt: new Date().toISOString()
            }]}
            onSaveView={onSaveView}
            onDeleteView={onDeleteView}
            onStateChange={onStateChange}
          />
          <ToolsPanel />
        </ReaderToolsProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Focus card" }).length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: /Export Workbook/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Status: Done" }));
    expect((screen.getByLabelText("Status") as HTMLInputElement).value).toBe("Done");

    await user.click(screen.getByRole("button", { name: /Save view/ }));
    expect(onSaveView).toHaveBeenCalledWith(expect.objectContaining({ name: "Finance Focus" }));

    await user.click(screen.getByRole("button", { name: "Saved Overview" }));
    expect((screen.getByLabelText("Status") as HTMLInputElement).value).toBe("Blocked");
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Focus card" }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole("button", { name: "Focus card" })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: /Reset view/ }));
    expect((screen.getByLabelText("Status") as HTMLInputElement).value).toBe("");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDeleteView).toHaveBeenCalledWith("saved-dashboard-view");

    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalled();
    });
  });

  it("keeps showing the dashboard loader until the current tab request finishes", async () => {
    const fixture = buildFixture();
    const firstTabId = fixture.dashboard.tabs[0].id;
    const firstRequest = deferred<typeof fixture.result>();
    const secondRequest = deferred<typeof fixture.result>();
    vi.mocked(renderDashboard)
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    render(
      <MemoryRouter>
        <DashboardView
          dashboard={fixture.dashboard}
          tables={fixture.tables}
          initialRuntimeFilters={{ "runtime-status": "Open" }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Loading this dashboard")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "Done" } });

    await act(async () => {
      firstRequest.resolve(resultForTab(fixture, firstTabId));
      await Promise.resolve();
    });

    expect(screen.getByText("Loading this dashboard")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Focus card" })).toHaveLength(0);

    await act(async () => {
      secondRequest.resolve(resultForTab(fixture, firstTabId));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Focus card" }).length).toBeGreaterThan(0);
    });
  });

  it("does not revert the selected tab when a saved tab prop arrives late", async () => {
    const user = userEvent.setup();
    const fixture = buildFixture();
    const firstTab = fixture.dashboard.tabs[0];
    const secondTab = fixture.dashboard.tabs[1];
    vi.mocked(renderDashboard).mockImplementation((_id, _filters, activeTabId) =>
      Promise.resolve(resultForTab(fixture, activeTabId || firstTab.id))
    );

    const view = render(
      <MemoryRouter>
        <DashboardView
          dashboard={fixture.dashboard}
          tables={fixture.tables}
          initialActiveTabId=""
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: new RegExp(firstTab.name) }).className).toContain("active");
    });

    await user.click(screen.getByRole("button", { name: new RegExp(secondTab.name) }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: new RegExp(secondTab.name) }).className).toContain("active");
    });

    view.rerender(
      <MemoryRouter>
        <DashboardView
          dashboard={fixture.dashboard}
          tables={fixture.tables}
          initialActiveTabId={firstTab.id}
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: new RegExp(secondTab.name) }).className).toContain("active");
    });
  });
});
