# Allandale Lightweight Live Transit Map

A single-page Leaflet app that shows Barrie Transit routes and live vehicle positions, Ontario Northland buses serving Barrie Allandale Terminal, and GO Transit route 68 buses and Barrie line trains while they are in the Barrie map area. It is tuned for a limited Smart TV browser, so everything stays lightweight and simple.

## Requirements
- Node.js 22
- Internet access (needed to download GTFS data and map tiles)

## 1. Configure environment variables
1. Copy `.env.example` to `.env`.
2. Edit `.env` and update the values:
   - Keep `GTFS_STATIC_URL=https://www.myridebarrie.ca/gtfs/google_transit.zip`.
   - Set `GTFS_RT_VEHICLES_URL` to your exact Vehicle Positions protobuf URL (for example `https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb`).
   - Keep the four `ONTARIO_NORTHLAND_*` feed URLs from `.env.example`; set `ONTARIO_NORTHLAND_ENABLED=false` only if that source must be disabled.
   - Keep the five `SIMCOE_LINX_*` settings from `.env.example`; LINX live vehicles come from a shared Ontario feed and are accepted only when both trip and route IDs match the Simcoe schedule.
   - Keep the `LINX_*` static and trip-update feed URLs to include route 2 departures from Allandale Platform 2.
   - Set `METROLINX_API_KEY` to the server-side Metrolinx Open Data API key and leave `GO_TRANSIT_ENABLED=true`.
   - Set `MAPBOX_ACCESS_TOKEN`, `MAPBOX_USERNAME`, and `MAPBOX_STYLE_ID` to use the custom TV basemap. When they are omitted or Mapbox tiles fail, the map falls back to OpenStreetMap. See `mapbox/README.md` for style publishing and token restrictions.
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
This bundles the frontend into `frontend/dist/` (hashed assets for long-lived caching), refreshes Barrie GTFS GeoJSON, creates compact Ontario Northland and Simcoe LINX layers containing only routes that serve Barrie, creates GO bus/train layers containing only trips serving Allandale stops `08049` and `AD`, and generates Simcoe LINX route 2 departure metadata.

> Tip: Run `npm run build:northland` to refresh only Ontario Northland data, `npm run build:simcoe` to refresh LINX live-map data, `npm run build:linx` to refresh LINX departure-board data, `npm run build:go` to refresh only GO Allandale data, or `npm run build:frontend` to rebuild the SPA bundle by itself.

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
- Ontario Northland buses on routes 101, 102, 201, and 202 appear with an **ON** badge. Their popup keeps the exact intercity route, destination, and live Allandale arrival when supplied by the trip-update feed.
- GO route 68 buses and Barrie line trains appear only while they are inside the Barrie map bounds. Other GO routes, stops, and vehicles are excluded.
- Highlighted stops display short codes on the map; use the left-side panel to see the full stop names those abbreviations represent.
- When buses stack at the same location (for example the downtown terminal), the icon consolidates into a combined pill that lists every route present, keeping the map readable.
- A banner if the realtime feed is temporarily unavailable (bus icons are hidden while it is offline).
- Ontario Northland service alerts are intentionally neither requested nor published; this map is focused on route and live-vehicle tracking.

The terminal-focused displays are available at `/platform.map` and `/batt.map`. Both consume the same merged, freshness-checked vehicle endpoint and show Ontario Northland and GO vehicles when they enter the calibrated Allandale platform area. The platform display reads `/api/terminal-layout`, overlays current GTFS-derived bay assignments, keeps live markers aligned at 16:9 and 4:3, and marks Platform 14 as having no scheduled service when it is absent from the current Barrie feed.

## Allandale departure board

Open [http://localhost:3000/departures](http://localhost:3000/departures) locally or `/departures` on the production site. The TV-safe board displays the next 10 outbound departures within 24 hours for Barrie Transit, Ontario Northland, GO buses and trains, and Simcoe LINX route 2.

Rows are selected from the next hour of published service and show only the next trip for each agency, route, destination, and platform combination. A **LIVE** badge and live countdown require both a fresh stop prediction and a fresh vehicle position for the exact agency and trip. Every other row is labelled **SCHED** and uses its published scheduled time. The supporting `GET /api/departures?limit=12` endpoint accepts limits from 1 through 30.

### Metrolinx data notice

Data used in this product or service is provided with the permission of Metrolinx. Metrolinx makes no representations or warranties of any kind, express or implied, with respect to the Data and assumes no responsibility for the accuracy or currency of the data used in this product or service.

## Service notice TV display

Open [http://localhost:3000/notices](http://localhost:3000/notices) locally or `/notices` on the production site.

- The display checks MyRide every 2 hours and cycles through every page of each active PDF notice.
- The right-side playlist groups pages under Detours, Stop Closures, Shuttles, and Holiday Service when applicable, and marks the page that is showing, up next, or already shown in the current cycle.
- Stop-closure pages remain visible for 15 seconds; all other notice pages remain visible for 20 seconds. A live countdown appears beside the current page. Use the left/right remote or keyboard buttons to move manually, Space to pause, and Enter/OK to request browser full screen.
- PDF pages are converted to lightweight JPEGs on the server so older Smart TV browsers do not need PDF support.
- If MyRide is temporarily unavailable, the last successful playlist continues and an update warning appears after 30 minutes.
- Notices without PDFs are intentionally excluded. When no PDF notices are active, the display shows a holding screen and continues checking.

For the terminal TV, disable its sleep/screensaver setting and bookmark the production `/notices` address. Some built-in TV browsers cannot reopen a page automatically or permanently hide their toolbar; use a kiosk-capable external player if the on-device test shows either limitation.

## Useful scripts
- `npm run build` - bundle the frontend and rebuild GeoJSON caches.
- `npm run build:data` - regenerate the cached GeoJSON from the latest GTFS ZIP.
- `npm run build:northland` - refresh the Barrie-serving Ontario Northland route and trip metadata.
- `npm run build:simcoe` - refresh Barrie-serving Simcoe LINX routes and live-map trip metadata.
- `npm run build:go` - refresh only GO route 68 and Barrie line data serving Allandale.
- `npm run build:linx` - refresh only Simcoe LINX route 2 metadata at Allandale.
- `npm run build:frontend` - produce hashed frontend assets in `frontend/dist/`.
- `npm run watch:frontend` - development watcher that rebuilds the frontend bundle on changes.
- `npm start` - run the Express server.
- `npm run dev` - launch the frontend watcher and Express server with live reload for local development.
- `npm run lint` - check browser, server, monitor, build, and test JavaScript with ESLint.
- `npm test` - run smoke tests for the GTFS build pipeline and API endpoints (Vitest + Supertest).
- `npm run test:e2e` - build and exercise the map and TV display routes in headless Chromium.

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
    build-ontario-northland.js # Builds the clipped Ontario Northland layer
    build-go-transit.js # Builds GO layers limited to Allandale-serving trips
    build-linx.js # Builds Simcoe LINX route 2 departure metadata
  server/
    server.js        # Express server, REST endpoints, static hosting
    vehicles.js      # Optional GTFS-Realtime fetch/convert helper
    ontario-northland.js # Ontario Northland vehicles, trip updates, and alerts
    go-transit.js  # Metrolinx vehicles filtered to Allandale routes and Barrie bounds
    departures.js # Unified static and realtime departure-board service
  cache/             # Generated GeoJSON (routes/stops) after build:data
  .env               # Local configuration (ignored by Git)
  .env.example       # Template for the environment variables
  package.json       # npm scripts and dependencies
  tests/             # Vitest smoke tests (GTFS build + API)
  .github/workflows/ci.yml # GitHub Actions workflow running build/test
```

## Realtime feed notes
- The map checks the timestamps inside the feed instead of treating every HTTP 200 response as live.
- `/api/vehicles.json` reports per-agency status under `sources.barrie_transit`, `sources.ontario_northland`, and `sources.go_transit`.
- Data older than `FEED_DELAYED_AFTER_MIN` (default 2 minutes) is labelled **DELAYED**. Data older than `FEED_STALE_AFTER_MIN` (default 15 minutes), a failed request, or a missing timestamp is labelled **OFFLINE**.
- If the realtime feed is delayed, the map dims the vehicle markers and shows their actual last-reported time. If the feed is offline, all bus icons are hidden. In both cases the map displays a warning banner and retries automatically.
- Buses that do not update for 60 seconds are removed automatically.
- Adjust `POLL_MS` in `.env` if you need faster or slower updates (default is 10 seconds).

## Deployment notes
- Set `BASE_PATH` to match the subdirectory where the app is hosted so all frontend fetches resolve correctly (for example `/apps/bus-map`).
- Populate `ALLOWED_ORIGINS` with the canonical production origins (e.g. `https://kiosk.example.com`) when exposing the API publicly; requests from other origins will be rejected with HTTP 403.
- Use `npm run build` during CI/CD to generate both the frontend bundle and GeoJSON caches before deploying static artifacts.
- Configure `METROLINX_API_KEY` as a runtime secret. Never place it in `vercel.json` or commit it to the repository.
- The Express API honours `CACHE_DIR` (advanced) allowing alternate cache storage paths in containerized or test environments.
- The bus monitor's scheduled production runner is Railway Cron (`railway.json`), which runs at `3,13,23,33,43,53 * * * *` UTC. The Railway service must use a persistent volume mounted at `/app/monitor/cache` so missing-bus state survives between runs.
- `.github/workflows/bus-monitor.yml` is now a manual backup only. Do not re-enable its schedule unless Railway is disabled first, otherwise duplicate notification emails can be sent.
- Railway variables required for the monitor service: `GTFS_STATIC_URL`, `GTFS_RT_VEHICLES_URL`, `GTFS_RT_TRIP_UPDATES_URL`, `ALERT_RECIPIENT`, either SMTP settings or Resend settings, and ideally `HEARTBEAT_URL`.
- The monitor sends a dedicated `NO_RECENT_VEHICLE_GPS` alert when buses are expected but no buses have recent GPS updates. It exits quietly when the schedule says no buses are expected, including configured no-service holidays.
- The monitor sends `Barrie Transit GTFS Integrity Alert | ...` when required GTFS tables, service dates, Allandale parent/platform/timed-transfer records, or static/realtime trip, route, and stop IDs are inconsistent. Persistent GTFS integrity issues resend no more than once every 12 hours by default (`GTFS_INTEGRITY_RESEND_MIN=720`).
- The monitor sends `Barrie Transit Email Volume Alert | ...` after 4 operational alert emails within a rolling 60-minute window. The warning has a 180-minute cooldown and does not count daily check-ins, test messages, or itself. Configure this with `EMAIL_VOLUME_ALERT_THRESHOLD`, `EMAIL_VOLUME_WINDOW_MIN`, and `EMAIL_VOLUME_ALERT_COOLDOWN_MIN`.
- The monitor now ships with a local holiday/service override calendar in `monitor/service-overrides.json` for the current operating year. Update that file annually or whenever special service changes are approved.
- The scheduled monitor job now refreshes GTFS static more aggressively (`GTFS_CACHE_MAX_AGE_HOURS=6`) to reduce stale service-calendar risk.
- Holiday dates use explicit GTFS `calendar_dates.txt` service when published; the local Sunday schedule is fallback-only and is never combined with a separate GTFS holiday service. Monitor emails name the holiday, selected schedule, source, and feed coverage used for the expected-bus count.
- If the published GTFS feed does not cover the monitored date, expected-bus GPS alerts pause and a `GTFS_SCHEDULE_DATE_NOT_COVERED` email is sent instead of silently treating the day as no service.
- A separate GitHub Actions workflow, **Bus Monitor Daily Check-In**, sends one daily health email with the subject `Barrie Transit Monitor Daily Check-In | ...`. It checks whether the GitHub manual backup workflow is active, reports live feed health, and helps catch obvious backup-workflow problems. Railway run health should be watched with `HEARTBEAT_URL`.

## Bus monitor holiday calendar maintenance
- Update `monitor/service-overrides.json` when holiday service is approved for a new year or when Council/operations changes a special-service day.
- Supported simple modes today are:
  - `no_service`
  - `sunday`
- After updating the file, run `npm test` to confirm the holiday calendar and fallback logic still pass.
- Keep the example file (`monitor/service-overrides.example.json`) in sync with the real file so the expected format stays obvious.
- Keep each `label` human-readable because it appears in daily check-in and GPS alert email subjects and bodies.
# Bus-Tracker-Map
