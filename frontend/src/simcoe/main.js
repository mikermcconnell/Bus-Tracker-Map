import L from 'leaflet';

const AGENCY_ORDER = ['simcoe-linx', 'go-transit', 'ontario-northland', 'barrie-transit'];
const AGENCY_LABELS = {
  'simcoe-linx': 'Simcoe County LINX',
  'go-transit': 'GO Transit',
  'ontario-northland': 'Ontario Northland',
  'barrie-transit': 'Barrie Transit',
};
const SOURCE_KEYS = {
  'simcoe-linx': 'simcoe_linx',
  'go-transit': 'go_transit',
  'ontario-northland': 'ontario_northland',
  'barrie-transit': 'barrie_transit',
};

const state = {
  config: null,
  map: null,
  regionalBounds: null,
  routes: [],
  stops: [],
  routeLayers: new Map(),
  stopLayer: null,
  vehicleLayer: null,
  agencyEnabled: new Map(AGENCY_ORDER.map((id) => [id, true])),
  selectedRoute: null,
  vehicles: [],
  sources: {},
  pollTimer: null,
};

document.addEventListener('DOMContentLoaded', initialize);

async function initialize() {
  try {
    const [config, routes, stops] = await Promise.all([
      fetchJson('/api/simcoe/config'),
      fetchJson('/api/simcoe/routes.geojson'),
      fetchJson('/api/simcoe/stops.geojson'),
    ]);
    state.config = config;
    state.routes = Array.isArray(routes.features) ? routes.features : [];
    state.stops = Array.isArray(stops.features) ? stops.features : [];
    createMap();
    buildRouteLayers();
    bindControls();
    renderServicePanel();
    refreshVisibility();
    await pollVehicles();
    state.pollTimer = window.setInterval(pollVehicles, Math.max(5000, Number(config.poll_ms) || 10000));
  } catch (error) {
    showMessage('The regional map could not be loaded. Please try again shortly.');
    setOverallStatus('Regional data unavailable', 'offline');
    console.error(error);
  }
}

async function fetchJson(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}cb=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function createMap() {
  const bounds = state.config.bounds;
  state.regionalBounds = L.latLngBounds([bounds[1], bounds[0]], [bounds[3], bounds[2]]);
  state.map = L.map('map', { zoomControl: true, preferCanvas: true, minZoom: 8, maxZoom: 18 });
  const basemap = state.config.basemap || {};
  L.tileLayer(basemap.url || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: basemap.attribution || '&copy; OpenStreetMap contributors',
    tileSize: Number(basemap.tile_size) || 256,
    zoomOffset: Number(basemap.zoom_offset) || 0,
    maxZoom: Number(basemap.max_zoom) || 19,
  }).addTo(state.map);
  state.stopLayer = L.layerGroup().addTo(state.map);
  state.vehicleLayer = L.layerGroup().addTo(state.map);
  state.map.fitBounds(state.regionalBounds, { padding: [28, 28] });
  state.map.on('zoomend moveend', refreshVisibility);
}

function routeKey(properties) {
  return `${properties.agency_id || 'barrie-transit'}:${properties.route_id || properties.route_short_name || 'route'}`;
}

function buildRouteLayers() {
  state.routes.forEach((feature) => {
    const properties = feature.properties || {};
    const key = routeKey(properties);
    let entry = state.routeLayers.get(key);
    if (!entry) {
      entry = {
        key,
        agencyId: properties.agency_id || 'barrie-transit',
        routeId: properties.route_id || '',
        label: properties.route_short_name || properties.route_id || 'Route',
        description: properties.route_long_name || AGENCY_LABELS[properties.agency_id] || 'Transit route',
        color: normalizeColor(properties.route_color, '#176B57'),
        group: L.layerGroup(),
        bounds: L.latLngBounds(),
      };
      state.routeLayers.set(key, entry);
    }
    const line = L.geoJSON(feature, {
      style: { color: entry.color, weight: 4, opacity: .82, lineCap: 'round' },
      onEachFeature: (_item, layer) => {
        layer.on('click', () => selectRoute(key));
        layer.bindTooltip(`${entry.label} · ${entry.description}`, { sticky: true });
      },
    });
    line.addTo(entry.group);
    const bounds = line.getBounds();
    if (bounds.isValid()) entry.bounds.extend(bounds);
  });
}

function bindControls() {
  document.getElementById('reset-map').addEventListener('click', resetRegionalView);
  document.getElementById('clear-selection').addEventListener('click', clearSelection);
}

function renderServicePanel() {
  const list = document.getElementById('agency-list');
  list.innerHTML = '';
  AGENCY_ORDER.forEach((agencyId) => {
    const routes = Array.from(state.routeLayers.values()).filter((entry) => entry.agencyId === agencyId)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    if (!routes.length) return;
    const source = state.sources[SOURCE_KEYS[agencyId]] || {};
    const card = document.createElement('section');
    card.className = 'agency-card';
    const summary = document.createElement('div');
    summary.className = 'agency-card__summary';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'agency-toggle';
    checkbox.checked = state.agencyEnabled.get(agencyId) !== false;
    checkbox.setAttribute('aria-label', `Show ${AGENCY_LABELS[agencyId]}`);
    checkbox.addEventListener('change', () => {
      state.agencyEnabled.set(agencyId, checkbox.checked);
      if (!checkbox.checked && state.selectedRoute && state.selectedRoute.startsWith(`${agencyId}:`)) clearSelection();
      refreshVisibility();
    });
    const title = document.createElement('div');
    title.innerHTML = `<span class="agency-name">${escapeHtml(AGENCY_LABELS[agencyId])}</span>` +
      `<span class="agency-meta">${routes.length} ${routes.length === 1 ? 'service' : 'services'} · ${Number(source.vehicle_count) || 0} live</span>`;
    const status = document.createElement('span');
    const feedState = source.feed_status || (state.sources[SOURCE_KEYS[agencyId]] ? 'offline' : 'loading');
    status.className = 'feed-state';
    status.dataset.state = feedState;
    status.textContent = feedState;
    summary.append(checkbox, title, status);
    const routeList = document.createElement('div');
    routeList.className = 'route-list';
    routes.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-button';
      button.dataset.routeKey = entry.key;
      button.setAttribute('aria-pressed', String(state.selectedRoute === entry.key));
      button.innerHTML = `<span class="route-swatch" style="--route-color:${entry.color}"></span><span>${escapeHtml(entry.label)} · ${escapeHtml(entry.description)}</span>`;
      button.addEventListener('click', () => selectRoute(entry.key));
      routeList.appendChild(button);
    });
    card.append(summary, routeList);
    list.appendChild(card);
  });
}

function refreshVisibility() {
  if (!state.map) return;
  const zoom = state.map.getZoom();
  const barrieRevealZoom = Number(state.config.barrie_reveal_zoom) || 11;
  state.routeLayers.forEach((entry) => {
    const agencyOn = state.agencyEnabled.get(entry.agencyId) !== false;
    const routeSelected = state.selectedRoute === entry.key;
    const selectionAllows = !state.selectedRoute || routeSelected;
    const barrieVisible = entry.agencyId !== 'barrie-transit' || zoom >= barrieRevealZoom || routeSelected;
    const visible = agencyOn && selectionAllows && barrieVisible;
    if (visible && !state.map.hasLayer(entry.group)) entry.group.addTo(state.map);
    if (!visible && state.map.hasLayer(entry.group)) state.map.removeLayer(entry.group);
  });
  renderStops();
  renderVehicles();
  const guidance = document.getElementById('zoom-guidance');
  guidance.textContent = zoom < barrieRevealZoom
    ? 'Zoom in for Barrie routes and stops'
    : (zoom < (Number(state.config.stops_reveal_zoom) || 12) ? 'Zoom in one more level for stops' : 'Stops shown in the current view');
}

function renderStops() {
  state.stopLayer.clearLayers();
  const zoom = state.map.getZoom();
  const revealZoom = Number(state.config.stops_reveal_zoom) || 12;
  if (zoom < revealZoom && !state.selectedRoute) return;
  const viewBounds = state.map.getBounds().pad(.1);
  const selected = state.selectedRoute && state.routeLayers.get(state.selectedRoute);
  state.stops.forEach((feature) => {
    const properties = feature.properties || {};
    const agencyId = properties.agency_id || 'barrie-transit';
    if (state.agencyEnabled.get(agencyId) === false) return;
    if (selected && selected.agencyId !== agencyId) return;
    if (selected && !(Array.isArray(properties.route_ids) && properties.route_ids.includes(selected.routeId))) return;
    const coordinates = feature.geometry && feature.geometry.coordinates;
    if (!coordinates || !viewBounds.contains([coordinates[1], coordinates[0]])) return;
    const icon = L.divIcon({ className: '', html: '<span class="stop-marker"></span>', iconSize: [8, 8], iconAnchor: [4, 4] });
    L.marker([coordinates[1], coordinates[0]], { icon, keyboard: true })
      .bindPopup(`<div class="popup-title">${escapeHtml(properties.stop_name || 'Transit stop')}</div><div class="popup-meta">${escapeHtml(properties.agency_name || AGENCY_LABELS[agencyId] || '')}</div>`)
      .addTo(state.stopLayer);
  });
}

function selectRoute(key) {
  const entry = state.routeLayers.get(key);
  if (!entry) return;
  state.selectedRoute = key;
  state.agencyEnabled.set(entry.agencyId, true);
  const card = document.getElementById('selection-card');
  card.hidden = false;
  document.getElementById('selection-title').textContent = entry.label;
  document.getElementById('selection-description').textContent = `${AGENCY_LABELS[entry.agencyId]} · ${entry.description}`;
  if (entry.bounds.isValid()) state.map.fitBounds(entry.bounds, { padding: [35, 35], maxZoom: 13 });
  renderServicePanel();
  refreshVisibility();
}

function clearSelection() {
  state.selectedRoute = null;
  document.getElementById('selection-card').hidden = true;
  renderServicePanel();
  refreshVisibility();
}

function resetRegionalView() {
  clearSelection();
  AGENCY_ORDER.forEach((id) => state.agencyEnabled.set(id, true));
  state.map.fitBounds(state.regionalBounds, { padding: [28, 28] });
  renderServicePanel();
}

async function pollVehicles() {
  try {
    const payload = await fetchJson('/api/simcoe/vehicles.json');
    state.sources = payload.sources || {};
    state.vehicles = Array.isArray(payload.vehicles) ? payload.vehicles.filter(isFreshVehicle) : [];
    const sourceStates = Object.values(state.sources).map((source) => source.feed_status);
    const liveCount = state.vehicles.length;
    const status = sourceStates.includes('live') ? 'live' : (sourceStates.includes('delayed') ? 'delayed' : 'offline');
    setOverallStatus(liveCount ? `${liveCount} live ${liveCount === 1 ? 'vehicle' : 'vehicles'}` : 'No current live vehicles', status);
    hideMessage();
    renderServicePanel();
    renderVehicles();
  } catch (error) {
    state.vehicles = [];
    renderVehicles();
    setOverallStatus('Live locations unavailable', 'offline');
    showMessage('Live vehicle locations are temporarily unavailable. Published routes remain on the map.');
  }
}

function isFreshVehicle(vehicle) {
  const reported = Number(vehicle && vehicle.last_reported) * 1000;
  const cutoff = Number(state.config.feed_offline_after_ms) || 15 * 60 * 1000;
  return Number.isFinite(Number(vehicle.lat)) && Number.isFinite(Number(vehicle.lon)) &&
    (!Number.isFinite(reported) || Date.now() - reported <= cutoff);
}

function renderVehicles() {
  if (!state.vehicleLayer || !state.map) return;
  state.vehicleLayer.clearLayers();
  const zoom = state.map.getZoom();
  const barrieRevealZoom = Number(state.config.barrie_reveal_zoom) || 11;
  const selected = state.selectedRoute && state.routeLayers.get(state.selectedRoute);
  state.vehicles.forEach((vehicle) => {
    const agencyId = vehicle.agency_id || 'barrie-transit';
    if (state.agencyEnabled.get(agencyId) === false) return;
    if (agencyId === 'barrie-transit' && zoom < barrieRevealZoom && (!selected || selected.agencyId !== agencyId)) return;
    if (selected && (selected.agencyId !== agencyId || selected.routeId !== vehicle.route_id)) return;
    const color = normalizeColor(vehicle.route_color, agencyId === 'simcoe-linx' ? '#006747' : '#176B57');
    const label = String(vehicle.route_label || vehicle.route_id || 'BUS').replace(/^LINX\s*/i, '').slice(0, 6);
    const icon = L.divIcon({
      className: '',
      html: `<span class="vehicle-marker" style="--vehicle-color:${color}"><span>${escapeHtml(label)}</span></span>`,
      iconSize: [31, 31],
      iconAnchor: [15, 28],
    });
    const lastReported = vehicle.last_reported ? new Date(Number(vehicle.last_reported) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Unknown';
    L.marker([Number(vehicle.lat), Number(vehicle.lon)], { icon, keyboard: true, zIndexOffset: 1000 })
      .bindPopup(`<div class="popup-title">${escapeHtml(vehicle.route_label || vehicle.route_id || 'Live vehicle')}</div>` +
        `<div class="popup-meta">${escapeHtml(vehicle.agency_name || AGENCY_LABELS[agencyId] || '')}<br>` +
        `${escapeHtml(vehicle.trip_headsign || vehicle.route_long_name || 'In service')}<br>Last reported ${escapeHtml(lastReported)}</div>`)
      .addTo(state.vehicleLayer);
  });
}

function normalizeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function setOverallStatus(message, status) {
  const element = document.getElementById('overall-status');
  element.textContent = message;
  element.dataset.state = status;
}

function showMessage(message) {
  const element = document.getElementById('map-message');
  element.textContent = message;
  element.hidden = false;
}

function hideMessage() {
  document.getElementById('map-message').hidden = true;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
