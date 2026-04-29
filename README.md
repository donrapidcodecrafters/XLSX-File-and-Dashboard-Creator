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
