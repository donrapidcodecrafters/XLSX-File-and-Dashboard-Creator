import type { FastifyInstance } from "fastify";
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
      reply.code(400);
      return {
        message: error instanceof Error
          ? error.message
          : `Quickbase table preview failed for table ${body.tableId || "(missing table id)"}.`
      };
    }
  });
}
