#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const bboxClip = require('@turf/bbox-clip').default;
require('dotenv').config();

const LINX_URL = process.env.SIMCOE_LINX_GTFS_STATIC_URL ||
  'https://metrolinx.tmix.se/gtfs/gtfs-simcoe.zip';
const GO_URL = process.env.GO_TRANSIT_GTFS_STATIC_URL ||
  'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip';
const NORTHLAND_URL = process.env.ONTARIO_NORTHLAND_GTFS_STATIC_URL ||
  'https://ontarionorthland.tmix.se/gtfs/gtfs.zip';
const BARRIE_URL = process.env.GTFS_STATIC_URL ||
  'https://www.myridebarrie.ca/gtfs/google_transit.zip';
const GO_ALLANDALE_STOP_IDS = new Set(['08049', 'AD']);
const REGION_PADDING_DEGREES = 0.015;

function readCsv(zip, name) {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`${name} missing from GTFS feed`);
  return parse(zip.readAsText(entry), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
}

function boundsFromCoordinates(coordinates) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      const lon = Number(value[0]);
      const lat = Number(value[1]);
      bounds[0] = Math.min(bounds[0], lon);
      bounds[1] = Math.min(bounds[1], lat);
      bounds[2] = Math.max(bounds[2], lon);
      bounds[3] = Math.max(bounds[3], lat);
      return;
    }
    value.forEach(visit);
  }
  visit(coordinates);
  return bounds.every(Number.isFinite) ? bounds : null;
}

function featureCollectionBounds(collection) {
  return boundsFromCoordinates((collection.features || []).map((feature) => (
    feature && feature.geometry && feature.geometry.coordinates
  )));
}

function expandBounds(bounds, padding = REGION_PADDING_DEGREES) {
  return [bounds[0] - padding, bounds[1] - padding, bounds[2] + padding, bounds[3] + padding];
}

function insideBounds(lat, lon, bounds) {
  const y = Number(lat);
  const x = Number(lon);
  return Number.isFinite(x) && Number.isFinite(y) &&
    x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
}

function normalizeColor(value, fallback) {
  const cleaned = String(value || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(cleaned) ? `#${cleaned.toUpperCase()}` : fallback;
}

function pointsByShape(rows, allowedShapeIds) {
  const output = {};
  rows.forEach((row) => {
    const shapeId = String(row.shape_id || '');
    if (!shapeId || (allowedShapeIds && !allowedShapeIds.has(shapeId))) return;
    if (!output[shapeId]) output[shapeId] = [];
    output[shapeId].push({
      sequence: Number(row.shape_pt_sequence || 0),
      coordinate: [Number(row.shape_pt_lon), Number(row.shape_pt_lat)],
    });
  });
  Object.keys(output).forEach((shapeId) => {
    output[shapeId] = output[shapeId]
      .sort((a, b) => a.sequence - b.sequence)
      .map((point) => point.coordinate)
      .filter((coordinate) => coordinate.every(Number.isFinite));
  });
  return output;
}

function clipFeature(coordinates, bounds, properties) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  try {
    const clipped = bboxClip({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates },
    }, bounds);
    if (!clipped || !clipped.geometry || !clipped.geometry.coordinates.length) return null;
    clipped.properties = properties;
    return clipped;
  } catch (error) {
    return null;
  }
}

function stopFeature(stop, agencyId, agencyName, routeIds = []) {
  return {
    type: 'Feature',
    properties: {
      stop_id: `${agencyId}:${String(stop.stop_id)}`,
      source_stop_id: String(stop.stop_id),
      stop_code: stop.stop_code || null,
      stop_name: stop.stop_name || 'Transit stop',
      agency_id: agencyId,
      agency_name: agencyName,
      route_ids: Array.from(new Set(routeIds)).sort(),
    },
    geometry: {
      type: 'Point',
      coordinates: [Number(stop.stop_lon), Number(stop.stop_lat)],
    },
  };
}

function buildLinx(zip, regionalBounds) {
  const agencies = readCsv(zip, 'agency.txt');
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const shapes = readCsv(zip, 'shapes.txt');
  const agency = agencies[0] || {};
  const routeMap = {};
  routes.forEach((route) => {
    const routeId = String(route.route_id);
    routeMap[routeId] = {
      id: routeId,
      map_route_id: `LINX-${routeId}`,
      short_name: route.route_short_name || routeId,
      long_name: route.route_long_name || null,
      color: normalizeColor(route.route_color, '#006747'),
      text_color: normalizeColor(route.route_text_color, '#FFFFFF'),
    };
  });
  const allandaleStopIds = new Set(stops.filter((stop) => (
    /Allandale/i.test(`${stop.stop_name || ''} ${stop.stop_desc || ''}`)
  )).map((stop) => String(stop.stop_id)));
  const terminalStopsByTrip = {};
  stopTimes.forEach((row) => {
    if (!allandaleStopIds.has(String(row.stop_id))) return;
    const tripId = String(row.trip_id);
    if (!terminalStopsByTrip[tripId]) terminalStopsByTrip[tripId] = [];
    terminalStopsByTrip[tripId].push({
      stop_id: String(row.stop_id),
      stop_sequence: Number(row.stop_sequence),
      arrival_time: row.arrival_time || null,
      departure_time: row.departure_time || row.arrival_time || null,
    });
  });
  const tripMap = {};
  const tripByShape = new Map();
  trips.forEach((trip) => {
    const tripId = String(trip.trip_id);
    const shapeId = String(trip.shape_id || '');
    tripMap[tripId] = {
      route_id: String(trip.route_id),
      service_id: String(trip.service_id || ''),
      headsign: trip.trip_headsign || null,
      shape_id: shapeId || null,
      terminal_stops: terminalStopsByTrip[tripId] || [],
    };
    if (shapeId && !tripByShape.has(shapeId)) tripByShape.set(shapeId, trip);
  });
  const shapePoints = pointsByShape(shapes);
  const routeFeatures = [];
  Object.entries(shapePoints).forEach(([shapeId, coordinates]) => {
    const trip = tripByShape.get(shapeId);
    if (!trip) return;
    const route = routeMap[String(trip.route_id)] || {};
    const feature = clipFeature(coordinates, regionalBounds, {
      shape_id: `LINX:${shapeId}`,
      route_id: route.map_route_id,
      route_short_name: `LINX ${route.short_name}`,
      route_long_name: route.long_name,
      route_color: route.color,
      route_text_color: route.text_color,
      agency_id: 'simcoe-linx',
      agency_name: 'Simcoe County LINX',
      source_route_id: String(trip.route_id),
    });
    if (feature) routeFeatures.push(feature);
  });
  const routeIdsByStop = {};
  stopTimes.forEach((row) => {
    const trip = tripMap[String(row.trip_id)];
    if (!trip) return;
    const stopId = String(row.stop_id);
    if (!routeIdsByStop[stopId]) routeIdsByStop[stopId] = new Set();
    routeIdsByStop[stopId].add(`LINX-${trip.route_id}`);
  });
  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source_url: LINX_URL,
      agency: {
        id: 'simcoe-linx',
        source_id: agency.agency_id || '0',
        name: agency.agency_name || 'Simcoe County LINX',
        map_label: 'LINX',
        color: '#006747',
        text_color: '#FFFFFF',
      },
      route_ids: Object.keys(routeMap),
      barrie_route_ids: Object.keys(routeMap),
      terminal_stop_ids: Array.from(allandaleStopIds),
      routes: routeMap,
      trips: tripMap,
    },
    routes: routeFeatures,
    stops: stops.filter((stop) => insideBounds(stop.stop_lat, stop.stop_lon, regionalBounds))
      .map((stop) => stopFeature(stop, 'simcoe-linx', 'Simcoe County LINX', Array.from(routeIdsByStop[String(stop.stop_id)] || []))),
  };
}

function buildGo(zip, regionalBounds) {
  const agencies = readCsv(zip, 'agency.txt');
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const shapes = readCsv(zip, 'shapes.txt');
  const selectedTripIds = new Set(stopTimes.filter((row) => (
    GO_ALLANDALE_STOP_IDS.has(String(row.stop_id))
  )).map((row) => String(row.trip_id)));
  const selectedTrips = trips.filter((trip) => selectedTripIds.has(String(trip.trip_id)));
  const routeIds = new Set(selectedTrips.map((trip) => String(trip.route_id)));
  const shapeIds = new Set(selectedTrips.map((trip) => String(trip.shape_id || '')).filter(Boolean));
  const routeMap = {};
  routes.filter((route) => routeIds.has(String(route.route_id))).forEach((route) => {
    const mode = String(route.route_type) === '2' ? 'train' : 'bus';
    routeMap[String(route.route_id)] = {
      id: String(route.route_id),
      short_name: route.route_short_name || null,
      long_name: route.route_long_name || null,
      route_type: String(route.route_type || ''),
      mode,
      map_route_id: mode === 'train' ? 'GO-TRAIN' : 'GO-BUS',
      map_label: mode === 'train' ? 'GO TRAIN' : 'GO BUS',
      color: normalizeColor(route.route_color, '#003767'),
      text_color: normalizeColor(route.route_text_color, '#FFFFFF'),
    };
  });
  const allandaleByTrip = {};
  stopTimes.forEach((row) => {
    if (!selectedTripIds.has(String(row.trip_id)) || !GO_ALLANDALE_STOP_IDS.has(String(row.stop_id))) return;
    if (!allandaleByTrip[row.trip_id]) allandaleByTrip[row.trip_id] = [];
    allandaleByTrip[row.trip_id].push({
      stop_id: String(row.stop_id),
      stop_sequence: Number(row.stop_sequence),
      arrival_time: row.arrival_time || null,
      departure_time: row.departure_time || row.arrival_time || null,
    });
  });
  const tripMap = {};
  const tripByShape = new Map();
  selectedTrips.forEach((trip) => {
    const shapeId = String(trip.shape_id || '');
    tripMap[String(trip.trip_id)] = {
      route_id: String(trip.route_id),
      service_id: String(trip.service_id || ''),
      headsign: trip.trip_headsign || null,
      shape_id: shapeId || null,
      terminal_stops: allandaleByTrip[String(trip.trip_id)] || [],
    };
    if (shapeId && !tripByShape.has(shapeId)) tripByShape.set(shapeId, trip);
  });
  const routeFeatures = [];
  Object.entries(pointsByShape(shapes, shapeIds)).forEach(([shapeId, coordinates]) => {
    const trip = tripByShape.get(shapeId);
    const route = trip && routeMap[String(trip.route_id)];
    if (!route) return;
    const feature = clipFeature(coordinates, regionalBounds, {
      shape_id: `GO:${shapeId}`,
      route_id: route.map_route_id,
      route_short_name: route.map_label,
      route_long_name: route.long_name,
      route_color: route.color,
      route_text_color: route.text_color,
      route_mode: route.mode,
      agency_id: 'go-transit',
      agency_name: 'GO Transit',
      source_route_id: String(trip.route_id),
    });
    if (feature) routeFeatures.push(feature);
  });
  const selectedStopIds = new Set(stopTimes.filter((row) => selectedTripIds.has(String(row.trip_id)))
    .map((row) => String(row.stop_id)));
  const routeIdsByStop = {};
  stopTimes.filter((row) => selectedTripIds.has(String(row.trip_id))).forEach((row) => {
    const trip = tripMap[String(row.trip_id)];
    const route = trip && routeMap[trip.route_id];
    if (!route) return;
    const stopId = String(row.stop_id);
    if (!routeIdsByStop[stopId]) routeIdsByStop[stopId] = new Set();
    routeIdsByStop[stopId].add(route.map_route_id);
  });
  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source_url: GO_URL,
      agency: { id: 'go-transit', source_id: agencies[0] && agencies[0].agency_id || 'GO', name: 'GO Transit' },
      allandale_stop_ids: Array.from(GO_ALLANDALE_STOP_IDS),
      allandale_route_ids: Array.from(routeIds),
      map_bounds: regionalBounds,
      routes: routeMap,
      trips: tripMap,
    },
    routes: routeFeatures,
    stops: stops.filter((stop) => selectedStopIds.has(String(stop.stop_id)) &&
      insideBounds(stop.stop_lat, stop.stop_lon, regionalBounds))
      .map((stop) => stopFeature(stop, 'go-transit', 'GO Transit', Array.from(routeIdsByStop[String(stop.stop_id)] || []))),
  };
}

function buildNorthland(zip, regionalBounds) {
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const shapes = readCsv(zip, 'shapes.txt');
  const barrieStopIds = new Set(stops.filter((stop) => (
    /\bBarrie\b/i.test(`${stop.stop_name || ''} ${stop.stop_desc || ''}`)
  )).map((stop) => String(stop.stop_id)));
  const selectedTripIds = new Set(stopTimes.filter((row) => barrieStopIds.has(String(row.stop_id)))
    .map((row) => String(row.trip_id)));
  const selectedTrips = trips.filter((trip) => selectedTripIds.has(String(trip.trip_id)));
  const routeIds = new Set(selectedTrips.map((trip) => String(trip.route_id)));
  const shapeIds = new Set(selectedTrips.map((trip) => String(trip.shape_id || '')).filter(Boolean));
  const routeMap = Object.fromEntries(routes.filter((route) => routeIds.has(String(route.route_id)))
    .map((route) => [String(route.route_id), route]));
  const tripByShape = new Map();
  selectedTrips.forEach((trip) => {
    const shapeId = String(trip.shape_id || '');
    if (shapeId && !tripByShape.has(shapeId)) tripByShape.set(shapeId, trip);
  });
  const routeFeatures = [];
  Object.entries(pointsByShape(shapes, shapeIds)).forEach(([shapeId, coordinates]) => {
    const trip = tripByShape.get(shapeId);
    const route = trip && routeMap[String(trip.route_id)] || {};
    const feature = clipFeature(coordinates, regionalBounds, {
      shape_id: `ONTC:${shapeId}`,
      route_id: 'ONTC',
      route_short_name: 'ON',
      route_long_name: route.route_long_name || 'Ontario Northland',
      route_color: '#00214D',
      route_text_color: '#E6B012',
      agency_id: 'ontario-northland',
      agency_name: 'Ontario Northland',
      source_route_id: trip && String(trip.route_id),
    });
    if (feature) routeFeatures.push(feature);
  });
  const selectedStopIds = new Set(stopTimes.filter((row) => selectedTripIds.has(String(row.trip_id)))
    .map((row) => String(row.stop_id)));
  return {
    routes: routeFeatures,
    stops: stops.filter((stop) => selectedStopIds.has(String(stop.stop_id)) &&
      insideBounds(stop.stop_lat, stop.stop_lon, regionalBounds))
      .map((stop) => stopFeature(stop, 'ontario-northland', 'Ontario Northland', ['ONTC'])),
  };
}

async function downloadZip(url, label) {
  const response = await fetch(url, { timeout: 30_000 });
  if (!response.ok) throw new Error(`${label} GTFS download failed: ${response.status}`);
  return new AdmZip(await response.buffer());
}

async function buildSimcoeRegion(options = {}) {
  const outDir = path.resolve(options.cacheDir || process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
  const barrieRoutes = JSON.parse(fs.readFileSync(path.join(outDir, 'routes.geojson'), 'utf8'));
  const barrieStops = JSON.parse(fs.readFileSync(path.join(outDir, 'stops.geojson'), 'utf8'));
  const [linxZip, goZip, northlandZip, barrieZip] = await Promise.all([
    downloadZip(options.linxUrl || LINX_URL, 'Simcoe LINX'),
    downloadZip(options.goUrl || GO_URL, 'GO Transit'),
    downloadZip(options.northlandUrl || NORTHLAND_URL, 'Ontario Northland'),
    downloadZip(options.barrieUrl || BARRIE_URL, 'Barrie Transit'),
  ]);
  const linxShapeRows = readCsv(linxZip, 'shapes.txt');
  const linxBounds = boundsFromCoordinates(linxShapeRows.map((row) => (
    [Number(row.shape_pt_lon), Number(row.shape_pt_lat)]
  )));
  const barrieBounds = featureCollectionBounds(barrieRoutes);
  if (!linxBounds || !barrieBounds) throw new Error('Unable to derive regional map bounds');
  const regionalBounds = expandBounds([
    Math.min(linxBounds[0], barrieBounds[0]),
    Math.min(linxBounds[1], barrieBounds[1]),
    Math.max(linxBounds[2], barrieBounds[2]),
    Math.max(linxBounds[3], barrieBounds[3]),
  ]);
  const linx = buildLinx(linxZip, regionalBounds);
  const go = buildGo(goZip, regionalBounds);
  const northland = buildNorthland(northlandZip, regionalBounds);
  const barrieRouteFeatures = (barrieRoutes.features || []).map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      agency_id: 'barrie-transit',
      agency_name: 'Barrie Transit',
    },
  }));
  const barrieTrips = Object.fromEntries(readCsv(barrieZip, 'trips.txt').map((trip) => (
    [String(trip.trip_id), String(trip.route_id)]
  )));
  const barrieRouteIdsByStop = {};
  readCsv(barrieZip, 'stop_times.txt').forEach((row) => {
    const routeId = barrieTrips[String(row.trip_id)];
    if (!routeId) return;
    const stopId = String(row.stop_id);
    if (!barrieRouteIdsByStop[stopId]) barrieRouteIdsByStop[stopId] = new Set();
    barrieRouteIdsByStop[stopId].add(routeId);
  });
  const barrieStopFeatures = (barrieStops.features || []).map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      stop_id: `barrie-transit:${String(feature.properties && feature.properties.stop_id || '')}`,
      source_stop_id: String(feature.properties && feature.properties.stop_id || ''),
      agency_id: 'barrie-transit',
      agency_name: 'Barrie Transit',
      route_ids: Array.from(barrieRouteIdsByStop[String(feature.properties && feature.properties.stop_id || '')] || []).sort(),
    },
  }));
  const routes = { type: 'FeatureCollection', features: barrieRouteFeatures.concat(linx.routes, go.routes, northland.routes) };
  const stops = { type: 'FeatureCollection', features: barrieStopFeatures.concat(linx.stops, go.stops, northland.stops) };
  const config = {
    generated_at: new Date().toISOString(),
    bounds: regionalBounds,
    barrie_reveal_zoom: 11,
    stops_reveal_zoom: 13,
    agencies: [
      { id: 'simcoe-linx', name: 'Simcoe County LINX' },
      { id: 'go-transit', name: 'GO Transit' },
      { id: 'ontario-northland', name: 'Ontario Northland' },
      { id: 'barrie-transit', name: 'Barrie Transit' },
    ],
  };
  fs.writeFileSync(path.join(outDir, 'simcoe-region.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(outDir, 'simcoe-region-routes.geojson'), JSON.stringify(routes));
  fs.writeFileSync(path.join(outDir, 'simcoe-region-stops.geojson'), JSON.stringify(stops));
  fs.writeFileSync(path.join(outDir, 'simcoe-region-linx.json'), JSON.stringify(linx.metadata));
  fs.writeFileSync(path.join(outDir, 'simcoe-region-go.json'), JSON.stringify(go.metadata));
  console.log(`Wrote Simcoe region with ${routes.features.length} route shapes and ${stops.features.length} stops`);
  return { config, routes, stops, linx: linx.metadata, go: go.metadata };
}

if (require.main === module) {
  buildSimcoeRegion().catch((error) => {
    console.error('Simcoe region build failed:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  boundsFromCoordinates,
  expandBounds,
  insideBounds,
  buildSimcoeRegion,
};
