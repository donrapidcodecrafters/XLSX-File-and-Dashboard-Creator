import type { FastifyInstance } from "fastify";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

interface WorkbookProfile {
  id: string;
  workbookName: string;
  dataSheets: string[];
  sourceIds: string[];
  objectIds: string[];
  lastImportedAt: string | null;
}

export async function registerWorkbookProfileRoutes(app: FastifyInstance) {

  app.get("/api/workbook-profiles/:id", async (request, reply) => {
    if (!isPostgresEnabled()) { reply.code(503); return { message: "Postgres required." }; }
    const { id } = request.params as { id: string };
    const result = await pgQuery<{
      id: string; workbook_name: string; data_sheets: string[];
      source_ids: string[]; object_ids: string[]; last_imported_at: string | null;
    }>(
      `SELECT id, workbook_name, data_sheets, source_ids, object_ids, last_imported_at
       FROM workbook_profiles WHERE id = $1`, [id]
    ).catch(() => null);
    const row = result?.rows[0];
    // A source with no saved profile yet (brand new, or never successfully saved
    // one) is a normal, expected state — not an error condition — so this returns
    // 200 with a null profile instead of 404. A 404 always shows up as a red
    // network-error entry in the browser console regardless of how gracefully the
    // client catches it, which reads as "something is broken" even though nothing is.
    if (!row) { return { profile: null }; }
    return {
      profile: {
        id: row.id,
        workbookName: row.workbook_name,
        dataSheets: row.data_sheets || [],
        sourceIds: row.source_ids || [],
        objectIds: row.object_ids || [],
        lastImportedAt: row.last_imported_at || null
      } as WorkbookProfile
    };
  });

  app.put("/api/workbook-profiles/:id", async (request, reply) => {
    if (!isPostgresEnabled()) { reply.code(503); return { message: "Postgres required." }; }
    const { id } = request.params as { id: string };
    const body = (request.body as Partial<WorkbookProfile> | undefined) || {};
    await pgQuery(
      `INSERT INTO workbook_profiles (id, workbook_name, data_sheets, source_ids, object_ids, last_imported_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         workbook_name = COALESCE(EXCLUDED.workbook_name, workbook_profiles.workbook_name),
         data_sheets   = COALESCE($3, workbook_profiles.data_sheets),
         source_ids    = COALESCE($4, workbook_profiles.source_ids),
         object_ids    = COALESCE($5, workbook_profiles.object_ids),
         last_imported_at = now(),
         updated_at    = now()`,
      [
        id,
        body.workbookName || id,
        body.dataSheets || [],
        body.sourceIds || [],
        body.objectIds || []
      ]
    );
    return { ok: true };
  });
}
