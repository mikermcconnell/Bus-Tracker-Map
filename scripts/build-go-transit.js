#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { bboxClip } = require('@turf/turf');
require('dotenv').config();

const DEFAULT_STATIC_URL =
  'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip';
const ALLANDALE_STOP_IDS = new Set(['08049', 'AD']);

function readCsv(zip, name) {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} missing in GO Transit GTFS zip`);
  return parse(zip.readAsText(entry), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
}

function normalizeHexColor(value, fallback) {
  const cleaned = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(cleaned)
    ? `#${cleaned.toUpperCase()}`
    : fallback;
}

function getFeatureCollectionBounds(featureCollection) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  function visit(coordinates) {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      Number.isFinite(Number(coordinates[0])) &&
      Number.isFinite(Number(coordinates[1]))
    ) {
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    coordinates.forEach(visit);
  }

  (featureCollection && featureCollection.features || []).forEach((feature) => {
    if (feature && feature.geometry) visit(feature.geometry.coordinates);
  });

  return [minLon, minLat, maxLon, maxLat].every(Number.isFinite)
    ? [minLon, minLat, maxLon, maxLat]
    : [-79.78, 44.30, -79.60, 44.47];
}

function mapRouteForType(routeType) {
  return String(routeType) === '2'
    ? { id: 'GO-TRAIN', label: 'GO TRAIN', mode: 'train' }
    : { id: 'GO-BUS', label: 'GO BUS', mode: 'bus' };
}

function buildArtifactsFromZip(zipBuffer, barrieRoutesGeojson) {
  const zip = new AdmZip(zipBuffer);
  const agencies = readCsv(zip, 'agency.txt');
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const shapes = readCsv(zip, 'shapes.txt');

  const allandaleStops = stops.filter((stop) => {
    return ALLANDALE_STOP_IDS.has(String(stop.stop_id)) &&
      /Allandale Waterfront GO/i.test(String(stop.stop_name || ''));
  });
  if (allandaleStops.length !== ALLANDALE_STOP_IDS.size) {
    throw new Error('GO Transit GTFS does not contain both Allandale stop records 08049 and AD');
  }

  const allandaleStopIds = new Set(allandaleStops.map((stop) => String(stop.stop_id)));
  const allandaleTripIds = new Set(
    stopTimes
      .filter((stopTime) => allandaleStopIds.has(String(stopTime.stop_id)))
      .map((stopTime) => String(stopTime.trip_id))
  );
  const allandaleTrips = trips.filter((trip) => allandaleTripIds.has(String(trip.trip_id)));
  const allandaleRouteIds = new Set(allandaleTrips.map((trip) => String(trip.route_id)));
  const allandaleShapeIds = new Set(
    allandaleTrips.map((trip) => String(trip.shape_id || '')).filter(Boolean)
  );
  const routeById = Object.fromEntries(routes.map((route) => [String(route.route_id), route]));

  const primaryAgency = agencies.find((agency) => String(agency.agency_id) === 'GO') || agencies[0] || {};
  const agency = {
    id: 'go-transit',
    source_id: primaryAgency.agency_id || 'GO',
    name: primaryAgency.agency_name || 'GO Transit',
    url: primaryAgency.agency_url || 'https://www.gotransit.com',
  };

  const routeMetadata = {};
  routes
    .filter((route) => allandaleRouteIds.has(String(route.route_id)))
    .forEach((route) => {
      const routeId = String(route.route_id);
      const mapRoute = mapRouteForType(route.route_type);
      routeMetadata[routeId] = {
        id: routeId,
        short_name: route.route_short_name || null,
        long_name: route.route_long_name || null,
        route_type: String(route.route_type || ''),
        mode: mapRoute.mode,
        map_route_id: mapRoute.id,
        map_label: mapRoute.label,
        color: normalizeHexColor(route.route_color, '#003767'),
        text_color: normalizeHexColor(route.route_text_color, '#FFFFFF'),
      };
    });

  const tripMetadata = {};
  allandaleTrips.forEach((trip) => {
    tripMetadata[String(trip.trip_id)] = {
      route_id: String(trip.route_id),
      headsign: trip.trip_headsign || null,
      shape_id: trip.shape_id || null,
    };
  });

  const pointsByShape = {};
  shapes.forEach((point) => {
    const shapeId = String(point.shape_id || '');
    if (!shapeId || !allandaleShapeIds.has(shapeId)) return;
    if (!pointsByShape[shapeId]) pointsByShape[shapeId] = [];
    pointsByShape[shapeId].push({
      sequence: Number(point.shape_pt_sequence || 0),
      lat: Number(point.shape_pt_lat),
      lon: Number(point.shape_pt_lon),
    });
  });

  const clipBounds = getFeatureCollectionBounds(barrieRoutesGeojson);
  const clippedFeatures = [];
  Object.entries(pointsByShape).forEach(([shapeId, points]) => {
    const coordinates = points
      .sort((a, b) => a.sequence - b.sequence)
      .map((point) => [point.lon, point.lat])
      .filter((point) => point.every(Number.isFinite));
    if (coordinates.length < 2) return;

    let clipped;
    try {
      clipped = bboxClip({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      }, clipBounds);
    } catch (err) {
      return;
    }
    if (!clipped || !clipped.geometry || !clipped.geometry.coordinates.length) return;

    const trip = allandaleTrips.find((entry) => String(entry.shape_id) === shapeId);
    const sourceRouteId = trip ? String(trip.route_id) : '';
    const route = routeMetadata[sourceRouteId] || {};
    clipped.properties = {
      shape_id: `GO:${shapeId}`,
      route_id: route.map_route_id || 'GO-BUS',
      route_short_name: route.map_label || 'GO BUS',
      route_long_name: route.long_name || 'GO Transit to Allandale',
      route_color: route.color || '#003767',
      route_text_color: route.text_color || '#FFFFFF',
      route_mode: route.mode || 'bus',
      agency_id: agency.id,
      agency_name: agency.name,
      source_route_id: sourceRouteId || null,
    };
    clippedFeatures.push(clipped);
  });

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source_url: process.env.GO_TRANSIT_GTFS_STATIC_URL || DEFAULT_STATIC_URL,
      agency,
      allandale_stop_ids: Array.from(allandaleStopIds).sort(),
      allandale_stops: allandaleStops.map((stop) => ({
        id: String(stop.stop_id),
        name: stop.stop_name,
        lat: Number(stop.stop_lat),
        lon: Number(stop.stop_lon),
      })),
      allandale_route_ids: Array.from(allandaleRouteIds).sort(),
      map_bounds: clipBounds,
      routes: routeMetadata,
      trips: tripMetadata,
    },
    routes: {
      type: 'FeatureCollection',
      features: clippedFeatures,
    },
  };
}

async function buildGoTransitArtifacts(options = {}) {
  const outDir = path.resolve(options.cacheDir || process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
  const staticUrl = options.staticUrl || process.env.GO_TRANSIT_GTFS_STATIC_URL || DEFAULT_STATIC_URL;
  const barrieRoutesPath = path.join(outDir, 'routes.geojson');
  const metadataPath = path.join(outDir, 'go-transit.json');
  const routesPath = path.join(outDir, 'go-transit-routes.geojson');

  if (!fs.existsSync(barrieRoutesPath)) {
    throw new Error('cache/routes.geojson must exist before building GO Transit map data');
  }

  console.log('Downloading GO Transit GTFS zip:', staticUrl);
  const response = await fetch(staticUrl, { timeout: 120_000 });
  if (!response.ok) throw new Error(`GO Transit GTFS download failed: ${response.status}`);
  const zipBuffer = await response.buffer();
  const barrieRoutes = JSON.parse(fs.readFileSync(barrieRoutesPath, 'utf8'));
  const artifacts = buildArtifactsFromZip(zipBuffer, barrieRoutes);

  fs.writeFileSync(metadataPath, JSON.stringify(artifacts.metadata));
  fs.writeFileSync(routesPath, JSON.stringify(artifacts.routes));
  console.log(
    'Wrote GO Transit Allandale data with',
    artifacts.metadata.allandale_route_ids.length,
    'routes and',
    artifacts.routes.features.length,
    'clipped shapes'
  );
  return artifacts;
}

if (require.main === module) {
  buildGoTransitArtifacts().catch((err) => {
    console.error('GO Transit build failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_STATIC_URL,
  ALLANDALE_STOP_IDS,
  mapRouteForType,
  buildArtifactsFromZip,
  buildGoTransitArtifacts,
};
