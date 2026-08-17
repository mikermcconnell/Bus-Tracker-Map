const SHELTER_TIME_ZONE = 'America/Toronto';

function normalizeText(value) {
  return String(value || '').trim();
}

function buildStopCodeIndex(stops) {
  const index = {};
  Object.values(stops).forEach((stop) => {
    const code = normalizeText(stop && stop.code);
    const id = normalizeText(stop && stop.id);
    if (!code || !id) return;
    const existing = index[code];
    if (!existing) {
      index[code] = id;
    } else if (Array.isArray(existing)) {
      if (!existing.includes(id)) existing.push(id);
    } else if (existing !== id) {
      index[code] = [existing, id];
    }
  });
  return index;
}

function buildShelterDepartureMetadata({
  generatedAt,
  sourceUrl,
  feedInfo = {},
  serviceCalendarMetadata = {},
  stopsRows = [],
  routesRows = [],
  tripsRows = [],
  stopTimesRows = [],
} = {}) {
  const stops = {};
  (Array.isArray(stopsRows) ? stopsRows : []).forEach((row) => {
    const id = normalizeText(row && row.stop_id);
    if (!id || normalizeText(row && row.location_type) === '1') return;
    stops[id] = {
      id,
      code: normalizeText(row.stop_code) || id,
      name: normalizeText(row.stop_name) || `Stop ${normalizeText(row.stop_code) || id}`,
    };
  });

  const routes = {};
  (Array.isArray(routesRows) ? routesRows : []).forEach((row) => {
    const id = normalizeText(row && row.route_id);
    if (!id) return;
    routes[id] = {
      short_name: normalizeText(row.route_short_name) || id,
      long_name: normalizeText(row.route_long_name) || null,
    };
  });

  const tripsById = new Map();
  (Array.isArray(tripsRows) ? tripsRows : []).forEach((row) => {
    const id = normalizeText(row && row.trip_id);
    if (id) tripsById.set(id, row);
  });

  const departuresByStop = {};
  const usedTripIds = new Set();
  (Array.isArray(stopTimesRows) ? stopTimesRows : []).forEach((row) => {
    const stopId = normalizeText(row && row.stop_id);
    const tripId = normalizeText(row && row.trip_id);
    const departureTime = normalizeText(row && (row.departure_time || row.arrival_time));
    if (
      !stops[stopId] ||
      !tripsById.has(tripId) ||
      !departureTime ||
      normalizeText(row && row.pickup_type) === '1'
    ) {
      return;
    }
    if (!departuresByStop[stopId]) departuresByStop[stopId] = [];
    departuresByStop[stopId].push([
      tripId,
      departureTime,
      Number.isFinite(Number(row.stop_sequence)) ? Number(row.stop_sequence) : null,
      normalizeText(row.stop_headsign) || null,
    ]);
    usedTripIds.add(tripId);
  });

  const trips = {};
  Array.from(usedTripIds).sort().forEach((tripId) => {
    const row = tripsById.get(tripId) || {};
    trips[tripId] = {
      route_id: normalizeText(row.route_id),
      service_id: normalizeText(row.service_id),
      direction_id: row.direction_id === undefined || row.direction_id === null
        ? null
        : normalizeText(row.direction_id),
      headsign: normalizeText(row.trip_headsign) || null,
    };
  });

  Object.values(departuresByStop).forEach((departures) => {
    departures.sort((left, right) => (
      String(left[1]).localeCompare(String(right[1])) ||
      String(left[0]).localeCompare(String(right[0]))
    ));
  });

  return {
    generated_at: generatedAt || new Date().toISOString(),
    source_url: sourceUrl || null,
    time_zone: SHELTER_TIME_ZONE,
    feed_info: {
      feed_version: normalizeText(feedInfo.feed_version) || null,
      feed_start_date: normalizeText(feedInfo.feed_start_date) || null,
      feed_end_date: normalizeText(feedInfo.feed_end_date) || null,
    },
    service_calendars: serviceCalendarMetadata.service_calendars || {},
    service_exceptions: serviceCalendarMetadata.service_exceptions || {},
    stops,
    stop_ids_by_code: buildStopCodeIndex(stops),
    routes,
    trips,
    departures_by_stop: departuresByStop,
  };
}

module.exports = {
  SHELTER_TIME_ZONE,
  buildShelterDepartureMetadata,
  buildStopCodeIndex,
};
