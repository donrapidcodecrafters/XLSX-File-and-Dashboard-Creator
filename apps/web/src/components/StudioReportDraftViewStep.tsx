import { type Dispatch, type SetStateAction, useMemo } from "react";
import { type ChartAggregation, type ChartDatum, type ChartSortMode, type ChartType, type ChartSeriesType, type StudioBuilderDraft, type SummaryMetric, type TableDefinition } from "@studio/shared";
import {
  CHART_SERIES_TYPE_OPTIONS,
  CHART_SORT_OPTIONS,
  DEFAULT_CHART_COLORS,
  chartAggregationOptions,
  chartColorKeyLabel,
  chartPrimaryFieldLabel,
  chartPercentModeOptions,
  chartRequiresSeries,
  chartSeriesFieldLabel,
  chartSupportsSecondaryAxis,
  chartSupportsPercentAggregation,
  chartSupportsSeries,
  chartTypeSelectOptions,
  chartUsesAxes,
  getChartColorKey,
  normalizeChartPercentMode,
  chartValueFieldLabel,
  getSortedFieldOptions,
  reportShowsChart
} from "./studioReportUtils";
import { SearchableSelect } from "./SearchableSelect";

function createMetricId() {
  return `metric-${Math.random().toString(36).slice(2, 10)}`;
}

export function StudioReportDraftViewStep({
  createDraft,
  createDraftTable,
  createDraftPreviewChartData = [],
  setCreateDraft
}: {
  createDraft: StudioBuilderDraft;
  createDraftTable: TableDefinition;
  createDraftPreviewChartData?: ChartDatum[];
  setCreateDraft: Dispatch<SetStateAction<StudioBuilderDraft>>;
}) {
  const fieldOptions = getSortedFieldOptions(createDraftTable);
  const chartColorKeyOptions = useMemo(() => {
    const keys = Array.from(new Set([
      ...createDraftPreviewChartData.map((datum) => getChartColorKey(datum)).filter(Boolean),
      ...Object.keys(createDraft.view.chartValueColors || {})
    ]));
    return keys.map((key) => ({ value: key, label: key }));
  }, [createDraftPreviewChartData, createDraft.view.chartValueColors]);
  return (
    <div className="card">
      <div className="card-head">
        <strong>View</strong>
        <span className="micro">Only the settings relevant to the chosen report mode stay visible here.</span>
      </div>
      <div className="view-layout-grid">
        {createDraft.view.mode === "summary" ? (
          <section className="builder-subsection">
            <div className="builder-subsection-head">
              <strong>Summary Setup</strong>
              <span className="micro">Pick the two fields that define the summary: the column grouping (X axis) and the value to aggregate (Y axis).</span>
            </div>
            <div className="builder-subsection-grid">
              <label className="field">
                <span>Group field (columns)</span>
                <SearchableSelect
                  value={createDraft.groups[0]?.fieldId || ""}
                  options={fieldOptions}
                  allowEmpty
                  emptyOptionLabel="Choose a field…"
                  onChange={(value) => setCreateDraft((current) => {
                    const metric = current.summaryMetrics[0];
                    const op = metric?.op || "sum";
                    const valueFieldId = metric?.fieldId || "";
                    const autoLabel = value ? `${op.charAt(0).toUpperCase() + op.slice(1)} of ${fieldOptions.find((f) => f.value === valueFieldId)?.label || valueFieldId || "rows"}` : "";
                    return {
                      ...current,
                      groups: value ? [{ id: current.groups[0]?.id || `grp-1`, fieldId: value }] : [],
                      summaryMetrics: metric ? [{ ...metric, label: autoLabel || metric.label }] : current.summaryMetrics
                    };
                  })}
                />
              </label>
              <label className="field">
                <span>Value field</span>
                <SearchableSelect
                  value={createDraft.summaryMetrics[0]?.fieldId || ""}
                  options={fieldOptions}
                  allowEmpty
                  emptyOptionLabel="Count rows"
                  onChange={(value) => setCreateDraft((current) => {
                    const op = value ? (current.summaryMetrics[0]?.op === "count" ? "sum" : (current.summaryMetrics[0]?.op || "sum")) : "count";
                    const groupLabel = fieldOptions.find((f) => f.value === (current.groups[0]?.fieldId || ""))?.label || "";
                    const valueLabel = fieldOptions.find((f) => f.value === value)?.label || "";
                    const autoLabel = value ? `${op.charAt(0).toUpperCase() + op.slice(1)} of ${valueLabel}` : "Row count";
                    return {
                      ...current,
                      summaryMetrics: [{
                        id: current.summaryMetrics[0]?.id || createMetricId(),
                        fieldId: value,
                        op,
                        label: autoLabel
                      }]
                    };
                    void groupLabel;
                  })}
                />
              </label>
              <label className="field">
                <span>Aggregation</span>
                <select
                  value={createDraft.summaryMetrics[0]?.op || "sum"}
                  disabled={!createDraft.summaryMetrics[0]?.fieldId}
                  onChange={(event) => setCreateDraft((current) => {
                    const op = event.target.value as SummaryMetric["op"];
                    const valueFieldId = current.summaryMetrics[0]?.fieldId || "";
                    const valueLabel = fieldOptions.find((f) => f.value === valueFieldId)?.label || valueFieldId || "rows";
                    const autoLabel = valueFieldId ? `${op.charAt(0).toUpperCase() + op.slice(1)} of ${valueLabel}` : "Row count";
                    return {
                      ...current,
                      summaryMetrics: current.summaryMetrics.length
                        ? [{ ...current.summaryMetrics[0], op, label: autoLabel }]
                        : [{ id: createMetricId(), fieldId: "", op: "count", label: "Row count" }]
                    };
                  })}
                >
                  <option value="count">Count</option>
                  <option value="sum">Sum</option>
                  <option value="avg">Average</option>
                  <option value="min">Minimum</option>
                  <option value="max">Maximum</option>
                </select>
              </label>
            </div>
          </section>
        ) : (
          <section className="builder-subsection">
            <div className="builder-subsection-head">
              <strong>Summary Metrics</strong>
              <span className="micro">Choose the summary values to show above the report. Use Count rows when you want row count instead of a field calculation.</span>
            </div>
            <div className="stack-compact">
              {createDraft.summaryMetrics.length ? createDraft.summaryMetrics.map((metric) => (
                <div className="inline-edit-row" key={metric.id}>
                  <SearchableSelect
                    value={metric.fieldId}
                    options={fieldOptions}
                    allowEmpty
                    emptyOptionLabel="Count rows"
                    onChange={(value) => setCreateDraft((current) => ({
                      ...current,
                      summaryMetrics: current.summaryMetrics.map((item) => item.id === metric.id ? {
                        ...item,
                        fieldId: value,
                        op: value ? item.op : "count",
                        label: value ? item.label : (item.label || "Row count")
                      } : item)
                    }))}
                  />
                  <select
                    value={metric.op}
                    onChange={(event) => setCreateDraft((current) => ({
                      ...current,
                      summaryMetrics: current.summaryMetrics.map((item) => item.id === metric.id ? {
                        ...item,
                        op: event.target.value as SummaryMetric["op"],
                        fieldId: event.target.value === "count" ? "" : item.fieldId
                      } : item)
                    }))}
                  >
                    <option value="count">Count rows</option>
                    <option value="sum">Sum</option>
                    <option value="avg">Average</option>
                    <option value="min">Minimum</option>
                    <option value="max">Maximum</option>
                  </select>
                  <input
                    value={metric.label}
                    onChange={(event) => setCreateDraft((current) => ({
                      ...current,
                      summaryMetrics: current.summaryMetrics.map((item) => item.id === metric.id ? { ...item, label: event.target.value } : item)
                    }))}
                    placeholder={metric.op === "count" ? "Row count" : "Metric label"}
                  />
                  <button
                    type="button"
                    onClick={() => setCreateDraft((current) => ({
                      ...current,
                      summaryMetrics: current.summaryMetrics.filter((item) => item.id !== metric.id)
                    }))}
                  >
                    Remove
                  </button>
                </div>
              )) : <div className="empty-hint">No summary metrics yet. Add one to show values like row count, sum, average, minimum, or maximum.</div>}
              <div className="studio-actions">
                <button
                  type="button"
                  onClick={() => setCreateDraft((current) => ({
                    ...current,
                    summaryMetrics: [
                      ...current.summaryMetrics,
                      { id: createMetricId(), fieldId: "", op: "count", label: "Row count" }
                    ]
                  }))}
                >
                  Add summary metric
                </button>
              </div>
            </div>
          </section>
        )}

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
                const nextAggregationOptions = chartAggregationOptions(nextChartType);
                const normalizedCurrentAggregation = current.view.chartAggregation === "avg" ? "average" : current.view.chartAggregation;
                const nextAggregation = nextAggregationOptions.some((option) => option.value === normalizedCurrentAggregation)
                  ? normalizedCurrentAggregation
                  : (nextAggregationOptions[0]?.value || "count");
                return {
                  ...current,
                  view: {
                    ...current.view,
                    chartType: nextChartType,
                    chartAggregation: nextAggregation,
                    chartPercentMode: nextAggregation === "percent"
                      ? normalizeChartPercentMode(nextChartType, current.view.chartPercentMode)
                      : current.view.chartPercentMode,
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
              <label className="field"><span>{chartPrimaryFieldLabel(createDraft.view.chartType)}</span><SearchableSelect value={createDraft.view.chartFieldId} options={fieldOptions} onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartFieldId: value } }))} /></label>
              {chartSupportsSeries(createDraft.view.chartType) ? (
                <label className="field">
                  <span>{chartSeriesFieldLabel(createDraft.view.chartType)}</span>
                  <SearchableSelect value={createDraft.view.chartSeriesFieldId} options={fieldOptions} allowEmpty emptyOptionLabel={chartRequiresSeries(createDraft.view.chartType) ? "Choose a series field" : "Single series"} onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSeriesFieldId: value } }))} />
                </label>
              ) : null}
              <label className="field"><span>{chartValueFieldLabel(createDraft.view.chartType)}</span><SearchableSelect value={createDraft.view.chartValueFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Count rows" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartValueFieldId: value, chartAggregation: value ? current.view.chartAggregation : "count" } }))} /></label>
              <label className="field">
                <span>Primary aggregation</span>
                <select
                  value={createDraft.view.chartAggregation === "avg" ? "average" : createDraft.view.chartAggregation}
                  onChange={(event) => setCreateDraft((current) => ({
                    ...current,
                    view: {
                      ...current.view,
                      chartAggregation: event.target.value as ChartAggregation,
                      chartPercentMode: event.target.value === "percent"
                        ? normalizeChartPercentMode(current.view.chartType, current.view.chartPercentMode)
                        : current.view.chartPercentMode,
                      chartValueFieldId: event.target.value === "count" ? "" : current.view.chartValueFieldId
                    }
                  }))}
                >
                  {chartAggregationOptions(createDraft.view.chartType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {createDraft.view.chartAggregation === "percent" && chartSupportsPercentAggregation(createDraft.view.chartType) ? (
                <label className="field">
                  <span>Percent mode</span>
                  <select
                    value={normalizeChartPercentMode(createDraft.view.chartType, createDraft.view.chartPercentMode) || ""}
                    onChange={(event) => setCreateDraft((current) => ({
                      ...current,
                      view: {
                        ...current.view,
                        chartPercentMode: event.target.value ? event.target.value as typeof current.view.chartPercentMode : undefined
                      }
                    }))}
                  >
                    {chartPercentModeOptions(createDraft.view.chartType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ) : null}
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
                          <label className="field"><span>Secondary Y axis field</span><SearchableSelect value={createDraft.view.chartSecondaryValueFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Count rows" onChange={(value) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSecondaryValueFieldId: value, chartSecondaryAggregation: value ? current.view.chartSecondaryAggregation : "count" } }))} /></label>
                          <label className="field">
                            <span>Secondary aggregation</span>
                            <select
                              value={createDraft.view.chartSecondaryAggregation === "avg" ? "average" : createDraft.view.chartSecondaryAggregation}
                              onChange={(event) => setCreateDraft((current) => ({
                                ...current,
                                view: {
                                  ...current.view,
                                  chartSecondaryAggregation: event.target.value as ChartAggregation,
                                  chartSecondaryValueFieldId: event.target.value === "count" ? "" : current.view.chartSecondaryValueFieldId
                                }
                              }))}
                            >
                              {chartAggregationOptions(createDraft.view.chartType).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <label className="field"><span>Secondary Y axis label</span><input value={createDraft.view.chartSecondaryYAxisLabel} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSecondaryYAxisLabel: event.target.value } }))} placeholder="Optional secondary axis label" /></label>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Chart colors</span>
                    <div className="micro">Base palette used when a specific category or series color is not assigned.</div>
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
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Specific chart colors</span>
                    <div className="micro">Assign colors to exact {chartColorKeyLabel(createDraft.view.chartType).toLowerCase()}s shown in the chart preview.</div>
                    <div className="stack-compact" style={{ marginTop: "10px" }}>
                      {chartColorKeyOptions.length ? chartColorKeyOptions.map((option) => (
                        <div className="inline-edit-row" key={option.value}>
                          <input value={option.label} disabled />
                          <input
                            type="color"
                            value={createDraft.view.chartValueColors?.[option.value] || "#0d7c66"}
                            onChange={(event) => setCreateDraft((current) => ({
                              ...current,
                              view: {
                                ...current.view,
                                chartValueColors: {
                                  ...(current.view.chartValueColors || {}),
                                  [option.value]: event.target.value
                                }
                              }
                            }))}
                          />
                          <button
                            type="button"
                            onClick={() => setCreateDraft((current) => {
                              const nextColors = { ...(current.view.chartValueColors || {}) };
                              delete nextColors[option.value];
                              return {
                                ...current,
                                view: {
                                  ...current.view,
                                  chartValueColors: nextColors
                                }
                              };
                            })}
                          >
                            Clear
                          </button>
                        </div>
                      )) : <div className="empty-hint">Preview the chart with data first to assign individual colors.</div>}
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
