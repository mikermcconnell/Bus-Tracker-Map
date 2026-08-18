const REFRESH_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const CACHE_KEY_PREFIX = 'platform-departures:v1:';
const API_PATH = '/api/departures';
const ASSET_PATH = '../../assets/';

let renderedPayloadSignature = '';

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
    signatureRows,
  ]);
}

function cacheKey(stopCode) {
  return `${CACHE_KEY_PREFIX}${stopCode}`;
}

function readCachedDepartures(stopCode, nowMs = Date.now()) {
  try {
    const stored = window.localStorage.getItem(cacheKey(stopCode));
    if (!stored) return null;
    const record = JSON.parse(stored);
    const savedAt = Number(record && record.saved_at);
    const payload = record && record.payload;
    if (!Number.isFinite(savedAt) || nowMs - savedAt > CACHE_MAX_AGE_MS) return null;
    if (!payload || String(payload.stop_code || '') !== String(stopCode)) return null;
    if (!Array.isArray(payload.departures)) return null;
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
  const tomorrow = new Date(nowMs + 24 * 60 * 60 * 1000);
  if (localDateKey(departure) === localDateKey(tomorrow)) {
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
    renderEmpty(platformDisplay, 'No departures scheduled', 'Please check again shortly');
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

function refreshCountdowns() {
  const cells = document.querySelectorAll('[data-departure-time]');
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    cell.textContent = formatDepartureText(cell.dataset.departureTime);
  }
}

function updateClock() {
  const clock = document.getElementById('departure-clock');
  if (clock) {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = formatTorontoTime(now);
  }
  refreshCountdowns();
}

function setStatus(message) {
  const status = document.getElementById('departure-status');
  if (!status) return;
  status.textContent = message || '';
  status.hidden = !message;
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
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Departure request failed (${response.status})`);
  return response.json();
}

async function loadDepartures(stopCode) {
  const payload = await requestJson(
    `${API_PATH}?view=platform&stop=${encodeURIComponent(stopCode)}`
  );
  renderDepartures(payload);
  writeCachedDepartures(stopCode, payload);
  setStatus('');
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
  if (cachedPayload) renderDepartures(cachedPayload);

  async function refresh() {
    try {
      hasRenderedData = await loadDepartures(parsedStop.stopCode);
    } catch (err) {
      if (!hasRenderedData) {
        renderEmpty(parsedStop.display, 'Departures unavailable', 'Retrying automatically');
      }
      setStatus('Departure data is temporarily unavailable. Retrying automatically.');
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
};
