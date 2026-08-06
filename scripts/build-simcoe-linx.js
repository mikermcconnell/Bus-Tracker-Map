#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const bboxClip = require('@turf/bbox-clip').default;
const { buildServiceCalendarMetadata } = require('../shared/gtfs-service-calendar');
const { getFeatureCollectionBounds } = require('./build-ontario-northland');
require('dotenv').config();

const DEFAULT_STATIC_URL = 'https://metrolinx.tmix.se/gtfs/gtfs-simcoe.zip';
const ALLANDALE_STOP_NAME = /\bAllandale\b/i;

function readCsv(zip, name, options = {}) {
  const entry = zip.getEntry(name);
  if (!entry) {
    if (options.optional) return [];
    throw new Error(`${name} missing in Simcoe LINX GTFS zip`);
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

function buildArtifactsFromZip(zipBuffer, barrieRoutesGeojson) {
  const zip = new AdmZip(zipBuffer);
  const agencies = readCsv(zip, 'agency.txt');
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const shapes = readCsv(zip, 'shapes.txt');
  const clipBounds = getFeatureCollectionBounds(barrieRoutesGeojson);
  const serviceCalendarMetadata = buildServiceCalendarMetadata(
    readCsv(zip, 'calendar.txt', { optional: true }),
    readCsv(zip, 'calendar_dates.txt', { optional: true })
  );

  const barrieStops = stops.filter((stop) => {
    const lat = Number(stop.stop_lat);
    const lon = Number(stop.stop_lon);
    return (
      /\bBarrie\b/i.test(`${stop.stop_name || ''} ${stop.stop_desc || ''}`) &&
      Number.isFinite(lat) && Number.isFinite(lon) &&
      lon >= clipBounds[0] && lon <= clipBounds[2] &&
      lat >= clipBounds[1] && lat <= clipBounds[3]
    );
  });
  if (!barrieStops.length) throw new Error('Simcoe LINX GTFS contains no Barrie stop');

  const terminalStops = barrieStops.filter((stop) => (
    ALLANDALE_STOP_NAME.test(`${stop.stop_name || ''} ${stop.stop_desc || ''}`)
  ));
  if (!terminalStops.length) throw new Error('Simcoe LINX GTFS contains no Allandale stop');

  const barrieStopIds = new Set(barrieStops.map((stop) => String(stop.stop_id)));
  const terminalStopIds = new Set(terminalStops.map((stop) => String(stop.stop_id)));
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
    if (!terminalStopIds.has(stopId) || !Number.isFinite(stopSequence)) return;
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
    id: 'simcoe-linx',
    source_id: primaryAgency.agency_id || '0',
    name: primaryAgency.agency_name || 'Simcoe County LINX',
    url: primaryAgency.agency_url || 'https://www.simcoe.ca/dpt/linx',
    map_label: 'LINX',
    color: '#006747',
    text_color: '#FFFFFF',
  };

  const routeMetadata = {};
  routes
    .filter((route) => barrieRouteIds.has(String(route.route_id)))
    .forEach((route) => {
      const routeId = String(route.route_id);
      routeMetadata[routeId] = {
        id: routeId,
        map_route_id: `LINX-${routeId}`,
        short_name: route.route_short_name || routeId,
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

  const tripByShape = new Map();
  barrieTrips.forEach((trip) => {
    const shapeId = String(trip.shape_id || '');
    if (shapeId && !tripByShape.has(shapeId)) tripByShape.set(shapeId, trip);
  });
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

    const trip = tripByShape.get(shapeId);
    const sourceRouteId = trip && String(trip.route_id || '');
    const route = routeMetadata[sourceRouteId] || {};
    clipped.properties = {
      shape_id: `LINX:${shapeId}`,
      route_id: route.map_route_id || `LINX-${sourceRouteId}`,
      route_short_name: `LINX ${route.short_name || sourceRouteId}`,
      route_long_name: route.long_name || agency.name,
      route_color: route.color || agency.color,
      route_text_color: route.text_color || agency.text_color,
      agency_id: agency.id,
      agency_name: agency.name,
      source_route_id: sourceRouteId,
    };
    clippedFeatures.push(clipped);
  });

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source_url: process.env.SIMCOE_LINX_GTFS_STATIC_URL || DEFAULT_STATIC_URL,
      agency,
      barrie_stop_ids: Array.from(barrieStopIds).sort(),
      barrie_route_ids: Array.from(barrieRouteIds).sort(),
      terminal_stop_ids: Array.from(terminalStopIds).sort(),
      terminal_stops: terminalStops.map((stop) => ({
        id: String(stop.stop_id),
        name: stop.stop_name || null,
        lat: Number(stop.stop_lat),
        lon: Number(stop.stop_lon),
        // The published LINX GTFS does not currently model an Allandale
        // platform. Passenger-facing assignments live in terminal-layout.js.
        platform_code: stop.platform_code || null,
      })),
      ...serviceCalendarMetadata,
      routes: routeMetadata,
      trips: tripMetadata,
    },
    routes: { type: 'FeatureCollection', features: clippedFeatures },
  };
}

async function buildSimcoeLinxArtifacts(options = {}) {
  const outDir = path.resolve(options.cacheDir || process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
  const staticUrl = options.staticUrl || process.env.SIMCOE_LINX_GTFS_STATIC_URL || DEFAULT_STATIC_URL;
  const barrieRoutesPath = path.join(outDir, 'routes.geojson');
  if (!fs.existsSync(barrieRoutesPath)) {
    throw new Error('cache/routes.geojson must exist before building Simcoe LINX map data');
  }

  console.log('Downloading Simcoe LINX GTFS zip:', staticUrl);
  const response = await fetch(staticUrl, { timeout: 30_000 });
  if (!response.ok) throw new Error(`Simcoe LINX GTFS download failed: ${response.status}`);
  const zipBuffer = await response.buffer();
  const barrieRoutes = JSON.parse(fs.readFileSync(barrieRoutesPath, 'utf8'));
  const artifacts = buildArtifactsFromZip(zipBuffer, barrieRoutes);
  fs.writeFileSync(path.join(outDir, 'simcoe-linx.json'), JSON.stringify(artifacts.metadata));
  fs.writeFileSync(path.join(outDir, 'simcoe-linx-routes.geojson'), JSON.stringify(artifacts.routes));
  console.log(
    'Wrote Simcoe LINX map data with',
    artifacts.metadata.barrie_route_ids.length,
    'Barrie-serving routes and',
    artifacts.routes.features.length,
    'clipped shapes'
  );
  return artifacts;
}

if (require.main === module) {
  buildSimcoeLinxArtifacts().catch((err) => {
    console.error('Simcoe LINX build failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_STATIC_URL,
  buildArtifactsFromZip,
  buildSimcoeLinxArtifacts,
};

