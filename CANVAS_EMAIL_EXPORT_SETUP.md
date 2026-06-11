# Canvas Email Export — Activation Guide

This enables server-side chart rendering for scheduled and test emails so the
exported charts are identical to the manual download. Everything is already
deployed. These steps just activate it on the VPS.

---

## Step 1 — Install system dependencies (one time)

SSH into the VPS and run:

```bash
sudo apt-get update
sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

---

## Step 2 — Add font files

Copy these four TTF files into `~/apps/api/fonts/` on the VPS:

| File | Download from |
|------|--------------|
| `Manrope-Bold.ttf` | https://fonts.google.com/specimen/Manrope → Download family → static/ |
| `Manrope-SemiBold.ttf` | same download |
| `Manrope-Medium.ttf` | same download |
| `IBMPlexMono-Regular.ttf` | https://fonts.google.com/specimen/IBM+Plex+Mono → Download family → static/ |

The fonts directory is `apps/api/fonts/` relative to the project root.

```bash
# Example — upload from your Mac after downloading the zip files
scp ~/Downloads/Manrope/static/Manrope-Bold.ttf     user@vps:~/app/apps/api/fonts/
scp ~/Downloads/Manrope/static/Manrope-SemiBold.ttf user@vps:~/app/apps/api/fonts/
scp ~/Downloads/Manrope/static/Manrope-Medium.ttf   user@vps:~/app/apps/api/fonts/
scp ~/Downloads/IBMPlexMono/static/IBMPlexMono-Regular.ttf user@vps:~/app/apps/api/fonts/
```

> **Note:** If you skip this step, the canvas renderer still works — charts just
> use Arial instead of Manrope/IBM Plex Mono. Activate the flag first to verify
> layout is correct, then add fonts to get exact styling.

---

## Step 3 — Install the canvas npm package on the VPS

```bash
cd ~/app/apps/api
npm install
```

The `canvas` package is already in `package.json`. This step compiles its native
bindings against the system libraries installed in Step 1.

---

## Step 4 — Set the environment variable

Add this line to your `.env` file (same file as DATABASE_URL, SESSION_SECRET, etc.):

```
CANVAS_CHARTS_ENABLED=true
```

---

## Step 5 — Restart the API

```bash
pm2 restart api
# or whatever your PM2 process name is
pm2 logs api --lines 50   # watch for startup errors
```

---

## Step 6 — Verify

1. Go to Scheduled Email Reports in the portal
2. Open any dashboard report config
3. Click **Send test email**
4. Compare the received email attachment against a manual export of the same
   dashboard — layout, charts, and data should be identical

---

## Rolling back

If anything looks wrong, remove `CANVAS_CHARTS_ENABLED=true` from `.env` and
restart. The original QuickChart.io email path is completely untouched and will
resume immediately.

---

## What changed (summary)

| | Before | After |
|---|---|---|
| Test email charts | QuickChart.io API (Chart.js style) | Same Canvas drawing as manual download |
| Scheduled email charts | QuickChart.io API | Same Canvas drawing as manual download |
| Manual download | Browser Canvas (unchanged) | Browser Canvas (unchanged) |
| Layout (side-by-side widgets) | Fixed in this deploy | Fixed in this deploy |
