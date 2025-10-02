# Architecture Overview

## System Context
```
[Smart TV Browser]
     |
     |  HTTPS (GET /routes.geojson, /stops.geojson, /vehicles.json)
     v
[Frontend SPA (Leaflet, vanilla JS)]
     |
     |  fetch every 10 s
     v
[Backend API (Express/Worker)]
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

## Component Summary
- **Frontend SPA**: Vanilla JS + Leaflet bundled with Vite (ES5 target) for a minimal footprint compatible with the Smart TV browser.
- **Backend service**: Node.js 20 + Express (deployable as a traditional Node app) with an equivalent Cloudflare Worker implementation planned for production deployment.
- **Data caches**: Local filesystem in development, Cloudflare KV or S3-compatible storage in production for precomputed GeoJSON and the most recent vehicles snapshot.

## Data Sources
- **GTFS static**: https://www.myridebarrie.ca/gtfs/google_transit.zip (routes, shapes, stops). A scheduled script downloads the ZIP, converts it to GeoJSON (routes.geojson, stops.geojson), and stores the output.
- **GTFS-Realtime vehicle positions**: https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb polled every 5-15 seconds (target 10 seconds); transformed into `{ id, route_id, lat, lon, bearing, speed, last_reported }` JSON.
- **Tile server**: MapTiler or OSM tiles selected to work without WebGL and respect provider rate limits.

## Data Flow
1. A recurring backend job downloads the latest GTFS static ZIP, normalizes it into GeoJSON collections, and stores the artifacts for long-term reuse.
2. A realtime poll fetches GTFS-Realtime vehicle positions, translates protobuf into JSON, and caches the result with a short TTL.
3. The frontend fetches routes and stops GeoJSON on load, rendering them with Leaflet layers and fitting the map to Barrie bounds.
4. The frontend polls the vehicles endpoint on an interval (default 10 seconds), animates markers between updates, and removes stale vehicles beyond 60 seconds.

## Backend Responsibilities
- Expose read-only endpoints with CORS headers:
  - `/api/routes.geojson` and `/api/stops.geojson` (cached for ~7 days, ETag enabled).
  - `/api/vehicles.json` (cached for 5-10 seconds, always includes generated_at timestamp).
  - `/health` for uptime checks.
- Provide a GTFS static conversion script (`scripts/build-geojson.js`) that runs on deploy or cron to refresh cache artifacts.
- Handle GTFS download or polling failures by serving last-known-good data while flagging degraded status in responses.
- Enforce rate limiting and guardrails (timeouts, retries, jitter) when communicating with upstream feeds.
- Keep the runtime portable so the same logic can run within Express (local dev) and Cloudflare Workers (prod) with minimal divergence.

## API Design (Backend)
- **GET /api/routes.geojson**: Returns precomputed route polylines; cached aggressively with ETag/Last-Modified.
- **GET /api/stops.geojson**: Returns stop markers with stop_code and stop_name; cached similar to routes.
- **GET /api/vehicles.json**: Returns `{ generated_at, vehicles: [...] }` where each vehicle includes id, route_id, lat, lon, bearing, speed, last_reported; kept fresh via short cache TTL or forced refresh.
- **Error handling**: Responses include HTTP 503 or 200 with `status: degraded` when upstream outages occur; clients show banners but retain existing map layers.

## Frontend Behavior
- Leaflet renders base layers using non-WebGL renderers (canvas/SVG) with simplified styling for TV readability.
- On load: fetch static GeoJSON, add route and stop layers, and call `map.fitBounds` to Barrie coverage.
- Start an interval timer (~10 seconds) to fetch `/api/vehicles.json`; animate marker positions using linear interpolation over the polling interval.
- Fade or remove markers when no update has arrived for 60 seconds; color-code by route where practical.
- Display a banner when realtime fetches fail; keep static map content untouched and retry with exponential backoff.

## Performance and Resilience
- Precompute and minify GeoJSON to keep initial payload <= 2 MB; optionally split by route for finer caching.
- Use HTTP caching (ETag/If-None-Match) and CDN distribution for static assets.
- Introduce jitter to polling schedules to avoid thundering herd effects on the GTFS-Realtime endpoint.
- Implement retries with exponential backoff and last-known-good fallback data to survive upstream hiccups.
- Keep the JavaScript bundle small (ES5-compatible build) to respect Smart TV CPU and memory limits.

## Deployment Considerations
- Host the frontend on static hosting (Netlify, Vercel, CloudFront) with gzip/brotli compression and cache headers tuned for TVs.
- Deploy the backend as Cloudflare Workers backed by KV storage; maintain an Express deployment path (Fly.io/Railway) for debugging or fallback.
- Schedule the GTFS static refresh via serverless cron or a managed task; persist GeoJSON artifacts in object storage (S3, KV store).
- Configure environment variables for feed URLs, polling intervals, tile API keys, and logging destinations.

## Testing Strategy
- Unit tests for GTFS parsing, transformation accuracy, and protobuf decoding edge cases using Vitest.
- Integration tests that stub upstream feeds to verify frontend rendering, outage messaging, and smoothing behavior.
- On-device testing on the target Smart TV to validate load-time performance and UI legibility.
- Optional visual regression snapshots to safeguard map styling across updates.

## Security and Privacy
- Serve only public transit data; do not collect or process user PII.
- Rate-limit backend endpoints and monitor for abuse if exposed publicly.
- Track upstream schema changes (GTFS static or realtime) to catch breaking changes before deployment.
