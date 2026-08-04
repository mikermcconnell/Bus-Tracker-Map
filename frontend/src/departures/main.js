import { createDataClient } from '../data/client.js';

const client = createDataClient();
const list = document.getElementById('departures-list');
const health = document.getElementById('service-health');
const warning = document.getElementById('warning');
const updated = document.getElementById('last-updated');
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const FAILURE_RETENTION_MS = 15 * 60 * 1000;
const AGENCIES = {
  barrie_transit: { name: 'Barrie Transit', short: 'BT', logo: 'agency-barrie-transit.png' },
  ontario_northland: { name: 'Ontario Northland', short: 'ON', logo: 'agency-ontario-northland.png' },
  go_transit: { name: 'GO Transit', short: 'GO', logo: 'agency-go-transit.svg' },
  simcoe_linx: { name: 'Simcoe LINX', short: 'LINX', logo: 'agency-simcoe-linx.png' },
};
let pollMs = 10000;
let lastGoodAt = 0;

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
  clockTime.textContent = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(now);
  clockDate.textContent = new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'short', day: 'numeric' }).format(now);
  renderTimes();
}

function departureLabel(epochSeconds) {
  const seconds = Math.round(Number(epochSeconds) - Date.now() / 1000);
  if (seconds <= 45) return 'Due';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(new Date(epochSeconds * 1000));
}

function renderTimes() {
  document.querySelectorAll('[data-departure-time]').forEach((element) => {
    element.textContent = departureLabel(element.dataset.departureTime);
  });
}

function platform(row) {
  return row.platform_type === 'stop' ? `Stop ${row.platform}` : `P${row.platform}`;
}

function renderDepartures(rows) {
  if (!rows.length) {
    list.innerHTML = '<li class="empty-state">No departures are scheduled in the next 24 hours.</li>';
    return;
  }
  list.innerHTML = rows.map((row) => {
    const agencyKey = String(row.agency_id || '').replace(/-/g, '_');
    const agency = AGENCIES[agencyKey] || { name: row.agency_name, short: row.agency_name, logo: '' };
    const sourceClass = row.departure_source === 'realtime' ? 'is-live' : 'is-scheduled';
    const logo = agency.logo ? `<img src="${asset(agency.logo)}" alt="">` : '';
    return `<li class="departure agency-${escapeHtml(agencyKey)}">
      <div class="service-cell">${logo}<span class="route-badge">${escapeHtml(row.route_label)}</span><span class="agency-name">${escapeHtml(agency.name)}</span></div>
      <div class="destination">${escapeHtml(row.destination || 'Destination unavailable')}</div>
      <div class="platform">${escapeHtml(platform(row))}</div>
      <div class="departure-time ${sourceClass}" data-departure-time="${Number(row.expected_departure_time)}">${departureLabel(row.expected_departure_time)}</div>
    </li>`;
  }).join('');
}

function renderHealth(sources) {
  health.innerHTML = Object.keys(AGENCIES).map((key) => {
    const source = sources && sources[key] || {};
    const agency = AGENCIES[key];
    const live = source.display_mode === 'realtime' || source.display_mode === 'mixed';
    const status = source.realtime_status === 'delayed' ? 'Delayed feed' : live ? 'Live' : 'Schedule';
    return `<span class="health-chip status-${escapeHtml(source.realtime_status || 'offline')}"><b>${escapeHtml(agency.short)}</b> ${status}</span>`;
  }).join('');
}

async function refresh() {
  try {
    const payload = await client.fetchDepartures(12);
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
    const config = await client.fetchConfig();
    if (Number.isFinite(Number(config.poll_ms))) pollMs = Math.max(5000, Number(config.poll_ms));
    if (config.base_path) client.setBasePath(config.base_path);
  } catch (error) {
    // The departures request still works at the current origin.
  }
  refresh();
}

formatClock();
window.setInterval(formatClock, 1000);
start();
