# Barrie Transit Lightweight Live Map

A single-page Leaflet app that shows Barrie Transit routes, stops, and live vehicle positions. It is tuned for a limited Smart TV browser, so everything stays lightweight and simple.

## Requirements
- Node.js 22
- Internet access (needed to download GTFS data and map tiles)

## 1. Configure environment variables
1. Copy `.env.example` to `.env`.
2. Edit `.env` and update the values:
   - Keep `GTFS_STATIC_URL=https://www.myridebarrie.ca/gtfs/google_transit.zip`.
   - Set `GTFS_RT_VEHICLES_URL` to your exact Vehicle Positions protobuf URL (for example `https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb`).
   - Leave `MAPTILER_KEY` blank to use OpenStreetMap tiles, or supply your MapTiler key if you have one.
   - Leave `POLL_MS=10000` unless you need a different polling interval.
   - Optional: set `BASE_PATH` if the app is hosted from a subdirectory (for example `/transit`).
   - Optional: set `ALLOWED_ORIGINS` (comma separated) to explicitly allow trusted cross-origin clients; otherwise the API is same-origin only.
   - Optional: set `LOG_LEVEL=debug` if you want verbose GTFS-RT logging.

> Tip: If you do not have the realtime URL yet, leave it blank and the app will show routes only.

## 2. Install dependencies
```bash
npm install
```

## 3. Build assets
```bash
npm run build
```
This bundles the frontend into `frontend/dist/` (hashed assets for long-lived caching) and downloads the GTFS ZIP to regenerate cached GeoJSON in `cache/`.

> Tip: Run `npm run build:data -- --force-refresh` if you only need to refresh the GTFS cache. `npm run build:frontend` rebuilds the SPA bundle by itself.

## 4. Start the server
```bash
npm start
```
The Express server serves the frontend and APIs on `http://localhost:3000`.

### Hot reloading during development
Run:
```bash
npm run dev
```
This builds any missing GeoJSON caches, starts the frontend watcher, and launches the Express server with live reload enabled. Changes in `frontend/src/` (JS, CSS, or HTML) automatically rebuild; the injected livereload script refreshes the browser as soon as the new bundle is ready.

## 5. View the map
Open [http://localhost:3000](http://localhost:3000) in a browser (or on the Smart TV). You should see:
- Colored routes immediately after the page loads. Use the legend checkboxes (or the Show All / Hide All buttons) to control which routes are visible.
- Bus markers appear after the first realtime poll (default ~10 seconds) once `GTFS_RT_VEHICLES_URL` is set.
- Highlighted stops display short codes on the map; use the left-side panel to see the full stop names those abbreviations represent.
- When buses stack at the same location (for example the downtown terminal), the icon consolidates into a combined pill that lists every route present, keeping the map readable.
- A banner if the realtime feed is temporarily unavailable (existing markers remain in place).

## Service notice TV display

Open [http://localhost:3000/notices](http://localhost:3000/notices) locally or `/notices` on the production site.

- The display checks MyRide every 2 hours and cycles through every page of each active PDF notice.
- The right-side playlist groups pages under Detours, Stop Closures, Shuttles, and Holiday Service when applicable, and marks the page that is showing, up next, or already shown in the current cycle.
- Stop-closure pages remain visible for 10 seconds; detour and other service-change pages remain visible for 30 seconds. A live countdown appears beside the current page. Use the left/right remote or keyboard buttons to move manually, Space to pause, and Enter/OK to request browser full screen.
- PDF pages are converted to lightweight JPEGs on the server so older Smart TV browsers do not need PDF support.
- If MyRide is temporarily unavailable, the last successful playlist continues and an update warning appears after 30 minutes.
- Notices without PDFs are intentionally excluded. When no PDF notices are active, the display shows a holding screen and continues checking.

For the terminal TV, disable its sleep/screensaver setting and bookmark the production `/notices` address. Some built-in TV browsers cannot reopen a page automatically or permanently hide their toolbar; use a kiosk-capable external player if the on-device test shows either limitation.

## Useful scripts
- `npm run build` - bundle the frontend and rebuild GeoJSON caches.
- `npm run build:data` - regenerate the cached GeoJSON from the latest GTFS ZIP.
- `npm run build:frontend` - produce hashed frontend assets in `frontend/dist/`.
- `npm run watch:frontend` - development watcher that rebuilds the frontend bundle on changes.
- `npm start` - run the Express server.
- `npm run dev` - launch the frontend watcher and Express server with live reload for local development.
- `npm test` - run smoke tests for the GTFS build pipeline and API endpoints (Vitest + Supertest).

## Project layout
```
barrie-bus/
  frontend/
    src/             # Entry point (main.js) plus modularized map/data/ui helpers
    dist/            # Built assets (hashed JS/CSS) generated by build:frontend
    data/            # Static supporting GeoJSON (major roads)
  scripts/
    build-frontend.js # Bundles the SPA and fingerprints static assets
    build-geojson.js  # Downloads GTFS static feed and writes GeoJSON caches
  server/
    server.js        # Express server, REST endpoints, static hosting
    vehicles.js      # Optional GTFS-Realtime fetch/convert helper
  cache/             # Generated GeoJSON (routes/stops) after build:data
  .env               # Local configuration (ignored by Git)
  .env.example       # Template for the environment variables
  package.json       # npm scripts and dependencies
  tests/             # Vitest smoke tests (GTFS build + API)
  .github/workflows/ci.yml # GitHub Actions workflow running build/test
```

## Realtime feed notes
- If the realtime feed is slow or offline, the map keeps the last known vehicle markers and shows a banner.
- Buses that do not update for 60 seconds are removed automatically.
- Adjust `POLL_MS` in `.env` if you need faster or slower updates (default is 10 seconds).

## Deployment notes
- Set `BASE_PATH` to match the subdirectory where the app is hosted so all frontend fetches resolve correctly (for example `/apps/bus-map`).
- Populate `ALLOWED_ORIGINS` with the canonical production origins (e.g. `https://kiosk.example.com`) when exposing the API publicly; requests from other origins will be rejected with HTTP 403.
- Use `npm run build` during CI/CD to generate both the frontend bundle and GeoJSON caches before deploying static artifacts.
- The Express API honours `CACHE_DIR` (advanced) allowing alternate cache storage paths in containerized or test environments.
- The bus monitor's scheduled production runner is Railway Cron (`railway.json`), which runs at `3,13,23,33,43,53 * * * *` UTC. The Railway service must use a persistent volume mounted at `/app/monitor/cache` so missing-bus state survives between runs.
- `.github/workflows/bus-monitor.yml` is now a manual backup only. Do not re-enable its schedule unless Railway is disabled first, otherwise duplicate notification emails can be sent.
- Railway variables required for the monitor service: `GTFS_STATIC_URL`, `GTFS_RT_VEHICLES_URL`, `GTFS_RT_TRIP_UPDATES_URL`, `ALERT_RECIPIENT`, either SMTP settings or Resend settings, and ideally `HEARTBEAT_URL`.
- The monitor sends a dedicated `NO_RECENT_VEHICLE_GPS` alert when buses are expected but no buses have recent GPS updates. It exits quietly when the schedule says no buses are expected, including configured no-service holidays.
- The monitor now ships with a local holiday/service override calendar in `monitor/service-overrides.json` for the current operating year. Update that file annually or whenever special service changes are approved.
- The scheduled monitor job now refreshes GTFS static more aggressively (`GTFS_CACHE_MAX_AGE_HOURS=6`) to reduce stale service-calendar risk.
- A separate GitHub Actions workflow, **Bus Monitor Daily Check-In**, sends one daily health email with the subject `Barrie Transit Monitor Daily Check-In | ...`. It checks whether the GitHub manual backup workflow is active, reports live feed health, and helps catch obvious backup-workflow problems. Railway run health should be watched with `HEARTBEAT_URL`.

## Bus monitor holiday calendar maintenance
- Update `monitor/service-overrides.json` when holiday service is approved for a new year or when Council/operations changes a special-service day.
- Supported simple modes today are:
  - `no_service`
  - `sunday`
- After updating the file, run `npm test` to confirm the holiday calendar and fallback logic still pass.
- Keep the example file (`monitor/service-overrides.example.json`) in sync with the real file so the expected format stays obvious.
# Bus-Tracker-Map
