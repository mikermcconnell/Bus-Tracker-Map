const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { fetchVehicles } = require('./vehicles');
const { enrichTerminalProgress } = require('./terminal-progress');
const { PLATFORM_BY_EXTERNAL_STOP } = require('./terminal-layout');

const DEFAULT_STATIC_URL = 'https://metrolinx.tmix.se/gtfs/gtfs-simcoe.zip';
// Tmix currently publishes Ontario vehicle positions in this shared feed.
// Matching must therefore use the exact trip IDs from the Simcoe static feed.
const DEFAULT_VEHICLES_URL = 'https://metrolinx.tmix.se/gtfs-realtime-belleville/vehiclepositions.pb';
const DEFAULT_TRIP_UPDATES_URL = 'http://metrolinx.tmix.se/gtfs-realtime-simcoe/tripupdates.pb';
const DEFAULT_ALERTS_URL = 'http://metrolinx.tmix.se/gtfs-realtime-simcoe/alerts.pb';
const REALTIME_CACHE_MS = 5_000;

const realtimeCaches = new Map();
const rawRealtimeCaches = new Map();

function readLong(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value && value.toNumber ? value.toNumber() : value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function readTranslation(value) {
  const translations = value && Array.isArray(value.translation) ? value.translation : [];
  if (!translations.length) return '';
  const english = translations.find((entry) => (
    /^en(?:-|$)/i.test(String(entry && entry.language || ''))
  ));
  const selected = english || translations[0];
  return selected && selected.text ? String(selected.text).trim() : '';
}

function loadMetadata(cacheDir, metadataFile = 'simcoe-linx.json') {
  const metadataPath = path.join(cacheDir, metadataFile);
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (
      parsed && parsed.trips && Object.keys(parsed.trips).length &&
      parsed.routes && Object.keys(parsed.routes).length &&
      (Array.isArray(parsed.barrie_route_ids) || Array.isArray(parsed.route_ids))
    ) {
      return parsed;
    }
    throw new Error('metadata contains no usable LINX routes or trips');
  } catch (err) {
    const metadataError = new Error(
      `Simcoe LINX static metadata unavailable at ${metadataPath}: ${err.message || err}`,
      { cause: err }
    );
    metadataError.code = 'SIMCOE_LINX_METADATA_UNAVAILABLE';
    throw metadataError;
  }
}

async function fetchFeed(url) {
  const response = await fetch(url, {
    timeout: 10_000,
    headers: {
      'Cache-Control': 'no-cache',
      'User-Agent': 'Barrie-Bus-Tracker/1.0',
    },
  });
  if (!response.ok) throw new Error(`GTFS-RT fetch failed: ${response.status}`);
  const buffer = await response.buffer();
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
}

async function fetchRawRealtime(options) {
  const vehiclesUrl = options.vehiclesUrl || DEFAULT_VEHICLES_URL;
  const tripUpdatesUrl = options.tripUpdatesUrl || DEFAULT_TRIP_UPDATES_URL;
  const alertsUrl = options.alertsUrl || DEFAULT_ALERTS_URL;
  const alertsEnabled = options.alertsEnabled !== false;
  const cacheKey = `${vehiclesUrl}|${tripUpdatesUrl}|${alertsEnabled ? alertsUrl : ''}`;
  const now = Date.now();
  const cached = rawRealtimeCaches.get(cacheKey);
  if (cached && now - cached.cachedAt < REALTIME_CACHE_MS) return cached.promise;
  const promise = Promise.all([
    fetchVehicles(vehiclesUrl),
    fetchFeed(tripUpdatesUrl).catch((err) => {
      console.warn('[simcoe-linx] Trip updates unavailable:', err.message || err);
      return null;
    }),
    alertsEnabled
      ? fetchFeed(alertsUrl).catch((err) => {
          console.warn('[simcoe-linx] Alerts unavailable:', err.message || err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  rawRealtimeCaches.set(cacheKey, { cachedAt: now, promise });
  try {
    return await promise;
  } catch (error) {
    rawRealtimeCaches.delete(cacheKey);
    throw error;
  }
}

function parseTripUpdates(feed, terminalStopIds, validTripIds) {
  const terminalIds = new Set((terminalStopIds || []).map(String));
  const allowedTrips = validTripIds instanceof Set ? validTripIds : new Set(validTripIds || []);
  const updates = {};
  (feed && Array.isArray(feed.entity) ? feed.entity : []).forEach((entity) => {
    const tripUpdate = entity && entity.tripUpdate;
    const tripId = tripUpdate && tripUpdate.trip && String(tripUpdate.trip.tripId || '');
    if (!tripId || !allowedTrips.has(tripId)) return;
    const terminalUpdate = (tripUpdate.stopTimeUpdate || []).find((stopUpdate) => (
      stopUpdate && terminalIds.has(String(stopUpdate.stopId || ''))
    ));
    if (!terminalUpdate) return;
    const arrivalEvent = terminalUpdate.arrival || terminalUpdate.departure || null;
    const departureEvent = terminalUpdate.departure || terminalUpdate.arrival || null;
    updates[tripId] = {
      stop_id: String(terminalUpdate.stopId || ''),
      stop_sequence: Number.isFinite(Number(terminalUpdate.stopSequence))
        ? Number(terminalUpdate.stopSequence)
        : null,
      arrival_time: readLong(arrivalEvent && arrivalEvent.time),
      departure_time: readLong(departureEvent && departureEvent.time),
      delay_seconds: departureEvent && Number.isFinite(Number(departureEvent.delay))
        ? Number(departureEvent.delay)
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
    alerts.push({
      id: String(entity.id || `simcoe-linx-alert-${alerts.length + 1}`),
      agency_id: 'simcoe-linx',
      agency_name: 'Simcoe County LINX',
      header: readTranslation(alert.headerText) || 'Simcoe LINX service alert',
      description: readTranslation(alert.descriptionText),
      cause: Number.isFinite(Number(alert.cause)) ? Number(alert.cause) : null,
      effect: Number.isFinite(Number(alert.effect)) ? Number(alert.effect) : null,
    });
  });
  return alerts;
}

function qualifyVehicle(vehicle, metadata, tripUpdates = {}) {
  if (!vehicle || !vehicle.trip_id) return null;
  const tripId = String(vehicle.trip_id);
  const trip = metadata.trips && metadata.trips[tripId];
  // The position endpoint is shared by many Ontario agencies and route IDs
  // collide. Exact Simcoe trip membership is the safe ownership boundary.
  if (!trip) return null;
  const sourceRouteId = String(trip.route_id || '');
  const reportedRouteId = String(vehicle.route_id || '');
  if (!reportedRouteId || reportedRouteId !== sourceRouteId) return null;
  const route = metadata.routes && metadata.routes[sourceRouteId] || {};
  const agency = metadata.agency || {};
  const terminalUpdate = tripUpdates[tripId] || null;
  const rawVehicleId = String(vehicle.id || tripId);

  const enriched = enrichTerminalProgress({
    ...vehicle,
    id: `simcoe-linx:${rawVehicleId}`,
    route_id: route.map_route_id || `LINX-${sourceRouteId}`,
    route_label: `LINX ${route.short_name || sourceRouteId}`,
    source_route_id: sourceRouteId,
    route_long_name: route.long_name || null,
    shape_id: trip.shape_id ? `LINX:${trip.shape_id}` : null,
    trip_headsign: trip.headsign || null,
    agency_id: agency.id || 'simcoe-linx',
    agency_name: agency.name || 'Simcoe County LINX',
    route_color: route.color || agency.color || '#006747',
    route_text_color: route.text_color || agency.text_color || '#FFFFFF',
    terminal_stop_id: terminalUpdate && terminalUpdate.stop_id || null,
    terminal_arrival_time: terminalUpdate && terminalUpdate.arrival_time || null,
    terminal_departure_time: terminalUpdate && terminalUpdate.departure_time || null,
    terminal_delay_seconds: terminalUpdate && terminalUpdate.delay_seconds,
  }, {
    terminalStopIds: metadata.terminal_stop_ids,
    terminalStops: Array.isArray(trip.terminal_stops) && trip.terminal_stops.length
      ? trip.terminal_stops
      : (terminalUpdate ? [{
          stop_id: terminalUpdate.stop_id,
          stop_sequence: terminalUpdate.stop_sequence,
        }] : []),
  });
  const platformByStop = PLATFORM_BY_EXTERNAL_STOP['simcoe-linx'] || {};
  return {
    ...enriched,
    platform: enriched.terminal_stop_id
      ? platformByStop[String(enriched.terminal_stop_id)] || null
      : null,
  };
}

async function fetchSimcoeLinxRealtime(options = {}) {
  if (options.enabled === false) {
    return {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      alerts: [],
      configured: false,
    };
  }
  const now = Date.now();
  const cacheKey = String(options.cacheKey || options.metadataFile || 'barrie');
  const cached = realtimeCaches.get(cacheKey);
  if (cached && now - cached.cachedAt < REALTIME_CACHE_MS) {
    return cached.value;
  }

  const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, '..', 'cache'));
  const metadata = loadMetadata(cacheDir, options.metadataFile);
  const validTripIds = new Set(Object.keys(metadata.trips || {}));
  const [vehiclePayload, tripFeed, alertsFeed] = await fetchRawRealtime(options);
  const tripUpdates = tripFeed
    ? parseTripUpdates(tripFeed, metadata.terminal_stop_ids, validTripIds)
    : {};
  const vehicles = (vehiclePayload.vehicles || [])
    .map((vehicle) => qualifyVehicle(vehicle, metadata, tripUpdates))
    .filter(Boolean);
  const value = {
    ...vehiclePayload,
    generated_at: Date.now(),
    vehicles,
    alerts: alertsFeed ? parseAlerts(alertsFeed) : [],
    configured: true,
    agency: metadata.agency,
  };
  realtimeCaches.set(cacheKey, { cachedAt: now, value });
  return value;
}

function resetSimcoeLinxCache() {
  realtimeCaches.clear();
  rawRealtimeCaches.clear();
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
  fetchSimcoeLinxRealtime,
  resetSimcoeLinxCache,
};

