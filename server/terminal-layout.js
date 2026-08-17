const PLATFORM_BY_EXTERNAL_STOP = Object.freeze({
  'ontario-northland': Object.freeze({
    '315': '8',
  }),
  'go-transit': Object.freeze({
    '08049': '7',
    AD: '1',
  }),
  // Operational override: the published LINX GTFS identifies the Allandale
  // stop but does not publish a platform_code. Reconfirm this assignment with
  // terminal operations whenever the physical bay plan changes.
  'simcoe-linx': Object.freeze({
    SCSTOP210: '2',
  }),
});

const { barriePlatformForStop } = require('./allandale-platforms');

const BARRIE_PLATFORM_LABELS = Object.freeze({
  '3|8A': 'Yonge Southbound',
  '4|8B': 'Essa Southbound',
  '5|8A': 'RVH Northbound',
  '6|7A': 'Grove',
  '6|7B': 'Bear Creek',
  '12|8B': 'Crosstown Northbound',
  '13|12A': 'Georgian Mall',
  '14|12B': 'Barrie South GO',
});

function cleanHeadsign(value, agencyId) {
  let label = String(value || '').trim();
  if (!label) return '';
  if (agencyId === 'go-transit') {
    label = label.replace(/^[A-Z0-9]+(?:[A-Z])?\s*-\s*/i, '');
  }
  return label.replace(/\s+/g, ' ');
}

function readStopPlatformMap(metadata) {
  const result = Object.create(null);
  (Array.isArray(metadata && metadata.terminal_stops) ? metadata.terminal_stops : [])
    .forEach((stop) => {
      const id = String(stop && (stop.id || stop.stop_id) || '');
      const platform = String(stop && stop.platform_code || barriePlatformForStop(id));
      if (id && platform) result[id] = platform;
    });
  return result;
}

function normalizeRoute(agencyId, trip, stopId) {
  const sourceRouteId = String(trip && trip.route_id || '');
  if (agencyId === 'go-transit') {
    const train = stopId === 'AD' || /(?:^|-)BR(?:$|-)/i.test(sourceRouteId);
    return {
      route_id: train ? 'GO-TRAIN' : 'GO-BUS',
      route_label: train ? 'TRAIN' : '68',
      source_route_id: sourceRouteId,
      mode: train ? 'train' : 'bus',
      destination: train ? 'Toronto / Union Station' : 'Aurora / East Gwillimbury',
    };
  }
  if (agencyId === 'ontario-northland') {
    return {
      route_id: 'ONTC',
      route_label: 'ON',
      source_route_id: sourceRouteId,
      mode: 'coach',
      destination: 'Ontario Northland',
    };
  }
  if (agencyId === 'simcoe-linx') {
    return {
      route_id: `LINX-${sourceRouteId}`,
      route_label: sourceRouteId,
      source_route_id: sourceRouteId,
      mode: 'bus',
      destination: sourceRouteId === '2' ? 'Wasaga Beach' : cleanHeadsign(trip.headsign, agencyId),
    };
  }
  return {
    route_id: sourceRouteId,
    route_label: sourceRouteId,
    source_route_id: sourceRouteId,
    mode: 'bus',
  };
}

function localServiceDateKeys(nowMs, timeZone = TERMINAL_TIME_ZONE) {
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

  return NEXT_DEPARTURE_DAY_OFFSETS.map((offset) => {
    const date = new Date(localDateAsUtc + offset * 24 * 60 * 60 * 1000);
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('');
  });
}

function nextDepartureForStop(metadata, trip, stop, nowSeconds, serviceDateKeys) {
  const departureTime = stop && (stop.departure_time || stop.arrival_time);
  if (!departureTime) return null;
  let nextDeparture = null;
  serviceDateKeys.forEach((serviceDate) => {
    if (!isServiceActiveOnDate(metadata, trip && trip.service_id, serviceDate)) return;
    const candidate = scheduledTimeToEpochSeconds(
      serviceDate,
      departureTime,
      TERMINAL_TIME_ZONE
    );
    if (!Number.isFinite(candidate) || candidate < nowSeconds) return;
    if (nextDeparture === null || candidate < nextDeparture) nextDeparture = candidate;
  });
  return nextDeparture;
}

function collectAssignments(metadata, agencyId, agencyName, nowSeconds) {
  const platformByStop = agencyId === 'barrie-transit'
    ? readStopPlatformMap(metadata)
    : PLATFORM_BY_EXTERNAL_STOP[agencyId] || {};
  const assignmentsByKey = new Map();
  const serviceDateKeys = localServiceDateKeys(nowSeconds * 1000);

  Object.values(metadata && metadata.trips || {}).forEach((trip) => {
    (Array.isArray(trip && trip.terminal_stops) ? trip.terminal_stops : []).forEach((stop) => {
      const stopId = String(stop && stop.stop_id || '');
      const platform = String(platformByStop[stopId] || '');
      if (!platform) return;
      const route = normalizeRoute(agencyId, trip, stopId);
      const key = [platform, agencyId, route.route_id].join('|');
      let assignment = assignmentsByKey.get(key);
      if (!assignment) {
        const configuredLabel = BARRIE_PLATFORM_LABELS[`${platform}|${route.route_id}`];
        assignment = {
          platform,
          stop_id: stopId,
          agency_id: agencyId,
          agency_name: agencyName,
          ...route,
          destination: configuredLabel || route.destination || cleanHeadsign(trip.headsign, agencyId),
          next_departure_time: null,
          next_departure_source: null,
        };
        assignmentsByKey.set(key, assignment);
      }

      const departure = nextDepartureForStop(
        metadata,
        trip,
        stop,
        nowSeconds,
        serviceDateKeys
      );
      if (
        departure !== null &&
        (assignment.next_departure_time === null || departure < assignment.next_departure_time)
      ) {
        assignment.next_departure_time = departure;
        assignment.next_departure_source = 'static';
      }
    });
  });

  return Array.from(assignmentsByKey.values());
}

function newestGeneratedAt(metadataList) {
  const dates = metadataList
    .map((metadata) => Date.parse(metadata && metadata.generated_at || ''))
    .filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

function buildTerminalLayout({
  barrie = {},
  ontarioNorthland = {},
  goTransit = {},
  simcoeLinx = {},
  now = Date.now(),
} = {}) {
  const parsedNow = now instanceof Date ? now.getTime() : Number(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.parse(now);
  const nowSeconds = Number.isFinite(nowMs) ? nowMs / 1000 : Date.now() / 1000;
  const metadataList = [barrie, ontarioNorthland, goTransit, simcoeLinx];
  const assignments = []
    .concat(collectAssignments(barrie, 'barrie-transit', 'Barrie Transit', nowSeconds))
    .concat(collectAssignments(ontarioNorthland, 'ontario-northland', 'Ontario Northland', nowSeconds))
    .concat(collectAssignments(goTransit, 'go-transit', 'GO Transit', nowSeconds))
    .concat(collectAssignments(simcoeLinx, 'simcoe-linx', 'Simcoe County LINX', nowSeconds))
    .sort((a, b) => (
      Number(a.platform) - Number(b.platform) ||
      a.agency_id.localeCompare(b.agency_id) ||
      a.route_label.localeCompare(b.route_label)
    ));

  return {
    generated_at: newestGeneratedAt(metadataList),
    assignments,
    sources: metadataList
      .filter((metadata) => metadata && metadata.source_url)
      .map((metadata) => ({
        source_url: metadata.source_url,
        generated_at: metadata.generated_at || null,
      })),
  };
}

module.exports = {
  BARRIE_PLATFORM_LABELS,
  PLATFORM_BY_EXTERNAL_STOP,
  buildTerminalLayout,
  cleanHeadsign,
  localServiceDateKeys,
};
const { scheduledTimeToEpochSeconds } = require('./terminal-progress');
const { isServiceActiveOnDate } = require('../shared/gtfs-service-calendar');

const TERMINAL_TIME_ZONE = 'America/Toronto';
const NEXT_DEPARTURE_DAY_OFFSETS = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
