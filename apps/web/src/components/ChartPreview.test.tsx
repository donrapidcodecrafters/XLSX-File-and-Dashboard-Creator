import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartPreview } from "./ChartPreview";

describe("ChartPreview", () => {
  it("renders heatmaps as a category by series matrix when series data is present", () => {
    render(
      <ChartPreview
        chartType="heatmap"
        title="Risk Matrix"
        xAxisLabel="Likelihood"
        yAxisLabel="Impact"
        data={[
          { label: "Low", rawLabel: "Low", series: "Rare", rawSeries: "Rare", value: 2, axis: "primary" },
          { label: "Low", rawLabel: "Low", series: "Likely", rawSeries: "Likely", value: 6, axis: "primary" },
          { label: "High", rawLabel: "High", series: "Rare", rawSeries: "Rare", value: 7, axis: "primary" },
          { label: "High", rawLabel: "High", series: "Likely", rawSeries: "Likely", value: 12, axis: "primary" }
        ]}
      />
    );

    expect(screen.getByText("Risk Matrix")).toBeInTheDocument();
    expect(screen.getByText("Likelihood")).toBeInTheDocument();
    expect(screen.getByText("Impact")).toBeInTheDocument();
    expect(screen.getAllByText("Rare").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Likely").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Low").length).toBeGreaterThan(0);
    expect(screen.getAllByText("High").length).toBeGreaterThan(0);
    expect(screen.getByText("12.00")).toBeInTheDocument();
  });

  it("renders bullet charts with actual and target labels", () => {
    render(
      <ChartPreview
        chartType="bullet"
        title="Quota Tracker"
        data={[
          { label: "Dana", rawLabel: "Dana", value: 74, axis: "primary" },
          { label: "Dana", rawLabel: "Dana", value: 90, axis: "secondary" }
        ]}
      />
    );

    expect(screen.getByText("Quota Tracker")).toBeInTheDocument();
    expect(screen.getByText("74.00%")).toBeInTheDocument();
    expect(screen.getByText("Dana")).toBeInTheDocument();
  });

  it("renders gauges for single-value KPI charts", () => {
    render(
      <ChartPreview
        chartType="gauge"
        title="Single KPI"
        data={[
          { label: "Adoption", rawLabel: "Adoption", value: 84, axis: "primary" }
        ]}
      />
    );

    expect(screen.getByText("Single KPI")).toBeInTheDocument();
    expect(screen.getByText("84.00")).toBeInTheDocument();
    expect(screen.getByText("Adoption")).toBeInTheDocument();
  });
});
