const REFRESH_INTERVAL_MS = 10_000;
const PAGE_SIZE = 3;
const API_PATH = '/api/departures';
const TIME_ZONE = 'America/Toronto';

const screenState = {
  activePage: 0,
  departures: [],
  stop: null,
  hasData: false,
};

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

function parseStopQuery(value) {
  const stop = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(stop) ? stop : '';
}

function parseGroupQuery(value) {
  const group = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(group) ? group : '';
}

function formatTorontoTime(date) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
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
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch (err) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
  }
}

function formatDepartureCountdown(timestampSeconds, nowMs = Date.now()) {
  const timestamp = Number(timestampSeconds);
  const departure = new Date(timestamp * 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(departure.getTime())) {
    return '--';
  }
  const differenceMs = departure.getTime() - nowMs;
  if (differenceMs <= 60_000 && differenceMs >= -60_000) return 'Due';
  if (localDateKey(departure) === localDateKey(new Date(nowMs))) {
    return `${Math.max(0, Math.ceil(differenceMs / 60_000))} min`;
  }
  const tomorrow = new Date(nowMs + 86_400_000);
  if (localDateKey(departure) === localDateKey(tomorrow)) {
    return `Tomorrow ${formatTorontoTime(departure)}`;
  }
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      weekday: 'short',
    }).format(departure);
    return `${weekday} ${formatTorontoTime(departure)}`;
  } catch (err) {
    return formatTorontoTime(departure);
  }
}

function createRealtimeIcon() {
  const indicator = document.createElement('span');
  indicator.className = 'realtime-icon';
  indicator.setAttribute('aria-label', 'Real-time prediction');
  indicator.textContent = 'LIVE';
  return indicator;
}

function pageCount() {
  return Math.max(1, Math.ceil(screenState.departures.length / PAGE_SIZE));
}

function setStatus(message) {
  const status = document.getElementById('shelter-status');
  if (!status) return;
  status.textContent = message || '';
  status.hidden = !message;
}

function renderMessage(message) {
  const rows = document.getElementById('shelter-rows');
  rows.replaceChildren();
  const row = document.createElement('tr');
  row.className = 'shelter-row shelter-row--message';
  const cell = document.createElement('td');
  cell.colSpan = 2;
  cell.textContent = message;
  row.appendChild(cell);
  rows.appendChild(row);
}

function updateHeader() {
  const stopLabel = document.getElementById('shelter-stop');
  const pageLabel = document.getElementById('shelter-page');
  if (screenState.stop) {
    stopLabel.textContent = screenState.stop.is_group
      ? screenState.stop.name
      : `STOP ${screenState.stop.code} — ${screenState.stop.name}`;
  }
  pageLabel.textContent = `Page ${screenState.activePage + 1} of ${pageCount()}`;
}

function renderVisiblePage() {
  updateHeader();
  if (!screenState.departures.length) {
    renderMessage('No upcoming departures');
    return;
  }
  const rows = document.getElementById('shelter-rows');
  rows.replaceChildren();
  const start = screenState.activePage * PAGE_SIZE;
  screenState.departures.slice(start, start + PAGE_SIZE).forEach((departure) => {
    const row = document.createElement('tr');
    row.className = 'shelter-row';
    const service = document.createElement('td');
    service.className = 'shelter-row__service';
    const serviceContent = document.createElement('div');
    serviceContent.className = 'shelter-row__service-content';
    const route = document.createElement('strong');
    route.textContent = String(departure.route_label || departure.route_id || '');
    serviceContent.appendChild(route);
    if (screenState.stop && screenState.stop.is_group && departure.stop_label) {
      const stopBadge = document.createElement('span');
      stopBadge.className = 'shelter-row__stop';
      stopBadge.textContent = String(departure.stop_label);
      serviceContent.appendChild(stopBadge);
    }
    const separator = document.createElement('span');
    separator.className = 'shelter-row__separator';
    separator.textContent = '–';
    const destination = document.createElement('span');
    destination.className = 'shelter-row__destination';
    destination.textContent = String(departure.destination || 'SERVICE');
    serviceContent.appendChild(separator);
    serviceContent.appendChild(destination);
    service.appendChild(serviceContent);

    const arrival = document.createElement('td');
    arrival.className = 'shelter-row__arrival';
    arrival.dataset.departureTime = departure.effective_departure_time || '';
    arrival.textContent = formatDepartureCountdown(departure.effective_departure_time);
    if (departure.source === 'realtime') arrival.appendChild(createRealtimeIcon());
    row.appendChild(service);
    row.appendChild(arrival);
    rows.appendChild(row);
  });
}

function applyPayload(payload) {
  screenState.stop = payload && payload.stop || null;
  screenState.departures = Array.isArray(payload && payload.departures) ? payload.departures : [];
  screenState.activePage = Math.min(screenState.activePage, pageCount() - 1);
  screenState.hasData = true;
  if (screenState.stop) {
    document.title = screenState.stop.is_group
      ? `${screenState.stop.name} Departures`
      : `Stop ${screenState.stop.code} Departures`;
  }
  renderVisiblePage();
  if (payload && payload.realtime_status === 'unavailable') {
    setStatus('Live predictions unavailable — showing scheduled times');
  } else if (payload && payload.realtime_status === 'scheduled') {
    setStatus('Showing scheduled departure times');
  } else {
    setStatus('');
  }
}

function advancePage() {
  if (pageCount() <= 1) return;
  screenState.activePage = (screenState.activePage + 1) % pageCount();
  renderVisiblePage();
}

function updateClockAndCountdowns() {
  const clock = document.getElementById('shelter-clock');
  if (clock) {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = formatTorontoTime(now);
  }
  document.querySelectorAll('[data-departure-time]').forEach((cell) => {
    const icon = cell.querySelector('.realtime-icon');
    cell.textContent = formatDepartureCountdown(cell.dataset.departureTime);
    if (icon) cell.appendChild(icon);
  });
}

async function loadDepartures(query) {
  const response = await fetch(`${API_PATH}?${query.type}=${encodeURIComponent(query.value)}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload && payload.message || `Departure request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  applyPayload(payload);
}

function startShelterScreen() {
  const stop = parseStopQuery(readQueryParameter(window.location.search, 'stop'));
  const group = parseGroupQuery(readQueryParameter(window.location.search, 'group'));
  const query = group
    ? { type: 'group', value: group }
    : (stop ? { type: 'stop', value: stop } : null);
  updateClockAndCountdowns();
  window.setInterval(updateClockAndCountdowns, 1000);
  if (!query) {
    document.getElementById('shelter-stop').textContent = 'STOP REQUIRED';
    renderMessage('Add a Barrie Transit stop or departure group');
    setStatus('Examples: ?stop=2 or ?group=downtown-barrie');
    return;
  }

  async function refresh() {
    try {
      await loadDepartures(query);
    } catch (err) {
      if (!screenState.hasData) {
        document.getElementById('shelter-stop').textContent = query.type === 'group'
          ? query.value.replace(/-/g, ' ').toUpperCase()
          : `STOP ${query.value}`;
        renderMessage(err && err.status === 404 ? 'Location not found' : 'Departures unavailable');
      }
      setStatus(err && err.message ? err.message : 'Unable to refresh departures');
    }
  }

  refresh();
  window.setInterval(() => {
    advancePage();
    refresh();
  }, REFRESH_INTERVAL_MS);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  startShelterScreen();
}

export {
  PAGE_SIZE,
  advancePage,
  applyPayload,
  formatDepartureCountdown,
  parseGroupQuery,
  parseStopQuery,
  readQueryParameter,
};
