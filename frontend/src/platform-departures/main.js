const REFRESH_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const LIVE_MAX_AGE_MS = 2 * 60 * 1000;
const CACHE_KEY_PREFIX = 'platform-departures:v1:';
const API_PATH = '/api/departures';
const ASSET_PATH = '../../assets/';

let renderedPayloadSignature = '';
let currentPayload = null;
let provisionalData = false;
let requestFailed = false;

const AGENCY_BRANDING = Object.freeze({
  'barrie-transit': Object.freeze({
    label: 'Barrie Transit',
    logo: `${ASSET_PATH}agency-barrie-transit.png`,
  }),
  'go-transit': Object.freeze({
    label: 'GO Transit',
    logo: `${ASSET_PATH}agency-go-transit.svg`,
  }),
  'ontario-northland': Object.freeze({
    label: 'Ontario Northland',
    logo: `${ASSET_PATH}agency-ontario-northland.png`,
  }),
  'simcoe-linx': Object.freeze({
    label: 'LINX',
    logo: `${ASSET_PATH}agency-simcoe-linx.png`,
  }),
});

function readQueryParameter(search, name) {
  const query = String(search || '').replace(/^\?/, '');
  if (!query) return '';
  const pairs = query.split('&');
  for (let index = 0; index < pairs.length; index += 1) {
    const parts = pairs[index].split('=');
    let key;
    try {
      key = decodeURIComponent(String(parts.shift() || '').replace(/\+/g, ' '));
    } catch (err) {
      continue;
    }
    if (key !== name) continue;
    try {
      return decodeURIComponent(parts.join('=').replace(/\+/g, ' '));
    } catch (err) {
      return '';
    }
  }
  return '';
}

function parseStopCode(value) {
  const stopCode = String(value || '').trim();
  const match = stopCode.match(/^90(\d{2})$/);
  if (!match) return null;
  const platform = Number(match[1]);
  if (!Number.isInteger(platform) || platform < 1 || platform > 14) return null;
  return {
    stopCode,
    platform: String(platform),
    display: platform < 10 ? `0${platform}` : String(platform),
  };
}

function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function visibleDepartures(payload) {
  const departures = Array.isArray(payload && payload.departures) ? payload.departures : [];
  const compactSign = window.innerWidth <= 360 && window.innerHeight <= 100;
  return compactSign ? departures.slice(0, 1) : departures;
}

function departurePayloadSignature(payload) {
  const rows = visibleDepartures(payload);
  const signatureRows = [];
  for (let index = 0; index < rows.length; index += 1) {
    const departure = rows[index] || {};
    signatureRows.push([
      departure.agency_id || '',
      departure.agency_name || '',
      departure.route_id || '',
      departure.route_label || '',
      departure.destination || '',
      departure.departure_time || '',
      departure.departure_source || 'scheduled',
    ]);
  }
  return JSON.stringify([
    String(payload && payload.platform_display || '--'),
    payload && payload.status || '',
    payload && payload.horizon_hours || 72,
    signatureRows,
  ]);
}

function cacheKey(stopCode) {
  return `${CACHE_KEY_PREFIX}${stopCode}`;
}

function validPayload(payload, stopCode) {
  const parsed = parseStopCode(stopCode);
  return Boolean(parsed && payload && String(payload.stop_code) === stopCode &&
    String(payload.platform_display) === parsed.display &&
    Number.isFinite(Number(payload.generated_at)) && Number(payload.generated_at) > 0 &&
    ['ok', 'no_departures', 'schedule_unavailable'].indexOf(payload.status) >= 0 &&
    Array.isArray(payload.departures) && payload.departures.every((row) => row &&
      typeof row === 'object' && Number.isFinite(Number(row.departure_time)) &&
      Number(row.departure_time) > 0 &&
      ['scheduled', 'estimated', 'realtime'].indexOf(row.departure_source) >= 0));
}

function readCachedDepartures(stopCode, nowMs = Date.now()) {
  try {
    const stored = window.localStorage.getItem(cacheKey(stopCode));
    if (!stored) return null;
    const record = JSON.parse(stored);
    const savedAt = Number(record && record.saved_at);
    const payload = record && record.payload;
    if (!Number.isFinite(savedAt) || savedAt > nowMs + 60_000 || nowMs - savedAt > CACHE_MAX_AGE_MS) return null;
    if (!validPayload(payload, stopCode)) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function writeCachedDepartures(stopCode, payload) {
  try {
    window.localStorage.setItem(cacheKey(stopCode), JSON.stringify({
      saved_at: Date.now(),
      payload,
    }));
  } catch (err) {
    // Storage can be unavailable in private or restricted embedded browsers.
  }
}

function formatTorontoTime(date) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch (err) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

function localDateKey(date) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch (err) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
  }
}

function formatDepartureText(timestampSeconds, nowMs = Date.now()) {
  const timestamp = Number(timestampSeconds);
  const departure = new Date(timestamp * 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(departure.getTime())) {
    return 'Departure time unavailable';
  }
  const differenceMs = departure.getTime() - nowMs;
  if (differenceMs < -60_000) return 'Departure time unavailable';
  if (localDateKey(departure) === localDateKey(new Date(nowMs))) {
    const minutes = Math.max(0, Math.ceil(differenceMs / 60_000));
    return minutes === 0 ? 'Departing now' : `Departing in ${minutes} min`;
  }
  // Advance the Toronto calendar date, not a fixed 24-hour duration.
  const todayKey = localDateKey(new Date(nowMs));
  const tomorrowKey = (() => {
    const match = todayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return localDateKey(new Date(nowMs + 24 * 60 * 60 * 1000));
    const nextDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1, 16));
    return localDateKey(nextDate);
  })();
  if (localDateKey(departure) === tomorrowKey) {
    return `Departs tomorrow at ${formatTorontoTime(departure)}`;
  }
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      weekday: 'short',
    }).format(departure);
    return `Departs ${weekday} at ${formatTorontoTime(departure)}`;
  } catch (err) {
    const weekday = departure.toLocaleDateString([], { weekday: 'short' });
    return `Departs ${weekday} at ${formatTorontoTime(departure)}`;
  }
}

function displayPayload(payload, nowMs = Date.now(), { provisional = false, failed = false } = {}) {
  const generatedAt = Number(payload && payload.generated_at);
  if (!payload || !Number.isFinite(generatedAt) || generatedAt > nowMs + 60_000 || nowMs - generatedAt > CACHE_MAX_AGE_MS) {
    return { ...payload, status: 'data_unavailable', departures: [] };
  }
  if (payload.status === 'schedule_unavailable') return { ...payload, departures: [] };
  const freshResponse = !provisional && !failed && nowMs - generatedAt <= LIVE_MAX_AGE_MS;
  const departures = (payload.departures || []).map((departure) => {
    const predicted = ['realtime', 'estimated'].indexOf(departure.departure_source) >= 0;
    const validUntil = Number(departure.live_valid_until) || generatedAt + LIVE_MAX_AGE_MS;
    const predictionAt = Number(departure.prediction_timestamp) || generatedAt;
    const freshPrediction = freshResponse && nowMs <= validUntil && nowMs - predictionAt <= LIVE_MAX_AGE_MS;
    if (!predicted || freshPrediction) return { ...departure };
    const scheduled = Number(departure.scheduled_departure_time);
    return {
      ...departure,
      departure_source: scheduled > 0 ? 'scheduled' : 'cached',
      departure_time: scheduled > 0 ? scheduled : departure.departure_time,
    };
  }).filter((departure) => Number(departure.departure_time) >= nowMs / 1000 - 60)
    .sort((left, right) => Number(left.departure_time) - Number(right.departure_time));
  return {
    ...payload,
    status: departures.length ? 'ok' : !freshResponse ? 'data_unavailable' : payload.departures.length ? 'updating' : payload.status,
    departures,
    updates_unavailable: !freshResponse,
  };
}

function renderCurrentPayload(nowMs = Date.now()) {
  const displayed = displayPayload(currentPayload, nowMs, { provisional: provisionalData, failed: requestFailed });
  renderDepartures(displayed);
  if (displayed.status === 'schedule_unavailable') setStatus('Schedule unavailable. Retrying automatically.', 'Schedule unavailable');
  else if (displayed.status === 'data_unavailable' || displayed.updates_unavailable) {
    setStatus('Departure updates are unavailable. Any remaining times are scheduled or cached.',
      provisionalData && !requestFailed ? 'Checking updates' : 'Updates unavailable');
  } else if (displayed.status === 'updating') setStatus('Checking for the next departure.', 'Updating departures');
  else setStatus('');
}

function createCell(tag, className, text) {
  const cell = document.createElement(tag);
  cell.className = className;
  if (text !== undefined) cell.textContent = text;
  return cell;
}

function createPlatformCell(platformDisplay, rowSpan) {
  const cell = createCell('th', 'platform-cell');
  cell.scope = 'rowgroup';
  cell.rowSpan = rowSpan;
  const label = document.createElement('span');
  label.textContent = 'Platform';
  const value = document.createElement('strong');
  value.id = 'platform-number';
  value.textContent = platformDisplay;
  cell.appendChild(label);
  cell.appendChild(value);
  return cell;
}

function createAgencyCell(departure) {
  const cell = createCell('td', 'agency-cell');
  cell.rowSpan = 2;
  const brand = AGENCY_BRANDING[String(departure && departure.agency_id || '')];
  if (brand) {
    const logo = document.createElement('img');
    logo.className = 'agency-logo';
    logo.src = brand.logo;
    logo.alt = brand.label;
    logo.loading = 'eager';
    cell.appendChild(logo);
  } else {
    const label = document.createElement('span');
    label.className = 'agency-name';
    label.textContent = String(departure && departure.agency_name || 'Transit');
    cell.appendChild(label);
  }
  return cell;
}

function routeDescription(departure) {
  const route = String(departure && departure.route_label || '').trim();
  const destination = String(departure && departure.destination || '').trim();
  if (route && destination) return `${route} - ${destination}`;
  return route || destination || 'Scheduled service';
}

function renderEmpty(platformDisplay, message, detail) {
  renderedPayloadSignature = '';
  const rows = document.getElementById('departure-rows');
  clearChildren(rows);
  const routeRow = document.createElement('tr');
  routeRow.appendChild(createPlatformCell(platformDisplay, 2));
  routeRow.appendChild(createCell('td', 'agency-cell'));
  routeRow.lastChild.rowSpan = 2;
  routeRow.appendChild(createCell('td', 'route-cell', message));
  const detailRow = document.createElement('tr');
  detailRow.className = 'departure-detail-row';
  detailRow.appendChild(createCell('td', 'departure-cell', detail));
  rows.appendChild(routeRow);
  rows.appendChild(detailRow);
}

function renderDepartures(payload) {
  const rows = document.getElementById('departure-rows');
  const departures = visibleDepartures(payload);
  const platformDisplay = String(payload && payload.platform_display || '--');
  const signature = departurePayloadSignature(payload);
  if (signature === renderedPayloadSignature) return false;
  if (!departures.length) {
    const unavailable = ['data_unavailable', 'schedule_unavailable'].indexOf(payload && payload.status) >= 0;
    renderEmpty(platformDisplay,
      unavailable ? 'Departures unavailable' : payload && payload.status === 'updating' ? 'Updating departures' : 'No departures scheduled',
      unavailable ? 'Retrying automatically' : `In the next ${Number(payload && payload.horizon_hours) || 72} hours`);
    renderedPayloadSignature = signature;
    return true;
  }
  clearChildren(rows);
  departures.forEach((departure, index) => {
    const routeRow = document.createElement('tr');
    if (index === 0) {
      routeRow.appendChild(createPlatformCell(platformDisplay, departures.length * 2));
    }
    routeRow.appendChild(createAgencyCell(departure));
    routeRow.appendChild(createCell('td', 'route-cell', routeDescription(departure)));

    const detailRow = document.createElement('tr');
    detailRow.className = 'departure-detail-row';
    const departureCell = createCell(
      'td',
      'departure-cell',
      formatDepartureText(departure.departure_time)
    );
    departureCell.dataset.departureTime = departure.departure_time || '';
    departureCell.dataset.source = departure.departure_source || '';
    detailRow.appendChild(departureCell);
    rows.appendChild(routeRow);
    rows.appendChild(detailRow);
  });
  renderedPayloadSignature = signature;
  return true;
}

function setTextIfChanged(element, nextText) {
  const value = String(nextText);
  if (element.textContent === value) return false;
  element.textContent = value;
  return true;
}

function refreshCountdowns(nowMs = Date.now()) {
  const cells = document.querySelectorAll('[data-departure-time]');
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    setTextIfChanged(cell, formatDepartureText(cell.dataset.departureTime, nowMs));
  }
}

function updateClock(now = new Date()) {
  const clock = document.getElementById('departure-clock');
  if (clock) {
    const clockText = formatTorontoTime(now);
    if (clock.textContent !== clockText) {
      clock.dateTime = now.toISOString();
      clock.textContent = clockText;
    }
  }
  if (currentPayload) renderCurrentPayload(now.getTime());
  refreshCountdowns(now.getTime());
}

function setStatus(message, shortMessage = 'Updates unavailable') {
  const status = document.getElementById('departure-status');
  if (!status) return;
  setTextIfChanged(status, message || '');
  if (status.hidden !== !message) status.hidden = !message;
  const health = document.getElementById('departure-health');
  if (health) {
    setTextIfChanged(health, message ? shortMessage : '');
    if (health.hidden !== !message) health.hidden = !message;
    const heading = health.parentNode;
    const className = message ? 'departure-board__clock has-warning' : 'departure-board__clock';
    if (heading && heading.className !== className) heading.className = className;
  }
}

function requestJsonWithXhr(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.setRequestHeader('Accept', 'application/json');
    request.timeout = REQUEST_TIMEOUT_MS;
    request.onreadystatechange = () => {
      if (request.readyState !== 4) return;
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Departure request failed (${request.status})`));
        return;
      }
      try {
        resolve(JSON.parse(request.responseText));
      } catch (err) {
        reject(new Error('Departure response was not valid JSON'));
      }
    };
    request.onerror = () => reject(new Error('Departure request failed (network error)'));
    request.ontimeout = () => reject(new Error('Departure request failed (timeout)'));
    request.send();
  });
}

async function requestJson(url) {
  if (typeof fetch !== 'function') {
    return requestJsonWithXhr(url);
  }
  return new Promise((resolve, reject) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let settled = false;
    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(payload);
    };
    const timer = setTimeout(() => {
      finish(new Error('Departure request failed (timeout)'));
      if (controller) controller.abort();
    }, REQUEST_TIMEOUT_MS);
    Promise.resolve().then(() => fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    })).then((response) => {
      if (!response.ok) throw new Error(`Departure request failed (${response.status})`);
      return response.json();
    }).then((payload) => finish(null, payload), (error) => finish(error));
  });
}

async function loadDepartures(stopCode) {
  const payload = await requestJson(
    `${API_PATH}?view=platform&stop=${encodeURIComponent(stopCode)}`
  );
  if (!validPayload(payload, stopCode)) {
    throw new Error('Invalid platform departure response');
  }
  currentPayload = payload;
  provisionalData = false;
  requestFailed = false;
  renderCurrentPayload();
  writeCachedDepartures(stopCode, payload);
  return true;
}

function startDepartureScreen() {
  const requestedStop = readQueryParameter(window.location.search, 'stop');
  const parsedStop = parseStopCode(requestedStop);
  updateClock();
  window.setInterval(updateClock, 1000);
  if (!parsedStop) {
    document.title = 'Platform Departures';
    renderEmpty('--', 'Stop code required', 'Use a terminal code from 9001 to 9014');
    setStatus('The URL does not contain a valid terminal stop code.');
    return;
  }

  document.title = `Platform ${parsedStop.display} Departures`;
  const cachedPayload = readCachedDepartures(parsedStop.stopCode);
  let hasRenderedData = Boolean(cachedPayload);
  if (cachedPayload) {
    currentPayload = cachedPayload;
    provisionalData = true;
    renderCurrentPayload();
  }

  async function refresh() {
    try {
      hasRenderedData = await loadDepartures(parsedStop.stopCode);
    } catch (err) {
      requestFailed = true;
      if (!hasRenderedData) {
        renderEmpty(parsedStop.display, 'Departures unavailable', 'Retrying automatically');
      }
      if (currentPayload) renderCurrentPayload();
      else setStatus('Departure data is temporarily unavailable. Retrying automatically.');
    } finally {
      window.setTimeout(refresh, REFRESH_INTERVAL_MS);
    }
  }
  refresh();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  startDepartureScreen();
}

export {
  formatDepartureText,
  departurePayloadSignature,
  parseStopCode,
  readCachedDepartures,
  readQueryParameter,
  routeDescription,
  writeCachedDepartures,
  displayPayload,
  requestJson,
  validPayload,
};
