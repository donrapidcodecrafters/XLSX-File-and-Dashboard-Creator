import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardWidgetDropPosition, DashboardWidgetMoveDirection, DashboardWidgetRowEdge } from "@studio/shared";
import { buildDashboardResult, buildStudioDocument, runReport, type DashboardDefinition, type DashboardRunResult, type ReportDefinition, type TableDefinition } from "@studio/shared";
import { describe, expect, it, vi } from "vitest";
import { StudioDashboardPreview } from "./StudioDashboardPreview";

function createCallbacks() {
  return {
    onOpenReport: vi.fn<(reportId: string) => void>(),
    onSelectWidget: vi.fn<(tabId: string, widgetId: string) => void>(),
    onStartWidgetDrag: vi.fn<(tabId: string, widgetId: string) => void>(),
    onEndWidgetDrag: vi.fn<() => void>(),
    onDropWidget: vi.fn<(tabId: string, widgetId: string, position: DashboardWidgetDropPosition) => void>(),
    onDropWidgetToRow: vi.fn<(tabId: string, rowIndex: number, edge: DashboardWidgetRowEdge) => void>(),
    onDropWidgetToTabEnd: vi.fn<(tabId: string) => void>(),
    onDropWidgetToGridPosition: vi.fn<(tabId: string, position: { x: number; y: number }) => void>(),
    onToggleFullWidth: vi.fn<(tabId: string, widgetId: string) => void>(),
    onBeginResizeWidget: vi.fn<(event: ReactPointerEvent<HTMLButtonElement>, tabId: string, widgetId: string, layout: { w: number; h: number }) => void>(),
    onMoveWidget: vi.fn<(tabId: string, widgetId: string, direction: DashboardWidgetMoveDirection) => void>()
  };
}

function buildPreviewFixture() {
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
        message: "Preview ready"
      };
    })
  );
  return {
    dashboard,
    tables: document.bundle.tables,
    result: buildDashboardResult(dashboard, widgets)
  };
}

function PreviewHarness({
  widgetSearch = "",
  resultOverride,
  callbacks
}: {
  widgetSearch?: string;
  resultOverride?: DashboardRunResult;
  callbacks: {
    onOpenReport: ReturnType<typeof createCallbacks>["onOpenReport"];
    onSelectWidget: ReturnType<typeof createCallbacks>["onSelectWidget"];
    onStartWidgetDrag: ReturnType<typeof createCallbacks>["onStartWidgetDrag"];
    onEndWidgetDrag: ReturnType<typeof createCallbacks>["onEndWidgetDrag"];
    onDropWidget: ReturnType<typeof createCallbacks>["onDropWidget"];
    onDropWidgetToRow: ReturnType<typeof createCallbacks>["onDropWidgetToRow"];
    onDropWidgetToTabEnd: ReturnType<typeof createCallbacks>["onDropWidgetToTabEnd"];
    onDropWidgetToGridPosition: ReturnType<typeof createCallbacks>["onDropWidgetToGridPosition"];
    onToggleFullWidth: ReturnType<typeof createCallbacks>["onToggleFullWidth"];
    onBeginResizeWidget: ReturnType<typeof createCallbacks>["onBeginResizeWidget"];
    onMoveWidget: ReturnType<typeof createCallbacks>["onMoveWidget"];
  };
}) {
  const fixture = buildPreviewFixture();
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});

  return (
    <>
      <StudioDashboardPreview
        dashboard={fixture.dashboard}
        result={resultOverride || fixture.result}
        tables={fixture.tables}
        runtimeValues={runtimeValues}
        setRuntimeValues={setRuntimeValues}
        widgetSearch={widgetSearch}
        selectedWidgetId=""
        draggingWidget={null}
        {...callbacks}
      />
      <div data-testid="runtime-values">{JSON.stringify(runtimeValues)}</div>
    </>
  );
}

describe("StudioDashboardPreview", () => {
  it("handles selection, card drag/drop intent, directional movement, full-width, and resize entry points", async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    const fixture = buildPreviewFixture();
    render(<PreviewHarness callbacks={callbacks} />);

    const moveButtons = screen.getAllByRole("button", { name: "Move right" });
    const fullWidthButtons = screen.getAllByRole("button", { name: /Full width|Restore width/ });
    const resizeButtons = screen.getAllByRole("button", { name: "Resize card" });
    const firstCard = screen.getByRole("button", { name: new RegExp(fixture.result.tabs[0].widgets[0].report.name, "i") });
    const secondCard = screen.getByRole("button", { name: new RegExp(fixture.result.tabs[0].widgets[1].report.name, "i") });
    vi.spyOn(secondCard, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 180,
      top: 0,
      left: 0,
      right: 240,
      bottom: 180,
      toJSON: () => ({})
    });

    await user.click(firstCard);
    await user.click(moveButtons[0]);
    fireEvent.click(fullWidthButtons[0]);
    fireEvent.pointerDown(resizeButtons[0], { clientX: 100, clientY: 100 });
    fireEvent.dragStart(firstCard);
    fireEvent.dragOver(secondCard, { clientX: 220, clientY: 90 });
    fireEvent.drop(secondCard, { clientX: 220, clientY: 90 });

    expect(firstCard).toHaveStyle({ gridColumn: "1 / 8" });
    expect(callbacks.onSelectWidget).toHaveBeenCalled();
    expect(callbacks.onMoveWidget).toHaveBeenCalled();
    expect(callbacks.onMoveWidget).toHaveBeenCalledWith(expect.any(String), expect.any(String), "right");
    expect(callbacks.onBeginResizeWidget).toHaveBeenCalled();
    expect(callbacks.onDropWidget).toHaveBeenCalledWith(expect.any(String), expect.any(String), "after");
  });

  it("supports snapped grid drops on blank canvas space", () => {
    const callbacks = createCallbacks();
    const fixture = buildPreviewFixture();
    render(
      <StudioDashboardPreview
        dashboard={fixture.dashboard}
        result={fixture.result}
        tables={fixture.tables}
        runtimeValues={{}}
        setRuntimeValues={vi.fn()}
        widgetSearch=""
        selectedWidgetId=""
        draggingWidget={{ tabId: fixture.dashboard.tabs[0].id, widgetId: fixture.dashboard.tabs[0].widgets[0].id }}
        {...callbacks}
      />
    );

    const gridDropzone = screen.getByTestId(`grid-drop-${fixture.dashboard.tabs[0].id}`);
    vi.spyOn(gridDropzone, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 1200,
      height: 480,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 480,
      toJSON: () => ({})
    });

    fireEvent.dragOver(gridDropzone, { clientX: 940, clientY: 280 });
    expect(screen.getByTestId(`grid-ghost-${fixture.dashboard.tabs[0].id}`)).toHaveStyle({
      gridColumn: "4 / 11",
      gridRow: "2 / 6"
    });
    fireEvent.drop(gridDropzone, { clientX: 940, clientY: 280 });

    expect(callbacks.onDropWidgetToGridPosition).toHaveBeenCalledWith(expect.any(String), { x: 4, y: 2 });
  });

  it("shows collision-adjusted ghost placement when a dense grid target repacks the row", () => {
    const callbacks = createCallbacks();
    const fixture = buildPreviewFixture();
    const dashboard = JSON.parse(JSON.stringify(fixture.dashboard)) as DashboardDefinition;
    const result = JSON.parse(JSON.stringify(fixture.result)) as DashboardRunResult;
    dashboard.tabs[0].widgets[0].layout = { w: 6, h: 6, x: 1, y: 1 };
    dashboard.tabs[0].widgets[1].layout = { w: 6, h: 6, x: 7, y: 1 };
    const extraWidget = JSON.parse(JSON.stringify(dashboard.tabs[0].widgets[1]));
    extraWidget.id = "widget-overview-extra";
    extraWidget.title = "Extra Overview";
    extraWidget.layout = { w: 4, h: 4, x: 1, y: 7 };
    dashboard.tabs[0].widgets.push(extraWidget);
    const extraResult = JSON.parse(JSON.stringify(result.tabs[0].widgets[1]));
    extraResult.widgetId = "widget-overview-extra";
    extraResult.widget = extraWidget;
    result.tabs[0].widgets.push(extraResult);
    render(
      <StudioDashboardPreview
        dashboard={dashboard}
        result={result}
        tables={fixture.tables}
        runtimeValues={{}}
        setRuntimeValues={vi.fn()}
        widgetSearch=""
        selectedWidgetId=""
        draggingWidget={{ tabId: dashboard.tabs[0].id, widgetId: dashboard.tabs[0].widgets[2].id }}
        {...callbacks}
      />
    );

    const gridDropzone = screen.getAllByTestId(`grid-drop-${dashboard.tabs[0].id}`)[1];
    vi.spyOn(gridDropzone, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 1200,
      height: 480,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 480,
      toJSON: () => ({})
    });

    fireEvent.dragOver(gridDropzone, { clientX: 420, clientY: 240 });

    const ghost = screen.getByTestId(`grid-ghost-${dashboard.tabs[0].id}`);
    expect(ghost.className).toContain("is-adjusted");
    expect(ghost.style.gridColumn).toBe("1 / 5");
    expect(ghost.style.gridRow).toBe("7 / 11");
    expect(screen.getByText(/Adjusted \+5 rows/i)).toBeInTheDocument();
  });

  it("previews live reflow when dragging across another card target", () => {
    const callbacks = createCallbacks();
    const fixture = buildPreviewFixture();
    render(
      <StudioDashboardPreview
        dashboard={fixture.dashboard}
        result={fixture.result}
        tables={fixture.tables}
        runtimeValues={{}}
        setRuntimeValues={vi.fn()}
        widgetSearch=""
        selectedWidgetId=""
        draggingWidget={{ tabId: fixture.dashboard.tabs[0].id, widgetId: fixture.dashboard.tabs[0].widgets[0].id }}
        {...callbacks}
      />
    );

    const firstCard = screen.getByRole("button", { name: new RegExp(fixture.result.tabs[0].widgets[0].report.name, "i") });
    const secondCard = screen.getByRole("button", { name: new RegExp(fixture.result.tabs[0].widgets[1].report.name, "i") });
    const initialGridColumn = firstCard.style.gridColumn;
    vi.spyOn(secondCard, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 180,
      top: 0,
      left: 0,
      right: 240,
      bottom: 180,
      toJSON: () => ({})
    });

    fireEvent.dragOver(secondCard, { clientX: 220, clientY: 90 });

    expect(secondCard.className).toContain("is-drop-after");
    expect(firstCard.style.gridColumn).not.toBe(initialGridColumn);
    expect(secondCard.className).toContain("is-displaced");
    expect(screen.getByTestId(`row-target-${fixture.dashboard.tabs[0].id}-0`).textContent).toContain("Preview target");
    expect(screen.getByTestId(`row-impact-${fixture.dashboard.tabs[0].id}-0`).textContent).toContain("reflow");
  });

  it("previews reflow intent when dragging across the row grid itself", () => {
    const callbacks = createCallbacks();
    const fixture = buildPreviewFixture();
    const { container } = render(
      <StudioDashboardPreview
        dashboard={fixture.dashboard}
        result={fixture.result}
        tables={fixture.tables}
        runtimeValues={{}}
        setRuntimeValues={vi.fn()}
        widgetSearch=""
        selectedWidgetId=""
        draggingWidget={{ tabId: fixture.dashboard.tabs[0].id, widgetId: fixture.dashboard.tabs[0].widgets[0].id }}
        {...callbacks}
      />
    );

    const firstRowGrid = container.querySelector(".dashboard-layout-grid");
    if (!(firstRowGrid instanceof HTMLElement)) {
      throw new Error("expected dashboard row grid");
    }
    const firstCard = screen.getByRole("button", { name: new RegExp(fixture.result.tabs[0].widgets[0].report.name, "i") });
    const secondCard = screen.getByRole("button", { name: new RegExp(fixture.result.tabs[0].widgets[1].report.name, "i") });
    const initialGridColumn = firstCard.style.gridColumn;
    vi.spyOn(firstRowGrid, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 1200,
      height: 384,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 384,
      toJSON: () => ({})
    });

    fireEvent.dragOver(firstRowGrid, { clientX: 1030, clientY: 120 });

    expect(firstCard.style.gridColumn).not.toBe(initialGridColumn);
    expect(screen.getByTestId(`row-impact-${fixture.dashboard.tabs[0].id}-0`).textContent).toContain("reflow");
  });

  it("updates runtime filter values and can surface failed cards while search filters the canvas", async () => {
    const user = userEvent.setup();
    const fixture = buildPreviewFixture();
    const callbacks = createCallbacks();
    const failedWidgetId = fixture.result.tabs.flatMap((tab) => tab.widgets).find((widget) => /invoice/i.test(widget.report.name))?.widgetId || "";
    const resultOverride: DashboardRunResult = {
      ...fixture.result,
      tabs: fixture.result.tabs.map((tab) => ({
        ...tab,
        widgets: tab.widgets.map((widget) => widget.widgetId === failedWidgetId
          ? { ...widget, status: "failed", message: "Source report missing", error: "Source report missing" }
          : widget)
      }))
    };

    render(<PreviewHarness widgetSearch="invoice" resultOverride={resultOverride} callbacks={callbacks} />);

    const filterInput = screen.getByLabelText("Status");
    await user.type(filterInput, "Open");

    expect(screen.getByTestId("runtime-values").textContent).toContain("Open");
    expect(screen.getByText("Card unavailable")).toBeInTheDocument();
    expect(screen.getByText("Invoice Health")).toBeInTheDocument();
    expect(screen.queryByText("Project Portfolio")).not.toBeInTheDocument();
  });
});
