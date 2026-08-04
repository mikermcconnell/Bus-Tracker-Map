const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const CACHE_MS = 5_000;
const cache = new Map();

function readNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value && typeof value.toNumber === 'function' ? value.toNumber() : value);
  return Number.isFinite(number) ? number : null;
}

function isRelationship(value, name, number) {
  return value === number || String(value || '').toUpperCase() === name;
}

function parseTripUpdates(feed, terminalStopIds) {
  const terminalIds = new Set((terminalStopIds || []).map(String));
  const updates = [];
  for (const entity of feed && Array.isArray(feed.entity) ? feed.entity : []) {
    const update = entity && entity.tripUpdate;
    const trip = update && update.trip;
    if (!update || !trip || !trip.tripId) continue;
    const canceled = isRelationship(trip.scheduleRelationship, 'CANCELED', 3);
    for (const stop of update.stopTimeUpdate || []) {
      const stopId = String(stop && stop.stopId || '');
      if (!terminalIds.has(stopId)) continue;
      const departure = stop.departure || stop.arrival || {};
      updates.push({
        trip_id: String(trip.tripId),
        route_id: trip.routeId ? String(trip.routeId) : null,
        start_date: trip.startDate ? String(trip.startDate) : null,
        stop_id: stopId,
        stop_sequence: readNumber(stop.stopSequence),
        departure_time: readNumber(departure.time),
        delay_seconds: readNumber(departure.delay),
        canceled,
        skipped: isRelationship(stop.scheduleRelationship, 'SKIPPED', 1),
      });
    }
  }
  return updates;
}

async function fetchTripUpdates(url, terminalStopIds, options = {}) {
  if (!url) throw new Error('Trip updates feed is not configured');
  const now = Number(options.now || Date.now());
  const cached = cache.get(url);
  if (cached && now - cached.fetched_at < CACHE_MS) return cached.value;
  const response = await fetch(url, {
    timeout: 10_000,
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Barrie-Bus-Tracker/1.0' },
  });
  if (!response.ok) throw new Error(`GTFS-RT fetch failed: ${response.status}`);
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(await response.buffer());
  const value = {
    fetched_at: now,
    feed_timestamp: readNumber(feed && feed.header && feed.header.timestamp),
    updates: parseTripUpdates(feed, terminalStopIds),
  };
  cache.set(url, { fetched_at: now, value });
  return value;
}

function resetTripUpdatesCache() {
  cache.clear();
}

module.exports = { fetchTripUpdates, parseTripUpdates, resetTripUpdatesCache };
