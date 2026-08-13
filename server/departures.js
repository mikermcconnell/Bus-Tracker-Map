const fetch = require('node-fetch');
const { isServiceActiveOnDate } = require('../shared/gtfs-service-calendar');
const { scheduledTimeToEpochSeconds } = require('./terminal-progress');
const { BARRIE_PLATFORM_LABELS, cleanHeadsign } = require('./terminal-layout');
const { fetchTripUpdates } = require('./gtfs-trip-updates');

const TIME_ZONE = 'America/Toronto';
const HORIZON_HOURS = 1;
const GRACE_SECONDS = 60;
const GO_BUS_DESTINATION = 'Barrie / Newmarket';
const BARRIE_ALLANDALE_STOP_IDS = new Set(['9003', '9004', '9005', '9006', '9012', '9013']);
const LINX_ALLANDALE_STOP_ID = 'SCSTOP210';
const LINX_HANDOFF_MAX_GAP_SECONDS = 10 * 60;
const LINX_HANDOFF_EARLY_TOLERANCE_SECONDS = 60;

const AGENCIES = Object.freeze({
  barrie_transit: { id: 'barrie-transit', name: 'Barrie Transit', mode: 'bus' },
  ontario_northland: { id: 'ontario-northland', name: 'Ontario Northland', mode: 'coach' },
  go_transit: { id: 'go-transit', name: 'GO Transit', mode: 'bus' },
  simcoe_linx: { id: 'simcoe-linx', name: 'Simcoe LINX', mode: 'bus' },
});

function localDateKeys(nowMs) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const base = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  return [-1, 0, 1, 2].map((offset) => {
    const date = new Date(base + offset * 86400000);
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  });
}

function stopPlatform(metadata, stopId, fallback) {
  const stop = (metadata.terminal_stops || []).find((candidate) => String(candidate.id || candidate.stop_id) === stopId);
  return String(stop && stop.platform_code || fallback || '');
}

function northlandRouteNumber(sourceRoute, tripId) {
  const candidates = [sourceRoute, String(tripId || '').split(':')[0]];
  return candidates.find((value) => /^(?:101|102|201|202)$/.test(String(value))) || sourceRoute;
}

function routeDetails(agencyKey, metadata, trip, stopId, tripId) {
  const sourceRoute = String(trip.route_id || '');
  if (agencyKey === 'barrie_transit') {
    const platform = stopPlatform(metadata, stopId, stopId === '14' ? '14' : '');
    return { route_id: sourceRoute, route_label: sourceRoute, mode: 'bus', destination: BARRIE_PLATFORM_LABELS[`${platform}|${sourceRoute}`] || cleanHeadsign(trip.headsign, 'barrie-transit') };
  }
  if (agencyKey === 'ontario_northland') {
    const route = metadata.routes && metadata.routes[sourceRoute] || {};
    return { route_id: sourceRoute, route_label: northlandRouteNumber(sourceRoute, tripId), mode: 'coach', destination: cleanHeadsign(trip.headsign, 'ontario-northland') || route.long_name || 'Ontario Northland' };
  }
  if (agencyKey === 'simcoe_linx') {
    const sourceDestination = cleanHeadsign(trip.headsign, 'simcoe-linx');
    const destination = /Wasaga.*45(?:th)?\s+Street/i.test(sourceDestination)
      ? 'Wasaga Beach 45th St'
      : sourceDestination || 'Wasaga Beach';
    return { route_id: sourceRoute, route_label: '2', mode: 'bus', destination };
  }
  const train = stopId === 'AD' || /(?:^|-)BR(?:$|-)/i.test(sourceRoute);
  return { route_id: sourceRoute, route_label: train ? 'TRAIN' : '68', mode: train ? 'train' : 'bus', destination: train ? (cleanHeadsign(trip.headsign, 'go-transit') || 'Toronto / Union Station') : GO_BUS_DESTINATION };
}

function platformDetails(agencyKey, metadata, stopId) {
  if (agencyKey === 'barrie_transit') {
    const value = stopPlatform(metadata, stopId, stopId === '14' ? '14' : '');
    return { platform: value, platform_type: stopId === '14' ? 'stop' : 'platform' };
  }
  if (agencyKey === 'ontario_northland') return { platform: '8', platform_type: 'platform' };
  if (agencyKey === 'simcoe_linx') return { platform: '2', platform_type: 'platform' };
  return { platform: stopId === 'AD' ? '1' : '7', platform_type: 'platform' };
}

function isBoardableTerminalDeparture(agencyKey, stop) {
  const stopId = String(stop && stop.stop_id || '');
  if (agencyKey === 'barrie_transit' && BARRIE_ALLANDALE_STOP_IDS.has(stopId)) {
    // Allandale is a departure board: a trip ending here must not be shown.
    // Interlined 8A/8B vehicles are represented by a new outgoing GTFS trip,
    // whose route is the one passengers can board after the changeover.
    return stop && stop.is_departure === true;
  }
  return !stop || stop.is_departure !== false;
}

function collectScheduledDepartures(metadata, agencyKey, nowMs, horizonHours = HORIZON_HOURS) {
  const agency = AGENCIES[agencyKey];
  if (!agency || !metadata || !metadata.trips) return [];
  const start = nowMs / 1000 - GRACE_SECONDS;
  const end = nowMs / 1000 + horizonHours * 3600;
  const results = [];
  for (const [tripId, trip] of Object.entries(metadata.trips)) {
    for (const stop of trip.terminal_stops || []) {
      if (!isBoardableTerminalDeparture(agencyKey, stop)) continue;
      const stopId = String(stop.stop_id || '');
      for (const serviceDate of localDateKeys(nowMs)) {
        if (!isServiceActiveOnDate(metadata, trip.service_id, serviceDate)) continue;
        const scheduled = scheduledTimeToEpochSeconds(serviceDate, stop.departure_time || stop.arrival_time, TIME_ZONE);
        if (!Number.isFinite(scheduled) || scheduled < start || scheduled > end) continue;
        results.push({
          id: `${agency.id}:${tripId}:${stopId}:${serviceDate}`,
          agency_id: agency.id,
          agency_name: agency.name,
          ...routeDetails(agencyKey, metadata, trip, stopId, tripId),
          ...platformDetails(agencyKey, metadata, stopId),
          stop_id: stopId,
          trip_id: tripId,
          service_date: serviceDate,
          scheduled_departure_time: scheduled,
          expected_departure_time: scheduled,
          departure_source: 'scheduled',
          delay_seconds: 0,
        });
      }
    }
  }
  return results;
}

function freshness(feedTimestamp, nowMs, delayedAfterMs, offlineAfterMs) {
  if (!Number.isFinite(feedTimestamp) || feedTimestamp <= 0) return { realtime_status: 'offline', status_reason: 'missing_timestamp', latest_data_timestamp: null };
  const age = Math.max(0, nowMs - feedTimestamp * 1000);
  if (age > offlineAfterMs) return { realtime_status: 'offline', status_reason: 'stale_feed', latest_data_timestamp: feedTimestamp * 1000 };
  if (age > delayedAfterMs) return { realtime_status: 'delayed', status_reason: 'delayed_feed', latest_data_timestamp: feedTimestamp * 1000 };
  return { realtime_status: 'live', status_reason: 'fresh_feed', latest_data_timestamp: feedTimestamp * 1000 };
}

function mergeTripUpdates(scheduled, realtime, nowMs, delayedAfterMs, offlineAfterMs) {
  const state = freshness(realtime && realtime.feed_timestamp, nowMs, delayedAfterMs, offlineAfterMs);
  if (state.realtime_status !== 'live') return { departures: scheduled, source: { display_mode: 'scheduled', ...state } };
  const updates = realtime.updates || [];
  const usedUpdates = new Set();
  let realtimeCount = 0;
  const departures = scheduled.flatMap((departure) => {
    let updateIndex = updates.findIndex((candidate, index) => (
      !usedUpdates.has(index) &&
      candidate.trip_id === departure.trip_id &&
      candidate.stop_id === departure.stop_id &&
      (!candidate.start_date || candidate.start_date === departure.service_date)
    ));
    let predictionMatchType = updateIndex >= 0 ? 'exact' : null;
    // Some publishers rotate static trip IDs before their realtime producer does.
    // A route/stop/time match keeps predictions usable without crossing services.
    if (updateIndex < 0) {
      let nearestDifference = 20 * 60 + 1;
      updates.forEach((candidate, index) => {
        if (usedUpdates.has(index) || candidate.canceled || candidate.skipped) return;
        if (candidate.stop_id !== departure.stop_id || String(candidate.route_id || '') !== String(departure.route_id || '')) return;
        if (!Number.isFinite(candidate.departure_time)) return;
        const difference = Math.abs(candidate.departure_time - departure.scheduled_departure_time);
        if (difference < nearestDifference) {
          nearestDifference = difference;
          updateIndex = index;
          predictionMatchType = 'fallback';
        }
      });
    }
    const update = updateIndex >= 0 ? updates[updateIndex] : null;
    if (!update) return [departure];
    if (update.canceled || update.skipped) return [];
    usedUpdates.add(updateIndex);
    const expected = Number.isFinite(update.departure_time)
      ? update.departure_time
      : departure.scheduled_departure_time + (Number(update.delay_seconds) || 0);
    realtimeCount += 1;
    return [{
      ...departure,
      expected_departure_time: expected,
      departure_source: 'estimated',
      prediction_source: 'trip_update',
      prediction_trip_id: String(update.trip_id || ''),
      prediction_match_type: predictionMatchType,
      delay_seconds: Math.round(expected - departure.scheduled_departure_time),
    }];
  });
  return { departures, source: { display_mode: realtimeCount ? (realtimeCount === departures.length ? 'realtime' : 'mixed') : 'scheduled', ...state } };
}

function normalizeEpochMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1e12 ? numeric : numeric * 1000;
}

function serviceDateFromEpochSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(numeric * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function parsePrefixedGoTripId(value) {
  const match = String(value || '').match(/^(\d{8})-([^-]+)-(.+)$/);
  if (!match) return null;
  return { service_date: match[1], route_id: match[2], trip_id: match[3] };
}

function vehicleMatchesDepartureTrip(vehicle, departure) {
  const vehicleTripId = String(vehicle && vehicle.trip_id || '');
  const departureTripId = String(departure && departure.trip_id || '');
  if (vehicleTripId === departureTripId) {
    return !vehicle.start_date || !departure.service_date ||
      String(vehicle.start_date) === String(departure.service_date);
  }
  if (String(departure && departure.agency_id || '') !== 'go-transit') return false;

  const prefixedTrip = parsePrefixedGoTripId(vehicleTripId);
  const departureServiceDate = String(
    departure.service_date || serviceDateFromEpochSeconds(departure.scheduled_departure_time) || ''
  );
  return Boolean(
    prefixedTrip &&
    prefixedTrip.trip_id === departureTripId &&
    prefixedTrip.route_id === String(departure.route_id || '') &&
    prefixedTrip.service_date === departureServiceDate &&
    (!vehicle.start_date || String(vehicle.start_date) === departureServiceDate)
  );
}

function isFreshVehiclePosition(vehicle, nowMs, maxAgeMs) {
  const reportedAt = normalizeEpochMilliseconds(vehicle && vehicle.last_reported);
  if (!vehicle || vehicle.lat === null || vehicle.lat === undefined || vehicle.lon === null || vehicle.lon === undefined) return false;
  const lat = Number(vehicle && vehicle.lat);
  const lon = Number(vehicle && vehicle.lon);
  if (!Number.isFinite(reportedAt) || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  const ageMs = nowMs - reportedAt;
  return ageMs >= -60_000 && ageMs <= maxAgeMs;
}

function linxTerminalHandoffGap(vehicle, departure) {
  if (
    String(departure && departure.agency_id || '') !== 'simcoe-linx' ||
    String(departure && departure.route_id || '') !== '2' ||
    String(departure && departure.stop_id || '') !== LINX_ALLANDALE_STOP_ID ||
    String(vehicle && vehicle.agency_id || '') !== 'simcoe-linx' ||
    String(vehicle && (vehicle.source_route_id || vehicle.route_id) || '').replace(/^LINX-/, '') !== '2' ||
    String(vehicle && vehicle.terminal_stop_id || '') !== LINX_ALLANDALE_STOP_ID ||
    !['approaching', 'at_terminal'].includes(String(vehicle && vehicle.terminal_progress_status || '')) ||
    !/Barrie Allandale/i.test(String(vehicle && vehicle.trip_headsign || ''))
  ) return null;
  if (
    vehicle.start_date && departure.service_date &&
    String(vehicle.start_date) !== String(departure.service_date)
  ) return null;
  const incomingTerminalTime = Number(vehicle.terminal_departure_time);
  const outgoingDepartureTime = Number(departure.expected_departure_time);
  if (!Number.isFinite(incomingTerminalTime) || !Number.isFinite(outgoingDepartureTime)) return null;
  const gap = outgoingDepartureTime - incomingTerminalTime;
  return gap >= -LINX_HANDOFF_EARLY_TOLERANCE_SECONDS && gap <= LINX_HANDOFF_MAX_GAP_SECONDS
    ? Math.abs(gap)
    : null;
}

function findLinxTerminalHandoffVehicle(vehicles, departure, nowMs, maxAgeMs) {
  const candidates = vehicles
    .filter((vehicle) => (
      isFreshVehiclePosition(vehicle, nowMs, maxAgeMs) &&
      linxTerminalHandoffGap(vehicle, departure) !== null
    ))
    .sort((left, right) => (
      linxTerminalHandoffGap(left, departure) - linxTerminalHandoffGap(right, departure)
    ));
  // The static LINX feed publishes no block_id. Fail closed when more than one
  // inbound vehicle could plausibly continue as this outbound departure.
  return candidates.length === 1 ? candidates[0] : null;
}

function applyVehicleEvidence(departures, vehiclePayload, nowMs, maxAgeMs) {
  const vehicles = Array.isArray(vehiclePayload && vehiclePayload.vehicles)
    ? vehiclePayload.vehicles
    : [];
  return departures.map((departure) => {
    const hasPrediction = (
      departure.departure_source === 'estimated' ||
      departure.departure_source === 'realtime'
    ) && Number.isFinite(Number(departure.expected_departure_time));
    if (!hasPrediction) return departure;

    const exactPrediction = (
      departure.prediction_match_type === 'exact' &&
      String(departure.prediction_trip_id || '') === String(departure.trip_id || '')
    );
    const exactTripVehicle = exactPrediction
      ? vehicles.find((vehicle) => (
        String(vehicle.agency_id || '') === String(departure.agency_id || '') &&
        vehicleMatchesDepartureTrip(vehicle, departure) &&
        isFreshVehiclePosition(vehicle, nowMs, maxAgeMs)
      ))
      : null;
    const handoffVehicle = exactPrediction && !exactTripVehicle
      ? findLinxTerminalHandoffVehicle(vehicles, departure, nowMs, maxAgeMs)
      : null;
    const matchingVehicle = exactTripVehicle || handoffVehicle;

    const barrieExactPrediction = (
      String(departure.agency_id || '') === 'barrie-transit' &&
      exactPrediction
    );

    if (!matchingVehicle) {
      return {
        ...departure,
        departure_source: barrieExactPrediction ? 'realtime' : 'estimated',
        live_evidence: barrieExactPrediction ? 'trip_update' : null,
        live_vehicle_id: null,
        live_vehicle_last_reported: null,
      };
    }

    return {
      ...departure,
      departure_source: 'realtime',
      live_evidence: handoffVehicle
        ? 'trip_update_and_terminal_handoff_vehicle'
        : 'trip_update_and_vehicle',
      live_vehicle_id: String(matchingVehicle.id || ''),
      live_vehicle_last_reported: Number(matchingVehicle.last_reported),
    };
  });
}

function readGoTime(value) {
  if (Number.isFinite(Number(value))) {
    const numeric = Number(value);
    return numeric > 1e12 ? Math.floor(numeric / 1000) : numeric;
  }
  const dotNet = String(value || '').match(/^\/Date\((\d+)/);
  if (dotNet) return Math.floor(Number(dotNet[1]) / 1000);
  const local = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2}):(\d{2})/);
  if (local && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || ''))) {
    return scheduledTimeToEpochSeconds(
      `${local[1]}${local[2]}${local[3]}`,
      `${local[4]}:${local[5]}:${local[6]}`,
      TIME_ZONE
    );
  }
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function parseGoNextService(payload, stopCode, nowMs) {
  const root = payload && (payload.NextService || payload.nextService || payload);
  const services = root && (root.Lines || root.lines || root.Services || root.services) || [];
  const rows = Array.isArray(services) ? services : services && services.Line || [];
  return (Array.isArray(rows) ? rows : [rows]).flatMap((row, index) => {
    const time = readGoTime(row && (row.ComputedDepartureTime || row.AdjustedDepartureTime || row.ScheduledDepartureTime || row.DepartureTime));
    if (!Number.isFinite(time)) return [];
    const train = stopCode === 'AD';
    return [{
      id: `go-transit:next-service:${stopCode}:${row.TripNumber || row.TripId || index}:${time}`,
      agency_id: 'go-transit', agency_name: 'GO Transit', mode: train ? 'train' : 'bus',
      route_id: String(row.LineCode || row.RouteNumber || (train ? 'BR' : '68')),
      route_label: train ? 'TRAIN' : String(row.LineCode || row.RouteNumber || '68').replace(/[^0-9].*$/, '') || '68',
      destination: train ? String(row.Destination || row.TripName || 'Toronto / Union Station') : GO_BUS_DESTINATION,
      platform: String(row.Platform || (train ? '1' : '7')), platform_type: 'platform', stop_id: stopCode,
      trip_id: String(row.TripNumber || row.TripId || ''),
      service_date: serviceDateFromEpochSeconds(readGoTime(row.ScheduledDepartureTime || row.DepartureTime) || time),
      scheduled_departure_time: readGoTime(row.ScheduledDepartureTime || row.DepartureTime) || time,
      expected_departure_time: time, departure_source: 'estimated',
      prediction_source: 'go_next_service', prediction_trip_id: String(row.TripNumber || row.TripId || ''),
      prediction_match_type: 'exact',
      delay_seconds: 0,
    }];
  }).filter((row) => row.expected_departure_time >= nowMs / 1000 - GRACE_SECONDS);
}

async function fetchGoNextServices({ apiBase, apiKey, nowMs }) {
  if (!apiKey) throw new Error('GO API key is not configured');
  const results = await Promise.all(['08049', 'AD'].map(async (stopCode) => {
    const endpoint = `${String(apiBase).replace(/\/$/, '')}/Stop/NextService/${stopCode}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, { timeout: 10_000, headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`GO NextService failed: ${response.status}`);
    const payload = await response.json();
    return { payload, stopCode };
  }));
  const timestampValues = results.map(({ payload }) => readGoTime(payload && (payload.Metadata && payload.Metadata.TimeStamp || payload.TimeStamp))).filter(Number.isFinite);
  return { feed_timestamp: timestampValues.length ? Math.max(...timestampValues) : Math.floor(nowMs / 1000), departures: results.flatMap(({ payload, stopCode }) => parseGoNextService(payload, stopCode, nowMs)) };
}

function unavailableSource(reason) {
  return { display_mode: 'scheduled', realtime_status: 'offline', status_reason: reason, latest_data_timestamp: null };
}

function selectScheduledDepartures(departures, nowMs, limit, horizonHours = HORIZON_HOURS) {
  const start = nowMs / 1000;
  const end = nowMs / 1000 + horizonHours * 3600;
  const seenServices = new Set();
  return departures
    .filter((row) => {
      const hasPrediction = (
        row.departure_source === 'estimated' ||
        row.departure_source === 'realtime'
      ) && Number.isFinite(Number(row.expected_departure_time));
      if (row.scheduled_departure_time > end) return false;
      return hasPrediction
        ? Number(row.expected_departure_time) >= start
        : row.scheduled_departure_time >= start;
    })
    .sort((a, b) => (
      a.scheduled_departure_time - b.scheduled_departure_time ||
      Number(a.platform) - Number(b.platform) ||
      String(a.route_label || '').localeCompare(String(b.route_label || '')) ||
      a.id.localeCompare(b.id)
    ))
    .filter((row) => {
      const serviceKey = [row.agency_id, row.route_label, row.destination, row.platform]
        .map((value) => String(value || '').trim().toUpperCase())
        .join('|');
      if (seenServices.has(serviceKey)) return false;
      seenServices.add(serviceKey);
      return true;
    })
    .slice(0, limit);
}

function createDeparturesService(options = {}) {
  const metadata = options.metadata || {};
  const delayedAfterMs = options.delayedAfterMs || 120000;
  const offlineAfterMs = options.offlineAfterMs || 900000;
  return async function getDepartures({ limit = 12, now = Date.now() } = {}) {
    const nowMs = Number(now);
    const schedule = {};
    for (const key of Object.keys(AGENCIES)) schedule[key] = collectScheduledDepartures(metadata[key], key, nowMs);
    if (!Object.values(metadata).some((value) => value && value.trips && Object.keys(value.trips).length)) {
      const error = new Error('Departure schedule metadata is unavailable'); error.statusCode = 503; throw error;
    }
    const realtimePromises = {
      barrie_transit: options.urls && options.urls.barrie ? fetchTripUpdates(options.urls.barrie, metadata.barrie_transit && metadata.barrie_transit.terminal_stop_ids, { now: nowMs }) : Promise.reject(new Error('not_configured')),
      ontario_northland: options.urls && options.urls.ontarioNorthland ? fetchTripUpdates(options.urls.ontarioNorthland, metadata.ontario_northland && metadata.ontario_northland.barrie_stop_ids, { now: nowMs }) : Promise.reject(new Error('not_configured')),
      simcoe_linx: options.urls && options.urls.linx ? fetchTripUpdates(options.urls.linx, metadata.simcoe_linx && metadata.simcoe_linx.terminal_stop_ids, { now: nowMs }) : Promise.reject(new Error('not_configured')),
      go_transit: fetchGoNextServices({ apiBase: options.goApiBase, apiKey: options.goApiKey, nowMs }),
    };
    const vehiclePayloadPromise = typeof options.fetchVehiclePayload === 'function'
      ? Promise.resolve().then(() => options.fetchVehiclePayload())
      : Promise.resolve({ vehicles: [] });
    const keys = Object.keys(realtimePromises);
    const settled = await Promise.allSettled(keys.map((key) => realtimePromises[key]));
    const sources = {};
    let combined = [];
    settled.forEach((result, index) => {
      const key = keys[index];
      if (result.status === 'rejected') {
        sources[key] = unavailableSource(result.reason && result.reason.message === 'not_configured' ? 'feed_not_configured' : 'fetch_failed');
        combined = combined.concat(schedule[key]);
        return;
      }
      if (key === 'go_transit') {
        const state = freshness(result.value.feed_timestamp, nowMs, delayedAfterMs, offlineAfterMs);
        if (state.realtime_status === 'live' && result.value.departures.length) {
          combined = combined.concat(result.value.departures);
          sources[key] = { display_mode: 'realtime', ...state };
        } else {
          combined = combined.concat(schedule[key]);
          sources[key] = { display_mode: 'scheduled', ...state };
        }
      } else {
        const merged = mergeTripUpdates(schedule[key], result.value, nowMs, delayedAfterMs, offlineAfterMs);
        combined = combined.concat(merged.departures);
        sources[key] = merged.source;
      }
    });
    const vehicleResult = await Promise.allSettled([vehiclePayloadPromise]);
    const vehiclePayload = vehicleResult[0].status === 'fulfilled'
      ? vehicleResult[0].value
      : { vehicles: [] };
    const classified = applyVehicleEvidence(
      combined,
      vehiclePayload,
      nowMs,
      options.vehicleLiveMaxAgeMs || delayedAfterMs
    );
    const departures = selectScheduledDepartures(classified, nowMs, limit);
    for (const [key, agency] of Object.entries(AGENCIES)) {
      const agencyRows = departures.filter((row) => row.agency_id === agency.id);
      sources[key].live_departure_count = agencyRows.filter((row) => row.departure_source === 'realtime').length;
      sources[key].estimated_departure_count = agencyRows.filter((row) => row.departure_source === 'estimated').length;
    }
    return { generated_at: nowMs, time_zone: TIME_ZONE, horizon_hours: HORIZON_HOURS, departures, sources };
  };
}

module.exports = {
  applyVehicleEvidence,
  collectScheduledDepartures,
  createDeparturesService,
  freshness,
  isBoardableTerminalDeparture,
  isFreshVehiclePosition,
  mergeTripUpdates,
  parsePrefixedGoTripId,
  parseGoNextService,
  readGoTime,
  selectScheduledDepartures,
  vehicleMatchesDepartureTrip,
};
