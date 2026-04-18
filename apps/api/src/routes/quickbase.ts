import type { FastifyInstance } from "fastify";
import { runReport, type ReportDefinition, type TableDefinition } from "@studio/shared";
import { loadQuickbaseSchema } from "../services/quickbase-schema.js";
import { fetchQuickbaseTableRows } from "../services/quickbase-storage.js";

export async function registerQuickbaseRoutes(app: FastifyInstance) {
  app.post("/api/quickbase/schema", async (request, reply) => {
    const body = (request.body as {
      realmHostname?: string;
      userToken?: string;
      appToken?: string;
      appId?: string;
    } | undefined) || {};

    try {
      const schema = await loadQuickbaseSchema({
        realmHostname: body.realmHostname || "",
        userToken: body.userToken || "",
        appToken: body.appToken || "",
        appId: body.appId || ""
      });
      return { schema };
    } catch (error) {
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Quickbase schema lookup failed."
      };
    }
  });

  app.post("/api/quickbase/table-preview", async (request, reply) => {
    const body = (request.body as {
      realmHostname?: string;
      userToken?: string;
      appToken?: string;
      appId?: string;
      tableId?: string;
      fieldIds?: string[];
      top?: number;
    } | undefined) || {};

    try {
      const rows = await fetchQuickbaseTableRows({
        realmHostname: body.realmHostname || "",
        userToken: body.userToken || "",
        appToken: body.appToken || "",
        appId: body.appId || "",
        apiBaseUrl: "https://api.quickbase.com/v1",
        objectTableId: "",
        objectKeyFieldId: "",
        objectTypeFieldId: "",
        objectNameFieldId: "",
        objectConfigFieldId: "",
        objectOwnerFieldId: "",
        objectUpdatedAtFieldId: "",
        objectUpdatedByFieldId: "",
        settingsTableId: "",
        settingsUserFieldId: "",
        settingsObjectFieldId: "",
        settingsObjectKeyFieldId: "",
        settingsJsonFieldId: "",
        settingsUpdatedByFieldId: "",
        versionTableId: "",
        versionObjectFieldId: "",
        versionObjectKeyFieldId: "",
        versionSnapshotFieldId: "",
        versionChangedAtFieldId: "",
        versionChangedByFieldId: "",
        versionUpdatedByFieldId: ""
      }, body.tableId || "", body.fieldIds || [], { top: body.top || 250 });
      return { rows };
    } catch (error) {
      request.log.warn({
        tableId: body.tableId || "",
        fieldCount: Array.isArray(body.fieldIds) ? body.fieldIds.length : 0,
        fieldIds: Array.isArray(body.fieldIds) ? body.fieldIds.slice(0, 12) : [],
        top: body.top || 250,
        error: error instanceof Error ? error.message : error
      }, "quickbase table preview failed");
      reply.code(400);
      return {
        message: error instanceof Error
          ? error.message
          : `Quickbase table preview failed for table ${body.tableId || "(missing table id)"}.`
      };
    }
  });

  app.post("/api/quickbase/report-preview", async (request, reply) => {
    const body = (request.body as {
      quickbase?: {
        realmHostname?: string;
        userToken?: string;
        appToken?: string;
        appId?: string;
      };
      report?: ReportDefinition;
      table?: TableDefinition;
    } | undefined) || {};

    try {
      const report = body.report;
      const table = body.table;
      if (!report || !table) {
        reply.code(400);
        return { message: "Report and table are required." };
      }
      const fieldIds = Array.from(new Set(
        [
          ...(report.selectedFieldIds || []),
          ...(report.filters || []).map((item) => item.fieldId),
          ...(report.groups || []).map((item) => item.fieldId),
          ...(report.sorts || []).map((item) => item.fieldId),
          ...((report.summaryMetrics || []).map((item) => item.fieldId)),
          report.view.chartFieldId,
          report.view.chartValueFieldId,
          report.view.timelineDateField,
          report.view.timelineEndField,
          report.view.calendarDateField,
          report.view.kanbanField,
          report.view.titleFieldId
        ].filter(Boolean).map(String)
      ));

      const rows = await fetchQuickbaseTableRows({
        realmHostname: body.quickbase?.realmHostname || "",
        userToken: body.quickbase?.userToken || "",
        appToken: body.quickbase?.appToken || "",
        appId: body.quickbase?.appId || "",
        apiBaseUrl: "https://api.quickbase.com/v1",
        objectTableId: "",
        objectKeyFieldId: "",
        objectTypeFieldId: "",
        objectNameFieldId: "",
        objectConfigFieldId: "",
        objectOwnerFieldId: "",
        objectUpdatedAtFieldId: "",
        objectUpdatedByFieldId: "",
        settingsTableId: "",
        settingsUserFieldId: "",
        settingsObjectFieldId: "",
        settingsObjectKeyFieldId: "",
        settingsJsonFieldId: "",
        settingsUpdatedByFieldId: "",
        versionTableId: "",
        versionObjectFieldId: "",
        versionObjectKeyFieldId: "",
        versionSnapshotFieldId: "",
        versionChangedAtFieldId: "",
        versionChangedByFieldId: "",
        versionUpdatedByFieldId: ""
      }, table.id, fieldIds, { top: 500 });

      return { result: runReport(report, table, rows) };
    } catch (error) {
      request.log.warn({
        tableId: body.table?.id || "",
        reportId: body.report?.id || "",
        fieldCount: Array.isArray(body.report?.selectedFieldIds) ? body.report?.selectedFieldIds.length : 0,
        selectedFieldIds: Array.isArray(body.report?.selectedFieldIds) ? body.report?.selectedFieldIds.slice(0, 12) : [],
        error: error instanceof Error ? error.message : error
      }, "quickbase report preview failed");
      reply.code(400);
      return {
        message: error instanceof Error ? error.message : "Quickbase report preview failed."
      };
    }
  });
}
