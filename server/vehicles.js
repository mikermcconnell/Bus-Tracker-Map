/* server/vehicles.js */
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const LOG_LEVEL = (process.env.LOG_LEVEL || '').toLowerCase();
const verboseGtfsLogging = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';

function readFeedTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value.toNumber ? value.toNumber() : value);
  return Number.isFinite(numeric) ? numeric : null;
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
        direction_id: (v.trip && Number.isFinite(Number(v.trip.directionId)) ? Number(v.trip.directionId) : null),
        lat: v.position.latitude,
        lon: v.position.longitude,
        bearing: v.position.bearing || null,
        speed: v.position.speed || null,
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

module.exports = { fetchVehicles, fetchGtfsRtFeedMeta };
