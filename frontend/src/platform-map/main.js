import L from 'leaflet';
import mapboxgl from 'mapbox-gl';
import { createDataClient } from '../data/client.js';
import { BATT_COORDS, getTerminalListStatus } from '../map/nearby-vehicles.js';
import { clusterVehicles, distanceBetweenMeters } from '../map/vehicle-groups.js';
import feedFreshness from '../../../shared/feed-freshness.js';
import {
  getRouteEightDirection,
  getVehicleLabel,
  getVehicleStyle,
  groupPlatformAssignments,
  isTerminalDisplayVehicle,
  normalizeBearing,
  projectVehicleToImage,
} from './model.js';

const { assessVehicleFeedFreshness, selectVehiclesForDisplay } = feedFreshness;
const DEFAULT_POLL_MS = 10000;
const CLUSTER_DISTANCE_METERS = 8;
const APPROACHING_WINDOW_MS = 5 * 60 * 1000;
const APPROACHING_DISTANCE_METERS = 500;
const DEPARTURE_NOW_GRACE_MS = 60 * 1000;
const DEPARTURE_PAGE_ROTATION_SECONDS = 15;
const PLATFORM_MAP_CENTER = Object.freeze([44.373974, -79.689423]);
const PLATFORM_MAP_ZOOM = 18.1;
const PLATFORM_MAPBOX_ZOOM = PLATFORM_MAP_ZOOM - 1;
const PLATFORM_BASEMAP_LOAD_TIMEOUT_MS = 15000;
const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'barrie_transit', agencyId: 'barrie-transit', label: 'Barrie Transit', short: 'BT' }),
  Object.freeze({ key: 'go_transit', agencyId: 'go-transit', label: 'GO Transit', short: 'GO' }),
  Object.freeze({ key: 'ontario_northland', agencyId: 'ontario-northland', label: 'Ontario Northland', short: 'ON' }),
  Object.freeze({ key: 'simcoe_linx', agencyId: 'simcoe-linx', label: 'Simcoe LINX', short: 'LINX' }),
]);
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
const DEPARTURE_PAGES = Object.freeze([
  Object.freeze({ label: 'P1–P6', platforms: Object.freeze(['1', '2', '3', '4', '5', '6']) }),
  Object.freeze({ label: 'P7–P13 + Stop 14', platforms: Object.freeze(['7', '8', '9', '10', '11', '12', '13', '14']) }),
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
// Center of the terminal building footprint identified on the display map.
const TERMINAL_BUILDING_COORDINATES = Object.freeze({
  lat: 44.374119,
  lon: -79.690116,
});
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

const SOURCE_STATUS_LABELS = Object.freeze({
  live: 'Live',
  delayed: 'Locations delayed',
  empty: 'No vehicles reported',
  offline: 'Locations unavailable',
  'not-tracked': 'Vehicle locations unavailable',
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

function tileHasVisiblePixels(tile) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return true;
    context.drawImage(tile, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 8) return true;
    }
    return false;
  } catch (_err) {
    // A provider without CORS-safe tiles can still be displayed; only pixel
    // inspection is unavailable in that case.
    return true;
  }
}

function projectedPercent(container, point) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || width <= 0 || height <= 0) return null;
  return { x: point.x / width * 100, y: point.y / height * 100 };
}

function setupLeafletBasemap(container, mapPlane, basemap, onProjectionChange) {
  const map = L.map(container, {
    attributionControl: true,
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
    zoomSnap: 0.1,
    fadeAnimation: false,
    zoomAnimation: false,
  });
  map.attributionControl.setPrefix(false);
  map.setView(PLATFORM_MAP_CENTER, PLATFORM_MAP_ZOOM, { animate: false });

  let activeLayer = null;
  let tileErrors = 0;
  let fallbackStarted = false;

  function mountLayer(url, options = {}) {
    const layer = L.tileLayer(url, {
      tileSize: Number(options.tile_size) || 256,
      zoomOffset: Number(options.zoom_offset) || 0,
      maxZoom: Number(options.max_zoom) || 19,
      opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : 1,
      attribution: options.attribution || '',
      crossOrigin: true,
    });
    layer.on('tileload', (event) => {
      if (tileHasVisiblePixels(event.tile)) {
        mapPlane.classList.add('map-plane--live-basemap');
        if (onProjectionChange) onProjectionChange();
      }
    });
    layer.on('tileerror', () => {
      tileErrors += 1;
      if (fallbackStarted || tileErrors < 3 || !basemap.fallback_url) return;
      fallbackStarted = true;
      if (activeLayer) map.removeLayer(activeLayer);
      activeLayer = mountLayer(basemap.fallback_url, {
        attribution: basemap.fallback_attribution,
      });
    });
    layer.addTo(map);
    return layer;
  }

  activeLayer = mountLayer(basemap.url || basemap.fallback_url, basemap);
  requestAnimationFrame(() => {
    map.invalidateSize(false);
    if (onProjectionChange) onProjectionChange();
  });
  return {
    project(lat, lon) {
      return projectedPercent(container, map.latLngToContainerPoint([lat, lon]));
    },
    remove() { map.remove(); },
    resize() {
      map.invalidateSize(false);
      if (onProjectionChange) onProjectionChange();
    },
  };
}

function setupPlatformBasemap(config, onProjectionChange) {
  const container = document.getElementById('platform-basemap');
  const mapPlane = container && container.closest('.map-plane');
  const basemap = config && (config.platform_basemap || config.basemap);
  if (!container || !mapPlane || !basemap) return null;

  if (basemap.provider !== 'mapbox-gl') {
    if (!basemap.url && !basemap.fallback_url) return null;
    return setupLeafletBasemap(container, mapPlane, basemap, onProjectionChange);
  }

  let map = null;
  let fallbackMap = null;
  let fallbackStarted = false;
  let styleLoaded = false;
  let loadTimer = null;

  function startFallback(reason) {
    if (fallbackStarted || !basemap.fallback_url) return;
    fallbackStarted = true;
    if (loadTimer) clearTimeout(loadTimer);
    if (reason) console.warn(`Platform Mapbox basemap unavailable (${reason}); using OpenStreetMap.`);
    if (map) {
      map.remove();
      map = null;
    }
    container.replaceChildren();
    mapPlane.classList.remove('map-plane--live-basemap');
    fallbackMap = setupLeafletBasemap(container, mapPlane, {
      url: basemap.fallback_url,
      attribution: basemap.fallback_attribution,
      tile_size: 256,
      zoom_offset: 0,
      max_zoom: 19,
    }, onProjectionChange);
  }

  if (
    !basemap.style_url || !basemap.access_token ||
    typeof mapboxgl.supported !== 'function' ||
    !mapboxgl.supported({ failIfMajorPerformanceCaveat: true })
  ) {
    startFallback('WebGL is not supported');
    return fallbackMap;
  }

  mapboxgl.accessToken = basemap.access_token;
  map = new mapboxgl.Map({
    container,
    style: basemap.style_url,
    center: [PLATFORM_MAP_CENTER[1], PLATFORM_MAP_CENTER[0]],
    zoom: PLATFORM_MAPBOX_ZOOM,
    bearing: 0,
    pitch: 0,
    interactive: false,
    attributionControl: true,
    fadeDuration: 0,
    renderWorldCopies: false,
  });

  loadTimer = setTimeout(() => startFallback('load timed out'), PLATFORM_BASEMAP_LOAD_TIMEOUT_MS);
  map.once('load', () => {
    styleLoaded = true;
    if (loadTimer) clearTimeout(loadTimer);
    mapPlane.classList.add('map-plane--live-basemap');
    if (onProjectionChange) onProjectionChange();
  });
  map.on('error', (event) => {
    const message = event && event.error && event.error.message || 'style failed to load';
    if (!styleLoaded) startFallback(message);
    else console.warn('Platform Mapbox resource error:', event.error || event);
  });
  map.getCanvas().addEventListener('webglcontextlost', () => startFallback('WebGL context was lost'), { once: true });
  requestAnimationFrame(() => map && map.resize());

  return {
    project(lat, lon) {
      if (fallbackMap) return fallbackMap.project(lat, lon);
      if (!map) return null;
      return projectedPercent(container, map.project([lon, lat]));
    },
    remove() {
      if (loadTimer) clearTimeout(loadTimer);
      if (map) map.remove();
      if (fallbackMap) fallbackMap.remove();
    },
    resize() {
      if (map) map.resize();
      if (fallbackMap) fallbackMap.resize();
      if (onProjectionChange) onProjectionChange();
    },
  };
}

function formatFeedTime(timestampSeconds) {
  const date = new Date(Number(timestampSeconds) * 1000);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function formatScheduledDeparture(timestampSeconds) {
  const timestamp = Number(timestampSeconds);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function localDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function departureDisplay(timestampSeconds, nowMs = Date.now()) {
  const timestamp = Number(timestampSeconds);
  const departure = new Date(timestamp * 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(departure.getTime())) {
    return { primary: 'No time', secondary: '', state: 'unavailable' };
  }

  const differenceMs = departure.getTime() - nowMs;
  if (differenceMs < -DEPARTURE_NOW_GRACE_MS) {
    return { primary: 'No time', secondary: '', state: 'past' };
  }

  const scheduledTime = formatScheduledDeparture(timestamp);
  const todayKey = localDateKey(new Date(nowMs));
  const departureKey = localDateKey(departure);
  if (departureKey === todayKey) {
    const minutes = Math.max(0, Math.ceil(differenceMs / 60000));
    return {
      primary: minutes === 0 ? 'Due now' : `${minutes} min`,
      secondary: scheduledTime,
      state: minutes <= 10 ? 'soon' : 'today',
    };
  }

  const tomorrowKey = localDateKey(new Date(nowMs + 24 * 60 * 60 * 1000));
  const dayLabel = departureKey === tomorrowKey
    ? 'Tomorrow'
    : new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      weekday: 'short',
    }).format(departure);
  return {
    primary: dayLabel,
    secondary: scheduledTime,
    state: 'future-day',
  };
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
  const distance = distanceBetweenMeters(
    Number(vehicle.lat),
    Number(vehicle.lon),
    BATT_COORDS.lat,
    BATT_COORDS.lon
  );
  return getTerminalListStatus(vehicle, distance);
}

function livePlatformState(vehicle) {
  const status = terminalDisplayStatus(vehicle);
  if (status === 'at_terminal') return 'occupied';
  if (status === 'approaching') {
    const distance = distanceBetweenMeters(
      Number(vehicle.lat),
      Number(vehicle.lon),
      BATT_COORDS.lat,
      BATT_COORDS.lon
    );
    const departureMs = Number(vehicle && vehicle.terminal_departure_time) * 1000;
    const timeUntilDeparture = departureMs - Date.now();
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

function activityCountdown(vehicle, state, concise = false) {
  const departureMs = Number(vehicle && vehicle.terminal_departure_time) * 1000;
  if (!Number.isFinite(departureMs) || departureMs <= 0) return '';
  const differenceMs = departureMs - Date.now();
  const minutes = Math.ceil(differenceMs / 60000);
  if (concise) return minutes <= 0 ? 'Now' : `${minutes} min`;
  if (state === 'approaching') {
    return minutes <= 0 ? 'Due now' : `Due in ${minutes} min`;
  }
  return minutes <= 0 ? 'Departs now' : `Departs in ${minutes} min`;
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
  return terminalDepartures.find((departure) => (
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
  let layoutTimer = null;
  let departurePageTimer = null;
  let platformBasemap = null;
  let projectionFrame = null;

  const busLayer = document.getElementById('bus-layer');
  const statusEl = document.getElementById('platform-status');
  const emptyEl = document.getElementById('terminal-empty');
  const connectionEl = document.getElementById('connection-status');
  const connectionLabelEl = document.getElementById('connection-label');
  const clockEl = document.getElementById('platform-clock');
  const lastUpdatedEl = document.getElementById('last-updated');
  const sourceStatusesEl = document.getElementById('source-statuses');
  const assignmentLayerEl = document.getElementById('assignment-layer');
  const departurePageLabelEl = document.getElementById('departure-page-label');
  const departurePageCountEl = document.getElementById('departure-page-count');
  const departurePageCountdownEl = document.getElementById('departure-page-countdown');
  const departurePageIndicatorEl = document.querySelector('.departure-page-indicator');
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
  let feedDisplayState = 'connecting';
  let lastVisibleVehicles = [];
  let lastTerminalDepartures = [];
  let activeDeparturePage = 0;
  let departurePageSecondsRemaining = DEPARTURE_PAGE_ROTATION_SECONDS;

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
    anchorLabel.dataset.labelPlacement = REVERSED_POINTER_LABEL_PLATFORMS.has(String(platform))
      ? defaultLabelPlacement === 'above' ? 'below' : 'above'
      : defaultLabelPlacement;
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

  function positionMapLandmark(landmark) {
    const position = projectCoordinate(landmark.dataset.lat, landmark.dataset.lon);
    if (!position) return;
    const stageRect = mapStageEl.getBoundingClientRect();
    const planeRect = mapPlaneEl.getBoundingClientRect();
    landmark.style.left = `${planeRect.left - stageRect.left + planeRect.width * position.x / 100}px`;
    landmark.style.top = `${planeRect.top - stageRect.top + planeRect.height * position.y / 100}px`;
  }

  function positionMapPlaneLandmark(landmark) {
    const position = projectCoordinate(landmark.dataset.lat, landmark.dataset.lon);
    if (!position) return;
    landmark.style.left = `${position.x}%`;
    landmark.style.top = `${position.y}%`;
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
    mapLabelLayerEl.querySelectorAll('.map-terminal-building')
      .forEach(positionMapLandmark);
    mapPlatformLayerEl.querySelectorAll('.map-terminal-building__footprint--map')
      .forEach(positionMapPlaneLandmark);
    if (lastPayload) renderPayload(lastPayload);
  }

  function scheduleProjectionRefresh() {
    if (projectionFrame) cancelAnimationFrame(projectionFrame);
    projectionFrame = requestAnimationFrame(() => {
      projectionFrame = null;
      refreshProjectedOverlays();
    });
  }

  function departurePageForPlatform(platform) {
    return DEPARTURE_PAGES.findIndex((page) => page.platforms.includes(String(platform)));
  }

  function showDeparturePage(pageIndex) {
    const normalizedPage = ((Number(pageIndex) || 0) + DEPARTURE_PAGES.length) % DEPARTURE_PAGES.length;
    activeDeparturePage = normalizedPage;
    const page = DEPARTURE_PAGES[activeDeparturePage];
    assignmentLayerEl.querySelectorAll('[data-departure-page]').forEach((item) => {
      const isActive = Number(item.dataset.departurePage) === activeDeparturePage;
      item.hidden = !isActive;
      item.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
    assignmentLayerEl.dataset.activePage = String(activeDeparturePage);
    assignmentLayerEl.setAttribute('aria-label', `Scheduled platform assignments, ${page.label}`);
    departurePageLabelEl.textContent = page.label;
    departurePageCountEl.textContent = `${activeDeparturePage + 1} / ${DEPARTURE_PAGES.length}`;
    departurePageIndicatorEl.setAttribute(
      'aria-label',
      `Departure page ${activeDeparturePage + 1} of ${DEPARTURE_PAGES.length}: ${page.label}`
    );
    departurePageIndicatorEl.querySelectorAll('.departure-page-indicator__dot').forEach((dot) => {
      dot.classList.toggle('departure-page-indicator__dot--active', Number(dot.dataset.page) === activeDeparturePage);
    });
  }

  function renderDeparturePageCountdown() {
    departurePageCountdownEl.textContent = `Next page in ${departurePageSecondsRemaining}s`;
  }

  function startDeparturePageRotation() {
    if (departurePageTimer) clearInterval(departurePageTimer);
    departurePageSecondsRemaining = DEPARTURE_PAGE_ROTATION_SECONDS;
    showDeparturePage(activeDeparturePage);
    renderDeparturePageCountdown();
    departurePageTimer = setInterval(() => {
      departurePageSecondsRemaining -= 1;
      if (departurePageSecondsRemaining <= 0) {
        showDeparturePage(activeDeparturePage + 1);
        departurePageSecondsRemaining = DEPARTURE_PAGE_ROTATION_SECONDS;
      }
      renderDeparturePageCountdown();
    }, 1000);
  }

  function setConnection(state, label) {
    feedDisplayState = state;
    connectionEl.className = `connection-status status-${state}`;
    connectionLabelEl.textContent = label;
  }

  function setStatus(message, state = 'warning') {
    statusEl.textContent = message || '';
    statusEl.dataset.state = state;
    statusEl.hidden = !message;
  }

  function renderSourceStatuses(sources) {
    while (sourceStatusesEl.firstChild) {
      sourceStatusesEl.removeChild(sourceStatusesEl.firstChild);
    }
    const problemDefinitions = SOURCE_DEFINITIONS.map((definition) => {
      const source = definition.key && sources && sources[definition.key];
      const status = definition.untracked ? 'not-tracked' : normalizedSourceStatus(source);
      return { definition, status };
    }).filter((entry) => entry.status !== 'live');
    problemDefinitions.forEach(({ definition, status }) => {
      const statusLabel = SOURCE_STATUS_LABELS[status] || 'Locations unavailable';
      const chip = createElement('div', 'source-chip');
      chip.dataset.status = status;
      chip.title = `${definition.label}: ${statusLabel}`;
      chip.setAttribute('aria-label', `${definition.label}: ${statusLabel}`);
      chip.appendChild(createElement('strong', 'source-chip__agency', definition.short));
      chip.appendChild(createElement('span', 'source-chip__dot'));
      chip.appendChild(createElement('span', 'source-chip__status', statusLabel));
      sourceStatusesEl.appendChild(chip);
    });
    sourceStatusesEl.hidden = problemDefinitions.length === 0;
  }

  function updatePlatformActivity(vehicles, terminalDepartures = lastTerminalDepartures) {
    const platformStates = new Map();
    (Array.isArray(vehicles) ? vehicles : []).forEach((vehicle) => {
      const platform = platformForVehicle(vehicle);
      const state = livePlatformState(vehicle);
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
        const hasRealtimeDeparture = terminalDeparture
          ? String(terminalDeparture.departure_source || '').toLowerCase() === 'realtime'
          : Boolean(active && state);
        row.classList.toggle('platform-card__service--active', active);
        row.setAttribute('aria-current', active ? 'true' : 'false');
        const countdown = row.querySelector('.platform-card__service-countdown');
        const scheduled = row.querySelector('.platform-card__service-scheduled');
        const source = row.querySelector('.platform-card__service-source');
        if (source) {
          source.textContent = hasRealtimeDeparture ? 'Live' : 'Scheduled';
          source.dataset.source = hasRealtimeDeparture ? 'live' : 'scheduled';
        }
        if (countdown) {
          const displayTimestamp = terminalDeparture && terminalDeparture.departure_time
            ? terminalDeparture.departure_time
            : active && state && activeVehicle.terminal_departure_time
              ? activeVehicle.terminal_departure_time
              : row.dataset.nextDepartureTime;
          const departure = row.dataset.departureLabel && !hasRealtimeDeparture && !terminalDeparture
            ? { primary: row.dataset.departureLabel, secondary: '', state: 'unavailable' }
            : departureDisplay(displayTimestamp);
          const physicalStatus = active && state === 'occupied'
            ? activityCountdown(activeVehicle, state, true)
            : '';
          countdown.textContent = physicalStatus || departure.primary;
          countdown.dataset.live = hasRealtimeDeparture ? 'true' : 'false';
          countdown.dataset.departureState = departure.state;
          countdown.hidden = !countdown.textContent;
          if (scheduled) {
            scheduled.textContent = departure.secondary;
            scheduled.hidden = !scheduled.textContent;
          }
        }
      });
      const badge = card.querySelector('.platform-card__state');
      if (!badge) return;
      badge.textContent = state === 'occupied'
        ? 'At platform'
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
          ? 'At platform'
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
      const status = card.querySelector('.map-platform-card__status');
      if (!status) return;
      if (state === 'occupied') {
        const departureMs = Number(activeVehicle && activeVehicle.terminal_departure_time) * 1000;
        const differenceMs = departureMs - Date.now();
        const minutes = Number.isFinite(departureMs)
          ? Math.ceil(differenceMs / 60000)
          : null;
        status.textContent = minutes === null
          ? 'At platform'
          : differenceMs < -DEPARTURE_NOW_GRACE_MS
            ? 'At platform'
            : `Departs ${minutes <= 0 ? 'now' : `${minutes}m`}`;
      } else if (state === 'approaching') {
        status.textContent = `${vehicleRouteCode(activeVehicle)} arriving`;
      } else {
        status.textContent = card.dataset.hasSchedule === 'true' ? '' : 'No schedule';
      }
      status.hidden = !status.textContent;
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
    const mapStatus = createElement(
      'div',
      'map-platform-card__status',
      assignments.length ? '' : 'No schedule'
    );
    mapStatus.hidden = !mapStatus.textContent;
    body.appendChild(mapStatus);
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

  function renderMapLandmarks() {
    mapPlatformLayerEl.appendChild(createElement('span', 'map-edge-mask map-edge-mask--left'));
    MAP_CONNECTIONS.forEach(renderMapConnection);

    const terminalBuilding = createElement('section', 'map-terminal-building');
    terminalBuilding.dataset.lat = String(TERMINAL_BUILDING_COORDINATES.lat);
    terminalBuilding.dataset.lon = String(TERMINAL_BUILDING_COORDINATES.lon);
    terminalBuilding.setAttribute('aria-label', 'Allandale Terminal Building. You are here.');
    const footprint = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    footprint.setAttribute('class', 'map-terminal-building__footprint map-terminal-building__footprint--map');
    footprint.setAttribute('viewBox', '0 0 200 140');
    footprint.setAttribute('aria-hidden', 'true');
    footprint.dataset.lat = String(TERMINAL_BUILDING_COORDINATES.lat);
    footprint.dataset.lon = String(TERMINAL_BUILDING_COORDINATES.lon);
    const buildingShape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    buildingShape.setAttribute('points', '66,10 122,19 118,96 111,107 64,98 53,57');
    footprint.appendChild(buildingShape);
    mapPlatformLayerEl.appendChild(footprint);
    positionMapPlaneLandmark(footprint);
    const callout = createElement('span', 'map-terminal-building__callout');
    callout.appendChild(createElement(
      'strong',
      'map-terminal-building__name',
      'Allandale Terminal Building'
    ));
    terminalBuilding.appendChild(callout);
    const here = createElement('span', 'map-terminal-building__here');
    here.appendChild(createElement('span', 'map-terminal-building__pin'));
    here.appendChild(createElement('strong', '', 'You Are Here'));
    terminalBuilding.appendChild(here);
    mapLabelLayerEl.appendChild(terminalBuilding);
    positionMapLandmark(terminalBuilding);

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

  function renderVehicles(vehicles, terminalDepartures = null) {
    lastVisibleVehicles = Array.isArray(vehicles) ? vehicles : [];
    if (Array.isArray(terminalDepartures)) lastTerminalDepartures = terminalDepartures;
    const clusters = clusterVehicles(
      lastVisibleVehicles.filter(isTerminalDisplayVehicle),
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
    emptyEl.hidden = clusters.length !== 0 ||
      feedDisplayState === 'offline' ||
      feedDisplayState === 'warning' ||
      !statusEl.hidden;
  }

  function renderAssignments(layout) {
    while (assignmentLayerEl.firstChild) {
      assignmentLayerEl.removeChild(assignmentLayerEl.firstChild);
    }
    while (mapPlatformLayerEl.firstChild) {
      mapPlatformLayerEl.removeChild(mapPlatformLayerEl.firstChild);
    }
    mapLabelLayerEl.querySelectorAll('.map-platform-anchor__label').forEach((label) => label.remove());
    mapLabelLayerEl.querySelectorAll('.map-terminal-building').forEach((landmark) => landmark.remove());
    mapLabelLayerEl.querySelectorAll('.map-dropoff-card[data-geographic-card="true"]').forEach((card) => card.remove());
    Object.values(mapLabelRails).forEach((rail) => rail.replaceChildren());
    const grouped = groupPlatformAssignments(layout && layout.assignments);
    const assignmentsForPlatform = (platform) => grouped[platform] || [];
    const orderedPlatforms = PLATFORM_DISPLAY_ORDER
      .filter((platform) => departurePageForPlatform(platform) >= 0 && assignmentsForPlatform(platform).length);

    orderedPlatforms.forEach((platform) => {
      const assignments = assignmentsForPlatform(platform);
      const card = createElement('section', 'platform-card');
      if (assignments.length > 1) card.classList.add('platform-card--multi-service');
      card.dataset.platform = platform;
      card.dataset.departurePage = String(departurePageForPlatform(platform));
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
        const departureMeta = createElement('span', 'platform-card__departure-meta');
        const scheduled = createElement('span', 'platform-card__service-scheduled', departure.secondary);
        scheduled.hidden = !scheduled.textContent;
        departureMeta.appendChild(scheduled);
        const source = createElement('span', 'platform-card__service-source', 'Scheduled');
        source.dataset.source = 'scheduled';
        departureMeta.appendChild(source);
        departureBlock.appendChild(departureMeta);
        row.appendChild(departureBlock);
        services.appendChild(row);
      });
      card.appendChild(services);
      assignmentLayerEl.appendChild(card);
    });

    if (!grouped['14'] || !grouped['14'].length) {
      const retired = createElement('section', 'platform-card platform-card--inactive');
      retired.dataset.platform = '14';
      retired.dataset.departurePage = String(departurePageForPlatform('14'));
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
    Object.keys(PLATFORM_MAP_POSITIONS).forEach((platform) => {
      renderMapPlatformCard(platform, grouped[platform] || []);
    });
    renderMapLandmarks();
    showDeparturePage(activeDeparturePage);
    updatePlatformActivity(lastVisibleVehicles, lastTerminalDepartures);
    scheduleProjectionRefresh();
  }

  function refreshTerminalLayout() {
    return dataClient.fetchTerminalLayout()
      .then((layout) => renderAssignments(layout))
      .catch((err) => {
        console.warn('Platform assignment refresh unavailable; keeping current times:', err);
      });
  }

  function applyFeedState(payload, freshness) {
    const sources = payload && payload.sources || null;
    const status = freshness.feed_status;
    const reportedAt = formatFeedTime(freshness.latest_data_timestamp);
    const sourceProblems = SOURCE_DEFINITIONS
      .filter((definition) => definition.key)
      .map((definition) => ({
        label: definition.label,
        status: normalizedSourceStatus(sources && sources[definition.key]),
      }))
      .filter((entry) => entry.status === 'offline' || entry.status === 'delayed');

    renderSourceStatuses(sources);
    lastDataTimestamp = freshness.latest_data_timestamp || lastDataTimestamp;

    if (status === 'offline') {
      setConnection('offline', 'OFFLINE');
      setStatus(
        reportedAt
          ? `Live vehicle feeds are offline. Icons are hidden. Last data: ${reportedAt}.`
          : 'Live vehicle feeds are offline. Icons are hidden; retrying automatically.',
        'offline'
      );
      return;
    }
    if (status === 'empty') {
      setConnection('warning', 'NO VEHICLES');
      setStatus('No vehicles are currently reporting live locations. Retrying automatically.');
      return;
    }
    if (sourceProblems.length) {
      setConnection('warning', 'PARTIAL');
      setStatus(sourceProblems.map((entry) => `${entry.label} is ${entry.status}`).join(' · '));
      return;
    }
    if (status === 'delayed') {
      setConnection('warning', 'DELAYED');
      setStatus(`Live vehicle locations are delayed${reportedAt ? ` · Last data ${reportedAt}` : ''}.`);
      return;
    }
    setConnection('live', 'LIVE');
    setStatus('');
  }

  function renderPayload(payload) {
    const freshness = assessVehicleFeedFreshness(payload, { delayedAfterMs, offlineAfterMs });
    applyFeedState(payload, freshness);
    const visible = selectVehiclesForDisplay(payload, freshness, { maxAgeMs: offlineAfterMs })
      .filter((vehicle) => isSourceVehicleVisible(vehicle, payload && payload.sources));
    renderVehicles(visible, payload && payload.terminal_departures);
  }

  function pollVehicles() {
    dataClient.fetchVehicles()
      .then((payload) => {
        if (!payload || !Array.isArray(payload.vehicles)) throw new Error('Invalid vehicle response');
        lastPayload = payload;
        renderPayload(payload);
      })
      .catch((err) => {
        lastPayload = null;
        setConnection('offline', 'OFFLINE');
        setStatus('Live vehicle feeds are offline. Icons are hidden; retrying automatically.', 'offline');
        renderVehicles([], []);
        renderSourceStatuses(null);
        console.warn('Platform vehicle poll failed:', err);
      })
      .then(() => {
        pollTimer = setTimeout(pollVehicles, pollMs);
      });
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
    dataClient.fetchServiceStatus()
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

  const handleResize = () => {
    if (platformBasemap) platformBasemap.resize();
    scheduleProjectionRefresh();
  };
  window.addEventListener('resize', handleResize);

  dataClient.fetchConfig()
    .then((config) => {
      if (config && config.base_path) dataClient.setBasePath(config.base_path);
      if (Number(config && config.poll_ms) > 0) pollMs = Number(config.poll_ms);
      if (Number(config && config.feed_delayed_after_ms) > 0) delayedAfterMs = Number(config.feed_delayed_after_ms);
      if (Number(config && config.feed_offline_after_ms) > 0) offlineAfterMs = Number(config.feed_offline_after_ms);
      platformBasemap = setupPlatformBasemap(config, scheduleProjectionRefresh);
    })
    .catch((err) => {
      console.warn('Using default platform-map configuration:', err);
    })
    .then(() => Promise.all([
      dataClient.fetchRoutes().catch((err) => {
        console.warn('Platform route styles unavailable:', err);
        return null;
      }),
      dataClient.fetchTerminalLayout().catch((err) => {
        console.warn('Platform assignments unavailable:', err);
        return { assignments: [] };
      }),
    ]).then(([routes, layout]) => {
      routeStyles = routeStyleIndex(routes);
      renderAssignments(layout);
    }))
    .then(() => {
      updateClock();
      setInterval(updateClock, 1000);
      setInterval(() => {
        if (lastPayload) renderPayload(lastPayload);
      }, 5000);
      loadServiceNotice();
      setInterval(loadServiceNotice, 5 * 60 * 1000);
      layoutTimer = setInterval(refreshTerminalLayout, 60 * 1000);
      startDeparturePageRotation();
      pollVehicles();
    });

  return {
    destroy() {
      if (pollTimer) clearTimeout(pollTimer);
      if (layoutTimer) clearInterval(layoutTimer);
      if (departurePageTimer) clearInterval(departurePageTimer);
      if (projectionFrame) cancelAnimationFrame(projectionFrame);
      window.removeEventListener('resize', handleResize);
      if (platformBasemap) platformBasemap.remove();
    },
    showDeparturePage,
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
