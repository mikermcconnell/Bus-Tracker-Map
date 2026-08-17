/* server/vehicles.js */
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const LOG_LEVEL = (process.env.LOG_LEVEL || '').toLowerCase();
const verboseGtfsLogging = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';
const TRIP_UPDATE_CACHE_TTL_MS = 5_000;
const tripUpdateCache = new Map();

function readFeedTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value.toNumber ? value.toNumber() : value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readFeedNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value.toNumber ? value.toNumber() : value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseTripUpdates(feed) {
  const updates = {};

  (feed && Array.isArray(feed.entity) ? feed.entity : []).forEach((entity) => {
    const tripUpdate = entity && entity.tripUpdate;
    const tripDescriptor = tripUpdate && tripUpdate.trip;
    const tripId = tripDescriptor && tripDescriptor.tripId;
    if (!tripId) return;

    updates[String(tripId)] = {
      trip_id: String(tripId),
      route_id: tripDescriptor.routeId ? String(tripDescriptor.routeId) : null,
      start_date: tripDescriptor.startDate ? String(tripDescriptor.startDate) : null,
      schedule_relationship: readFeedNumber(tripDescriptor.scheduleRelationship),
      stop_time_updates: (tripUpdate.stopTimeUpdate || []).map((stopUpdate) => {
        const arrivalEvent = stopUpdate.arrival || null;
        const departureEvent = stopUpdate.departure || null;
        return {
          stop_id: String(stopUpdate.stopId || ''),
          stop_sequence: readFeedNumber(stopUpdate.stopSequence),
          schedule_relationship: readFeedNumber(stopUpdate.scheduleRelationship),
          arrival_time: readFeedTimestamp(arrivalEvent && arrivalEvent.time),
          arrival_delay: readFeedNumber(arrivalEvent && arrivalEvent.delay),
          departure_time: readFeedTimestamp(departureEvent && departureEvent.time),
          departure_delay: readFeedNumber(departureEvent && departureEvent.delay),
        };
      }).filter((stopUpdate) => stopUpdate.stop_id),
    };
  });

  return updates;
}

function parseTerminalTripUpdates(feed, terminalStopIds) {
  const terminalIds = new Set((terminalStopIds || []).map(String));
  const updates = {};

  Object.entries(parseTripUpdates(feed)).forEach(([tripId, tripUpdate]) => {
    const terminalUpdates = tripUpdate.stop_time_updates
      .filter((stopUpdate) => terminalIds.has(stopUpdate.stop_id))
      .map((stopUpdate) => ({
        stop_id: stopUpdate.stop_id,
        stop_sequence: stopUpdate.stop_sequence,
        arrival_time: stopUpdate.arrival_time || stopUpdate.departure_time,
        departure_time: stopUpdate.departure_time || stopUpdate.arrival_time,
      }));
    if (terminalUpdates.length) updates[tripId] = terminalUpdates;
  });

  return updates;
}

async function fetchTripUpdates(rtUrl, { cacheTtlMs = TRIP_UPDATE_CACHE_TTL_MS } = {}) {
  if (!rtUrl) return { feed_timestamp: null, trip_updates: {} };
  const now = Date.now();
  const cached = tripUpdateCache.get(rtUrl);
  if (cached && cached.value && cached.expires_at > now) return cached.value;
  if (cached && cached.in_flight) return cached.in_flight;

  const inFlight = (async () => {
    const res = await fetch(rtUrl, { timeout: 10_000 });
    if (!res.ok) throw new Error('GTFS-RT trip updates fetch failed: ' + res.status);
    const buffer = await res.buffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    return {
      feed_timestamp: readFeedTimestamp(feed.header && feed.header.timestamp),
      trip_updates: parseTripUpdates(feed),
    };
  })();

  tripUpdateCache.set(rtUrl, { in_flight: inFlight, expires_at: 0, value: null });
  try {
    const value = await inFlight;
    tripUpdateCache.set(rtUrl, {
      in_flight: null,
      expires_at: Date.now() + Math.max(0, Number(cacheTtlMs) || 0),
      value,
    });
    return value;
  } catch (err) {
    tripUpdateCache.delete(rtUrl);
    throw err;
  }
}

function selectTerminalTripUpdate(vehicle, tripUpdates) {
  const updates = vehicle && vehicle.trip_id && tripUpdates && tripUpdates[vehicle.trip_id];
  if (!Array.isArray(updates) || !updates.length) return null;
  const rawCurrentSequence = vehicle.current_stop_sequence;
  const currentSequence = Number(rawCurrentSequence);
  const hasCurrentSequence = rawCurrentSequence !== null &&
    rawCurrentSequence !== undefined && rawCurrentSequence !== '' &&
    Number.isFinite(currentSequence);
  const upcoming = updates.filter((update) => (
    !hasCurrentSequence ||
    !Number.isFinite(Number(update.stop_sequence)) ||
    Number(update.stop_sequence) >= currentSequence
  ));
  const candidates = upcoming.length ? upcoming : updates;
  return candidates.slice().sort((a, b) => {
    const aSequence = Number.isFinite(Number(a.stop_sequence)) ? Number(a.stop_sequence) : Infinity;
    const bSequence = Number.isFinite(Number(b.stop_sequence)) ? Number(b.stop_sequence) : Infinity;
    return aSequence - bSequence;
  })[0] || null;
}

async function fetchTerminalTripUpdates(rtUrl, terminalStopIds) {
  const result = await fetchTripUpdates(rtUrl);
  const terminalIds = new Set((terminalStopIds || []).map(String));
  const tripUpdates = {};
  Object.entries(result.trip_updates || {}).forEach(([tripId, tripUpdate]) => {
    const rows = (tripUpdate.stop_time_updates || [])
      .filter((stopUpdate) => terminalIds.has(stopUpdate.stop_id))
      .map((stopUpdate) => ({
        stop_id: stopUpdate.stop_id,
        stop_sequence: stopUpdate.stop_sequence,
        arrival_time: stopUpdate.arrival_time || stopUpdate.departure_time,
        departure_time: stopUpdate.departure_time || stopUpdate.arrival_time,
      }));
    if (rows.length) tripUpdates[tripId] = rows;
  });
  return {
    feed_timestamp: result.feed_timestamp,
    trip_updates: tripUpdates,
  };
}

async function fetchGtfsRtFeedMeta(rtUrl) {
  if (!rtUrl) {
    return {
      generated_at: Date.now(),
      header_timestamp: null,
      entity_count: 0,
      last_modified: null,
      etag: null,
      content_length: null,
    };
  }

  const started = Date.now();

  try {
    const res = await fetch(rtUrl, { timeout: 10_000 });
    if (!res.ok) throw new Error('GTFS-RT fetch failed: ' + res.status);
    const buffer = await res.buffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    const headerTimestamp = readFeedTimestamp(feed.header && feed.header.timestamp);
    const entityCount = Array.isArray(feed.entity) ? feed.entity.length : 0;
    const duration = Date.now() - started;

    if (verboseGtfsLogging) {
      console.debug(`[gtfs-rt] fetched meta for ${entityCount} entities in ${duration}ms`);
    }

    return {
      generated_at: Date.now(),
      header_timestamp: headerTimestamp,
      entity_count: entityCount,
      last_modified: res.headers.get('last-modified') || null,
      etag: res.headers.get('etag') || null,
      content_length: res.headers.get('content-length') || null,
    };
  } catch (err) {
    const duration = Date.now() - started;
    console.error(`[gtfs-rt] metadata fetch failed after ${duration}ms:`, err.message || err);
    throw err;
  }
}

async function fetchVehicles(rtUrl) {
  if (!rtUrl) {
    if (verboseGtfsLogging) {
      console.debug('[gtfs-rt] GTFS_RT_VEHICLES_URL not configured; returning empty vehicles list.');
    }
    return {
      generated_at: Date.now(),
      feed_timestamp: null,
      feed_last_modified: null,
      feed_etag: null,
      feed_content_length: null,
      vehicles: [],
    };
  }

  const started = Date.now();

  try {
    const res = await fetch(rtUrl, { timeout: 10_000 });
    if (!res.ok) throw new Error('GTFS-RT fetch failed: ' + res.status);
    const buffer = await res.buffer();

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    const feedTimestamp = readFeedTimestamp(feed.header && feed.header.timestamp);
    const vehicles = [];

    feed.entity.forEach((ent) => {
      if (!ent.vehicle || !ent.vehicle.position) return;
      const v = ent.vehicle;
      vehicles.push({
        id: (v.vehicle && (v.vehicle.id || v.vehicle.label)) || ent.id,
        route_id: (v.trip && v.trip.routeId) || null,
        trip_id: (v.trip && v.trip.tripId) || null,
        start_date: (v.trip && v.trip.startDate) || null,
        start_time: (v.trip && v.trip.startTime) || null,
        direction_id: (v.trip && Number.isFinite(Number(v.trip.directionId)) ? Number(v.trip.directionId) : null),
        lat: v.position.latitude,
        lon: v.position.longitude,
        bearing: v.position.bearing || null,
        speed: v.position.speed || null,
        stop_id: v.stopId || null,
        current_stop_sequence: Number.isFinite(Number(v.currentStopSequence))
          ? Number(v.currentStopSequence)
          : null,
        current_status: Number.isFinite(Number(v.currentStatus)) ? Number(v.currentStatus) : null,
        last_reported:
          (v.timestamp && Number(v.timestamp.toNumber ? v.timestamp.toNumber() : v.timestamp)) || null,
      });
    });

    const duration = Date.now() - started;
    if (verboseGtfsLogging) {
      console.debug(`[gtfs-rt] fetched ${vehicles.length} vehicles in ${duration}ms`);
    } else if (duration > 2000) {
      console.warn(`[gtfs-rt] slow fetch (${duration}ms) for ${vehicles.length} vehicles`);
    }

    return {
      generated_at: Date.now(),
      feed_timestamp: feedTimestamp,
      feed_last_modified: res.headers.get('last-modified') || null,
      feed_etag: res.headers.get('etag') || null,
      feed_content_length: res.headers.get('content-length') || null,
      vehicles,
    };
  } catch (err) {
    const duration = Date.now() - started;
    console.error(`[gtfs-rt] fetch failed after ${duration}ms:`, err.message || err);
    throw err;
  }
}

module.exports = {
  fetchTripUpdates,
  fetchVehicles,
  fetchGtfsRtFeedMeta,
  fetchTerminalTripUpdates,
  parseTripUpdates,
  parseTerminalTripUpdates,
  selectTerminalTripUpdate,
};
