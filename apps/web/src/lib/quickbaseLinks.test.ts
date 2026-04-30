import { describe, expect, it } from "vitest";
import { buildQuickbaseHelpdeskTicketUrl } from "./quickbaseLinks";

describe("buildQuickbaseHelpdeskTicketUrl", () => {
  it("builds a prefilled Quickbase add-record form url for helpdesk tickets", () => {
    const url = buildQuickbaseHelpdeskTicketUrl({
      realmHostname: "cadencec.quickbase.com",
      helpdeskAppDbid: "bhelpdesk1",
      helpdeskTicketsTableDbid: "btickets1",
      helpdeskParentTableDbid: "bparent1",
      helpdeskParentAppIdFid: "42"
    }, "bva8ar4ad");

    expect(url).toBe("https://cadencec.quickbase.com/db/btickets1?a=API_GenAddRecordForm&_fid_42=bva8ar4ad&z=%2Fdb%2Fbparent1");
  });

  it("returns an empty string when required helpdesk config is incomplete", () => {
    expect(buildQuickbaseHelpdeskTicketUrl({
      realmHostname: "cadencec.quickbase.com",
      helpdeskAppDbid: "",
      helpdeskTicketsTableDbid: "btickets1",
      helpdeskParentTableDbid: "bparent1",
      helpdeskParentAppIdFid: "42"
    }, "bva8ar4ad")).toBe("");
  });
});
