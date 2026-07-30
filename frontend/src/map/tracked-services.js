const SERVICE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'barrie-transit',
    sourceKey: 'barrie_transit',
    agencyId: 'barrie-transit',
    agencyLabel: 'Barrie Transit',
    serviceType: 'Local Buses',
    badgeLabel: 'BT',
    color: '#004e80',
    textColor: '#ffffff'
  }),
  Object.freeze({
    id: 'go-bus',
    sourceKey: 'go_transit',
    agencyId: 'go-transit',
    mode: 'bus',
    agencyLabel: 'GO Transit',
    serviceType: 'Regional Buses',
    badgeLabel: 'GO BUS',
    color: '#007a33',
    textColor: '#ffffff'
  }),
  Object.freeze({
    id: 'go-train',
    sourceKey: 'go_transit',
    agencyId: 'go-transit',
    mode: 'train',
    agencyLabel: 'GO Transit',
    serviceType: 'Barrie Line Train',
    badgeLabel: 'GO TRAIN',
    color: '#007a33',
    textColor: '#ffffff'
  }),
  Object.freeze({
    id: 'ontario-northland',
    sourceKey: 'ontario_northland',
    agencyId: 'ontario-northland',
    agencyLabel: 'Ontario Northland',
    serviceType: 'Regional Buses',
    badgeLabel: 'ON',
    color: '#00214d',
    textColor: '#e6b012'
  }),
  Object.freeze({
    id: 'simcoe-linx',
    sourceKey: null,
    agencyId: 'simcoe-linx',
    agencyLabel: 'Simcoe County LINX',
    serviceType: 'Regional Buses',
    badgeLabel: 'LINX',
    color: '#005596',
    textColor: '#ffffff',
    tracked: false
  })
]);

const AGENCY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'barrie-transit',
    agencyLabel: 'Barrie Transit',
    logoSrc: './assets/agency-barrie-transit.png',
    logoAlt: 'Barrie Transit',
    serviceIds: Object.freeze(['barrie-transit'])
  }),
  Object.freeze({
    id: 'go-transit',
    agencyLabel: 'GO Transit',
    logoSrc: './assets/agency-go-transit.svg',
    logoAlt: 'GO Transit',
    serviceIds: Object.freeze(['go-bus', 'go-train'])
  }),
  Object.freeze({
    id: 'ontario-northland',
    agencyLabel: 'Ontario Northland',
    logoSrc: './assets/agency-ontario-northland.png',
    logoAlt: 'Ontario Northland',
    serviceIds: Object.freeze(['ontario-northland'])
  }),
  Object.freeze({
    id: 'simcoe-linx',
    agencyLabel: 'Simcoe County LINX',
    logoSrc: './assets/agency-simcoe-linx.png',
    logoAlt: 'Simcoe County LINX',
    serviceIds: Object.freeze(['simcoe-linx'])
  })
]);

function normalizeStatus(source) {
  if (!source) return 'unavailable';
  const status = String(source.feed_status || '').trim().toLowerCase();
  if (status === 'live' || status === 'empty' || status === 'delayed' || status === 'offline') {
    return status;
  }
  return 'unavailable';
}

function matchesDefinition(vehicle, definition) {
  if (!vehicle || vehicle.agency_id !== definition.agencyId) return false;
  if (!definition.mode) return true;
  const mode = String(vehicle.route_mode || 'bus').trim().toLowerCase();
  return mode === definition.mode;
}

export function formatTrackedServiceStatus(entry) {
  const status = entry && entry.status;
  const trackedCount = Math.max(0, Number(entry && entry.trackedCount) || 0);
  const onMapCount = Math.max(0, Number(entry && entry.onMapCount) || 0);

  if (status === 'delayed') {
    return `Delayed · ${onMapCount} last known on map`;
  }
  if (status === 'offline') return 'Offline';
  if (status === 'not-tracked') return 'Not tracked';
  if (status === 'unavailable') return 'Unavailable';
  if (trackedCount !== onMapCount) {
    return `${trackedCount} tracked · ${onMapCount} on map`;
  }
  return `${onMapCount} live on map`;
}

export function buildTrackedServiceSummaries({ vehicles, sources, isOnMap } = {}) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  const sourceMap = sources && typeof sources === 'object' ? sources : {};
  const onMap = typeof isOnMap === 'function' ? isOnMap : () => false;

  return SERVICE_DEFINITIONS.map((definition) => {
    const matching = list.filter((vehicle) => matchesDefinition(vehicle, definition));
    const entry = {
      ...definition,
      status: definition.tracked === false
        ? 'not-tracked'
        : normalizeStatus(sourceMap[definition.sourceKey]),
      trackedCount: matching.length,
      onMapCount: matching.filter(onMap).length
    };
    return {
      ...entry,
      statusLabel: formatTrackedServiceStatus(entry)
    };
  });
}

export function buildTrackedAgencySummaries(options = {}) {
  const serviceSummaries = buildTrackedServiceSummaries(options);
  const servicesById = new Map(serviceSummaries.map((service) => [service.id, service]));

  return AGENCY_DEFINITIONS.map((agency) => ({
    ...agency,
    services: agency.serviceIds
      .map((serviceId) => servicesById.get(serviceId))
      .filter(Boolean)
  }));
}

export function buildNearbyRenderSignature(rows) {
  const entries = Array.isArray(rows) ? rows : [];
  return JSON.stringify({
    rows: entries.map((entry) => ({
      id: String(entry && entry.id || ''),
      routeLabel: String(entry && entry.routeLabel || ''),
      agencyLabel: String(entry && entry.agencyLabel || ''),
      agencyId: String(entry && entry.agencyId || ''),
      routeCode: String(entry && entry.routeCode || ''),
      serviceLabel: String(entry && entry.serviceLabel || ''),
      destination: String(entry && entry.destination || ''),
      terminalStatus: String(entry && entry.terminalStatus || ''),
      distanceMeters: Math.round(Number(entry && entry.distanceMeters) || 0),
      distanceLabel: String(entry && entry.distanceLabel || ''),
      color: String(entry && entry.color || ''),
      textColor: String(entry && entry.textColor || '')
    }))
  });
}
