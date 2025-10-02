/* server/vehicles.js */
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

async function fetchVehicles(rtUrl) {
  if (!rtUrl) {
    // No live feed configured; return empty (frontend handles gracefully)
    return { generated_at: Date.now(), vehicles: [] };
  }

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

  return { generated_at: Date.now(), vehicles };
}

module.exports = { fetchVehicles };
