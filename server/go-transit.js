const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DEFAULT_API_BASE = 'https://api.openmetrolinx.com/OpenDataAPI/api/V1';
const REALTIME_CACHE_MS = 5_000;
let realtimeCache = null;

function loadMetadata(cacheDir) {
  const metadataPath = path.join(cacheDir, 'go-transit.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error('GO Transit static metadata is not built');
  }
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

function readTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isInsideBounds(lat, lon, bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) return false;
  const latitude = Number(lat);
  const longitude = Number(lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    longitude >= Number(bounds[0]) && longitude <= Number(bounds[2]) &&
    latitude >= Number(bounds[1]) && latitude <= Number(bounds[3]);
}

function getVehicleLabel(vehicle, route) {
  const sourceLabel = String(vehicle && vehicle.vehicle && vehicle.vehicle.label || '').trim();
  const shortLabel = sourceLabel.split(' - ')[0].trim();
  if (route && route.mode === 'train') return 'GO TRAIN';
  return shortLabel ? `GO ${shortLabel}` : 'GO BUS';
}

function parseVehicleFeed(feed, metadata) {
  const allowedRoutes = new Set((metadata.allandale_route_ids || []).map(String));
  const routes = metadata.routes || {};
  const agency = metadata.agency || {};
  const newestByVehicle = new Map();

  (feed && Array.isArray(feed.entity) ? feed.entity : []).forEach((entity) => {
    const vehicle = entity && entity.vehicle;
    const trip = vehicle && vehicle.trip;
    const position = vehicle && vehicle.position;
    const sourceRouteId = trip && String(trip.route_id || '');
    if (!vehicle || !position || !allowedRoutes.has(sourceRouteId)) return;
    if (!isInsideBounds(position.latitude, position.longitude, metadata.map_bounds)) return;

    const route = routes[sourceRouteId] || {};
    const rawVehicleId = String(
      vehicle.vehicle && (vehicle.vehicle.id || vehicle.vehicle.label) ||
      entity.id ||
      trip.trip_id
    );
    const timestamp = readTimestamp(vehicle.timestamp) || readTimestamp(feed.header && feed.header.timestamp);
    const existing = newestByVehicle.get(rawVehicleId);
    if (existing && Number(existing.last_reported || 0) > Number(timestamp || 0)) return;

    newestByVehicle.set(rawVehicleId, {
      id: `go-transit:${rawVehicleId}`,
      route_id: route.map_route_id || (route.mode === 'train' ? 'GO-TRAIN' : 'GO-BUS'),
      route_label: getVehicleLabel(vehicle, route),
      source_route_id: sourceRouteId,
      route_long_name: route.long_name || null,
      trip_id: trip.trip_id || null,
      trip_headsign: String(vehicle.vehicle && vehicle.vehicle.label || '').split(' - ').slice(1).join(' - ') || null,
      start_date: trip.start_date || null,
      start_time: trip.start_time || null,
      direction_id: Number.isFinite(Number(trip.direction_id)) ? Number(trip.direction_id) : null,
      lat: Number(position.latitude),
      lon: Number(position.longitude),
      bearing: Number.isFinite(Number(position.bearing)) ? Number(position.bearing) : null,
      speed: Number.isFinite(Number(position.speed)) ? Number(position.speed) : null,
      stop_id: vehicle.stop_id || null,
      current_status: vehicle.current_status || null,
      last_reported: timestamp,
      agency_id: agency.id || 'go-transit',
      agency_name: agency.name || 'GO Transit',
      route_mode: route.mode || 'bus',
      route_color: route.color || '#003767',
      route_text_color: route.text_color || '#FFFFFF',
    });
  });

  return Array.from(newestByVehicle.values());
}

async function fetchGoTransitRealtime(options = {}) {
  const enabled = options.enabled === true;
  const apiKey = String(options.apiKey || '').trim();
  if (!enabled || !apiKey) {
    return {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      configured: false,
    };
  }

  const now = Date.now();
  if (realtimeCache && now - realtimeCache.cachedAt < REALTIME_CACHE_MS) {
    return realtimeCache.value;
  }

  const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, '..', 'cache'));
  const metadata = loadMetadata(cacheDir);
  const apiBase = String(options.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const endpoint = `${apiBase}/Gtfs/Feed/VehiclePosition?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    timeout: 10_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Barrie-Bus-Tracker/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Metrolinx vehicle feed failed: ${response.status}`);
  }

  const feed = await response.json();
  const value = {
    generated_at: Date.now(),
    feed_timestamp: readTimestamp(feed.header && feed.header.timestamp),
    vehicles: parseVehicleFeed(feed, metadata),
    configured: true,
    agency: metadata.agency,
  };
  realtimeCache = { cachedAt: now, value };
  return value;
}

function resetGoTransitCache() {
  realtimeCache = null;
}

module.exports = {
  DEFAULT_API_BASE,
  loadMetadata,
  isInsideBounds,
  parseVehicleFeed,
  fetchGoTransitRealtime,
  resetGoTransitCache,
};
