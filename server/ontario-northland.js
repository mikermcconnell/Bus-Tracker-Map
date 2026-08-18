const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { fetchVehicles } = require('./vehicles');
const { enrichTerminalProgressWithFallback } = require('./terminal-progress');

const DEFAULT_STATIC_URL = 'https://ontarionorthland.tmix.se/gtfs/gtfs.zip';
const DEFAULT_VEHICLES_URL = 'https://ontarionorthland.tmix.se/gtfs-realtime/vehicleupdates.pb';
const DEFAULT_TRIP_UPDATES_URL = 'https://ontarionorthland.tmix.se/gtfs-realtime/tripupdates.pb';
const DEFAULT_ALERTS_URL = 'https://ontarionorthland.tmix.se/gtfs-realtime/alerts.pb';
const REALTIME_CACHE_MS = 5_000;
const AUXILIARY_REALTIME_CACHE_MS = 15_000;

let realtimeCache = null;
const metadataCache = new Map();
const auxiliaryFeedCaches = new Map();

function fileVersion(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
}

function readLong(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value && value.toNumber ? value.toNumber() : value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function readTranslation(value) {
  const translations = value && Array.isArray(value.translation) ? value.translation : [];
  if (!translations.length) return '';
  const english = translations.find((entry) => {
    const language = String(entry && entry.language || '').toLowerCase();
    return language === 'en' || language.startsWith('en-');
  });
  const selected = english || translations[0];
  return selected && selected.text ? String(selected.text).trim() : '';
}

function loadMetadata(cacheDir) {
  const metadataPath = path.join(cacheDir, 'ontario-northland.json');
  try {
    const version = fileVersion(metadataPath);
    const cached = metadataCache.get(metadataPath);
    if (cached && cached.version === version) return cached.value;
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (parsed && Array.isArray(parsed.barrie_route_ids)) {
      metadataCache.set(metadataPath, { version, value: parsed });
      return parsed;
    }
  } catch (err) {
    console.warn('[ontario-northland] Static metadata unavailable:', err.message || err);
  }

  return {
    agency: {
      id: 'ontario-northland',
      name: 'Ontario Northland',
      map_route_id: 'ONTC',
      map_label: 'ON',
      color: '#00214D',
      text_color: '#E6B012',
    },
    barrie_stop_ids: ['315'],
    barrie_route_ids: ['101', '102', '201', '202'],
    routes: {},
    trips: {},
  };
}

async function fetchFeed(url) {
  const response = await fetch(url, {
    timeout: 10_000,
    headers: {
      'Cache-Control': 'no-cache',
      'User-Agent': 'Barrie-Bus-Tracker/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`GTFS-RT fetch failed: ${response.status}`);
  }
  const buffer = await response.buffer();
  return {
    feed: GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer),
    headers: response.headers,
  };
}

async function fetchAuxiliaryFeed(url) {
  const now = Date.now();
  const cached = auxiliaryFeedCaches.get(url);
  if (cached && now - cached.cachedAt < AUXILIARY_REALTIME_CACHE_MS) return cached.promise;
  const promise = fetchFeed(url);
  auxiliaryFeedCaches.set(url, { cachedAt: now, promise });
  try {
    const value = await promise;
    const current = auxiliaryFeedCaches.get(url);
    if (current && current.promise === promise) current.cachedAt = Date.now();
    return value;
  } catch (error) {
    auxiliaryFeedCaches.delete(url);
    throw error;
  }
}

function parseTripUpdates(feed, terminalStopIds) {
  const terminalIds = new Set((terminalStopIds || []).map(String));
  const updates = {};

  (feed && Array.isArray(feed.entity) ? feed.entity : []).forEach((entity) => {
    const tripUpdate = entity && entity.tripUpdate;
    const trip = tripUpdate && tripUpdate.trip;
    const tripId = trip && trip.tripId;
    if (!tripUpdate || !tripId) return;

    const terminalUpdate = (tripUpdate.stopTimeUpdate || []).find((stopUpdate) => {
      return stopUpdate && terminalIds.has(String(stopUpdate.stopId || ''));
    });
    if (!terminalUpdate) return;

    const arrivalEvent = terminalUpdate.arrival || terminalUpdate.departure || null;
    const departureEvent = terminalUpdate.departure || terminalUpdate.arrival || null;
    updates[String(tripId)] = {
      stop_id: String(terminalUpdate.stopId || ''),
      arrival_time: readLong(arrivalEvent && arrivalEvent.time),
      departure_time: readLong(departureEvent && departureEvent.time),
      delay_seconds: departureEvent && Number.isFinite(Number(departureEvent.delay))
        ? Number(departureEvent.delay)
        : null,
      stop_sequence: Number.isFinite(Number(terminalUpdate.stopSequence))
        ? Number(terminalUpdate.stopSequence)
        : null,
    };
  });

  return updates;
}

function parseAlerts(feed) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const alerts = [];

  (feed && Array.isArray(feed.entity) ? feed.entity : []).forEach((entity) => {
    const alert = entity && entity.alert;
    if (!alert) return;

    const periods = Array.isArray(alert.activePeriod) ? alert.activePeriod : [];
    const isActive = !periods.length || periods.some((period) => {
      const start = readLong(period && period.start);
      const end = readLong(period && period.end);
      return (start === null || start <= nowSeconds) && (end === null || end >= nowSeconds);
    });
    if (!isActive) return;

    const header = readTranslation(alert.headerText) || 'Ontario Northland service alert';
    const description = readTranslation(alert.descriptionText);
    const effect = Number.isFinite(Number(alert.effect)) ? Number(alert.effect) : null;
    const cancellationText = `${header} ${description}`;
    const isCancellation = effect === 1 || /\b(?:cancel(?:led|ed|lation)?|no service)\b/i.test(cancellationText);
    if (!isCancellation) return;

    alerts.push({
      id: String(entity.id || `ontario-northland-alert-${alerts.length + 1}`),
      agency_id: 'ontario-northland',
      agency_name: 'Ontario Northland',
      header,
      description,
      cause: Number.isFinite(Number(alert.cause)) ? Number(alert.cause) : null,
      effect,
    });
  });

  return alerts;
}

function qualifyVehicle(vehicle, metadata, tripUpdates) {
  if (!vehicle || !vehicle.route_id) return null;
  const sourceRouteId = String(vehicle.route_id);
  const allowedRoutes = new Set((metadata.barrie_route_ids || []).map(String));
  if (!allowedRoutes.has(sourceRouteId)) return null;

  const agency = metadata.agency || {};
  const route = metadata.routes && metadata.routes[sourceRouteId] || {};
  const trip = vehicle.trip_id && metadata.trips && metadata.trips[vehicle.trip_id] || {};
  const terminalUpdate = vehicle.trip_id && tripUpdates && tripUpdates[vehicle.trip_id] || null;
  const rawVehicleId = String(vehicle.id || vehicle.trip_id || `route-${sourceRouteId}`);

  return enrichTerminalProgressWithFallback({
    ...vehicle,
    id: `ontario-northland:${rawVehicleId}`,
    route_id: agency.map_route_id || 'ONTC',
    route_label: agency.map_label || 'ON',
    source_route_id: sourceRouteId,
    route_long_name: route.long_name || null,
    shape_id: trip.shape_id ? `ONTC:${trip.shape_id}` : null,
    trip_headsign: trip.headsign || null,
    agency_id: agency.id || 'ontario-northland',
    agency_name: agency.name || 'Ontario Northland',
    route_color: agency.color || '#00214D',
    route_text_color: agency.text_color || '#E6B012',
    terminal_stop_id: terminalUpdate && terminalUpdate.stop_id || null,
    terminal_arrival_time: terminalUpdate && terminalUpdate.arrival_time || null,
    terminal_departure_time: terminalUpdate && terminalUpdate.departure_time || null,
    terminal_delay_seconds: terminalUpdate && terminalUpdate.delay_seconds,
  }, {
    terminalStopIds: metadata.barrie_stop_ids,
    terminalStops: trip.terminal_stops || (
      terminalUpdate && terminalUpdate.stop_id
        ? [{
            stop_id: terminalUpdate.stop_id,
            stop_sequence: terminalUpdate.stop_sequence,
          }]
        : []
    ),
    terminalApproachFallbacks: metadata.terminal_approach_fallbacks,
    terminalApproachFallbackStatuses: ['departed', 'not_serving', 'unknown'],
  });
}

async function fetchOntarioNorthlandRealtime(options = {}) {
  const enabled = options.enabled !== false;
  if (!enabled) {
    return {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      alerts: [],
      configured: false,
    };
  }

  const now = Date.now();
  if (realtimeCache && now - realtimeCache.cachedAt < REALTIME_CACHE_MS) {
    return realtimeCache.value;
  }

  const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, '..', 'cache'));
  const metadata = loadMetadata(cacheDir);
  const vehiclesUrl = options.vehiclesUrl || DEFAULT_VEHICLES_URL;
  const tripUpdatesUrl = options.tripUpdatesUrl || DEFAULT_TRIP_UPDATES_URL;
  const alertsUrl = options.alertsUrl || DEFAULT_ALERTS_URL;
  const alertsEnabled = options.alertsEnabled === true;

  const [vehiclePayload, tripResult, alertsResult] = await Promise.all([
    fetchVehicles(vehiclesUrl),
    fetchAuxiliaryFeed(tripUpdatesUrl).catch((err) => {
      console.warn('[ontario-northland] Trip updates unavailable:', err.message || err);
      return null;
    }),
    alertsEnabled
      ? fetchAuxiliaryFeed(alertsUrl).catch((err) => {
          console.warn('[ontario-northland] Alerts unavailable:', err.message || err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const tripUpdates = tripResult
    ? parseTripUpdates(tripResult.feed, metadata.barrie_stop_ids)
    : {};
  const alerts = alertsResult ? parseAlerts(alertsResult.feed) : [];
  const vehicles = (vehiclePayload.vehicles || [])
    .map((vehicle) => qualifyVehicle(vehicle, metadata, tripUpdates))
    .filter(Boolean);

  const value = {
    ...vehiclePayload,
    generated_at: Date.now(),
    vehicles,
    alerts,
    configured: true,
    agency: metadata.agency,
  };
  realtimeCache = { cachedAt: now, value };
  return value;
}

function resetOntarioNorthlandCache() {
  realtimeCache = null;
  metadataCache.clear();
  auxiliaryFeedCaches.clear();
}

module.exports = {
  DEFAULT_STATIC_URL,
  DEFAULT_VEHICLES_URL,
  DEFAULT_TRIP_UPDATES_URL,
  DEFAULT_ALERTS_URL,
  loadMetadata,
  parseTripUpdates,
  parseAlerts,
  qualifyVehicle,
  fetchOntarioNorthlandRealtime,
  resetOntarioNorthlandCache,
};
