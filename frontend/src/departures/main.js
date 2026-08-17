import { createDataClient } from '../data/client.js';

const client = createDataClient();
const list = document.getElementById('departures-list');
const health = document.getElementById('service-health');
const warning = document.getElementById('warning');
const updated = document.getElementById('last-updated');
const clockTime = document.getElementById('clock-time');
const FAILURE_RETENTION_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;
const WATCHDOG_STALE_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60 * 1000;
const MAX_DEPARTURES = 11;
const boardId = /\/departures\/downtown\/?$/i.test(window.location.pathname) ? 'downtown' : 'allandale';
const AGENCIES = {
  barrie_transit: { name: 'Barrie Transit', short: 'BT', logo: 'agency-barrie-transit.png' },
  ontario_northland: { name: 'Ontario Northland', short: 'ON', logo: 'agency-ontario-northland.png' },
  go_transit: { name: 'GO Transit', short: 'GO', logo: 'agency-go-transit.svg' },
  simcoe_linx: { name: 'Simcoe LINX', short: 'LINX', logo: 'agency-simcoe-linx.png' },
};
let pollMs = 10000;
let lastGoodAt = 0;
const startedAt = Date.now();

if (boardId === 'downtown') {
  document.title = 'Downtown Hub Departures';
  document.getElementById('page-title').textContent = 'Downtown Hub Departures';
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function asset(name) {
  return new URL(`../assets/${name}`, window.location.href).pathname;
}

function formatClock() {
  const now = new Date();
  clockTime.textContent = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(now);
  renderTimes();
}

function departureLabel(epochSeconds) {
  const seconds = Math.round(Number(epochSeconds) - Date.now() / 1000);
  if (seconds <= 45) return 'Due';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function renderTimes() {
  document.querySelectorAll('[data-departure-time]').forEach((element) => {
    element.textContent = departureLabel(element.dataset.departureTime);
  });
}

function platform(row) {
  const rawNumber = String(row.platform || '');
  return {
    label: row.platform_type === 'stop' ? 'Stop' : 'Platform',
    number: rawNumber.length < 2 ? `0${rawNumber}` : rawNumber,
  };
}

function publicRouteLabel(row, agencyKey) {
  const label = String(row.route_label || '');
  if (agencyKey !== 'ontario_northland' || label.toUpperCase() !== 'ONTC') return label;
  const candidates = [row.route_id, String(row.trip_id || '').split(':')[0]];
  return String(candidates.filter((value) => /^(?:101|102|201|202)$/.test(String(value)))[0] || label);
}

function scheduledDeparture(row) {
  return Number(row.scheduled_departure_time || row.expected_departure_time);
}

function displayedDeparture(row) {
  const expected = Number(row.expected_departure_time);
  const live = row.departure_source === 'realtime' && Number.isFinite(expected);
  return {
    time: live ? expected : scheduledDeparture(row),
    live,
    state: live ? 'live' : 'scheduled',
    label: live ? 'LIVE' : 'SCHED',
    description: live
      ? row.live_evidence === 'trip_update_and_terminal_handoff_vehicle'
        ? 'Live prediction based on the active inbound Route 2 vehicle and its Allandale handoff'
        : 'Live prediction from this active vehicle and trip'
      : 'Scheduled time',
  };
}

function compareDepartures(left, right) {
  return displayedDeparture(left).time - displayedDeparture(right).time ||
    Number(left.platform) - Number(right.platform) ||
    String(left.route_label || '').localeCompare(String(right.route_label || ''));
}

function renderDepartures(rows) {
  const orderedRows = rows.slice().sort(compareDepartures).slice(0, MAX_DEPARTURES);
  if (!orderedRows.length) {
    list.style.setProperty('--departure-count', '1');
    list.innerHTML = '<li class="empty-state">No departures are scheduled in the next hour.</li>';
    return;
  }
  list.style.setProperty('--departure-count', String(orderedRows.length));
  list.innerHTML = orderedRows.map((row) => {
    const agencyKey = String(row.agency_id || '').replace(/-/g, '_');
    const agency = AGENCIES[agencyKey] || { name: row.agency_name, short: row.agency_name, logo: '' };
    const bay = platform(row);
    const departure = displayedDeparture(row);
    const routeLabel = publicRouteLabel(row, agencyKey);
    const logo = agency.logo ? `<img src="${asset(agency.logo)}" alt="">` : '';
    return `<li class="departure agency-${escapeHtml(agencyKey)}">
      <div class="agency-logo">${logo}<span class="visually-hidden">${escapeHtml(agency.name)}</span></div>
      <div class="route">${escapeHtml(routeLabel)}</div>
      <div class="destination">${escapeHtml(String(row.destination || 'Destination unavailable').toUpperCase())}</div>
      <div class="departure-time departure-time--${departure.state}">
        <span class="departure-status" aria-label="${departure.description}">${departure.label}</span>
        <span data-departure-time="${departure.time}">${departureLabel(departure.time)}</span>
      </div>
      <div class="platform"><span>${escapeHtml(bay.label)}</span><strong>${escapeHtml(bay.number)}</strong></div>
    </li>`;
  }).join('');
}

function renderHealth(sources) {
  health.textContent = Object.keys(sources || {}).map((key) => {
    const source = sources && sources[key] || {};
    const agency = AGENCIES[key];
    const feedActive = source.realtime_status === 'live';
    const status = source.realtime_status === 'delayed'
      ? 'Feed delayed'
      : feedActive
        ? 'Feed active'
        : 'Schedule only';
    return `${agency.short} ${status}`;
  }).join('. ');
}

async function refresh() {
  try {
    const payload = await client.fetchDepartures(MAX_DEPARTURES, { timeoutMs: REQUEST_TIMEOUT_MS, board: boardId });
    lastGoodAt = Date.now();
    renderDepartures(Array.isArray(payload.departures) ? payload.departures : []);
    renderHealth(payload.sources || {});
    warning.hidden = true;
    updated.textContent = `Updated ${new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(payload.generated_at || Date.now()))}`;
  } catch (error) {
    warning.hidden = false;
    updated.textContent = 'Update connection interrupted';
    if (!lastGoodAt || Date.now() - lastGoodAt > FAILURE_RETENTION_MS) {
      list.innerHTML = '<li class="empty-state error-state">Departure information is temporarily unavailable.</li>';
    }
  } finally {
    window.setTimeout(refresh, pollMs);
  }
}

async function start() {
  try {
    const config = await client.fetchConfig({ timeoutMs: REQUEST_TIMEOUT_MS });
    if (Number.isFinite(Number(config.poll_ms))) pollMs = Math.max(5000, Number(config.poll_ms));
    if (config.base_path) client.setBasePath(config.base_path);
  } catch (error) {
    // The departures request still works at the current origin.
  }
  refresh();
}

formatClock();
window.setInterval(formatClock, 1000);
window.setInterval(() => {
  const lastHealthyAt = lastGoodAt || startedAt;
  if (Date.now() - lastHealthyAt > WATCHDOG_STALE_MS) window.location.reload();
}, WATCHDOG_INTERVAL_MS);
start();
