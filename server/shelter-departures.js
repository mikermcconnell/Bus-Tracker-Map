const fs = require('fs');
const path = require('path');
const { DEPARTURE_STOP_GROUPS } = require('../shared/departure-stop-groups');
const { isServiceActiveOnDate } = require('../shared/gtfs-service-calendar');
const { scheduledTimeToEpochSeconds } = require('./terminal-progress');

const SHELTER_TIME_ZONE = 'America/Toronto';
const MAX_DEPARTURES = 6;
const DEPARTURE_GRACE_SECONDS = 60;
const SERVICE_DAY_OFFSETS = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
const TRIP_CANCELED = 3;
const TRIP_DELETED = 6;
const STOP_SKIPPED = 1;
const STOP_NO_DATA = 2;

function emptyMetadata() {
  return {
    service_calendars: {},
    service_exceptions: {},
    stops: {},
    stop_ids_by_code: {},
    routes: {},
    trips: {},
    departures_by_stop: {},
  };
}

function loadShelterDepartureMetadata(cacheDir, fileName = 'barrie-departures.json') {
  const filePath = path.join(cacheDir, fileName);
  if (!fs.existsSync(filePath)) return emptyMetadata();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : emptyMetadata();
  } catch (err) {
    console.error('Failed to load shelter departure metadata:', err.message || err);
    return emptyMetadata();
  }
}

function parseShelterStopQuery(value) {
  const stop = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(stop) ? stop : '';
}

function parseShelterGroupQuery(value) {
  const group = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(group) ? group : '';
}

function resolveShelterStop(metadata, value) {
  const query = parseShelterStopQuery(value);
  if (!query) return null;
  const stops = metadata && metadata.stops || {};
  const codeIndex = metadata && metadata.stop_ids_by_code || {};
  const resolved = stops[query] ? query : codeIndex[query];
  const stopIds = (Array.isArray(resolved) ? resolved : [resolved])
    .map(String)
    .filter((stopId) => stops[stopId]);
  if (!stopIds.length) return null;
  const primary = stops[stopIds[0]];
  return {
    id: String(primary.id || stopIds[0]),
    ids: stopIds,
    code: String(primary.code || query),
    name: String(primary.name || `Stop ${query}`),
    is_group: false,
    stop_labels_by_id: Object.fromEntries(stopIds.map((stopId) => [
      stopId,
      `STOP ${String(stops[stopId].code || stopId)}`,
    ])),
  };
}

function resolveShelterGroup(metadata, value, groups = DEPARTURE_STOP_GROUPS) {
  const groupId = parseShelterGroupQuery(value);
  const definition = groupId && groups && groups[groupId];
  if (!definition || !Array.isArray(definition.stops) || !definition.stops.length) return null;

  const resolvedStops = definition.stops.map((configuredStop) => {
    const resolved = resolveShelterStop(metadata, configuredStop && configuredStop.code);
    if (!resolved) {
      return configuredStop && configuredStop.optional
        ? {
          code: String(configuredStop.code),
          ids: [],
          label: String(configuredStop.label || `STOP ${configuredStop.code}`),
          unavailable: true,
        }
        : null;
    }
    return {
      code: String(configuredStop.code),
      ids: resolved.ids,
      label: String(configuredStop.label || `STOP ${resolved.code}`),
      unavailable: false,
    };
  });
  if (resolvedStops.some((stop) => !stop)) return null;

  const ids = [];
  const stopLabelsById = {};
  resolvedStops.forEach((resolved) => {
    resolved.ids.forEach((stopId) => {
      if (!ids.includes(stopId)) ids.push(stopId);
      stopLabelsById[stopId] = resolved.label;
    });
  });

  return {
    id: String(definition.id || groupId),
    ids,
    code: null,
    name: String(definition.name || groupId),
    is_group: true,
    stop_codes: definition.stops.map((stop) => String(stop.code)),
    unavailable_stop_codes: resolvedStops
      .filter((stop) => stop.unavailable)
      .map((stop) => stop.code),
    stop_labels_by_id: stopLabelsById,
  };
}

function resolveShelterLocation(metadata, { stopQuery, groupQuery } = {}) {
  if (parseShelterGroupQuery(groupQuery)) return resolveShelterGroup(metadata, groupQuery);
  return resolveShelterStop(metadata, stopQuery);
}

function localServiceDateKeys(nowMs, timeZone = SHELTER_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDateAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );
  return SERVICE_DAY_OFFSETS.map((offset) => {
    const date = new Date(localDateAsUtc + offset * 86_400_000);
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('');
  });
}

function normalizeDestination(routeId, directionId, headsign) {
  const route = String(routeId || '').trim().toUpperCase();
  const direction = String(directionId === null || directionId === undefined ? '' : directionId);
  const configured = {
    '100': 'RED',
    '8A|0': 'RVH NORTHBOUND',
    '8A|1': 'YONGE SOUTHBOUND',
    '8B|0': 'CROSSTOWN NORTHBOUND',
    '8B|1': 'ESSA SOUTHBOUND',
  }[`${route}|${direction}`] || ({ '100': 'RED' }[route]);
  if (configured) return configured;
  const cleaned = String(headsign || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+to\s+/i)[0]
    .trim();
  return (cleaned || route || 'SERVICE').toUpperCase();
}

function findRealtimeStopUpdate(tripUpdate, candidate, realtimeServiceDates) {
  if (!tripUpdate || typeof tripUpdate !== 'object') return null;
  if (
    !tripUpdate.start_date &&
    realtimeServiceDates &&
    !realtimeServiceDates.has(candidate.service_date)
  ) {
    return null;
  }
  if (
    Number(tripUpdate.schedule_relationship) === TRIP_CANCELED ||
    Number(tripUpdate.schedule_relationship) === TRIP_DELETED
  ) {
    return { canceled: true };
  }
  if (tripUpdate.start_date && tripUpdate.start_date !== candidate.service_date) return null;
  const rows = (tripUpdate.stop_time_updates || [])
    .filter((row) => String(row && row.stop_id || '') === candidate.stop_id);
  if (!rows.length) return null;
  const exactSequence = rows.find((row) => (
    Number.isFinite(Number(candidate.stop_sequence)) &&
    Number(row.stop_sequence) === Number(candidate.stop_sequence)
  ));
  return exactSequence || rows[0];
}

function mergeRealtimeDeparture(candidate, tripUpdates, realtimeServiceDates) {
  const tripUpdate = tripUpdates && tripUpdates[candidate.trip_id];
  const stopUpdate = findRealtimeStopUpdate(tripUpdate, candidate, realtimeServiceDates);
  if (stopUpdate && stopUpdate.canceled) return null;
  if (!stopUpdate || Number(stopUpdate.schedule_relationship) === STOP_NO_DATA) {
    return { ...candidate, predicted_departure_time: null, effective_departure_time: candidate.scheduled_departure_time, source: 'scheduled' };
  }
  if (Number(stopUpdate.schedule_relationship) === STOP_SKIPPED) return null;
  const absoluteTime = Number(stopUpdate.departure_time || stopUpdate.arrival_time);
  const delay = Number.isFinite(Number(stopUpdate.departure_delay))
    ? Number(stopUpdate.departure_delay)
    : Number(stopUpdate.arrival_delay);
  const predicted = Number.isFinite(absoluteTime) && absoluteTime > 0
    ? absoluteTime
    : (Number.isFinite(delay) ? candidate.scheduled_departure_time + delay : null);
  if (
    predicted &&
    !tripUpdate.start_date &&
    Math.abs(predicted - candidate.scheduled_departure_time) > 12 * 60 * 60
  ) {
    return {
      ...candidate,
      predicted_departure_time: null,
      effective_departure_time: candidate.scheduled_departure_time,
      source: 'scheduled',
    };
  }
  return {
    ...candidate,
    predicted_departure_time: predicted,
    effective_departure_time: predicted || candidate.scheduled_departure_time,
    source: predicted ? 'realtime' : 'scheduled',
  };
}

function collectScheduledDepartures(metadata, stop, nowSeconds) {
  const departuresByStop = metadata && metadata.departures_by_stop || {};
  const trips = metadata && metadata.trips || {};
  const routes = metadata && metadata.routes || {};
  const serviceDates = localServiceDateKeys(nowSeconds * 1000, metadata.time_zone || SHELTER_TIME_ZONE);
  const scheduled = [];

  stop.ids.forEach((stopId) => {
    (departuresByStop[stopId] || []).forEach((entry) => {
      const [tripId, gtfsTime, stopSequence, stopHeadsign] = entry;
      const trip = trips[tripId];
      if (!trip) return;
      serviceDates.forEach((serviceDate) => {
        if (!isServiceActiveOnDate(metadata, trip.service_id, serviceDate)) return;
        const departureTime = scheduledTimeToEpochSeconds(
          serviceDate,
          gtfsTime,
          metadata.time_zone || SHELTER_TIME_ZONE
        );
        if (!Number.isFinite(departureTime) || departureTime < nowSeconds - DEPARTURE_GRACE_SECONDS) return;
        const route = routes[trip.route_id] || {};
        scheduled.push({
          trip_id: String(tripId),
          route_id: String(trip.route_id || ''),
          route_label: String(route.short_name || trip.route_id || ''),
          destination: normalizeDestination(
            trip.route_id,
            trip.direction_id,
            stopHeadsign || trip.headsign || route.long_name
          ),
          direction_id: trip.direction_id === undefined ? null : trip.direction_id,
          service_date: serviceDate,
          stop_id: stopId,
          stop_code: String(metadata.stops[stopId].code || stopId),
          stop_label: stop.stop_labels_by_id[stopId] || `STOP ${stopId}`,
          stop_sequence: stopSequence,
          scheduled_departure_time: departureTime,
        });
      });
    });
  });

  return scheduled;
}

function buildShelterDepartures({
  metadata = emptyMetadata(),
  stopQuery,
  groupQuery,
  tripUpdates = {},
  realtimeStatus = 'scheduled',
  feedTimestamp = null,
  now = Date.now(),
} = {}) {
  const stop = resolveShelterLocation(metadata, { stopQuery, groupQuery });
  if (!stop) return null;
  const parsedNow = now instanceof Date ? now.getTime() : Number(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const nowSeconds = nowMs / 1000;
  const realtimeServiceDates = new Set(
    localServiceDateKeys(nowMs, metadata.time_zone || SHELTER_TIME_ZONE).slice(0, 2)
  );
  const departures = collectScheduledDepartures(metadata, stop, nowSeconds)
    .map((candidate) => mergeRealtimeDeparture(candidate, tripUpdates, realtimeServiceDates))
    .filter((departure) => (
      departure && departure.effective_departure_time >= nowSeconds - DEPARTURE_GRACE_SECONDS
    ))
    .sort((left, right) => (
      left.effective_departure_time - right.effective_departure_time ||
      left.route_label.localeCompare(right.route_label)
    ))
    .filter((departure, index, rows) => rows.findIndex((candidate) => (
      candidate.trip_id === departure.trip_id &&
      candidate.service_date === departure.service_date &&
      candidate.stop_id === departure.stop_id &&
      candidate.stop_sequence === departure.stop_sequence
    )) === index)
    .slice(0, MAX_DEPARTURES)
    .map(({ stop_sequence: _stopSequence, ...departure }) => departure);

  return {
    generated_at: nowMs,
    feed_timestamp: Number(feedTimestamp) || null,
    realtime_status: realtimeStatus,
    stop: {
      id: stop.id,
      code: stop.code,
      name: stop.name,
      is_group: stop.is_group,
      stop_codes: stop.stop_codes || [stop.code],
      unavailable_stop_codes: stop.unavailable_stop_codes || [],
    },
    status: departures.length ? 'ok' : 'no_departures',
    departures,
  };
}

module.exports = {
  DEPARTURE_GRACE_SECONDS,
  DEPARTURE_STOP_GROUPS,
  MAX_DEPARTURES,
  SHELTER_TIME_ZONE,
  buildShelterDepartures,
  collectScheduledDepartures,
  findRealtimeStopUpdate,
  loadShelterDepartureMetadata,
  localServiceDateKeys,
  mergeRealtimeDeparture,
  normalizeDestination,
  parseShelterGroupQuery,
  parseShelterStopQuery,
  resolveShelterGroup,
  resolveShelterLocation,
  resolveShelterStop,
};
