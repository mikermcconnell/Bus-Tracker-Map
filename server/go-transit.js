const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { enrichTerminalProgress } = require('./terminal-progress');

const DEFAULT_API_BASE = 'https://api.openmetrolinx.com/OpenDataAPI/api/V1';
const REALTIME_CACHE_MS = 5_000;
const STALE_IF_ERROR_MS = 15 * 60 * 1000;
const PROXY_FAILURE_REASONS = new Set([
  'fetch_failed',
  'invalid_payload',
  'feed_not_configured',
  'missing_timestamp',
]);
const realtimeCaches = new Map();
const lastSuccessfulRealtimeByKey = new Map();
const rawRealtimeCaches = new Map();

function loadMetadata(cacheDir, metadataFile = 'go-transit.json', routesFile = 'go-transit-routes.geojson') {
  const metadataPath = path.join(cacheDir, metadataFile);
  if (!fs.existsSync(metadataPath)) {
    throw new Error('GO Transit static metadata is not built');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const routesPath = path.join(cacheDir, routesFile);
  if (fs.existsSync(routesPath)) {
    const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
    metadata.shape_coordinates = buildShapeCoordinateIndex(routes);
  }
  return metadata;
}

function readTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readEpochSeconds(value) {
  const timestamp = readTimestamp(value);
  if (timestamp === null) return null;
  return Math.floor(timestamp >= 1e12 ? timestamp / 1000 : timestamp);
}

function cacheSuccessfulRealtime(now, value, cacheKey = 'barrie') {
  realtimeCaches.set(cacheKey, { cachedAt: now, value });
  lastSuccessfulRealtimeByKey.set(cacheKey, { cachedAt: now, value });
  return value;
}

async function fetchRealtimeJson(url, fetchImpl, label) {
  const now = Date.now();
  const cached = rawRealtimeCaches.get(url);
  if (cached && now - cached.cachedAt < REALTIME_CACHE_MS) return cached.promise;
  const promise = (async () => {
    const response = await fetchImpl(url, {
      timeout: 10_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Barrie-Bus-Tracker/1.0',
      },
    });
    if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
    return response.json();
  })();
  rawRealtimeCaches.set(url, { cachedAt: now, promise });
  try {
    return await promise;
  } catch (error) {
    rawRealtimeCaches.delete(url);
    if (error && /^GO Transit proxy feed failed:|^Metrolinx vehicle feed failed:/.test(String(error.message || ''))) {
      throw error;
    }
    throw new Error(`${label} unavailable`, { cause: error });
  }
}

function useLastSuccessfulRealtime(now, error, cacheKey = 'barrie') {
  const lastSuccessfulRealtime = lastSuccessfulRealtimeByKey.get(cacheKey);
  if (!lastSuccessfulRealtime || now - lastSuccessfulRealtime.cachedAt > STALE_IF_ERROR_MS) {
    throw error;
  }
  const value = {
    ...lastSuccessfulRealtime.value,
    generated_at: now,
    stale_if_error: true,
  };
  realtimeCaches.set(cacheKey, { cachedAt: now, value });
  return value;
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

function buildShapeCoordinateIndex(featureCollection) {
  const index = {};
  (featureCollection && Array.isArray(featureCollection.features)
    ? featureCollection.features
    : []).forEach((feature) => {
    const shapeId = String(feature && feature.properties && feature.properties.shape_id || '')
      .replace(/^GO:/, '');
    const geometry = feature && feature.geometry;
    if (!shapeId || !geometry) return;
    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
      index[shapeId] = [geometry.coordinates];
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      index[shapeId] = geometry.coordinates;
    }
  });
  return index;
}

function segmentBearing(start, end) {
  const radians = Math.PI / 180;
  const startLat = Number(start && start[1]) * radians;
  const endLat = Number(end && end[1]) * radians;
  const deltaLon = (Number(end && end[0]) - Number(start && start[0])) * radians;
  if (![startLat, endLat, deltaLon].every(Number.isFinite)) return null;
  const y = Math.sin(deltaLon) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  const bearing = Math.atan2(y, x) / radians;
  return (bearing + 360) % 360;
}

function findNearestShapeBearing(shapeLines, lat, lon, maxDistanceMeters = 500) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const lonScale = Math.cos(latitude * Math.PI / 180);
  const metersPerDegree = 111_320;
  let best = null;

  (Array.isArray(shapeLines) ? shapeLines : []).forEach((line) => {
    for (let index = 1; index < (Array.isArray(line) ? line.length : 0); index += 1) {
      const start = line[index - 1];
      const end = line[index];
      const startX = (Number(start && start[0]) - longitude) * lonScale * metersPerDegree;
      const startY = (Number(start && start[1]) - latitude) * metersPerDegree;
      const endX = (Number(end && end[0]) - longitude) * lonScale * metersPerDegree;
      const endY = (Number(end && end[1]) - latitude) * metersPerDegree;
      if (![startX, startY, endX, endY].every(Number.isFinite)) continue;
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const lengthSquared = deltaX * deltaX + deltaY * deltaY;
      if (lengthSquared <= 0) continue;
      const progress = Math.max(0, Math.min(
        1,
        -(startX * deltaX + startY * deltaY) / lengthSquared
      ));
      const nearestX = startX + progress * deltaX;
      const nearestY = startY + progress * deltaY;
      const distance = Math.sqrt(nearestX * nearestX + nearestY * nearestY);
      if (!best || distance < best.distance) {
        best = {
          distance,
          bearing: segmentBearing(start, end),
        };
      }
    }
  });

  return best &&
    best.distance <= maxDistanceMeters &&
    Number.isFinite(best.bearing)
    ? best.bearing
    : null;
}

function resolveGoBearing(position, tripMetadata, metadata) {
  const hasBearing = position &&
    position.bearing !== null &&
    position.bearing !== undefined &&
    Number.isFinite(Number(position.bearing));
  const hasSpeed = position &&
    position.speed !== null &&
    position.speed !== undefined &&
    Number.isFinite(Number(position.speed));
  const realtimeBearing = hasBearing ? Number(position.bearing) : null;
  const speed = hasSpeed ? Number(position.speed) : null;
  const defaultMissingPair = realtimeBearing === 0 && (speed === 0 || speed === null);

  if (realtimeBearing !== null && !defaultMissingPair) {
    return {
      bearing: (realtimeBearing % 360 + 360) % 360,
      source: 'realtime',
    };
  }

  const shapeId = String(tripMetadata && tripMetadata.shape_id || '');
  const shapeLines = metadata &&
    metadata.shape_coordinates &&
    metadata.shape_coordinates[shapeId];
  const shapeBearing = findNearestShapeBearing(
    shapeLines,
    position && position.latitude,
    position && position.longitude
  );
  return {
    bearing: shapeBearing,
    source: shapeBearing === null ? null : 'static_shape',
  };
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

    const tripMetadata = trip && metadata.trips && metadata.trips[trip.trip_id] || {};
    const resolvedBearing = resolveGoBearing(position, tripMetadata, metadata);
    const parsedVehicle = {
      id: `go-transit:${rawVehicleId}`,
      route_id: route.map_route_id || (route.mode === 'train' ? 'GO-TRAIN' : 'GO-BUS'),
      route_label: getVehicleLabel(vehicle, route),
      source_route_id: sourceRouteId,
      route_long_name: route.long_name || null,
      trip_id: trip.trip_id || null,
      shape_id: tripMetadata.shape_id ? `GO:${tripMetadata.shape_id}` : null,
      trip_headsign: String(vehicle.vehicle && vehicle.vehicle.label || '').split(' - ').slice(1).join(' - ') ||
        tripMetadata.headsign ||
        null,
      start_date: trip.start_date || null,
      start_time: trip.start_time || null,
      direction_id: Number.isFinite(Number(trip.direction_id)) ? Number(trip.direction_id) : null,
      lat: Number(position.latitude),
      lon: Number(position.longitude),
      bearing: resolvedBearing.bearing,
      bearing_source: resolvedBearing.source,
      speed: position.speed !== null &&
        position.speed !== undefined &&
        Number.isFinite(Number(position.speed))
        ? Number(position.speed)
        : null,
      stop_id: vehicle.stop_id || null,
      current_stop_sequence: vehicle.current_stop_sequence !== null &&
        vehicle.current_stop_sequence !== undefined &&
        Number.isFinite(Number(vehicle.current_stop_sequence))
        ? Number(vehicle.current_stop_sequence)
        : null,
      current_status: Number.isFinite(Number(vehicle.current_status))
        ? Number(vehicle.current_status)
        : null,
      last_reported: timestamp,
      agency_id: agency.id || 'go-transit',
      agency_name: agency.name || 'GO Transit',
      route_mode: route.mode || 'bus',
      route_color: route.color || '#003767',
      route_text_color: route.text_color || '#FFFFFF',
    };
    newestByVehicle.set(rawVehicleId, enrichTerminalProgress(parsedVehicle, {
      terminalStopIds: metadata.allandale_stop_ids,
      terminalStops: tripMetadata.terminal_stops,
      inboundHeadsignPattern: /Allandale Waterfront|Barrie Allandale/i,
    }));
  });

  return Array.from(newestByVehicle.values());
}

async function fetchGoTransitRealtime(options = {}) {
  const enabled = options.enabled === true;
  const apiKey = String(options.apiKey || '').trim();
  const proxyUrl = String(options.proxyUrl || '').trim();
  const fetchImpl = options.fetchImpl || fetch;
  if (!enabled || (!apiKey && !proxyUrl)) {
    return {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      configured: false,
    };
  }

  const now = Date.now();
  const cacheKey = String(options.cacheKey || options.metadataFile || 'barrie');
  const realtimeCache = realtimeCaches.get(cacheKey);
  if (realtimeCache && now - realtimeCache.cachedAt < REALTIME_CACHE_MS) {
    return realtimeCache.value;
  }

  if (!apiKey && proxyUrl) {
    try {
      const payload = await fetchRealtimeJson(proxyUrl, fetchImpl, 'GO Transit proxy feed');
      const source = payload && payload.sources && payload.sources.go_transit || {};
      if (PROXY_FAILURE_REASONS.has(String(source.status_reason || '').toLowerCase())) {
        throw new Error(`GO Transit proxy source unavailable: ${source.status_reason}`);
      }
      const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, '..', 'cache'));
      const metadata = loadMetadata(cacheDir, options.metadataFile, options.routesFile);
      const sourceTimestamp = readEpochSeconds(source.latest_data_timestamp) ||
        readEpochSeconds(payload && payload.feed_timestamp);
      const proxyResponseTimestamp = readEpochSeconds(payload && payload.generated_at);
      const value = {
        generated_at: now,
        // A stationary GO vehicle can keep the same GPS timestamp even though
        // Metrolinx is responding normally. Track the successful source poll
        // separately, while stale individual icons are still filtered later.
        feed_timestamp: proxyResponseTimestamp || sourceTimestamp,
        vehicles: (payload && Array.isArray(payload.vehicles) ? payload.vehicles : [])
          .filter((vehicle) => vehicle && vehicle.agency_id === 'go-transit')
          .map((vehicle) => {
            const trip = vehicle.trip_id && metadata.trips && metadata.trips[vehicle.trip_id] || {};
            return enrichTerminalProgress({
              ...vehicle,
              trip_headsign: vehicle.trip_headsign || trip.headsign || null,
            }, {
              terminalStopIds: metadata.allandale_stop_ids,
              terminalStops: trip.terminal_stops,
              inboundHeadsignPattern: /Allandale Waterfront|Barrie Allandale/i,
            });
          }),
        configured: true,
        agency: { id: 'go-transit', name: 'GO Transit' },
      };
      return cacheSuccessfulRealtime(now, value, cacheKey);
    } catch (error) {
      return useLastSuccessfulRealtime(now, error, cacheKey);
    }
  }

  const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, '..', 'cache'));
  const metadata = loadMetadata(cacheDir, options.metadataFile, options.routesFile);
  const apiBase = String(options.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const endpoint = `${apiBase}/Gtfs/Feed/VehiclePosition?key=${encodeURIComponent(apiKey)}`;
  try {
    const feed = await fetchRealtimeJson(endpoint, fetchImpl, 'Metrolinx vehicle feed');
    const value = {
      generated_at: now,
      feed_timestamp: readEpochSeconds(feed.header && feed.header.timestamp),
      vehicles: parseVehicleFeed(feed, metadata),
      configured: true,
      agency: metadata.agency,
    };
    return cacheSuccessfulRealtime(now, value, cacheKey);
  } catch (error) {
    return useLastSuccessfulRealtime(now, error, cacheKey);
  }
}

function resetGoTransitCache() {
  realtimeCaches.clear();
  lastSuccessfulRealtimeByKey.clear();
  rawRealtimeCaches.clear();
}

module.exports = {
  DEFAULT_API_BASE,
  loadMetadata,
  isInsideBounds,
  buildShapeCoordinateIndex,
  findNearestShapeBearing,
  resolveGoBearing,
  parseVehicleFeed,
  fetchGoTransitRealtime,
  resetGoTransitCache,
};
