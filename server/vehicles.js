/* server/vehicles.js */
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const LOG_LEVEL = (process.env.LOG_LEVEL || '').toLowerCase();
const verboseGtfsLogging = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';

async function fetchVehicles(rtUrl) {
  if (!rtUrl) {
    if (verboseGtfsLogging) {
      console.debug('[gtfs-rt] GTFS_RT_VEHICLES_URL not configured; returning empty vehicles list.');
    }
    return { generated_at: Date.now(), vehicles: [] };
  }

  const started = Date.now();

  try {
    const res = await fetch(rtUrl, { timeout: 10_000 });
    if (!res.ok) throw new Error('GTFS-RT fetch failed: ' + res.status);
    const buffer = await res.buffer();

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    const vehicles = [];

    feed.entity.forEach((ent) => {
      if (!ent.vehicle || !ent.vehicle.position) return;
      const v = ent.vehicle;
      vehicles.push({
        id: (v.vehicle && (v.vehicle.id || v.vehicle.label)) || ent.id,
        route_id: (v.trip && v.trip.routeId) || null,
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

    return { generated_at: Date.now(), vehicles };
  } catch (err) {
    const duration = Date.now() - started;
    console.error(`[gtfs-rt] fetch failed after ${duration}ms:`, err.message || err);
    throw err;
  }
}

module.exports = { fetchVehicles };
