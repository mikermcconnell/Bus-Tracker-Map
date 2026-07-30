const PLATFORM_BY_EXTERNAL_STOP = Object.freeze({
  'ontario-northland': Object.freeze({
    '315': '8',
  }),
  'go-transit': Object.freeze({
    '08049': '7',
    AD: '1',
  }),
});

const BARRIE_PLATFORM_LABELS = Object.freeze({
  '3|8A': 'Yonge Southbound',
  '4|8B': 'Essa Southbound',
  '5|8A': 'RVH Northbound',
  '6|7A': 'Grove',
  '6|7B': 'Bear Creek',
  '12|8B': 'Crosstown Northbound',
  '13|12A': 'Georgian Mall',
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
      const platform = String(stop && stop.platform_code || '');
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
  return {
    route_id: sourceRouteId,
    route_label: sourceRouteId,
    source_route_id: sourceRouteId,
    mode: 'bus',
  };
}

function collectAssignments(metadata, agencyId, agencyName) {
  const platformByStop = agencyId === 'barrie-transit'
    ? readStopPlatformMap(metadata)
    : PLATFORM_BY_EXTERNAL_STOP[agencyId] || {};
  const assignments = [];
  const seen = new Set();

  Object.values(metadata && metadata.trips || {}).forEach((trip) => {
    (Array.isArray(trip && trip.terminal_stops) ? trip.terminal_stops : []).forEach((stop) => {
      const stopId = String(stop && stop.stop_id || '');
      const platform = String(platformByStop[stopId] || '');
      if (!platform) return;
      const route = normalizeRoute(agencyId, trip, stopId);
      const key = [platform, agencyId, route.route_id].join('|');
      if (seen.has(key)) return;
      seen.add(key);

      const configuredLabel = BARRIE_PLATFORM_LABELS[`${platform}|${route.route_id}`];
      assignments.push({
        platform,
        stop_id: stopId,
        agency_id: agencyId,
        agency_name: agencyName,
        ...route,
        destination: configuredLabel || route.destination || cleanHeadsign(trip.headsign, agencyId),
      });
    });
  });

  return assignments;
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
} = {}) {
  const metadataList = [barrie, ontarioNorthland, goTransit];
  const assignments = []
    .concat(collectAssignments(barrie, 'barrie-transit', 'Barrie Transit'))
    .concat(collectAssignments(ontarioNorthland, 'ontario-northland', 'Ontario Northland'))
    .concat(collectAssignments(goTransit, 'go-transit', 'GO Transit'))
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
};
