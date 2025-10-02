/* scripts/build-geojson.js */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
require('dotenv').config();

const args = process.argv.slice(2);
const skipIfCache = args.includes('--skip-if-cache');
const forceRefresh = args.includes('--force-refresh');

const OUT_DIR = path.join(__dirname, '..', 'cache');
const ROUTES_PATH = path.join(OUT_DIR, 'routes.geojson');
const STOPS_PATH = path.join(OUT_DIR, 'stops.geojson');
const hasCache = fs.existsSync(ROUTES_PATH) && fs.existsSync(STOPS_PATH);
const GTFS_URL = process.env.GTFS_STATIC_URL;

if (!GTFS_URL) {
  if (skipIfCache && hasCache && !forceRefresh) {
    console.warn('GTFS_STATIC_URL missing but existing cache found; skipping rebuild.');
    process.exit(0);
  }
  console.error('GTFS_STATIC_URL missing in .env');
  process.exit(1);
}

if (skipIfCache && hasCache && !forceRefresh) {
  console.log('GTFS cache already present, skipping download. Use --force-refresh to rebuild.');
  process.exit(0);
}

function normalizeHexColor(color) {
  if (!color) return null;
  const cleaned = String(color).trim().replace(/^#/, '');
  if (!cleaned) return null;
  if (!/^[0-9a-fA-F]{3,6}$/.test(cleaned)) return null;
  const hex = cleaned.length === 3
    ? cleaned.split('').map((ch) => ch + ch).join('')
    : cleaned.padStart(6, '0').slice(-6);
  return `#${hex.toUpperCase()}`;
}

(async function main() {
  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    console.log('Downloading GTFS zip:', GTFS_URL);
    const res = await fetch(GTFS_URL, { timeout: 30_000 });
    if (!res.ok) throw new Error(`GTFS download failed: ${res.status}`);
    const buffer = await res.buffer();

    const zip = new AdmZip(buffer);
    const getText = (name) => {
      const entry = zip.getEntry(name);
      if (!entry) return null;
      return zip.readAsText(entry);
    };

    const tripsTxt = getText('trips.txt');
    const routesTxt = getText('routes.txt');

    const shapeToRouteCounts = new Map();
    if (tripsTxt) {
      const tripsRows = parse(tripsTxt, { columns: true, skip_empty_lines: true });
      tripsRows.forEach((trip) => {
        const shapeId = trip.shape_id;
        const routeId = trip.route_id;
        if (!shapeId || !routeId) return;
        if (!shapeToRouteCounts.has(shapeId)) shapeToRouteCounts.set(shapeId, {});
        const counts = shapeToRouteCounts.get(shapeId);
        counts[routeId] = (counts[routeId] || 0) + 1;
      });
    }

    const routeInfoById = new Map();
    if (routesTxt) {
      const routesRows = parse(routesTxt, { columns: true, skip_empty_lines: true });
      routesRows.forEach((route) => {
        const id = route.route_id;
        if (!id) return;
        routeInfoById.set(id, {
          id,
          shortName: route.route_short_name || null,
          longName: route.route_long_name || null,
          color: normalizeHexColor(route.route_color),
          textColor: normalizeHexColor(route.route_text_color),
        });
      });
    }

    const resolveRouteMeta = (shapeId) => {
      const counts = shapeToRouteCounts.get(shapeId);
      if (!counts) return null;
      const routeId = Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a])[0];
      if (!routeId) return null;
      const info = routeInfoById.get(routeId) || {};
      return {
        route_id: routeId,
        route_short_name: info.shortName,
        route_long_name: info.longName,
        route_color: info.color,
        route_text_color: info.textColor,
      };
    };

    // --- Parse shapes.txt
    const shapesTxt = getText('shapes.txt');
    if (!shapesTxt) throw new Error('shapes.txt missing in GTFS zip');

    const shapesRows = parse(shapesTxt, { columns: true, skip_empty_lines: true });
    const byId = {};
    for (const r of shapesRows) {
      const id = r.shape_id;
      if (!id) continue;
      if (!byId[id]) byId[id] = [];
      byId[id].push({
        seq: Number(r.shape_pt_sequence || 0),
        lat: Number(r.shape_pt_lat),
        lon: Number(r.shape_pt_lon),
      });
    }
    const shapeFeatures = [];
    Object.keys(byId).forEach((id) => {
      const pts = byId[id]
        .sort((a, b) => a.seq - b.seq)
        .map((p) => [p.lon, p.lat])
        .filter((coords) => Number.isFinite(coords[0]) && Number.isFinite(coords[1]));
      if (pts.length > 1) {
        const meta = resolveRouteMeta(id) || {};
        const properties = {
          shape_id: id,
          route_id: meta.route_id || id,
          route_short_name: meta.route_short_name || null,
          route_long_name: meta.route_long_name || null,
          route_color: meta.route_color || null,
          route_text_color: meta.route_text_color || null,
        };
        shapeFeatures.push({
          type: 'Feature',
          properties,
          geometry: { type: 'LineString', coordinates: pts },
        });
      }
    });
    const routesGeoJSON = { type: 'FeatureCollection', features: shapeFeatures };
    fs.writeFileSync(ROUTES_PATH, JSON.stringify(routesGeoJSON));
    console.log('Wrote cache/routes.geojson with', shapeFeatures.length, 'shapes');

    // --- Parse stops.txt (still generated for optional use)
    const stopsTxt = getText('stops.txt');
    if (!stopsTxt) throw new Error('stops.txt missing in GTFS zip');

    const stopsRows = parse(stopsTxt, { columns: true, skip_empty_lines: true });
    const stopFeatures = stopsRows
      .map((s) => ({
        type: 'Feature',
        properties: {
          stop_id: s.stop_id,
          stop_code: s.stop_code || null,
          stop_name: s.stop_name || null,
        },
        geometry: {
          type: 'Point',
          coordinates: [Number(s.stop_lon), Number(s.stop_lat)],
        },
      }))
      .filter((f) => f.geometry.coordinates.every(Number.isFinite));

    const stopsGeoJSON = { type: 'FeatureCollection', features: stopFeatures };
    fs.writeFileSync(STOPS_PATH, JSON.stringify(stopsGeoJSON));
    console.log('Wrote cache/stops.geojson with', stopFeatures.length, 'stops');

    console.log('GTFS -> GeoJSON complete');
  } catch (e) {
    console.error('Build failed:', e.message);
    process.exit(1);
  }
})();
