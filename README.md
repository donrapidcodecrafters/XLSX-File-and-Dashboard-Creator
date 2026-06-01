# Quickbase Reporting Platform

Full rebuild of the reporting studio as a hosted platform:

- `apps/web`: React + Vite frontend for reports, dashboards, direct links, and embed mode
- `apps/api`: Node + Fastify API with worker-backed report execution and in-memory caching
- `packages/shared`: shared models, seed data, and report execution logic

## Run locally

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

API: `http://localhost:3001`

## Build

```bash
npm run build
```

## Enterprise API mode

The API can now boot with a Postgres-backed enterprise storage layer while keeping the local JSON fallback for development.

1. Copy `.env.example` to `.env` on the server and fill in `DATABASE_URL`, `SESSION_SECRET`, and the auth whitelist.
2. Build the workspaces:

```bash
npm run build
```

3. Start the compiled API under PM2:

```bash
pm2 start ecosystem.config.cjs
```

When `DATABASE_URL` or `POSTGRES_URL` is present, the API creates the static Postgres tables for `users`, `session`, `app_entities`, `app_attributes`, `app_records`, `app_sync_jobs`, and `report_configs`. Quickbase refreshes continue to update the existing studio cache and also replace the matching JSONB `app_records` rows by `source_id`. Report and dashboard execution can read those durable rows back from Postgres in batches when the local JSON cache is empty.

Durable source endpoints:

- `GET /api/studio/sources` lists Postgres-backed sources and matching studio table metadata.
- `POST /api/studio/sources/xlsx?sourceId=...&sourceName=...` imports an uploaded workbook as durable Excel sources. Multipart uploads are stream parsed and batch-written to Postgres; base64 JSON uploads are supported for small programmatic imports. A single-sheet workbook uses `sourceId`; multi-tab workbooks use stable per-sheet IDs like `sourceId:sheet-name`. Re-importing the same `sourceId` replaces that source's old `app_records` rows.

Set `AUTH_ENABLED=true` to protect API routes with the hardcoded bcrypt whitelist. Without `AUTH_ENABLED`, the current open local-dev behavior is preserved.

## GitHub Pages

This repo supports two GitHub Pages frontend builds without changing the Vite setup:

- Live: `https://donaldlundgren.github.io/XLSX-File-and-Dashboard-Creator/`
- Dev: `https://donaldlundgren.github.io/XLSX-File-and-Dashboard-Creator/dev/`

Both builds use the same `apps/web` Vite app. The only difference is the base path.

### Publish live without removing dev

```bash
VITE_API_BASE_URL="https://xlsx-file-and-dashboard-creator.onrender.com" npm run pages:live
```

This builds with:

- `VITE_BASE_PATH=/XLSX-File-and-Dashboard-Creator/`
- output in `docs/`
- preserves `docs/dev/`

### Publish dev without touching live

```bash
VITE_API_BASE_URL="https://xlsx-file-and-dashboard-creator.onrender.com" npm run pages:dev
```

This builds with:

- `VITE_BASE_PATH=/XLSX-File-and-Dashboard-Creator/dev/`
- output in `docs/dev/`
- does not overwrite the live site in `docs/`

### Commit and push

After either build:

```bash
git add -A
git commit -m "Publish GitHub Pages build"
git push origin main
```

## Notes

- GitHub Pages can host the frontend, but it cannot securely hold Quickbase tokens.
- For live Quickbase data, run `apps/api` on a real Node host and point the frontend to it with `VITE_API_BASE_URL`.
