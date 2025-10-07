# Agent Brief

## Context
This repository is for a single-page web app that renders Barrie Transit bus routes, stops, and live vehicle locations on a constrained Smart TV browser. The TV struggles with the existing TripSpark site, so this project focuses on a lightweight, resilient experience tuned for that environment.

## Stakeholders & Skill Level
- Project owner is brand new to coding (computer engineering skill level = 0). Use clear, plain language explanations and avoid unnecessary jargon in all guidance.

## Scope (v1)
- Render all Barrie bus routes and stops using prebuilt GeoJSON derived from GTFS static data.
- Show moving buses with smooth position transitions by polling GTFS-Realtime vehicle feeds every 5-15 seconds (target 10 seconds).
- Deliver a minimal Leaflet-based UI that loads on the Smart TV within 5 seconds over home Wi-Fi.
- Handle realtime feed outages gracefully with a banner and retry logic while keeping the static map visible.

## Out of Scope (v1)
- User accounts, authentication, or personalization features.
- Advanced search, complex filtering, or trip planning workflows.
- Service alerts, push notifications, or messaging features.

## Success Criteria (Acceptance Tests)
- The Smart TV loads the app, renders the base map, and displays routes and stops in <= 5 seconds on home Wi-Fi.
- Vehicle icons appear and update automatically at the chosen interval with smooth transitions between updates.
- The app runs without prompting for extra permissions and succeeds without WebGL (Leaflet canvas/SVG fallback).
- Temporary data outages surface a visible banner and retries without clearing the existing map data.

## High-Level Approach
- Convert GTFS static data into cached GeoJSON (routes.geojson, stops.geojson) so the TV avoids ZIP or CSV parsing.
- Poll the GTFS-Realtime feed, translate protobuf payloads into compact JSON ({ id, route_id, lat, lon, bearing, speed, timestamp }).
- Build the front end with vanilla JS and Leaflet, fetching preprocessed assets and polling the vehicles endpoint.
- Provide a small backend (Node/Express or serverless) that caches static data, proxies GTFS-Realtime, adds CORS headers, and emits JSON endpoints.
- Deploy the SPA and backend as static hosting plus a lightweight API (serverless preferred) with CDN caching where helpful.

## Data Sources
- GTFS static (routes, stops, shapes): https://www.myridebarrie.ca/gtfs/google_transit.zip
- GTFS-Realtime vehicle positions: https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb

## Chosen Stack
- **Frontend**: Vanilla JS + Leaflet with a Vite build targeting ES5, plain CSS tuned for TV readability.
- **Backend**: Node.js 20 + Express, using `node-fetch@2` for HTTP access and `gtfs-realtime-bindings` for protobuf decoding.
- **Scripts**: Node CLI tools with `csv-parse` and `@turf/turf` to precompute GeoJSON artifacts shared by the API.
- **Hosting**: Static frontend on Vercel/Netlify; backend on Cloudflare Workers (primary target) or a lightweight Node host when Workers is unsuitable.
- **Storage/cache**: Local filesystem in dev; object storage or KV (Cloudflare KV/S3) in prod for prebuilt GeoJSON and the latest vehicle snapshot.

## System Architecture
```
[Smart TV Browser]
     |
     |  HTTPS (GET /routes.geojson, /stops.geojson, /vehicles.json)
     v
[Frontend SPA (Leaflet, vanilla JS)]
     |
     |  fetch every 10 s
     v
[Backend API (Express or Worker)]
  - /api/routes.geojson (cached static)
  - /api/stops.geojson  (cached static)
  - /api/vehicles.json  (fresh GTFS-RT)
     |
     |  scheduled refresh / on-demand proxy
     v
[Data sources]
  - GTFS static (ZIP)
  - GTFS-RT vehicle positions (protobuf)
  - Tile server (OSM/MapTiler)
```

## Detailed Requirements
- **R1. Route lines**: Convert shapes.txt into routes.geojson server-side; render via L.geoJSON with thin polylines and low opacity.
- **R2. Stops**: Convert stops.txt into stops.geojson including stop_code and stop_name; draw Leaflet circle markers with simple popups.
- **R3. Live vehicles**: Poll GTFS-Realtime every 5-15 seconds; expose { id, route_id, lat, lon, bearing, speed, last_reported }; animate markers client-side, and render the vehicle badge with the route short name (e.g., 2A, 2B, 7A, 7B, 8A, 8B, 10, 100, 101, 400).
- **R4. Route snapping (optional v1.1)**: Optionally snap vehicles to the nearest route polyline using turf.js or backend spatial indexing.
- **R5. Failure handling**: Show "Live data unavailable" banner on fetch errors; implement exponential backoff while retaining last known data.
- **R6. TV-friendly UI**: Provide large tap targets, minimal controls (zoom, layer toggles), and auto-fit to Barrie bounds on load.

## Non-Functional Requirements
- Performance: Initial payload <= 2 MB; realtime payload roughly 50 KB per poll.
- Compatibility: Works without WebGL and avoids bleeding-edge JS features (transpile to ES5 if needed).
- Availability: Serve static assets from CDN edge; tolerate data outages by reusing cached data.
- Security: Keep secrets server-side, enforce CORS on backend, and rate-limit GTFS proxy endpoints.

## Tech Stack Notes
- Keep the entire repo as a single npm workspace to simplify scripts and dependency sharing.
- Prefer TypeScript only if DX issues arise; baseline remains JavaScript to reduce transpile overhead.
- Use Vitest for backend/script unit tests and defer Playwright/device testing until after core flows exist.

## Deliverables (Repository Structure)
- frontend/: index.html, app.js, styles.css.
- server/: server.js, routes/gtfs.js, rt/vehicles.js.
- cache/: routes.geojson, stops.geojson, vehicles.json (generated artifacts).
- scripts/: build-geojson.js for static feed conversion.
- README.md: quick start, run, and deploy instructions.

## Project Plan and Timeline (Solo Developer)
- Phase 0 - Setup (0.5 day): Initialize repo, configure Vite + Leaflet skeleton, set up deployment targets.
- Phase 1 - Static data (1-1.5 days): Download GTFS ZIP, convert to GeoJSON, expose /api/routes.geojson and /api/stops.geojson, render static map on TV.
- Phase 2 - Live data (1-2 days): Implement GTFS-Realtime polling, expose /api/vehicles.json, animate vehicles in the frontend.
- Phase 3 - TV hardening (0.5-1 day): Transpile/polyfill as needed, trim bundle size, configure tile keys, add outage banner and minimal controls.
- Phase 4 - Polish and deploy (0.5 day): Final README, environment setup, CI, deploy, and on-device verification.

## Risks and Mitigations
- Missing or restricted GTFS-Realtime feed: Confirm access early; negotiate keys or fall back to near-real snapshots if needed.
- CORS or rate limiting from data sources: Proxy through backend with appropriate headers and caching.
- Smart TV browser limitations: Stay with Leaflet, limit heavy libraries, pre-convert data, and throttle marker counts.
- Tile provider limits: Use a MapTiler key or self-host tiles; enable caching and attributions.
- Data timestamp drift: Expose last_reported values so users can gauge freshness.

## Local Development Commands
```
# create project
mkdir barrie-bus && cd barrie-bus
npm init -y

# install dependencies
npm install express node-fetch@2 gtfs-realtime-bindings csv-parse @turf/turf
npm install --save-dev vite esbuild

# scaffold baseline structure
mkdir -p frontend server scripts cache

# run preprocessing and server
node scripts/build-geojson.js
node server/server.js
```

## Open Questions
- Does the Smart TV browser support Service Workers or IndexedDB for caching static GeoJSON locally?
- What tile provider and key or licensing constraints will apply in production?
- What polling interval is acceptable to the data provider and operations team to avoid rate limiting?


## Maintenance Notes
- 2025-10-06: Barrie GTFS static feed rotated route_id GUIDs. When the cache/routes.geojson file was built before the rotation, local dev showed UUIDs on vehicle badges. Fix by rerunning ``node scripts/build-geojson.js --force-refresh`` (or ``npm run build:data -- --force-refresh``) so the route lookup table refreshes.
