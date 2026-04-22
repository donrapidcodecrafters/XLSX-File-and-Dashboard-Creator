import { buildStudioDocument, type ReportDefinition } from "@studio/shared";
import { describe, expect, it } from "vitest";
import { getProfileIdsForCatalogItem, getProfileLabelsForCatalogItem, toggleFavoriteIds } from "./catalog";

describe("catalog helpers", () => {
  it("toggles favorites without duplicating ids", () => {
    expect(toggleFavoriteIds([], "report-1")).toEqual(["report-1"]);
    expect(toggleFavoriteIds(["report-1", "report-2"], "report-1")).toEqual(["report-2"]);
  });

  it("resolves app ids and labels for catalog items", () => {
    const studioDocument = buildStudioDocument();
    const profileId = studioDocument.quickbaseProfiles[0]?.id || "profile-1";
    const report = studioDocument.bundle.objects["report-project-portfolio"] as ReportDefinition;
    const reportTable = studioDocument.bundle.tables.find((table) => table.id === report.sourceTableId);

    expect(reportTable).toBeTruthy();

    reportTable!.quickbaseProfileId = profileId;

    const profileIds = getProfileIdsForCatalogItem(report, studioDocument);
    const labels = getProfileLabelsForCatalogItem(report, studioDocument);

    expect(profileIds.length).toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThan(0);
  });
});
