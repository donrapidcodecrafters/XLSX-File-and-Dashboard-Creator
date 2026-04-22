import { type Dispatch, type SetStateAction } from "react";
import { type ChartAggregation, type ChartSortMode, type ChartType, type ChartSeriesType, type ReportViewMode, type StudioBuilderDraft, type TableDefinition } from "@studio/shared";
import {
  CHART_AGGREGATION_OPTIONS,
  CHART_SERIES_TYPE_OPTIONS,
  CHART_SORT_OPTIONS,
  DEFAULT_CHART_COLORS,
  REPORT_VIEW_OPTIONS,
  chartSupportsSecondaryAxis,
  chartSupportsSeries,
  chartTypeSelectOptions,
  chartUsesAxes,
  chartValueFieldLabel,
  getSortedFieldOptions,
  reportShowsChart,
  reportShowsDetails,
  reportShowsSummary
} from "./studioReportUtils";
import { SearchableSelect } from "./SearchableSelect";

export function StudioReportDraftViewStep({
  createDraft,
  createDraftTable,
  setCreateDraft
}: {
  createDraft: StudioBuilderDraft;
  createDraftTable: TableDefinition;
  setCreateDraft: Dispatch<SetStateAction<StudioBuilderDraft>>;
}) {
  const fieldOptions = getSortedFieldOptions(createDraftTable);
  return (
    <div className="card">
      <div className="card-head">
        <strong>View</strong>
        <span className="micro">Only the settings relevant to the chosen report mode stay visible here.</span>
      </div>
      <div className="view-layout-grid">
        <section className="builder-subsection">
          <div className="builder-subsection-head">
            <strong>Basics</strong>
            <span className="micro">Choose the default layout and core formatting.</span>
          </div>
          <div className="builder-subsection-grid">
            <label className="field">
              <span>Mode</span>
              <select
                value={createDraft.view.mode}
                onChange={(event) => setCreateDraft((current) => {
                  const nextMode = event.target.value as ReportViewMode;
                  return {
                    ...current,
                    view: {
                      ...current.view,
                      mode: nextMode,
                      showChartInTable: nextMode === "table" ? current.view.showChartInTable : false,
                      showSummary: nextMode === "table" || nextMode === "summary" || nextMode === "chart",
                      showDetails: nextMode === "table" || nextMode === "timeline" || nextMode === "calendar" || nextMode === "kanban"
                    }
                  };
                })}
              >
                {REPORT_VIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Record title field</span>
              <SearchableSelect value={createDraft.view.titleFieldId} options={fieldOptions} onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, titleFieldId: value } }))} />
            </label>
            <label className="field">
              <span>Decimal places</span>
              <input type="number" min="0" max="6" value={createDraft.view.decimalPlaces} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, decimalPlaces: Math.max(0, Math.min(6, Number(event.target.value) || 0)) } }))} />
            </label>
            <label className="toggle-row builder-subsection-toggle">
              <input type="checkbox" checked={createDraft.view.showSummary ?? reportShowsSummary({ view: createDraft.view })} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, showSummary: event.target.checked } }))} />
              Show summary metrics
            </label>
            <label className="toggle-row builder-subsection-toggle">
              <input type="checkbox" checked={createDraft.view.showDetails ?? reportShowsDetails({ view: createDraft.view })} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, showDetails: event.target.checked } }))} />
              {createDraft.view.mode === "chart" || createDraft.view.mode === "summary"
                ? "Include detail rows"
                : createDraft.view.mode === "kanban" || createDraft.view.mode === "timeline" || createDraft.view.mode === "calendar"
                  ? "Show detail cards"
                  : "Show detail rows"}
            </label>
            {createDraft.view.mode === "table" ? (
              <label className="toggle-row builder-subsection-toggle">
                <input type="checkbox" checked={createDraft.view.showChartInTable} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, showChartInTable: event.target.checked } }))} />
                Include chart above table
              </label>
            ) : null}
          </div>
        </section>

        {reportShowsChart({ view: createDraft.view }) ? (
          <section className="builder-subsection">
            <div className="builder-subsection-head">
              <strong>Chart Setup</strong>
              <span className="micro">Chart-only options stay isolated from the rest of the report builder.</span>
            </div>
            <div className="builder-subsection-grid">
              <label className="field"><span>Chart title</span><input value={createDraft.view.chartTitle} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartTitle: event.target.value } }))} placeholder="Optional custom chart title" /></label>
              <label className="field"><span>Chart type</span><select value={createDraft.view.chartType} onChange={(event) => setCreateDraft((current) => {
                const nextChartType = event.target.value as ChartType;
                const nextSupportsSecondary = chartSupportsSecondaryAxis(nextChartType);
                const nextSupportsSeries = chartSupportsSeries(nextChartType);
                return {
                  ...current,
                  view: {
                    ...current.view,
                    chartType: nextChartType,
                    chartSeriesFieldId: nextSupportsSeries ? current.view.chartSeriesFieldId : "",
                    chartUseSecondaryAxis: nextSupportsSecondary ? current.view.chartUseSecondaryAxis : false,
                    chartSecondaryValueFieldId: nextSupportsSecondary ? current.view.chartSecondaryValueFieldId : "",
                    chartSecondaryYAxisLabel: nextSupportsSecondary ? current.view.chartSecondaryYAxisLabel : ""
                  }
                };
              })}>{chartTypeSelectOptions(createDraft.view.chartType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {(createDraft.view.chartType === "bar" || createDraft.view.chartType === "stacked-bar") ? (
                <label className="field"><span>Bar direction</span><select value={createDraft.view.chartOrientation} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartOrientation: event.target.value as "vertical" | "horizontal" } }))}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>
              ) : null}
              <label className="field"><span>X axis field</span><SearchableSelect value={createDraft.view.chartFieldId} options={fieldOptions} onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartFieldId: value } }))} /></label>
              {chartSupportsSeries(createDraft.view.chartType) ? (
                <label className="field">
                  <span>Series field</span>
                  <SearchableSelect value={createDraft.view.chartSeriesFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Single series" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSeriesFieldId: value } }))} />
                </label>
              ) : null}
              <label className="field"><span>{chartValueFieldLabel(createDraft.view.chartType)}</span><SearchableSelect value={createDraft.view.chartValueFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Count rows" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartValueFieldId: value } }))} /></label>
              <label className="field"><span>Primary aggregation</span><select value={createDraft.view.chartAggregation} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartAggregation: event.target.value as ChartAggregation, chartValueFieldId: event.target.value === "count" ? "" : current.view.chartValueFieldId } }))}>{CHART_AGGREGATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            </div>
            <details className="builder-details">
              <summary>Advanced chart settings</summary>
              <div className="builder-details-content">
                <div className="builder-subsection-grid">
                  <label className="field"><span>Chart sort</span><select value={createDraft.view.chartSort} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSort: event.target.value as ChartSortMode } }))}>{CHART_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="field"><span>Top results</span><input type="number" min="0" value={createDraft.view.chartTopN} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartTopN: Math.max(0, Number(event.target.value) || 0) } }))} /></label>
                  {chartUsesAxes(createDraft.view.chartType) ? (
                    <>
                      <label className="field"><span>X axis label</span><input value={createDraft.view.chartXAxisLabel} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartXAxisLabel: event.target.value } }))} placeholder="Optional custom x axis label" /></label>
                      <label className="field"><span>Y axis label</span><input value={createDraft.view.chartYAxisLabel} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartYAxisLabel: event.target.value } }))} placeholder="Optional custom y axis label" /></label>
                    </>
                  ) : null}
                  {chartSupportsSecondaryAxis(createDraft.view.chartType) ? (
                    <>
                      <label className="toggle-row builder-subsection-toggle">
                        <input type="checkbox" checked={createDraft.view.chartUseSecondaryAxis} onChange={(event) => setCreateDraft((current) => ({
                          ...current,
                          view: {
                            ...current.view,
                            chartUseSecondaryAxis: event.target.checked,
                            chartSecondaryValueFieldId: event.target.checked ? current.view.chartSecondaryValueFieldId : "",
                            chartSecondaryYAxisLabel: event.target.checked ? current.view.chartSecondaryYAxisLabel : ""
                          }
                        }))} />
                        Use a secondary Y axis
                      </label>
                      {createDraft.view.chartUseSecondaryAxis ? (
                        <>
                          <label className="field"><span>Secondary series type</span><select value={createDraft.view.chartSecondarySeriesType} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSecondarySeriesType: event.target.value as ChartSeriesType } }))}>{CHART_SERIES_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                          <label className="field"><span>Secondary Y axis field</span><SearchableSelect value={createDraft.view.chartSecondaryValueFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Count rows" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSecondaryValueFieldId: value } }))} /></label>
                          <label className="field"><span>Secondary aggregation</span><select value={createDraft.view.chartSecondaryAggregation} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSecondaryAggregation: event.target.value as ChartAggregation, chartSecondaryValueFieldId: event.target.value === "count" ? "" : current.view.chartSecondaryValueFieldId } }))}>{CHART_AGGREGATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                          <label className="field"><span>Secondary Y axis label</span><input value={createDraft.view.chartSecondaryYAxisLabel} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSecondaryYAxisLabel: event.target.value } }))} placeholder="Optional secondary axis label" /></label>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Chart colors</span>
                    <div className="micro">These colors are used in preview, dashboards, and full-screen charts in the order shown.</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "8px" }}>
                      {(createDraft.view.chartColors?.length ? createDraft.view.chartColors : DEFAULT_CHART_COLORS).map((color, index) => (
                        <label key={`chart-color-${index}`} className="field" style={{ width: "84px" }}>
                          <span>Color {index + 1}</span>
                          <input
                            type="color"
                            value={color}
                            onChange={(event) => setCreateDraft((current) => {
                              const nextColors = [...(current.view.chartColors?.length ? current.view.chartColors : DEFAULT_CHART_COLORS)];
                              nextColors[index] = event.target.value;
                              return {
                                ...current,
                                view: {
                                  ...current.view,
                                  chartColors: nextColors
                                }
                              };
                            })}
                          />
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                      <button type="button" className="ghost-button" onClick={() => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartColors: [...(current.view.chartColors?.length ? current.view.chartColors : DEFAULT_CHART_COLORS), "#0d7c66"].slice(0, 12) } }))} disabled={(createDraft.view.chartColors?.length || DEFAULT_CHART_COLORS.length) >= 12}>Add color</button>
                      <button type="button" className="ghost-button" onClick={() => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartColors: current.view.chartColors?.length && current.view.chartColors.length > 1 ? current.view.chartColors.slice(0, -1) : [...DEFAULT_CHART_COLORS] } }))}>Remove last color</button>
                      <button type="button" className="ghost-button" onClick={() => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartColors: [...DEFAULT_CHART_COLORS] } }))}>Reset colors</button>
                    </div>
                  </div>
                  <label className="toggle-row builder-subsection-toggle"><input type="checkbox" checked={createDraft.view.chartShowLegend} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartShowLegend: event.target.checked } }))} /> Show legend</label>
                  <label className="toggle-row builder-subsection-toggle"><input type="checkbox" checked={createDraft.view.chartShowValues} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartShowValues: event.target.checked } }))} /> Show values</label>
                </div>
              </div>
            </details>
          </section>
        ) : null}

        {createDraft.view.mode === "kanban" || createDraft.view.mode === "timeline" || createDraft.view.mode === "calendar" ? (
          <section className="builder-subsection">
            <div className="builder-subsection-head">
              <strong>Mode-specific fields</strong>
              <span className="micro">Only the fields needed for the selected layout are shown here.</span>
            </div>
            <div className="builder-subsection-grid">
              {createDraft.view.mode === "kanban" ? <label className="field"><span>Kanban field</span><SearchableSelect value={createDraft.view.kanbanField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, kanbanField: value } }))} /></label> : null}
              {createDraft.view.mode === "timeline" ? (
                <>
                  <label className="field"><span>Timeline start</span><SearchableSelect value={createDraft.view.timelineDateField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, timelineDateField: value } }))} /></label>
                  <label className="field"><span>Timeline end</span><SearchableSelect value={createDraft.view.timelineEndField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, timelineEndField: value } }))} /></label>
                </>
              ) : null}
              {createDraft.view.mode === "calendar" ? <label className="field"><span>Calendar date</span><SearchableSelect value={createDraft.view.calendarDateField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, calendarDateField: value } }))} /></label> : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
