#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const bboxClip = require('@turf/bbox-clip').default;
const { buildServiceCalendarMetadata } = require('../shared/gtfs-service-calendar');
require('dotenv').config();

const DEFAULT_STATIC_URL = 'https://ontarionorthland.tmix.se/gtfs/gtfs.zip';

function readCsv(zip, name, options = {}) {
  const entry = zip.getEntry(name);
  if (!entry) {
    if (options.optional) return [];
    throw new Error(`${name} missing in Ontario Northland GTFS zip`);
  }
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

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return [-79.78, 44.30, -79.60, 44.47];
  }
  return [minLon, minLat, maxLon, maxLat];
}

function buildArtifactsFromZip(zipBuffer, barrieRoutesGeojson) {
  const zip = new AdmZip(zipBuffer);
  const agencies = readCsv(zip, 'agency.txt');
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const shapes = readCsv(zip, 'shapes.txt');
  const serviceCalendarMetadata = buildServiceCalendarMetadata(
    readCsv(zip, 'calendar.txt', { optional: true }),
    readCsv(zip, 'calendar_dates.txt', { optional: true })
  );

  const barrieStops = stops.filter((stop) => {
    return /\bBARRIE\b/i.test(`${stop.stop_name || ''} ${stop.stop_desc || ''}`);
  });
  if (!barrieStops.length) {
    throw new Error('Ontario Northland GTFS contains no Barrie stop');
  }

  const barrieStopIds = new Set(barrieStops.map((stop) => String(stop.stop_id)));
  const barrieTripIds = new Set(
    stopTimes
      .filter((stopTime) => barrieStopIds.has(String(stopTime.stop_id)))
      .map((stopTime) => String(stopTime.trip_id))
  );
  const barrieTrips = trips.filter((trip) => barrieTripIds.has(String(trip.trip_id)));
  const barrieRouteIds = new Set(barrieTrips.map((trip) => String(trip.route_id)));
  const barrieShapeIds = new Set(
    barrieTrips.map((trip) => String(trip.shape_id || '')).filter(Boolean)
  );
  const terminalStopsByTrip = {};
  stopTimes.forEach((stopTime) => {
    const stopId = String(stopTime.stop_id || '');
    const stopSequence = Number(stopTime.stop_sequence);
    if (!barrieStopIds.has(stopId) || !Number.isFinite(stopSequence)) return;
    const tripId = String(stopTime.trip_id || '');
    if (!tripId) return;
    if (!terminalStopsByTrip[tripId]) terminalStopsByTrip[tripId] = [];
    terminalStopsByTrip[tripId].push({
      stop_id: stopId,
      stop_sequence: stopSequence,
      arrival_time: stopTime.arrival_time || null,
      departure_time: stopTime.departure_time || stopTime.arrival_time || null,
    });
  });

  const primaryAgency = agencies[0] || {};
  const agency = {
    id: 'ontario-northland',
    source_id: primaryAgency.agency_id || '0',
    name: primaryAgency.agency_name || 'Ontario Northland',
    url: primaryAgency.agency_url || 'https://www.ontarionorthland.ca',
    map_route_id: 'ONTC',
    map_label: 'ON',
    color: '#00214D',
    text_color: '#E6B012',
  };

  const routeMetadata = {};
  routes
    .filter((route) => barrieRouteIds.has(String(route.route_id)))
    .forEach((route) => {
      const routeId = String(route.route_id);
      routeMetadata[routeId] = {
        id: routeId,
        short_name: route.route_short_name || null,
        long_name: route.route_long_name || null,
        color: normalizeHexColor(route.route_color, agency.color),
        text_color: normalizeHexColor(route.route_text_color, agency.text_color),
      };
    });

  const tripMetadata = {};
  barrieTrips.forEach((trip) => {
    tripMetadata[String(trip.trip_id)] = {
      route_id: String(trip.route_id),
      service_id: String(trip.service_id || ''),
      headsign: trip.trip_headsign || null,
      shape_id: trip.shape_id || null,
      terminal_stops: (terminalStopsByTrip[String(trip.trip_id)] || [])
        .sort((a, b) => a.stop_sequence - b.stop_sequence),
    };
  });

  const pointsByShape = {};
  shapes.forEach((point) => {
    const shapeId = String(point.shape_id || '');
    if (!shapeId || !barrieShapeIds.has(shapeId)) return;
    if (!pointsByShape[shapeId]) pointsByShape[shapeId] = [];
    pointsByShape[shapeId].push({
      sequence: Number(point.shape_pt_sequence || 0),
      lat: Number(point.shape_pt_lat),
      lon: Number(point.shape_pt_lon),
    });
  });

  const clipBounds = getFeatureCollectionBounds(barrieRoutesGeojson);
  const clippedFeatures = [];
  Object.keys(pointsByShape).forEach((shapeId) => {
    const coordinates = pointsByShape[shapeId]
      .sort((a, b) => a.sequence - b.sequence)
      .map((point) => [point.lon, point.lat])
      .filter((point) => point.every(Number.isFinite));
    if (coordinates.length < 2) return;

    const sourceFeature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates },
    };
    let clipped;
    try {
      clipped = bboxClip(sourceFeature, clipBounds);
    } catch (err) {
      return;
    }
    if (!clipped || !clipped.geometry || !clipped.geometry.coordinates.length) return;

    const trip = barrieTrips.find((entry) => String(entry.shape_id) === shapeId);
    clipped.properties = {
      shape_id: `ONTC:${shapeId}`,
      route_id: agency.map_route_id,
      route_short_name: agency.map_label,
      route_long_name: agency.name,
      route_color: agency.color,
      route_text_color: agency.text_color,
      agency_id: agency.id,
      source_route_id: trip ? String(trip.route_id) : null,
    };
    clippedFeatures.push(clipped);
  });

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source_url: process.env.ONTARIO_NORTHLAND_GTFS_STATIC_URL || DEFAULT_STATIC_URL,
      agency,
      barrie_stop_ids: Array.from(barrieStopIds).sort(),
      barrie_route_ids: Array.from(barrieRouteIds).sort(),
      ...serviceCalendarMetadata,
      routes: routeMetadata,
      trips: tripMetadata,
    },
    routes: {
      type: 'FeatureCollection',
      features: clippedFeatures,
    },
  };
}

async function buildOntarioNorthlandArtifacts(options = {}) {
  const outDir = path.resolve(options.cacheDir || process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
  const staticUrl = options.staticUrl || process.env.ONTARIO_NORTHLAND_GTFS_STATIC_URL || DEFAULT_STATIC_URL;
  const barrieRoutesPath = path.join(outDir, 'routes.geojson');
  const metadataPath = path.join(outDir, 'ontario-northland.json');
  const routesPath = path.join(outDir, 'ontario-northland-routes.geojson');

  if (!fs.existsSync(barrieRoutesPath)) {
    throw new Error('cache/routes.geojson must exist before building Ontario Northland map data');
  }

  console.log('Downloading Ontario Northland GTFS zip:', staticUrl);
  const response = await fetch(staticUrl, { timeout: 30_000 });
  if (!response.ok) throw new Error(`Ontario Northland GTFS download failed: ${response.status}`);
  const zipBuffer = await response.buffer();
  const barrieRoutes = JSON.parse(fs.readFileSync(barrieRoutesPath, 'utf8'));
  const artifacts = buildArtifactsFromZip(zipBuffer, barrieRoutes);

  fs.writeFileSync(metadataPath, JSON.stringify(artifacts.metadata));
  fs.writeFileSync(routesPath, JSON.stringify(artifacts.routes));
  console.log(
    'Wrote Ontario Northland map data with',
    artifacts.metadata.barrie_route_ids.length,
    'Barrie-serving routes and',
    artifacts.routes.features.length,
    'clipped shapes'
  );
  return artifacts;
}

if (require.main === module) {
  buildOntarioNorthlandArtifacts().catch((err) => {
    console.error('Ontario Northland build failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_STATIC_URL,
  getFeatureCollectionBounds,
  buildArtifactsFromZip,
  buildOntarioNorthlandArtifacts,
};
