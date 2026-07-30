import { createDataClient } from '../data/client.js';
import { clusterVehicles } from '../map/vehicle-groups.js';
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
const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'barrie_transit', agencyId: 'barrie-transit', label: 'Barrie Transit', short: 'BT' }),
  Object.freeze({ key: 'go_transit', agencyId: 'go-transit', label: 'GO Transit', short: 'GO' }),
  Object.freeze({ key: 'ontario_northland', agencyId: 'ontario-northland', label: 'Ontario Northland', short: 'ON' }),
  Object.freeze({ key: null, agencyId: 'simcoe-linx', label: 'Simcoe LINX', short: 'LINX', untracked: true }),
]);

const PLATFORM_CARD_POSITIONS = Object.freeze({
  '1': Object.freeze({ left: 75.7, top: 51.1, width: 15, scrubLeft: 75.6, scrubWidth: 13.4, scrubHeight: 5.5 }),
  '3': Object.freeze({ left: 48.6, top: 60.7, width: 11.1, scrubLeft: 47.3, scrubWidth: 10.2, scrubHeight: 6.6 }),
  '4': Object.freeze({ left: 37.7, top: 60.7, width: 10.7, scrubLeft: 37.6, scrubWidth: 10.2, scrubHeight: 6.6 }),
  '5': Object.freeze({ left: 26.8, top: 60.7, width: 10.7, scrubLeft: 27.4, scrubWidth: 10.6, scrubHeight: 6.6 }),
  '6': Object.freeze({ left: 27.4, top: 26.8, width: 11.6, scrubLeft: 27.3, scrubWidth: 11.3, scrubHeight: 9.1 }),
  '7': Object.freeze({ left: 39.1, top: 26.8, width: 11.8, scrubLeft: 38.1, scrubWidth: 11.8, scrubHeight: 7.8 }),
  '8': Object.freeze({ left: 51, top: 26.8, width: 11.6, scrubLeft: 49.3, scrubWidth: 11.3, scrubHeight: 7.8 }),
  '12': Object.freeze({ left: 5.8, top: 34.8, width: 9.4, scrubWidth: 9.4, scrubHeight: 10.6 }),
  '13': Object.freeze({ left: 15.3, top: 34.8, width: 9.4, scrubWidth: 9.4, scrubHeight: 10.6 }),
  '14': Object.freeze({ left: 2.2, top: 71.3, width: 13.5, scrubWidth: 13.6, scrubHeight: 7.9 }),
});

const SOURCE_STATUS_LABELS = Object.freeze({
  live: 'Live',
  delayed: 'Locations delayed',
  empty: 'No vehicles reported',
  offline: 'Locations unavailable',
  'not-tracked': 'Locations unavailable',
});

function sourceKeyForVehicle(vehicle) {
  if (!vehicle) return '';
  if (vehicle.agency_id === 'go-transit') return 'go_transit';
  if (vehicle.agency_id === 'ontario-northland') return 'ontario_northland';
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
  return String(vehicle && vehicle.platform || '');
}

function livePlatformState(vehicle) {
  const status = String(vehicle && vehicle.terminal_progress_status || '').toLowerCase();
  if (status === 'at_terminal') return 'occupied';
  if (status === 'approaching') return 'approaching';
  return '';
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

function platformStatusLabel(vehicle) {
  const status = String(vehicle && vehicle.terminal_progress_status || '').toLowerCase();
  if (status === 'at_terminal') {
    const stopId = String(vehicle.terminal_stop_id || '');
    const barriePlatform = /^90\d{2}$/.test(stopId)
      ? String(Number(stopId.slice(2)))
      : '';
    return barriePlatform ? `AT PLATFORM ${barriePlatform}` : 'AT TERMINAL';
  }
  if (status === 'approaching') return 'APPROACHING';
  if (status === 'departed') return 'DEPARTING';
  return '';
}

function createMarker(key) {
  const marker = createElement('div', 'vehicle-marker');
  marker.dataset.markerKey = key;
  const arrow = createElement('span', 'vehicle-marker__arrow');
  const body = createElement('span', 'vehicle-marker__body');
  const labels = createElement('span', 'vehicle-marker__labels');
  const detail = createElement('span', 'vehicle-marker__detail');
  marker.appendChild(arrow);
  marker.appendChild(body);
  marker.appendChild(labels);
  marker.appendChild(detail);
  marker.__parts = { arrow, body, labels, detail };
  return marker;
}

function updateMarker(marker, cluster, routeStyles) {
  const vehicles = cluster.vehicles;
  const lead = vehicles[0];
  const position = projectVehicleToImage(cluster.lat, cluster.lon);
  if (!position) return false;

  marker.style.left = `${Math.min(97, Math.max(3, position.x))}%`;
  marker.style.top = `${Math.min(84.5, Math.max(14.5, position.y))}%`;
  marker.dataset.agencyId = String(lead.agency_id || 'barrie-transit');
  marker.dataset.vehicleIds = vehicles.map((vehicle) => vehicle.id || vehicle.vehicle_id || '').join(',');
  marker.classList.toggle('vehicle-marker--cluster', vehicles.length > 1);
  marker.classList.toggle('vehicle-marker--train', String(lead.route_mode || '').toLowerCase() === 'train');

  const style = getVehicleStyle(lead, routeStyles);
  marker.style.setProperty('--route-color', style.color);
  marker.style.setProperty('--route-text-color', style.textColor);

  const labels = vehicles.map(getVehicleLabel);
  while (marker.__parts.labels.firstChild) {
    marker.__parts.labels.removeChild(marker.__parts.labels.firstChild);
  }
  labels.slice(0, 4).forEach((label, index) => {
    const labelElement = createElement('span', 'vehicle-marker__route', label);
    const labelStyle = getVehicleStyle(vehicles[index], routeStyles);
    labelElement.style.setProperty('--route-color', labelStyle.color);
    labelElement.style.setProperty('--route-text-color', labelStyle.textColor);
    marker.__parts.labels.appendChild(labelElement);
  });
  if (labels.length > 4) {
    marker.__parts.labels.appendChild(createElement('span', 'vehicle-marker__route', `+${labels.length - 4}`));
  }

  const direction = getRouteEightDirection(lead);
  const status = platformStatusLabel(lead);
  marker.__parts.detail.textContent = [direction, status].filter(Boolean).join(' · ');
  marker.__parts.detail.hidden = !marker.__parts.detail.textContent;
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

  const busLayer = document.getElementById('bus-layer');
  const statusEl = document.getElementById('platform-status');
  const emptyEl = document.getElementById('terminal-empty');
  const connectionEl = document.getElementById('connection-status');
  const connectionLabelEl = document.getElementById('connection-label');
  const clockEl = document.getElementById('platform-clock');
  const lastUpdatedEl = document.getElementById('last-updated');
  const sourceStatusesEl = document.getElementById('source-statuses');
  const assignmentLayerEl = document.getElementById('assignment-layer');
  const serviceNoticeEl = document.getElementById('service-notice');
  const serviceNoticeTextEl = document.getElementById('service-notice-text');
  const displayLegendEl = document.getElementById('display-legend');
  let feedDisplayState = 'connecting';
  let lastVisibleVehicles = [];

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
    SOURCE_DEFINITIONS.forEach((definition) => {
      const source = definition.key && sources && sources[definition.key];
      const status = definition.untracked ? 'not-tracked' : normalizedSourceStatus(source);
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
  }

  function updatePlatformActivity(vehicles) {
    const platformStates = new Map();
    (Array.isArray(vehicles) ? vehicles : []).forEach((vehicle) => {
      const platform = platformForVehicle(vehicle);
      const state = livePlatformState(vehicle);
      if (!platform || !state) return;
      if (state === 'occupied' || !platformStates.has(platform)) {
        platformStates.set(platform, state);
      }
    });

    assignmentLayerEl.querySelectorAll('.platform-card').forEach((card) => {
      const state = platformStates.get(card.dataset.platform) || '';
      card.dataset.liveState = state;
      card.classList.toggle('platform-card--occupied', state === 'occupied');
      card.classList.toggle('platform-card--approaching', state === 'approaching');
      const badge = card.querySelector('.platform-card__state');
      if (!badge) return;
      badge.textContent = state === 'occupied'
        ? 'Vehicle here'
        : state === 'approaching'
          ? 'Approaching'
          : 'Scheduled';
    });
  }

  function renderVehicles(vehicles) {
    lastVisibleVehicles = Array.isArray(vehicles) ? vehicles : [];
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
      if (updateMarker(marker, cluster, routeStyles)) seen.add(key);
    });

    markerIndex.forEach((marker, key) => {
      if (seen.has(key)) return;
      marker.remove();
      markerIndex.delete(key);
    });
    updatePlatformActivity(lastVisibleVehicles);
    emptyEl.hidden = clusters.length !== 0 ||
      feedDisplayState === 'offline' ||
      feedDisplayState === 'warning' ||
      !statusEl.hidden;
  }

  function renderAssignments(layout) {
    while (assignmentLayerEl.firstChild) {
      assignmentLayerEl.removeChild(assignmentLayerEl.firstChild);
    }
    const grouped = groupPlatformAssignments(layout && layout.assignments);
    Object.keys(PLATFORM_CARD_POSITIONS).forEach((platform) => {
      const assignments = grouped[platform];
      if (!assignments || !assignments.length) return;
      const position = PLATFORM_CARD_POSITIONS[platform];
      const scrub = createElement('div', 'platform-card-scrub');
      scrub.dataset.platform = platform;
      scrub.style.left = `${position.scrubLeft ?? position.left}%`;
      scrub.style.top = `${position.top}%`;
      scrub.style.width = `${position.scrubWidth}%`;
      scrub.style.height = `${position.scrubHeight}%`;
      assignmentLayerEl.appendChild(scrub);

      const card = createElement('section', 'platform-card');
      card.dataset.platform = platform;
      card.style.left = `${position.left}%`;
      card.style.top = `${position.top}%`;
      card.style.width = `${position.width}%`;
      const heading = createElement('header', 'platform-card__heading');
      heading.appendChild(createElement('h2', 'platform-card__title', `Platform ${platform}`));
      heading.appendChild(createElement('span', 'platform-card__state', 'Scheduled'));
      card.appendChild(heading);
      const services = createElement('div', 'platform-card__services');
      assignments.slice(0, 4).forEach((assignment) => {
        const row = createElement('div', 'platform-card__service');
        row.dataset.agencyId = assignment.agency_id || '';
        const destination = assignment.destination || assignment.agency_name;
        row.title = `${assignment.route_label || assignment.route_id}: ${destination}`;
        row.appendChild(createElement(
          'strong',
          'platform-card__route',
          assignment.route_label || assignment.route_id
        ));
        row.appendChild(createElement(
          'span',
          'platform-card__destination',
          destination
        ));
        services.appendChild(row);
      });
      card.appendChild(services);
      assignmentLayerEl.appendChild(card);
    });

    if (!grouped['14'] || !grouped['14'].length) {
      const position = PLATFORM_CARD_POSITIONS['14'];
      const scrub = createElement('div', 'platform-card-scrub');
      scrub.dataset.platform = '14';
      scrub.style.left = `${position.scrubLeft ?? position.left}%`;
      scrub.style.top = `${position.top}%`;
      scrub.style.width = `${position.scrubWidth}%`;
      scrub.style.height = `${position.scrubHeight}%`;
      assignmentLayerEl.appendChild(scrub);

      const retired = createElement('section', 'platform-card platform-card--inactive');
      retired.dataset.platform = '14';
      retired.style.left = `${position.left}%`;
      retired.style.top = `${position.top}%`;
      retired.style.width = `${position.width}%`;
      const heading = createElement('header', 'platform-card__heading');
      heading.appendChild(createElement('h2', 'platform-card__title', 'Platform 14'));
      heading.appendChild(createElement('span', 'platform-card__state', 'Inactive'));
      retired.appendChild(heading);
      retired.appendChild(createElement('div', 'platform-card__inactive-text', 'No scheduled service'));
      assignmentLayerEl.appendChild(retired);
    }
    updatePlatformActivity(lastVisibleVehicles);
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
    renderVehicles(visible);
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
        renderVehicles([]);
        renderSourceStatuses(null);
        console.warn('Platform vehicle poll failed:', err);
      })
      .then(() => {
        pollTimer = setTimeout(pollVehicles, pollMs);
      });
  }

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    clockEl.dateTime = now.toISOString();
    lastUpdatedEl.textContent = relativeAge(lastDataTimestamp);
  }

  function loadServiceNotice() {
    dataClient.fetchServiceStatus()
      .then((status) => {
        const upcoming = status && status.upcoming_warning && status.upcoming_warning.message;
        const special = status && status.is_special_service && status.today;
        const message = upcoming || (special && status.message) || '';
        serviceNoticeTextEl.textContent = String(message).replace(/^Barrie Transit\s*(?:—|-|:)\s*/i, '');
        serviceNoticeTextEl.textContent = serviceNoticeTextEl.textContent
          .replace(/^Upcoming Holiday Service\s*(?:—|-|:)\s*/i, '')
          .replace(/^Civic Holiday Service\s*:\s*/i, '')
          .trim();
        serviceNoticeEl.hidden = !serviceNoticeTextEl.textContent;
        displayLegendEl.hidden = !serviceNoticeEl.hidden;
      })
      .catch((err) => {
        serviceNoticeEl.hidden = true;
        displayLegendEl.hidden = false;
        console.warn('Platform service status unavailable:', err);
      });
  }

  dataClient.fetchConfig()
    .then((config) => {
      if (config && config.base_path) dataClient.setBasePath(config.base_path);
      if (Number(config && config.poll_ms) > 0) pollMs = Number(config.poll_ms);
      if (Number(config && config.feed_delayed_after_ms) > 0) delayedAfterMs = Number(config.feed_delayed_after_ms);
      if (Number(config && config.feed_offline_after_ms) > 0) offlineAfterMs = Number(config.feed_offline_after_ms);
    })
    .catch((err) => {
      console.warn('Using default platform-map configuration:', err);
    })
    .then(() => Promise.all([
      dataClient.fetchRoutes().then((routes) => {
        routeStyles = routeStyleIndex(routes);
      }).catch((err) => {
        console.warn('Platform route styles unavailable:', err);
      }),
      dataClient.fetchTerminalLayout().then(renderAssignments).catch((err) => {
        console.warn('Platform assignments unavailable:', err);
        renderAssignments({ assignments: [] });
      }),
    ]))
    .then(() => {
      updateClock();
      setInterval(updateClock, 1000);
      setInterval(() => {
        if (lastPayload) renderPayload(lastPayload);
      }, 5000);
      loadServiceNotice();
      setInterval(loadServiceNotice, 5 * 60 * 1000);
      pollVehicles();
    });

  return {
    destroy() {
      if (pollTimer) clearTimeout(pollTimer);
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
