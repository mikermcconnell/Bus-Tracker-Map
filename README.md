# Barrie Transit Lightweight Live Map

A single-page Leaflet app that shows Barrie Transit routes, stops, and live vehicle positions. It is tuned for a limited Smart TV browser, so everything stays lightweight and simple.

## Requirements
- Node.js 18 or newer
- Internet access (needed to download GTFS data and map tiles)

## 1. Configure environment variables
1. Copy `.env.example` to `.env`.
2. Edit `.env` and update the values:
   - Keep `GTFS_STATIC_URL=https://www.myridebarrie.ca/gtfs/google_transit.zip`.
   - Set `GTFS_RT_VEHICLES_URL` to your exact Vehicle Positions protobuf URL (for example `https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb`).
   - Leave `MAPTILER_KEY` blank to use OpenStreetMap tiles, or supply your MapTiler key if you have one.
   - Leave `POLL_MS=10000` unless you need a different polling interval.

> Tip: If you do not have the realtime URL yet, leave it blank and the app will show routes only.

## 2. Install dependencies
```bash
npm install
```

## 3. Build static GeoJSON (first run or when GTFS static data changes)
```bash
npm run build:data
```
This downloads the GTFS ZIP, converts `shapes.txt` and `stops.txt` into GeoJSON, and writes them to `cache/`.
> Tip: `npm run dev` now reuses any cached GeoJSON. Run `npm run build:data -- --force-refresh` if you want to force a fresh download.

## 4. Start the server
```bash
npm start
```
The Express server serves the frontend and APIs on `http://localhost:3000`.

## 5. View the map
Open [http://localhost:3000](http://localhost:3000) in a browser (or on the Smart TV). You should see:
- Colored routes immediately after the page loads. Use the legend checkboxes (or the Show All / Hide All buttons) to control which routes are visible.
- Bus markers appear after the first realtime poll (default ~10 seconds) once `GTFS_RT_VEHICLES_URL` is set.
- A banner if the realtime feed is temporarily unavailable (existing markers remain in place).

## Useful scripts
- `npm run build:data` - regenerate the cached GeoJSON from the latest GTFS ZIP.
- `npm start` - run the Express server.
- `npm run dev` - reuse cached GeoJSON when available, otherwise download and build, then start the server.

## Project layout
```
barrie-bus/
  frontend/
    index.html       # Leaflet page shell and legend container
    app.js           # Map bootstrapping, polling logic, marker animation
    styles.css       # TV-friendly layout and legend styling
  scripts/
    build-geojson.js # Downloads GTFS static feed and writes GeoJSON caches
  server/
    server.js        # Express server, REST endpoints, static hosting
    vehicles.js      # Optional GTFS-Realtime fetch/convert helper
  cache/             # Generated GeoJSON (routes/stops) after build:data
  .env               # Local configuration (ignored by Git)
  .env.example       # Template for the environment variables
  package.json       # npm scripts and dependencies
```

## Realtime feed notes
- If the realtime feed is slow or offline, the map keeps the last known vehicle markers and shows a banner.
- Buses that do not update for 60 seconds are removed automatically.
- Adjust `POLL_MS` in `.env` if you need faster or slower updates (default is 10 seconds).
# Bus-Tracker-Map
