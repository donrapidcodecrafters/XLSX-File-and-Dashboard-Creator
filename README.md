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

## GitHub Pages

Build the frontend with a repo-aware base path:

```bash
cd apps/web
VITE_BASE_PATH=/your-repo-name/ npm run build
```

Then publish `apps/web/dist`.

## Notes

- GitHub Pages can host the frontend, but it cannot securely hold Quickbase tokens.
- For live Quickbase data, run `apps/api` on a real Node host and point the frontend to it with `VITE_API_BASE_URL`.
