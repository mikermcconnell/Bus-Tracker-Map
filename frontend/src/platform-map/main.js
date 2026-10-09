import { createDataClient } from '../data/client.js';
import { BATT_COORDS, getTerminalListStatus } from '../map/nearby-vehicles.js';
import { clusterVehicles, distanceBetweenMeters } from '../map/vehicle-groups.js';
import feedFreshness from '../../../shared/feed-freshness.js';
import {
  DEPARTURE_NOW_GRACE_MS,
  departureDisplay,
  departureMatchesVehicle,
  departureSourceDisplay,
  getRouteEightDirection,
  getVehicleLabel,
  getVehicleStyle,
  groupPlatformAssignments,
  isAtPlatformDepartureEligible,
  isTerminalDisplayVehicle,
  normalizeDepartureBoard,
  normalizeBearing,
  projectToBasemap,
  projectVehicleToImage,
  basemapPixel,
  snapToTrack,
  trackPoint,
} from './model.js';
import {
  GO_TRAIN_CAR_GAP_METRES,
  GO_TRAIN_CONSIST,
  describeGoTrain,
  drawGoTrain,
  isGoTrain,
} from './go-train.js';
import BASEMAP_CALIBRATION from './basemap-calibration.json';
import {
  fetchText,
  isNewBuild,
  isNightlyReloadDue,
  isPollStalled,
} from './kiosk.js';

const { assessVehicleFeedFreshness, selectVehiclesForDisplay } = feedFreshness;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_POLL_MS = 10000;
const LIVE_TRACKING_UNAVAILABLE_MESSAGE = 'Live bus tracking is unavailable. Times may not reflect delays.';
const REQUEST_TIMEOUT_MS = 8000;
// Keep the last departure board through brief outages, then fall back to the
// timetable so an old prediction is never shown as current.
const DEPARTURES_RETENTION_MS = 2 * 60 * 1000;
const CONFIG_RETRY_MAX_MS = 60 * 1000;
const KIOSK_CHECK_INTERVAL_MS = 60 * 1000;
const BUILD_CHECK_INTERVAL_MS = 5 * 60 * 1000;
// With no successful poll for this long, reload to clear any broken state.
const NO_DATA_RELOAD_MS = 10 * 60 * 1000;
const CLUSTER_DISTANCE_METERS = 8;
const APPROACHING_WINDOW_MS = 5 * 60 * 1000;
const APPROACHING_DISTANCE_METERS = 500;
const AGENCY_BRANDING = Object.freeze({
  'barrie-transit': Object.freeze({
    id: 'barrie-transit',
    short: 'BT',
    label: 'Barrie Transit',
    logo: './assets/agency-barrie-transit.png',
  }),
  'go-transit': Object.freeze({
    id: 'go-transit',
    short: 'GO',
    label: 'GO Transit',
    logo: './assets/agency-go-transit.svg',
  }),
  'ontario-northland': Object.freeze({
    id: 'ontario-northland',
    short: 'ON',
    label: 'Ontario Northland',
    logo: './assets/agency-ontario-northland.png',
  }),
  'simcoe-linx': Object.freeze({
    id: 'simcoe-linx',
    short: 'LINX',
    label: 'Simcoe LINX',
    logo: './assets/agency-simcoe-linx.png',
  }),
});

// Keep the departure directory in the same numeric order riders see on the
// platform signs.  The map itself still uses its calibrated physical layout.
const PLATFORM_DISPLAY_ORDER = Object.freeze([
  '1', '2', '3', '4', '5', '6', '7',
  '8', '9', '10', '11', '12', '13', '14',
]);
const PLATFORM_MAP_POSITIONS = Object.freeze({
  '1': Object.freeze({ left: 73.8, top: 54, scrubLeft: 75.6, scrubWidth: 13.4, scrubHeight: 5.5, wide: true }),
  '2': Object.freeze({ left: 60.6, top: 60.7, scrubLeft: 60.6, scrubTop: 60.5, scrubWidth: 10.2, scrubHeight: 6.6 }),
  '3': Object.freeze({ left: 49.8, top: 60.7, scrubLeft: 49.8, scrubWidth: 10.2, scrubHeight: 6.6 }),
  '4': Object.freeze({ left: 39, top: 60.7, scrubLeft: 39, scrubWidth: 10.2, scrubHeight: 6.6 }),
  '5': Object.freeze({ left: 28.2, top: 60.7, scrubLeft: 28.2, scrubWidth: 10.6, scrubHeight: 6.6 }),
  '6': Object.freeze({ left: 28.6, top: 26.8, scrubLeft: 28.6, scrubWidth: 10.2, scrubHeight: 9.1 }),
  '7': Object.freeze({ left: 38.5, top: 26.8, scrubLeft: 38.1, scrubWidth: 11.3, scrubHeight: 7.8 }),
  '8': Object.freeze({ left: 50.2, top: 26.8, scrubLeft: 50.2, scrubWidth: 10.2, scrubHeight: 7.8 }),
  '12': Object.freeze({ left: 10.6, top: 26.8, scrubLeft: 10.6, scrubTop: 26.5, scrubWidth: 10.2, scrubHeight: 8.5 }),
  '13': Object.freeze({ left: 19.6, top: 26.8, scrubLeft: 19.6, scrubTop: 26.5, scrubWidth: 8.6, scrubHeight: 8.5 }),
  '14': Object.freeze({ left: 10.6, top: 60.7, scrubLeft: 10.6, scrubTop: 60.5, scrubWidth: 13.6, scrubHeight: 7.9, wide: true }),
});
const PLATFORM_LABEL_RAILS = Object.freeze({
  '1': Object.freeze({ rail: 'bottom', order: 6 }),
  '2': Object.freeze({ rail: 'bottom', order: 5 }),
  '3': Object.freeze({ rail: 'bottom', order: 4 }),
  '4': Object.freeze({ rail: 'bottom', order: 3 }),
  '5': Object.freeze({ rail: 'bottom', order: 2 }),
  '6': Object.freeze({ rail: 'top', order: 3 }),
  '7': Object.freeze({ rail: 'top', order: 4 }),
  '8': Object.freeze({ rail: 'top', order: 5 }),
  '9': Object.freeze({ rail: 'top', order: 6 }),
  '12': Object.freeze({ rail: 'top', order: 1 }),
  '13': Object.freeze({ rail: 'top', order: 2 }),
  '14': Object.freeze({ rail: 'bottom', order: 1 }),
});
const REVERSED_POINTER_LABEL_PLATFORMS = new Set(['2', '3', '4', '5', '6', '7', '8']);
// Neighbouring pointers are only a label-width apart; these sit one row further out.
const STAGGERED_POINTER_LABEL_PLATFORMS = new Set(['2', '4', '7']);
const POINTER_LABEL_PLACEMENT_OVERRIDES = Object.freeze({ '12': 'left' });
// User-confirmed physical pointer locations. Add platforms here one at a time;
// do not substitute agency GTFS stop coordinates for these display anchors.
const PLATFORM_POINTER_COORDINATES = Object.freeze({
  '1': Object.freeze({ lat: 44.373611, lon: -79.688611 }),
  '2': Object.freeze({ lat: 44.373833, lon: -79.689111 }),
  '3': Object.freeze({ lat: 44.373861, lon: -79.689333 }),
  '4': Object.freeze({ lat: 44.373889, lon: -79.689583 }),
  '5': Object.freeze({ lat: 44.373917, lon: -79.689806 }),
  '6': Object.freeze({ lat: 44.374250, lon: -79.689722 }),
  '7': Object.freeze({ lat: 44.374250, lon: -79.689472 }),
  '8': Object.freeze({ lat: 44.374194, lon: -79.689194 }),
  '9': Object.freeze({ lat: 44.374306, lon: -79.688944 }),
  '12': Object.freeze({ lat: 44.374167, lon: -79.690444 }),
  '13': Object.freeze({ lat: 44.374028, lon: -79.690528 }),
  '14': Object.freeze({ lat: 44.373583, lon: -79.691111 }),
});
const PICKUP_DROPOFF_POINTER_COORDINATES = Object.freeze({
  lat: 44.373639,
  lon: -79.687411,
});
// Terminal building footprint (OpenStreetMap way 1427393969, as used by the Barrie Simulator).
const TERMINAL_BUILDING_FOOTPRINT = Object.freeze([
  [44.374292, -79.690245], [44.374213, -79.690261], [44.374215, -79.690301], [44.37413, -79.690318],
  [44.374138, -79.690352], [44.373951, -79.690395], [44.373914, -79.690081], [44.374092, -79.690042],
  [44.374104, -79.690076], [44.374266, -79.690033],
]);
// GO Barrie line through the terminal: the GO shape's final segment into Allandale
// Waterfront, extended west across Essa Rd. [west end, east end].
const GO_TRACK = Object.freeze([[44.373855, -79.6925], [44.37316, -79.6835]]);
// Only GPS positions this close to the track count as a train on this line.
const GO_TRACK_MAX_OFFSET_METRES = 60;
// A stopped train sits along the GO platform with its west end just west of the P1 pointer.
const GO_TRAIN_STOPPED_FRONT_OFFSET_METRES = -30;
// Street names drawn on the map (the simulator renders none). [start, end] along each street.
const MAP_STREET_LABELS = Object.freeze([
  Object.freeze({ name: 'Tiffin St', line: [[44.374399, -79.691263], [44.374518, -79.690551]] }),
  Object.freeze({ name: 'Essa Rd', line: [[44.373327, -79.691097], [44.373135, -79.691228]] }),
  Object.freeze({ name: 'Lakeshore Dr', line: [[44.374865, -79.688293], [44.374611, -79.687485]] }),
  Object.freeze({ name: 'Gowan St', line: [[44.373412, -79.688251], [44.373286, -79.687196]] }),
]);
const MAP_CONNECTIONS = Object.freeze([
  Object.freeze({
    platform: '9',
    stop: 'Stop 900',
    agency: 'Transit ON Demand',
    serviceLabel: 'On Demand',
    brand: AGENCY_BRANDING['barrie-transit'],
    routes: Object.freeze([
      Object.freeze({ label: 'C', color: '#e51d43' }),
      Object.freeze({ label: 'D', color: '#67c819' }),
    ]),
    left: 61,
    top: 26.8,
    scrubLeft: 61,
    scrubTop: 26.5,
    scrubWidth: 10.2,
    scrubHeight: 8.1,
  }),
]);
const PLATFORM_BY_STOP_ID = Object.freeze({
  '14': '14',
  '315': '8',
  '08049': '7',
  AD: '1',
});


function sourceKeyForVehicle(vehicle) {
  if (!vehicle) return '';
  if (vehicle.agency_id === 'go-transit') return 'go_transit';
  if (vehicle.agency_id === 'ontario-northland') return 'ontario_northland';
  if (vehicle.agency_id === 'simcoe-linx') return 'simcoe_linx';
  return 'barrie_transit';
}

function routeStyleIndex(geojson) {
  const result = Object.create(null);
  (geojson && Array.isArray(geojson.features) ? geojson.features : []).forEach((feature) => {
    const props = feature && feature.properties || {};
    const id = String(props.route_id || props.route_short_name || '');
    if (!id || result[id]) return;
    const color = props.route_color ? `#${String(props.route_color).replace(/^#/, '')}` : '';
    const textColor = props.route_text_color ? `#${String(props.route_text_color).replace(/^#/, '')}` : '';
    result[id] = { color, textColor };
  });
  return result;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

// The base map is a still image rendered from the Barrie Simulator. It needs no
// network, WebGL or map library, so it shows immediately on the TV.
function setupImageBasemap(container, mapPlane) {
  if (!container || !mapPlane) return null;
  const image = createElement('img', 'platform-basemap__image');
  image.src = './assets/allandale-sim-basemap.webp';
  image.alt = '';
  image.decoding = 'async';
  container.appendChild(image);
  const stage = mapPlane.parentNode;
  if (stage && !stage.querySelector('.platform-basemap__attribution')) {
    stage.appendChild(createElement('span', 'platform-basemap__attribution', '© OpenStreetMap contributors'));
  }
  mapPlane.classList.add('map-plane--live-basemap');
  return {
    project(lat, lon) {
      return projectToBasemap(lat, lon, BASEMAP_CALIBRATION);
    },
    remove() {
      while (container.firstChild) container.removeChild(container.firstChild);
      const credit = stage && stage.querySelector('.platform-basemap__attribution');
      if (credit) credit.remove();
    },
  };
}

function relativeAge(timestampSeconds) {
  const timestamp = Number(timestampSeconds) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'WAITING FOR LIVE DATA';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'UPDATED JUST NOW';
  if (seconds < 60) return `UPDATED ${seconds}s AGO`;
  return `UPDATED ${Math.floor(seconds / 60)}m AGO`;
}

function normalizedSourceStatus(source) {
  const status = String(source && source.feed_status || 'offline').toLowerCase();
  return ['live', 'delayed', 'empty', 'offline'].indexOf(status) !== -1 ? status : 'offline';
}

function platformForVehicle(vehicle) {
  const stopId = String(vehicle && vehicle.terminal_stop_id || '');
  if (/^90\d{2}$/.test(stopId)) return String(Number(stopId.slice(2)));
  if (PLATFORM_BY_STOP_ID[stopId]) return PLATFORM_BY_STOP_ID[stopId];
  return String(vehicle && vehicle.platform || '');
}

function normalizeServiceNotice(message) {
  const cleaned = String(message || '')
    .replace(/^Barrie Transit\s*(?:—|-|:)\s*/i, '')
    .replace(/^Upcoming Holiday Service\s*(?:—|-|:)\s*/i, '')
    .replace(/^Civic Holiday Service\s*:\s*/i, '')
    .trim();
  return cleaned.replace(
    /^Sunday Schedules on\s+/i,
    'Holiday service — Sunday schedule on '
  );
}

function terminalDisplayStatus(vehicle) {
  if (!vehicle) return '';
  // A train is about 300 m long, so the bus geofence around the terminal says
  // little about it. Use the train's own trip progress instead.
  if (isGoTrain(vehicle)) return String(vehicle.terminal_progress_status || '').toLowerCase();
  const distance = distanceBetweenMeters(
    Number(vehicle.lat),
    Number(vehicle.lon),
    BATT_COORDS.lat,
    BATT_COORDS.lon
  );
  return getTerminalListStatus(vehicle, distance);
}

function livePlatformState(vehicle, nowMs = Date.now()) {
  const status = terminalDisplayStatus(vehicle);
  if (status === 'at_terminal') {
    return isAtPlatformDepartureEligible(vehicle, nowMs) ? 'occupied' : '';
  }
  if (status === 'approaching') {
    const distance = distanceBetweenMeters(
      Number(vehicle.lat),
      Number(vehicle.lon),
      BATT_COORDS.lat,
      BATT_COORDS.lon
    );
    const departureMs = Number(vehicle && vehicle.terminal_departure_time) * 1000;
    const timeUntilDeparture = departureMs - nowMs;
    if (
      Number.isFinite(distance) &&
      distance <= APPROACHING_DISTANCE_METERS &&
      Number.isFinite(departureMs) &&
      timeUntilDeparture >= -60000 &&
      timeUntilDeparture <= APPROACHING_WINDOW_MS
    ) {
      return 'approaching';
    }
  }
  return '';
}

function sortServiceRowsByDeparture(container) {
  if (!container) return;
  const sortTime = (row) => Number(row.dataset.sortTime) || Number.POSITIVE_INFINITY;
  const rows = Array.from(container.children);
  const sorted = rows.slice().sort((a, b) => {
    const first = sortTime(a);
    const second = sortTime(b);
    return first === second ? 0 : first < second ? -1 : 1;
  });
  if (sorted.some((row, index) => row !== rows[index])) {
    sorted.forEach((row) => container.appendChild(row));
  }
}

function isSourceVehicleVisible(vehicle, sources) {
  if (!sources || typeof sources !== 'object') return true;
  const source = sources[sourceKeyForVehicle(vehicle)];
  if (!source) return true;
  const status = normalizedSourceStatus(source);
  return status !== 'offline' && status !== 'empty';
}

function buildClusterKey(vehicles) {
  return (Array.isArray(vehicles) ? vehicles : [])
    .map((vehicle, index) => String(vehicle && (vehicle.id || vehicle.vehicle_id) || `vehicle-${index}`))
    .sort()
    .join('|');
}

function platformDisplayName(platform) {
  return String(platform) === '14' ? 'Stop 14' : `P${platform}`;
}

function platformAgencyBrand(platform, assignments) {
  const assignment = (Array.isArray(assignments) ? assignments : [])
    .find((entry) => AGENCY_BRANDING[String(entry && entry.agency_id || '')]);
  if (assignment) return AGENCY_BRANDING[assignment.agency_id];
  if (String(platform) === '1' || String(platform) === '7') return AGENCY_BRANDING['go-transit'];
  if (String(platform) === '8') return AGENCY_BRANDING['ontario-northland'];
  return AGENCY_BRANDING['barrie-transit'];
}

function createAgencyLogo(brand, className) {
  const logo = createElement('img', className);
  logo.src = brand.logo;
  logo.alt = brand.label;
  logo.loading = 'eager';
  logo.decoding = 'async';
  return logo;
}

function vehicleAgencyMark(vehicle) {
  const agencyId = String(vehicle && vehicle.agency_id || '');
  if (agencyId === 'go-transit') return 'GO';
  if (agencyId === 'ontario-northland') return 'ON';
  if (agencyId === 'simcoe-linx') return 'LINX';
  return '';
}

function vehicleRouteCode(vehicle) {
  const agencyId = String(vehicle && vehicle.agency_id || '');
  if (agencyId === 'ontario-northland') {
    return String(vehicle.source_route_id || vehicle.route_label || 'ON').replace(/^ON\s*/i, '').trim() || 'ON';
  }
  if (agencyId === 'go-transit') {
    if (String(vehicle && vehicle.route_mode || '').toLowerCase() === 'train') return 'TRAIN';
    return String(vehicle.route_label || vehicle.source_route_id || 'GO').replace(/^GO\s*/i, '').trim() || 'GO';
  }
  if (agencyId === 'simcoe-linx') {
    return String(vehicle.source_route_id || vehicle.route_label || 'LINX')
      .replace(/^LINX\s*/i, '').trim() || 'LINX';
  }
  return String(vehicle && (vehicle.route_label || vehicle.route_id) || '?');
}

function serviceRouteCode(service) {
  return vehicleRouteCode(service);
}

function normalizeRouteIdentity(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^(?:GO|ON|LINX)[\s-]+/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function serviceRowMatchesVehicle(row, vehicle) {
  const assignmentIdentities = [
    row && row.dataset.routeId,
    row && row.dataset.routeLabel,
    row && row.dataset.sourceRouteId,
  ].map(normalizeRouteIdentity).filter(Boolean);
  const vehicleIdentities = [
    vehicle && vehicle.route_id,
    vehicle && vehicle.route_label,
    vehicle && vehicle.source_route_id,
    vehicleRouteCode(vehicle),
  ].map(normalizeRouteIdentity).filter(Boolean);
  return assignmentIdentities.some((identity) => vehicleIdentities.includes(identity));
}

function terminalDepartureForRow(row, terminalDepartures) {
  if (!row || !Array.isArray(terminalDepartures)) return null;
  const card = row.closest('.platform-card');
  const platform = String(card && card.dataset.platform || '');
  const agencyId = String(row.dataset.agencyId || '');
  const earliestSeconds = (Date.now() - DEPARTURE_NOW_GRACE_MS) / 1000;
  return terminalDepartures.find((departure) => (
    Number(departure && departure.departure_time) >= earliestSeconds &&
    String(departure && departure.platform || '') === platform &&
    String(departure && departure.agency_id || '') === agencyId &&
    serviceRowMatchesVehicle(row, departure)
  )) || null;
}

function vehicleMarkerStyle(vehicle, routeStyles) {
  const style = getVehicleStyle(vehicle, routeStyles);
  const isGoBus = String(vehicle && vehicle.agency_id || '') === 'go-transit' &&
    String(vehicle && vehicle.route_mode || '').toLowerCase() !== 'train';
  return isGoBus ? { ...style, color: '#00843d', textColor: '#fff' } : style;
}

function renderVehicleBubbleLabel(element, vehicle, includeDirection = false) {
  while (element.firstChild) element.removeChild(element.firstChild);
  const agency = vehicleAgencyMark(vehicle);
  if (agency) element.appendChild(createElement('span', 'vehicle-marker__agency', agency));
  element.appendChild(createElement('span', 'vehicle-marker__route-text', vehicleRouteCode(vehicle)));
  if (includeDirection) {
    const direction = getRouteEightDirection(vehicle);
    if (direction) {
      element.appendChild(createElement(
        'span',
        'vehicle-marker__direction',
        direction === 'NORTHBOUND' ? 'N' : 'S'
      ));
    }
  }
}

function createMarker(key) {
  const marker = createElement('div', 'vehicle-marker');
  marker.dataset.markerKey = key;
  const arrow = createElement('span', 'vehicle-marker__arrow');
  const body = createElement('span', 'vehicle-marker__body');
  const label = createElement('span', 'vehicle-marker__label');
  body.appendChild(label);
  const labels = createElement('span', 'vehicle-marker__labels');
  marker.appendChild(arrow);
  marker.appendChild(body);
  marker.appendChild(labels);
  const count = createElement('span', 'vehicle-marker__count');
  marker.appendChild(count);
  marker.__parts = { arrow, body, label, labels, count };
  return marker;
}

function updateMarker(marker, cluster, routeStyles, projectCoordinate) {
  const vehicles = cluster.vehicles;
  const lead = vehicles[0];
  const position = projectCoordinate(cluster.lat, cluster.lon);
  if (!position) return false;

  marker.style.left = `${Math.min(97, Math.max(3, position.x))}%`;
  marker.style.top = `${Math.min(84.5, Math.max(14.5, position.y))}%`;
  marker.dataset.agencyId = String(lead.agency_id || 'barrie-transit');
  marker.dataset.vehicleIds = vehicles.map((vehicle) => vehicle.id || vehicle.vehicle_id || '').join(',');
  marker.classList.toggle('vehicle-marker--cluster', vehicles.length > 1);
  marker.classList.toggle('vehicle-marker--train', String(lead.route_mode || '').toLowerCase() === 'train');

  const style = vehicleMarkerStyle(lead, routeStyles);
  marker.style.setProperty('--route-color', style.color);
  marker.style.setProperty('--route-text-color', style.textColor);
  renderVehicleBubbleLabel(marker.__parts.label, lead, true);

  while (marker.__parts.labels.firstChild) {
    marker.__parts.labels.removeChild(marker.__parts.labels.firstChild);
  }
  vehicles.slice(0, 4).forEach((vehicle) => {
    const labelElement = createElement('span', 'vehicle-marker__route');
    labelElement.dataset.agencyId = String(vehicle && vehicle.agency_id || 'barrie-transit');
    const labelStyle = vehicleMarkerStyle(vehicle, routeStyles);
    labelElement.style.setProperty('--route-color', labelStyle.color);
    labelElement.style.setProperty('--route-text-color', labelStyle.textColor);
    renderVehicleBubbleLabel(labelElement, vehicle);
    marker.__parts.labels.appendChild(labelElement);
  });
  if (vehicles.length > 4) {
    const overflow = createElement('span', 'vehicle-marker__route vehicle-marker__route--count');
    overflow.appendChild(createElement('span', 'vehicle-marker__route-text', `+${vehicles.length - 4}`));
    marker.__parts.labels.appendChild(overflow);
  }

  marker.__parts.count.textContent = vehicles.length > 1 ? `${vehicles.length} vehicles` : '';
  marker.__parts.count.hidden = vehicles.length <= 1;
  const bearing = normalizeBearing(lead.bearing);
  marker.__parts.arrow.hidden = bearing === null;
  marker.__parts.arrow.style.setProperty('--bearing', `${bearing === null ? 0 : bearing}deg`);
  marker.title = vehicles.map((vehicle) => {
    const destination = vehicle.trip_headsign ? ` to ${vehicle.trip_headsign}` : '';
    return `${vehicle.agency_name || 'Transit'} ${getVehicleLabel(vehicle)}${destination}`;
  }).join('\n');
  return true;
}

function setupPlatformApp() {
  const dataClient = createDataClient();
  const markerIndex = new Map();
  let pollMs = DEFAULT_POLL_MS;
  let delayedAfterMs = 2 * 60 * 1000;
  let offlineAfterMs = 15 * 60 * 1000;
  let routeStyles = Object.create(null);
  let lastPayload = null;
  let lastDataTimestamp = null;
  let pollTimer = null;
  let pollGeneration = 0;
  let lastPollSettledAt = Date.now();
  let lastHealthyPollAt = Date.now();
  let lastDeparturesAt = 0;
  let layoutTimer = null;
  let configRetryTimer = null;
  const timers = [];
  let platformBasemap = null;
  let projectionFrame = null;

  const busLayer = document.getElementById('bus-layer');
  const goTrainLayer = document.createElementNS(SVG_NS, 'svg');
  goTrainLayer.setAttribute('class', 'map-go-train-layer');
  goTrainLayer.setAttribute('viewBox', `0 0 ${BASEMAP_CALIBRATION.width} ${BASEMAP_CALIBRATION.height}`);
  goTrainLayer.setAttribute('preserveAspectRatio', 'none');
  goTrainLayer.setAttribute('aria-hidden', 'true');
  busLayer.parentNode.insertBefore(goTrainLayer, busLayer);
  platformBasemap = setupImageBasemap(
    document.getElementById('platform-basemap'),
    document.querySelector('.map-plane')
  );
  const statusEl = document.getElementById('platform-status');
  const connectionEl = document.getElementById('connection-status');
  const connectionLabelEl = document.getElementById('connection-label');
  const clockEl = document.getElementById('platform-clock');
  const lastUpdatedEl = document.getElementById('last-updated');
  const assignmentLayerEl = document.getElementById('assignment-layer');
  const mapStageEl = document.querySelector('.map-stage');
  const mapPlaneEl = document.querySelector('.map-plane');
  const mapPlatformLayerEl = document.getElementById('map-platform-layer');
  const mapLabelLayerEl = document.getElementById('map-label-layer');
  const mapLabelRails = Object.freeze({
    top: document.getElementById('map-label-rail-top'),
    bottom: document.getElementById('map-label-rail-bottom'),
    right: document.getElementById('map-label-rail-right'),
  });
  const serviceNoticeEl = document.getElementById('service-notice');
  const serviceNoticeTextEl = document.getElementById('service-notice-text');
  const displayLegendEl = document.getElementById('display-legend');
  let lastVisibleVehicles = [];
  let lastTerminalDepartures = [];

  function projectCoordinate(lat, lon) {
    const numericLat = Number(lat);
    const numericLon = Number(lon);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) return null;
    const livePosition = platformBasemap && platformBasemap.project(numericLat, numericLon);
    return livePosition || projectVehicleToImage(numericLat, numericLon);
  }

  function positionManualPointer(card, anchor) {
    if (card.dataset.geographicCard === 'true') {
      requestAnimationFrame(() => {
        if (!card.isConnected || !mapStageEl.isConnected || !mapPlaneEl.isConnected) return;
        const stageRect = mapStageEl.getBoundingClientRect();
        const planeRect = mapPlaneEl.getBoundingClientRect();
        const anchorX = planeRect.left - stageRect.left + planeRect.width * anchor.x / 100;
        const anchorY = planeRect.top - stageRect.top + planeRect.height * anchor.y / 100;
        const cardWidth = card.getBoundingClientRect().width;
        const cardHeight = card.getBoundingClientRect().height;
        card.style.left = `${Math.max(cardWidth + 8, Math.min(stageRect.width - 8, anchorX))}px`;
        card.style.top = `${Math.max(cardHeight / 2 + 8, Math.min(stageRect.height - cardHeight / 2 - 8, anchorY))}px`;
      });
      return;
    }
    const dot = card.__platformAnchor;
    const label = card.__platformAnchorLabel;
    if (!dot || !label || !anchor) return;
    dot.style.left = `${anchor.x}%`;
    dot.style.top = `${anchor.y}%`;
    requestAnimationFrame(() => {
      if (!card.isConnected || !mapStageEl.isConnected || !mapPlaneEl.isConnected) return;
      const stageRect = mapStageEl.getBoundingClientRect();
      const planeRect = mapPlaneEl.getBoundingClientRect();
      const anchorX = planeRect.left - stageRect.left + planeRect.width * anchor.x / 100;
      const anchorY = planeRect.top - stageRect.top + planeRect.height * anchor.y / 100;
      label.style.left = `${anchorX}px`;
      label.style.top = `${anchorY}px`;
    });
  }

  function appendCardToRail(card, placement) {
    const rail = placement && mapLabelRails[placement.rail];
    if (!rail) return;
    card.dataset.labelRail = placement.rail;
    card.style.order = String(placement.order);
    rail.appendChild(card);
  }

  function mountManualPointer(card, platform, coordinates = null) {
    const pointerCoordinates = coordinates || PLATFORM_POINTER_COORDINATES[platform];
    if (!pointerCoordinates) return;
    card.dataset.manualPointer = 'true';
    card.dataset.pointerLat = String(pointerCoordinates.lat);
    card.dataset.pointerLon = String(pointerCoordinates.lon);
    const labelRail = platform ? PLATFORM_LABEL_RAILS[platform] && PLATFORM_LABEL_RAILS[platform].rail : 'right';
    const pointerLabel = platform ? (String(platform) === '14' ? 'S14' : `P${platform}`) : 'P/D';
    const agencyId = card.dataset.agencyId || 'passenger';
    if (card.classList.contains('map-dropoff-card')) {
      card.dataset.geographicCard = 'true';
      mapLabelLayerEl.appendChild(card);
      return;
    }
    const anchor = createElement('span', 'map-platform-anchor');
    const anchorLabel = createElement('span', 'map-platform-anchor__label');
    anchorLabel.appendChild(createElement('span', 'map-platform-anchor__label-text', pointerLabel));
    const anchorState = createElement('span', 'map-platform-anchor__state');
    anchorState.hidden = true;
    anchorLabel.appendChild(anchorState);
    anchor.dataset.pointerLabel = pointerLabel;
    anchor.dataset.agencyId = agencyId;
    anchorLabel.dataset.pointerLabel = pointerLabel;
    const defaultLabelPlacement = labelRail === 'top' ? 'below' : labelRail === 'bottom' ? 'above' : 'left';
    anchorLabel.dataset.labelPlacement = POINTER_LABEL_PLACEMENT_OVERRIDES[String(platform)] || (
      REVERSED_POINTER_LABEL_PLATFORMS.has(String(platform))
        ? defaultLabelPlacement === 'above' ? 'below' : 'above'
        : defaultLabelPlacement
    );
    if (STAGGERED_POINTER_LABEL_PLATFORMS.has(String(platform))) anchorLabel.dataset.labelStagger = 'true';
    anchorLabel.dataset.agencyId = agencyId;
    if (card.classList.contains('map-dropoff-card')) {
      anchor.classList.add('map-platform-anchor--pickup-dropoff');
    }
    card.__platformAnchor = anchor;
    card.__platformAnchorLabel = anchorLabel;
    mapPlatformLayerEl.appendChild(anchor);
    mapLabelLayerEl.appendChild(anchorLabel);
  }

  function refreshManualPointer(card) {
    const pointerPosition = projectCoordinate(card.dataset.pointerLat, card.dataset.pointerLon);
    if (!pointerPosition) return;
    if (card.dataset.geographicCard !== 'true' && (!card.__platformAnchor || !card.__platformAnchorLabel)) return;
    positionManualPointer(card, pointerPosition);
  }

  function positionMapPlatformCard(card) {
    refreshManualPointer(card);
  }

  function positionMapConnectionCard(card) {
    refreshManualPointer(card);
  }

  function refreshProjectedOverlays() {
    mapLabelLayerEl.querySelectorAll('.map-platform-card').forEach((card) => {
      positionMapPlatformCard(card);
    });
    mapLabelLayerEl.querySelectorAll('.map-connection-card[data-manual-pointer="true"]')
      .forEach(positionMapConnectionCard);
    mapLabelLayerEl.querySelectorAll('.map-dropoff-card[data-manual-pointer="true"]')
      .forEach(refreshManualPointer);
    if (lastPayload) renderPayload(lastPayload);
  }

  function scheduleProjectionRefresh() {
    if (projectionFrame) cancelAnimationFrame(projectionFrame);
    projectionFrame = requestAnimationFrame(() => {
      projectionFrame = null;
      refreshProjectedOverlays();
    });
  }

  function setConnection(state, label) {
    connectionEl.className = `connection-status status-${state}`;
    connectionLabelEl.textContent = label;
  }

  function setStatus(message, state = 'warning') {
    statusEl.textContent = message || '';
    statusEl.dataset.state = state;
    statusEl.hidden = !message;
  }

  function updatePlatformActivity(vehicles, terminalDepartures = lastTerminalDepartures) {
    const platformStates = new Map();
    const activityNow = Date.now();
    (Array.isArray(vehicles) ? vehicles : []).forEach((vehicle) => {
      const platform = platformForVehicle(vehicle);
      const state = livePlatformState(vehicle, activityNow);
      if (!platform || !state) return;
      const current = platformStates.get(platform);
      const departure = Number(vehicle && vehicle.terminal_departure_time) || Number.POSITIVE_INFINITY;
      const currentDeparture = Number(current && current.vehicle && current.vehicle.terminal_departure_time) || Number.POSITIVE_INFINITY;
      if (!current || state === 'occupied' && current.state !== 'occupied' || state === current.state && departure < currentDeparture) {
        platformStates.set(platform, { state, vehicle });
      }
    });

    assignmentLayerEl.querySelectorAll('.platform-card').forEach((card) => {
      const activity = platformStates.get(card.dataset.platform);
      const state = activity && activity.state || '';
      const activeVehicle = activity && activity.vehicle;
      const activeRoute = activeVehicle ? vehicleRouteCode(activeVehicle) : '';
      card.dataset.liveState = state;
      card.dataset.activeRoute = activeRoute;
      card.classList.toggle('platform-card--occupied', state === 'occupied');
      card.classList.toggle('platform-card--approaching', state === 'approaching');
      card.querySelectorAll('.platform-card__service').forEach((row) => {
        const active = Boolean(activeVehicle && serviceRowMatchesVehicle(row, activeVehicle));
        const terminalDeparture = terminalDepartureForRow(row, terminalDepartures);
        const boardTimestamp = terminalDeparture && terminalDeparture.departure_time;
        // A bus still at the platform after the board has moved on to the next
        // trip is boardable now, so its own departure time wins.
        const activeVehicleTimestamp = active && state && activeVehicle.terminal_is_departure !== false
          ? Number(activeVehicle.terminal_departure_time) || null
          : null;
        const vehicleTimestamp = activeVehicleTimestamp && (
          !boardTimestamp ||
          state === 'occupied' && activeVehicleTimestamp * 1000 <= activityNow
        )
          ? activeVehicleTimestamp
          : null;
        // A route match only proves the same route is nearby. The vehicle is
        // live evidence for this row only when it runs the displayed trip.
        const vehicleRunsDisplayedTrip = Boolean(vehicleTimestamp) ||
          Boolean(active && state && departureMatchesVehicle(terminalDeparture, activeVehicle));
        const departureSource = departureSourceDisplay(
          vehicleTimestamp ? null : terminalDeparture,
          vehicleRunsDisplayedTrip
        );
        const hasRealtimeDeparture = departureSource.key === 'live';
        row.classList.toggle('platform-card__service--active', active);
        row.setAttribute('aria-current', active ? 'true' : 'false');
        const countdown = row.querySelector('.platform-card__service-countdown');
        const source = row.querySelector('.platform-card__service-source');
        const displayTimestamp = vehicleTimestamp || boardTimestamp || row.dataset.nextDepartureTime;
        const departure = row.dataset.departureLabel && !hasRealtimeDeparture && !terminalDeparture
          ? { primary: row.dataset.departureLabel, secondary: '', state: 'unavailable' }
          : departureDisplay(displayTimestamp);
        const hasTime = departure.state !== 'unavailable' && departure.state !== 'past';
        row.dataset.sortTime = hasTime ? String(Number(displayTimestamp)) : '';
        if (source) {
          source.textContent = departureSource.label;
          source.dataset.source = departureSource.key;
          source.hidden = !hasTime || !hasRealtimeDeparture;
        }
        if (countdown) {
          countdown.textContent = departure.primary;
          countdown.dataset.live = hasRealtimeDeparture ? 'true' : 'false';
          countdown.dataset.departureState = departure.state;
          countdown.hidden = !countdown.textContent;
        }
      });
      sortServiceRowsByDeparture(card.querySelector('.platform-card__services'));
      const badge = card.querySelector('.platform-card__state');
      if (!badge) return;
      badge.textContent = state === 'occupied'
        ? (isGoTrain(activity.vehicle) ? 'Boarding' : 'At platform')
        : state === 'approaching'
          ? 'Arriving'
          : '';
      badge.hidden = !badge.textContent;
    });

    mapLabelLayerEl.querySelectorAll('.map-platform-card').forEach((card) => {
      const activity = platformStates.get(card.dataset.platform);
      const state = activity && activity.state || '';
      const activeVehicle = activity && activity.vehicle;
      card.dataset.liveState = state;
      card.classList.toggle('map-platform-card--occupied', state === 'occupied');
      card.classList.toggle('map-platform-card--approaching', state === 'approaching');
      const anchor = card.__platformAnchor;
      const anchorLabel = card.__platformAnchorLabel;
      const anchorState = anchorLabel && anchorLabel.querySelector('.map-platform-anchor__state');
      if (anchor) anchor.dataset.liveState = state;
      if (anchorLabel) {
        const liveStateLabel = state === 'occupied'
          ? (isGoTrain(activeVehicle) ? 'Boarding' : 'At platform')
          : state === 'approaching'
            ? 'Arriving'
            : '';
        anchorLabel.dataset.liveState = state;
        anchorLabel.setAttribute(
          'aria-label',
          liveStateLabel
            ? `${platformDisplayName(card.dataset.platform)}, ${liveStateLabel}`
            : platformDisplayName(card.dataset.platform)
        );
        if (anchorState) {
          anchorState.textContent = liveStateLabel;
          anchorState.hidden = !liveStateLabel;
        }
      }
      card.querySelectorAll('.map-platform-card__route').forEach((route) => {
        route.classList.toggle(
          'map-platform-card__route--active',
          Boolean(activeVehicle && serviceRowMatchesVehicle(route, activeVehicle))
        );
      });
    });
  }

  function renderMapPlatformCard(platform, assignments) {
    const position = PLATFORM_MAP_POSITIONS[platform];
    if (!position) return;
    const brand = platformAgencyBrand(platform, assignments);

    const scrub = createElement('span', 'map-platform-scrub');
    scrub.dataset.platform = platform;
    scrub.style.left = `${position.scrubLeft}%`;
    scrub.style.top = `${position.scrubTop ?? position.top}%`;
    scrub.style.width = `${position.scrubWidth}%`;
    scrub.style.height = `${position.scrubHeight}%`;
    mapPlatformLayerEl.appendChild(scrub);

    const card = createElement('section', 'map-platform-card');
    card.dataset.platform = platform;
    card.dataset.agencyId = brand.id;
    card.dataset.hasSchedule = assignments.length ? 'true' : 'false';
    card.dataset.liveState = '';
    card.__platformScrub = scrub;
    card.setAttribute('aria-label', platformDisplayName(platform));
    if (position.wide) card.classList.add('map-platform-card--wide');

    const heading = createElement('header', 'map-platform-card__header');
    heading.appendChild(createElement('strong', 'map-platform-card__title', platformDisplayName(platform).toUpperCase()));
    const brandMark = createElement('span', 'map-platform-card__brand');
    brandMark.appendChild(createAgencyLogo(brand, 'map-platform-card__brand-logo'));
    brandMark.appendChild(createElement('span', 'map-platform-card__dot'));
    heading.appendChild(brandMark);
    card.appendChild(heading);

    const routes = createElement('div', 'map-platform-card__routes');
    assignments.forEach((assignment) => {
      const route = createElement(
        'strong',
        'map-platform-card__route',
        serviceRouteCode(assignment)
      );
      route.dataset.routeId = assignment.route_id || '';
      route.dataset.routeLabel = assignment.route_label || '';
      route.dataset.sourceRouteId = assignment.source_route_id || '';
      const style = getVehicleStyle(assignment, routeStyles);
      route.style.setProperty('--route-color', style.color);
      route.style.setProperty('--route-text-color', style.textColor);
      routes.appendChild(route);
    });
    const body = createElement('div', 'map-platform-card__body');
    body.appendChild(routes);
    card.appendChild(body);
    mountManualPointer(card, platform);
    appendCardToRail(card, PLATFORM_LABEL_RAILS[platform]);
    positionMapPlatformCard(card);
  }

  function renderMapConnection(connection) {
    const scrub = createElement('span', 'map-landmark-scrub');
    scrub.style.left = `${connection.scrubLeft}%`;
    scrub.style.top = `${connection.scrubTop}%`;
    scrub.style.width = `${connection.scrubWidth}%`;
    scrub.style.height = `${connection.scrubHeight}%`;
    mapPlatformLayerEl.appendChild(scrub);

    const card = createElement('section', 'map-connection-card');
    card.dataset.platform = connection.platform;
    card.dataset.agencyId = connection.brand.id;
    card.__connectionScrub = scrub;
    card.setAttribute(
      'aria-label',
      `Platform ${connection.platform}, ${connection.agency}, ${connection.stop}`
    );

    const heading = createElement('header', 'map-connection-card__header');
    heading.appendChild(createElement('strong', 'map-connection-card__platform', `P${connection.platform}`));
    heading.appendChild(createAgencyLogo(connection.brand, 'map-connection-card__logo'));
    card.appendChild(heading);

    const service = createElement('div', 'map-connection-card__service');
    const routes = createElement('span', 'map-connection-card__routes');
    connection.routes.forEach((route) => {
      const badge = createElement('strong', 'map-connection-card__route', route.label);
      badge.style.setProperty('--connection-route-color', route.color);
      badge.style.setProperty('--connection-route-text', route.textColor || '#fff');
      routes.appendChild(badge);
    });
    service.appendChild(routes);
    const serviceCopy = createElement('span', 'map-connection-card__service-copy');
    serviceCopy.appendChild(createElement(
      'strong',
      'map-connection-card__service-name',
      connection.serviceLabel || connection.agency
    ));
    serviceCopy.appendChild(createElement('span', 'map-connection-card__stop', connection.stop));
    service.appendChild(serviceCopy);
    card.appendChild(service);
    mountManualPointer(card, connection.platform);
    appendCardToRail(card, PLATFORM_LABEL_RAILS[connection.platform]);
    positionMapConnectionCard(card);
  }

  // "You are here": the terminal building outlined in red with a red dot; the legend explains it.
  function renderTerminalMarker() {
    const points = TERMINAL_BUILDING_FOOTPRINT.map(([lat, lon]) => projectCoordinate(lat, lon));
    if (points.some((point) => !point)) return;
    const outline = document.createElementNS(SVG_NS, 'svg');
    outline.setAttribute('class', 'map-here__outline');
    outline.setAttribute('viewBox', '0 0 100 100');
    outline.setAttribute('preserveAspectRatio', 'none');
    outline.setAttribute('aria-hidden', 'true');
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
    outline.appendChild(polygon);
    mapPlatformLayerEl.appendChild(outline);
    const centre = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
    const dot = createElement('span', 'map-here__dot');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'You are here: Allandale Terminal Building');
    dot.style.left = `${centre.x}%`;
    dot.style.top = `${centre.y}%`;
    mapPlatformLayerEl.appendChild(dot);
  }

  function renderStreetLabels() {
    const planeWidth = mapPlaneEl.clientWidth || BASEMAP_CALIBRATION.width;
    const planeHeight = mapPlaneEl.clientHeight || BASEMAP_CALIBRATION.height;
    MAP_STREET_LABELS.forEach((street) => {
      const start = projectCoordinate(street.line[0][0], street.line[0][1]);
      const end = projectCoordinate(street.line[1][0], street.line[1][1]);
      if (!start || !end) return;
      let angle = Math.atan2((end.y - start.y) * planeHeight, (end.x - start.x) * planeWidth) * 180 / Math.PI;
      // Keep text upright.
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      const label = createElement('span', 'map-street-label', street.name);
      label.style.left = `${(start.x + end.x) / 2}%`;
      label.style.top = `${(start.y + end.y) / 2}%`;
      label.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      mapPlatformLayerEl.appendChild(label);
    });
  }

  function renderMapLegend() {
    const legend = createElement('section', 'map-legend');
    legend.setAttribute('aria-label', 'Map legend');
    [['here', 'You are here'], ['train', 'GO train'], ['bus', 'Live bus']].forEach(([key, text]) => {
      const item = createElement('span', 'map-legend__item');
      item.appendChild(createElement('i', `map-legend__symbol map-legend__symbol--${key}`));
      item.appendChild(createElement('span', '', text));
      legend.appendChild(item);
    });
    mapLabelLayerEl.appendChild(legend);
  }

  function renderMapLandmarks() {
    mapPlatformLayerEl.appendChild(createElement('span', 'map-edge-mask map-edge-mask--left'));
    MAP_CONNECTIONS.forEach(renderMapConnection);

    renderTerminalMarker();
    renderStreetLabels();
    renderMapLegend();

    const scrub = createElement('span', 'map-landmark-scrub map-landmark-scrub--dropoff');
    mapPlatformLayerEl.appendChild(scrub);

    const dropoff = createElement('section', 'map-dropoff-card');
    dropoff.setAttribute('aria-label', 'Passenger pick-up and drop-off');
    dropoff.appendChild(createElement('span', 'map-dropoff-card__icon', 'P'));
    const copy = createElement('span', 'map-dropoff-card__copy');
    copy.appendChild(createElement('strong', '', 'Passenger'));
    copy.appendChild(createElement('span', '', 'Pick-up / drop-off'));
    dropoff.appendChild(copy);
    mountManualPointer(dropoff, null, PICKUP_DROPOFF_POINTER_COORDINATES);
    refreshManualPointer(dropoff);
  }

  // Where a GO train sits on the track, in metres east of the track's west end.
  function goTrainFrontMetres(vehicle) {
    const snapped = snapToTrack(GO_TRACK, vehicle.lat, vehicle.lon);
    if (!snapped || snapped.offset > GO_TRACK_MAX_OFFSET_METRES) return null;
    if (String(vehicle.terminal_progress_status || '').toLowerCase() === 'at_terminal') {
      const platform = PLATFORM_POINTER_COORDINATES['1'];
      const stop = snapToTrack(GO_TRACK, platform.lat, platform.lon);
      return stop.along + GO_TRAIN_STOPPED_FRONT_OFFSET_METRES;
    }
    // Moving: centre the drawing on the reported position.
    const length = GO_TRAIN_CONSIST.reduce((sum, car) => sum + car.metres + GO_TRAIN_CAR_GAP_METRES, 0);
    return snapped.along - length / 2;
  }

  // Returns the GO trains drawn on the track, so they are not also drawn as bubbles.
  function renderGoTrains(vehicles) {
    goTrainLayer.textContent = '';
    mapLabelLayerEl.querySelectorAll('.map-go-train-tag').forEach((tag) => tag.remove());
    mapPlatformLayerEl.querySelectorAll('.map-street-label').forEach((label) => { label.style.visibility = ''; });
    const drawn = new Set();
    vehicles.filter(isGoTrain).forEach((vehicle) => {
      const front = goTrainFrontMetres(vehicle);
      if (front === null) return;
      let cursor = front;
      const cars = GO_TRAIN_CONSIST.map((car) => {
        const start = basemapPixel(...trackPoint(GO_TRACK, cursor), BASEMAP_CALIBRATION);
        const end = basemapPixel(...trackPoint(GO_TRACK, cursor + car.metres), BASEMAP_CALIBRATION);
        cursor += car.metres + GO_TRAIN_CAR_GAP_METRES;
        return { kind: car.kind, start, end };
      });
      if (cars.some((car) => !car.start || !car.end)) return;
      drawGoTrain(goTrainLayer, cars);
      drawn.add(vehicle);
      const status = describeGoTrain(vehicle);
      if (status) renderGoTrainTag(status, trackPoint(GO_TRACK, Math.max(front, 0)));
    });
    return drawn;
  }

  function renderGoTrainTag(status, [lat, lon]) {
    const position = projectCoordinate(lat, lon);
    if (!position) return;
    const tag = createElement('section', `map-go-train-tag map-go-train-tag--${status.state}`);
    tag.setAttribute('role', 'status');
    tag.appendChild(createAgencyLogo(AGENCY_BRANDING['go-transit'], 'map-go-train-tag__logo'));
    const copy = createElement('span', 'map-go-train-tag__copy');
    copy.appendChild(createElement('strong', '', status.title));
    if (status.detail) copy.appendChild(createElement('span', '', status.detail));
    tag.appendChild(copy);
    mapLabelLayerEl.appendChild(tag);
    // Below the track, starting near the front of the train, kept inside the map.
    const stageRect = mapStageEl.getBoundingClientRect();
    const planeRect = mapPlaneEl.getBoundingClientRect();
    const x = planeRect.left - stageRect.left + planeRect.width * position.x / 100;
    const y = planeRect.top - stageRect.top + planeRect.height * position.y / 100;
    const width = tag.offsetWidth;
    tag.style.left = `${Math.max(12, Math.min(stageRect.width - width - 12, x - 20))}px`;
    tag.style.top = `${y + 50}px`;
    // A street name under the label would show as stray letters; hide it while the train is here.
    const tagRect = tag.getBoundingClientRect();
    mapPlatformLayerEl.querySelectorAll('.map-street-label').forEach((label) => {
      const rect = label.getBoundingClientRect();
      const overlaps = rect.left < tagRect.right && rect.right > tagRect.left &&
        rect.top < tagRect.bottom && rect.bottom > tagRect.top;
      if (overlaps) label.style.visibility = 'hidden';
    });
  }

  function renderVehicles(vehicles, terminalDepartures = null) {
    lastVisibleVehicles = Array.isArray(vehicles) ? vehicles : [];
    if (Array.isArray(terminalDepartures)) lastTerminalDepartures = terminalDepartures;
    const drawnTrains = renderGoTrains(lastVisibleVehicles);
    const clusters = clusterVehicles(
      lastVisibleVehicles.filter((vehicle) => !drawnTrains.has(vehicle) && isTerminalDisplayVehicle(vehicle)),
      CLUSTER_DISTANCE_METERS
    );
    const seen = new Set();

    clusters.forEach((cluster) => {
      const key = buildClusterKey(cluster.vehicles);
      let marker = markerIndex.get(key);
      if (!marker) {
        marker = createMarker(key);
        markerIndex.set(key, marker);
        busLayer.appendChild(marker);
      }
      if (updateMarker(marker, cluster, routeStyles, projectCoordinate)) seen.add(key);
    });

    markerIndex.forEach((marker, key) => {
      if (seen.has(key)) return;
      marker.remove();
      markerIndex.delete(key);
    });
    updatePlatformActivity(lastVisibleVehicles, lastTerminalDepartures);
  }

  function renderAssignments(layout) {
    while (assignmentLayerEl.firstChild) {
      assignmentLayerEl.removeChild(assignmentLayerEl.firstChild);
    }
    while (mapPlatformLayerEl.firstChild) {
      mapPlatformLayerEl.removeChild(mapPlatformLayerEl.firstChild);
    }
    mapLabelLayerEl.querySelectorAll('.map-platform-anchor__label').forEach((label) => label.remove());
    mapLabelLayerEl.querySelectorAll('.map-legend').forEach((legend) => legend.remove());
    mapLabelLayerEl.querySelectorAll('.map-go-train-tag').forEach((tag) => tag.remove());
    mapLabelLayerEl.querySelectorAll('.map-dropoff-card[data-geographic-card="true"]').forEach((card) => card.remove());
    Object.values(mapLabelRails).forEach((rail) => {
      while (rail.firstChild) rail.removeChild(rail.firstChild);
    });
    const grouped = groupPlatformAssignments(layout && layout.assignments);
    const assignmentsForPlatform = (platform) => grouped[platform] || [];
    const orderedPlatforms = PLATFORM_DISPLAY_ORDER
      .filter((platform) => assignmentsForPlatform(platform).length);

    orderedPlatforms.forEach((platform) => {
      const assignments = assignmentsForPlatform(platform);
      const card = createElement('section', 'platform-card');
      if (assignments.length > 1) card.classList.add('platform-card--multi-service');
      card.dataset.platform = platform;
      card.setAttribute('aria-label', platformDisplayName(platform));
      const heading = createElement('header', 'platform-card__heading');
      heading.appendChild(createElement('h2', 'platform-card__title', platformDisplayName(platform)));
      const state = createElement('span', 'platform-card__state');
      state.hidden = true;
      heading.appendChild(state);
      card.appendChild(heading);
      const brand = platformAgencyBrand(platform, assignments);
      const agency = createElement('div', 'platform-card__agency');
      agency.appendChild(createAgencyLogo(brand, 'platform-card__agency-logo'));
      card.appendChild(agency);
      const services = createElement('div', 'platform-card__services');
      assignments.forEach((assignment) => {
        const row = createElement('div', 'platform-card__service');
        row.dataset.agencyId = assignment.agency_id || '';
        row.dataset.routeId = assignment.route_id || '';
        row.dataset.routeLabel = assignment.route_label || '';
        row.dataset.sourceRouteId = assignment.source_route_id || '';
        row.dataset.nextDepartureTime = assignment.next_departure_time || '';
        row.dataset.departureLabel = assignment.departure_label || '';
        const destination = assignment.destination || assignment.agency_name;
        row.title = `${serviceRouteCode(assignment)}: ${destination}`;
        row.appendChild(createElement(
          'strong',
          'platform-card__route',
          serviceRouteCode(assignment)
        ));
        const routeBadge = row.lastChild;
        const style = getVehicleStyle(assignment, routeStyles);
        routeBadge.style.setProperty('--route-color', style.color);
        routeBadge.style.setProperty('--route-text-color', style.textColor);
        row.appendChild(createElement(
          'span',
          'platform-card__destination',
          destination
        ));
        const departure = assignment.departure_label
          ? { primary: assignment.departure_label, secondary: '', state: 'unavailable' }
          : departureDisplay(assignment.next_departure_time);
        const departureBlock = createElement('span', 'platform-card__departure');
        const countdown = createElement('strong', 'platform-card__service-countdown', departure.primary);
        countdown.dataset.live = 'false';
        countdown.dataset.departureState = departure.state;
        countdown.hidden = !countdown.textContent;
        departureBlock.appendChild(countdown);
        const source = createElement('span', 'platform-card__service-source', 'Live');
        source.dataset.source = 'scheduled';
        source.hidden = true;
        departureBlock.appendChild(source);
        row.appendChild(departureBlock);
        services.appendChild(row);
      });
      card.appendChild(services);
      assignmentLayerEl.appendChild(card);
    });

    const connections = createElement('section', 'platform-connections');
    connections.setAttribute('aria-label', 'Other terminal connections');
    MAP_CONNECTIONS.forEach((connection) => {
      const row = createElement('article', 'platform-connection');
      row.dataset.platform = connection.platform;
      row.appendChild(createElement(
        'strong',
        'platform-connection__platform',
        platformDisplayName(connection.platform)
      ));
      row.appendChild(createAgencyLogo(connection.brand, 'platform-connection__agency-logo'));
      row.appendChild(createElement(
        'strong',
        'platform-connection__route',
        connection.routes.map((route) => route.label).join(' / ')
      ));
      const copy = createElement('span', 'platform-connection__copy');
      copy.appendChild(createElement(
        'strong',
        'platform-connection__stop',
        connection.serviceLabel || connection.agency
      ));
      copy.appendChild(createElement('span', 'platform-connection__agency', connection.stop));
      row.appendChild(copy);
      connections.appendChild(row);
    });

    if (!grouped['14'] || !grouped['14'].length) {
      const retired = createElement('section', 'platform-card platform-card--inactive');
      retired.dataset.platform = '14';
      const heading = createElement('header', 'platform-card__heading');
      heading.appendChild(createElement('h2', 'platform-card__title', 'Stop 14'));
      heading.appendChild(createElement('span', 'platform-card__state', 'Assignment unavailable'));
      retired.appendChild(heading);
      const agency = createElement('div', 'platform-card__agency');
      agency.appendChild(createAgencyLogo(
        platformAgencyBrand('14', []),
        'platform-card__agency-logo'
      ));
      retired.appendChild(agency);
      retired.appendChild(createElement('div', 'platform-card__inactive-text', 'Scheduled service data is unavailable'));
      assignmentLayerEl.appendChild(retired);
    }
    assignmentLayerEl.appendChild(connections);
    Object.keys(PLATFORM_MAP_POSITIONS).forEach((platform) => {
      renderMapPlatformCard(platform, grouped[platform] || []);
    });
    renderMapLandmarks();
    updatePlatformActivity(lastVisibleVehicles, lastTerminalDepartures);
    scheduleProjectionRefresh();
  }

  function refreshTerminalLayout() {
    return dataClient.fetchTerminalLayout({ timeoutMs: REQUEST_TIMEOUT_MS })
      .then((layout) => renderAssignments(layout))
      .catch((err) => {
        console.warn('Platform assignment refresh unavailable; keeping current times:', err);
      });
  }

  // Riders only need to know when live times may be wrong. Feed details for
  // each agency stay in the console and the monitor, not on the public screen.
  function applyFeedState(payload, freshness) {
    const status = freshness.feed_status;
    lastDataTimestamp = freshness.latest_data_timestamp || lastDataTimestamp;
    if (status === 'offline') {
      setConnection('offline', 'SCHEDULED TIMES');
      setStatus(LIVE_TRACKING_UNAVAILABLE_MESSAGE, 'offline');
      return;
    }
    if (status === 'delayed') {
      setConnection('warning', 'DELAYED');
      setStatus('Live bus tracking is delayed. Times may not reflect recent changes.');
      return;
    }
    if (status === 'empty') {
      setConnection('warning', 'SCHEDULED TIMES');
      setStatus('');
      return;
    }
    setConnection('live', 'LIVE');
    setStatus('');
  }

  function renderPayload(payload, departuresPayload) {
    const freshness = assessVehicleFeedFreshness(payload, { delayedAfterMs, offlineAfterMs });
    applyFeedState(payload, freshness);
    const visible = selectVehiclesForDisplay(payload, freshness, { maxAgeMs: offlineAfterMs })
      .filter((vehicle) => isSourceVehicleVisible(vehicle, payload && payload.sources));
    renderVehicles(
      visible,
      departuresPayload === undefined
        ? lastTerminalDepartures
        : normalizeDepartureBoard(departuresPayload)
    );
  }

  function pollVehicles() {
    // A watchdog restart bumps the generation, so a late reply from a stalled
    // request cannot start a second polling loop.
    const generation = ++pollGeneration;
    Promise.all([
      dataClient.fetchVehicles({ timeoutMs: REQUEST_TIMEOUT_MS }),
      dataClient.fetchDepartures(30, { board: 'allandale', timeoutMs: REQUEST_TIMEOUT_MS }).catch((err) => {
        console.warn('Platform departures poll failed:', err);
        return null;
      }),
    ])
      .then(([payload, departuresPayload]) => {
        if (generation !== pollGeneration) return;
        if (!payload || !Array.isArray(payload.vehicles)) throw new Error('Invalid vehicle response');
        lastPayload = payload;
        lastHealthyPollAt = Date.now();
        if (departuresPayload) {
          lastDeparturesAt = lastHealthyPollAt;
          renderPayload(payload, departuresPayload);
        } else {
          // Keep the last board briefly, then use timetable times instead.
          const keepBoard = lastHealthyPollAt - lastDeparturesAt < DEPARTURES_RETENTION_MS;
          renderPayload(payload, keepBoard ? undefined : null);
        }
      })
      .catch((err) => {
        if (generation !== pollGeneration) return;
        console.warn('Platform vehicle poll failed:', err);
        if (lastPayload) {
          // One failed poll is not an outage. The freshness rules mark the
          // data delayed or offline as the last good payload ages.
          renderPayload(lastPayload);
          return;
        }
        setConnection('offline', 'SCHEDULED TIMES');
        setStatus(LIVE_TRACKING_UNAVAILABLE_MESSAGE, 'offline');
        renderVehicles([], []);
      })
      .then(() => {
        if (generation !== pollGeneration) return;
        lastPollSettledAt = Date.now();
        pollTimer = setTimeout(pollVehicles, pollMs);
      });
  }

  function restartPollingIfStalled() {
    if (!isPollStalled(lastPollSettledAt, Date.now(), pollMs)) return;
    console.warn('Platform poll loop stalled; restarting it.');
    if (pollTimer) clearTimeout(pollTimer);
    lastPollSettledAt = Date.now();
    pollVehicles();
  }

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
    });
    clockEl.dateTime = now.toISOString();
    lastUpdatedEl.textContent = relativeAge(lastDataTimestamp);
  }

  function loadServiceNotice() {
    dataClient.fetchServiceStatus(undefined, { timeoutMs: REQUEST_TIMEOUT_MS })
      .then((status) => {
        const upcoming = status && status.upcoming_warning && status.upcoming_warning.message;
        const special = status && status.is_special_service && status.today;
        const message = upcoming || (special && status.message) || '';
        serviceNoticeTextEl.textContent = normalizeServiceNotice(message);
        serviceNoticeEl.hidden = !serviceNoticeTextEl.textContent;
        displayLegendEl.hidden = !serviceNoticeEl.hidden;
      })
      .catch((err) => {
        serviceNoticeEl.hidden = true;
        displayLegendEl.hidden = false;
        console.warn('Platform service status unavailable:', err);
      });
  }

  // 1 at the TV's 1920x1080; smaller when the map is drawn smaller.
  function updateMapScale() {
    const scale = mapPlaneEl.clientHeight / BASEMAP_CALIBRATION.height;
    if (scale > 0) mapStageEl.style.setProperty('--map-scale', String(Math.min(1.2, scale)));
  }
  updateMapScale();

  const handleResize = () => {
    updateMapScale();
    scheduleProjectionRefresh();
  };
  window.addEventListener('resize', handleResize);

  function applyConfig(config) {
    if (config && config.base_path) dataClient.setBasePath(config.base_path);
    if (Number(config && config.poll_ms) > 0) pollMs = Number(config.poll_ms);
    if (Number(config && config.feed_delayed_after_ms) > 0) delayedAfterMs = Number(config.feed_delayed_after_ms);
    if (Number(config && config.feed_offline_after_ms) > 0) offlineAfterMs = Number(config.feed_offline_after_ms);
  }

  // After a power cut the TV can start before the network does. Keep trying
  // so the feed settings are picked up once the connection is back.
  function loadConfigWithRetry(delayMs = 5000) {
    return dataClient.fetchConfig({ timeoutMs: REQUEST_TIMEOUT_MS })
      .then(applyConfig)
      .catch((err) => {
        console.warn(`Platform-map configuration unavailable; retrying in ${delayMs / 1000}s:`, err);
        configRetryTimer = setTimeout(
          () => loadConfigWithRetry(Math.min(delayMs * 2, CONFIG_RETRY_MAX_MS)),
          delayMs
        );
      });
  }

  const startedAt = Date.now();
  const buildIdMeta = document.querySelector('meta[name="app-build-id"]');
  const currentBuildId = buildIdMeta ? buildIdMeta.getAttribute('content') || '' : '';
  let lastBuildCheckAt = startedAt;
  let reloadPending = false;

  // Only reload when the server answers; a reload while it is down would
  // leave the TV on a browser error page with nothing to recover it.
  function reloadWhenServerReachable(reason) {
    if (reloadPending) return;
    reloadPending = true;
    dataClient.fetchConfig({ timeoutMs: REQUEST_TIMEOUT_MS })
      .then(() => {
        console.warn(`Reloading platform map: ${reason}.`);
        window.location.reload();
      })
      .catch(() => {
        reloadPending = false;
      });
  }

  function runKioskChecks() {
    const now = Date.now();
    restartPollingIfStalled();
    if (isNightlyReloadDue(now, startedAt)) {
      reloadWhenServerReachable('nightly refresh');
      return;
    }
    if (now - lastHealthyPollAt > NO_DATA_RELOAD_MS) {
      reloadWhenServerReachable('no data received for 10 minutes');
      return;
    }
    if (currentBuildId && now - lastBuildCheckAt >= BUILD_CHECK_INTERVAL_MS) {
      lastBuildCheckAt = now;
      fetchText(window.location.href, REQUEST_TIMEOUT_MS)
        .then((html) => {
          if (isNewBuild(currentBuildId, html)) reloadWhenServerReachable('new version deployed');
        })
        .catch(() => {});
    }
  }

  function startTimers() {
    updateClock();
    timers.push(setInterval(updateClock, 1000));
    timers.push(setInterval(() => {
      if (lastPayload) renderPayload(lastPayload);
    }, 5000));
    loadServiceNotice();
    timers.push(setInterval(loadServiceNotice, 5 * 60 * 1000));
    layoutTimer = setInterval(refreshTerminalLayout, 60 * 1000);
    timers.push(setInterval(runKioskChecks, KIOSK_CHECK_INTERVAL_MS));
    pollVehicles();
  }

  loadConfigWithRetry()
    .then(() => Promise.all([
      dataClient.fetchRoutes({ timeoutMs: REQUEST_TIMEOUT_MS }).catch((err) => {
        console.warn('Platform route styles unavailable:', err);
        return null;
      }),
      dataClient.fetchTerminalLayout({ timeoutMs: REQUEST_TIMEOUT_MS }).catch((err) => {
        console.warn('Platform assignments unavailable:', err);
        return { assignments: [] };
      }),
    ]))
    .then(([routes, layout]) => {
      routeStyles = routeStyleIndex(routes);
      renderAssignments(layout);
    })
    .catch((err) => {
      // Never let a render error stop the clock, polling and recovery checks.
      console.error('Platform map startup render failed:', err);
    })
    .then(startTimers);

  return {
    destroy() {
      if (pollTimer) clearTimeout(pollTimer);
      pollGeneration += 1;
      if (configRetryTimer) clearTimeout(configRetryTimer);
      timers.forEach((timer) => clearInterval(timer));
      if (layoutTimer) clearInterval(layoutTimer);
      if (projectionFrame) cancelAnimationFrame(projectionFrame);
      window.removeEventListener('resize', handleResize);
      if (platformBasemap) platformBasemap.remove();
    },
  };
}

function bootstrap() {
  window.__platformMapApp = setupPlatformApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
