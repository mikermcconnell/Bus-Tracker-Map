/**
 * UI controller encapsulates banner messaging, legend interactions,
 * and service notice behaviour. Map logic injects callbacks and state snapshots
 * through the legend context so this module remains unaware of Leaflet internals.
 */

const BANNER_PRIORITY = ['routes', 'vehicles'];

export function createUiController() {
  let bannerEl = null;
  let bannerDefaultText = '';
  let legendEl = null;
  let stopLegendEl = null;
  let serviceNoticeEl = null;
  let serviceStatusEl = null;
  let currentTimeEl = null;
  let lastUpdatedEl = null;
  let lastVehicleUpdate = null;
  const bannerMessages = Object.create(null);

  function init() {
    bannerEl = document.getElementById('banner');
    legendEl = document.getElementById('legend');
    stopLegendEl = document.getElementById('stop-legend');
    serviceNoticeEl = document.getElementById('service-notice');
    serviceStatusEl = document.getElementById('service-status');
    currentTimeEl = document.getElementById('current-time');
    lastUpdatedEl = document.getElementById('last-updated');

    if (bannerEl) {
      bannerDefaultText = bannerEl.textContent || 'Live data unavailable, retrying';
      bannerEl.hidden = true;
    }

    setupServiceNotice();
    initWeather();
    initClock();
  }

  function requestJson(url) {
    if (typeof fetch === 'function') {
      return fetch(url).then((response) => {
        if (!response.ok) throw new Error('Request failed: ' + response.status);
        return response.json();
      });
    }

    return new Promise((resolve, reject) => {
      if (typeof XMLHttpRequest !== 'function') {
        reject(new Error('No supported HTTP client available'));
        return;
      }

      const request = new XMLHttpRequest();
      request.open('GET', url, true);
      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        if (request.status >= 200 && request.status < 300) {
          try {
            resolve(JSON.parse(request.responseText));
          } catch (err) {
            reject(err);
          }
          return;
        }
        reject(new Error('Request failed: ' + request.status));
      };
      request.onerror = function () {
        reject(new Error('Network request failed'));
      };
      request.send(null);
    });
  }

  function initClock() {
    if (!currentTimeEl) return;

    const updateClock = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      currentTimeEl.textContent = `${displayHours}:${minutes} ${ampm}`;
    };

    updateClock();
    setInterval(updateClock, 1000);
  }

  function updateLastUpdated(timestamp) {
    const numeric = Number(timestamp);
    lastVehicleUpdate = Number.isFinite(numeric) && numeric > 0
      ? (numeric < 1e12 ? numeric * 1000 : numeric)
      : Date.now();
    refreshLastUpdatedDisplay();
  }

  function refreshLastUpdatedDisplay() {
    if (!lastUpdatedEl || !lastVehicleUpdate) return;

    const elapsed = Math.max(0, Date.now() - lastVehicleUpdate);
    const seconds = Math.floor(elapsed / 1000);

    if (seconds < 10) {
      lastUpdatedEl.textContent = 'Updated just now';
    } else if (seconds < 60) {
      lastUpdatedEl.textContent = `Updated ${seconds}s ago`;
    } else {
      const minutes = Math.floor(seconds / 60);
      lastUpdatedEl.textContent = `Updated ${minutes}m ago`;
    }
  }

  // Refresh the "Updated X ago" display every 5 seconds
  setInterval(refreshLastUpdatedDisplay, 5000);

  function initWeather() {
    const dateEl = document.getElementById('weather-date');
    const tempEl = document.getElementById('weather-temp');
    const condEl = document.getElementById('weather-condition');

    if (!dateEl || !tempEl || !condEl) return;

    const updateDate = () => {
      const now = new Date();
      const options = { weekday: 'long', month: 'short', day: 'numeric' };
      dateEl.textContent = now.toLocaleDateString('en-US', options);
    };

    const fetchWeather = async () => {
      try {
        // Barrie coordinates: 44.3894,-79.6903
        const data = await requestJson(
          'https://api.open-meteo.com/v1/forecast?latitude=44.3894&longitude=-79.6903&current=temperature_2m,weather_code&timezone=America%2FNew_York'
        );
        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;

        tempEl.innerHTML = `${temp}&deg;`;
        condEl.textContent = getWeatherCondition(code);
      } catch (err) {
        console.warn('Weather update failed:', err);
        tempEl.innerHTML = '--&deg;';
        condEl.textContent = 'Unavailable';
      }
    };

    updateDate();
    fetchWeather();

    // Update date every minute, weather every 15 minutes
    setInterval(updateDate, 60000);
    setInterval(fetchWeather, 15 * 60000);
  }

  function getWeatherCondition(code) {
    // WMO Weather interpretation codes (WW)
    const codes = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      56: 'Light freezing drizzle',
      57: 'Dense freezing drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      66: 'Light freezing rain',
      67: 'Heavy freezing rain',
      71: 'Slight snow fall',
      73: 'Moderate snow fall',
      75: 'Heavy snow fall',
      77: 'Snow grains',
      80: 'Slight rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      85: 'Slight snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm with slight hail',
      99: 'Thunderstorm with heavy hail'
    };
    return codes[code] || 'Unknown';
  }

  function setupServiceNotice() {
    if (!serviceNoticeEl) return;
    serviceNoticeEl.hidden = true;
    const track = serviceNoticeEl.querySelector('.service-notice__track');
    if (track) {
      const segments = track.querySelectorAll('.service-notice__text');
      segments.forEach((segment) => {
        segment.textContent = '';
      });
    }
  }

  function setServiceNoticeText(text) {
    if (!serviceNoticeEl) return;
    const message = String(text || '').trim();
    const track = serviceNoticeEl.querySelector('.service-notice__track');
    if (track) {
      const segments = track.querySelectorAll('.service-notice__text');
      segments.forEach((segment) => {
        segment.textContent = message;
      });
    }
    serviceNoticeEl.hidden = !message;
  }

  function getSpecialServiceDisplay(status, today) {
    if (today && today.display_label) {
      return String(today.display_label).trim();
    }

    const label = today && today.label ? String(today.label).trim() : '';

    if (today && today.mode === 'no_service') {
      return label ? `${label} Service: No Service` : 'Holiday Service: No Service';
    }

    if (today && today.mode === 'service_day' && today.service_day === 'sunday') {
      return label ? `${label} Service: Sunday Schedules` : 'Holiday Service: Sunday Schedules';
    }

    const serviceLabel = today && today.service_label
      ? String(today.service_label).trim()
      : (status && status.headline ? String(status.headline).trim() : 'Special Service');
    return label ? `${label} Service: ${serviceLabel}` : serviceLabel;
  }

  function setServiceStatus(status) {
    const isSpecial = Boolean(status && status.is_special_service && status.today);
    const warningMessage = status && status.upcoming_warning && status.upcoming_warning.message
      ? String(status.upcoming_warning.message).trim()
      : '';

    if (serviceStatusEl) {
      serviceStatusEl.classList.remove('service-status-pill--no-service', 'service-status-pill--special');
      if (!isSpecial) {
        serviceStatusEl.hidden = true;
        serviceStatusEl.textContent = '';
      } else {
        const today = status.today || {};
        const display = getSpecialServiceDisplay(status, today);
        serviceStatusEl.textContent = display;
        serviceStatusEl.title = display;
        serviceStatusEl.hidden = false;
        serviceStatusEl.classList.add(today.mode === 'no_service'
          ? 'service-status-pill--no-service'
          : 'service-status-pill--special');
      }
    }

    if (!isSpecial) {
      setServiceNoticeText(warningMessage);
      return;
    }

    setServiceNoticeText(getSpecialServiceDisplay(status, status.today || {}));
  }

  function showBanner(source, message) {
    if (!bannerEl) return;
    if (message) {
      bannerMessages[source] = message;
    } else {
      delete bannerMessages[source];
    }

    let nextMessage = null;
    for (let i = 0; i < BANNER_PRIORITY.length; i += 1) {
      const key = BANNER_PRIORITY[i];
      if (bannerMessages[key]) {
        nextMessage = bannerMessages[key];
        break;
      }
    }
    if (!nextMessage) {
      const keys = Object.keys(bannerMessages);
      if (keys.length > 0) {
        nextMessage = bannerMessages[keys[0]];
      }
    }

    if (!nextMessage) {
      bannerEl.textContent = bannerDefaultText;
      bannerEl.hidden = true;
    } else {
      bannerEl.textContent = nextMessage;
      bannerEl.hidden = false;
    }
  }

  function setupLegend(context) {
    if (!legendEl) return;
    legendEl.innerHTML = '';

    const routesSection = document.createElement('div');
    routesSection.className = 'legend-section';
    legendEl.appendChild(routesSection);

    const routesTitle = document.createElement('div');
    routesTitle.className = 'legend-section-title legend-section-title--terminal';
    routesTitle.setAttribute('aria-label', 'Barrie Allandale Transit Terminal');
    routesTitle.innerHTML = [
      '<span class="legend-section-title__line">Barrie Allandale</span>',
      '<span class="legend-section-title__line">Transit Terminal</span>'
    ].join('');
    routesSection.appendChild(routesTitle);

    const routeList = document.createElement('div');
    routeList.className = 'route-list';
    routeList.id = 'routeList';
    routesSection.appendChild(routeList);

    renderRouteLegend(context);
    renderStopLegend(context);
  }

  function renderRouteLegend(context) {
    if (!legendEl) return;
    const routeList = legendEl.querySelector('#routeList');
    if (!routeList) return;

    routeList.innerHTML = '';
    const routeIds = context.getRouteIds();
    const routeLayers = context.getRouteLayers();

    routeIds.forEach((routeId) => {
      const entry = routeLayers[routeId];
      if (!entry) return;

      // Only show visible/active routes
      if (entry.visible === false) return;

      const meta = context.getRouteMeta(routeId);
      const item = document.createElement('div');
      item.className = 'route-item route-item--display';
      item.title = meta.longName ? `${meta.displayName} - ${meta.longName}` : meta.displayName;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = meta.color;
      item.appendChild(swatch);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'route-name';
      nameSpan.textContent = meta.displayName;
      item.appendChild(nameSpan);

      routeList.appendChild(item);
    });
  }

  function renderStopLegend(context) {
    if (!stopLegendEl) return;
    stopLegendEl.innerHTML = '';
    const entries = typeof context.getStopLegendEntries === 'function'
      ? context.getStopLegendEntries()
      : [];

    if (!entries.length) {
      stopLegendEl.hidden = true;
      return;
    }

    stopLegendEl.hidden = false;

    const title = document.createElement('div');
    title.className = 'stop-legend-title';
    title.textContent = 'Transit Hubs';
    stopLegendEl.appendChild(title);

    const list = document.createElement('dl');
    list.className = 'stop-legend-list';

    entries.forEach((entry) => {
      const term = document.createElement('dt');
      term.textContent = entry.shortLabel;
      list.appendChild(term);

      const desc = document.createElement('dd');
      desc.textContent = entry.fullLabel;
      list.appendChild(desc);
    });

    stopLegendEl.appendChild(list);
  }

  function updateRouteLegendState(context) {
    // Re-render the legend to reflect current visibility state
    renderRouteLegend(context);
  }

  return {
    init,
    showBanner,
    clearBanner(source) {
      showBanner(source, null);
    },
    setupLegend,
    renderRouteLegend,
    renderStopLegend,
    updateRouteLegendState,
    updateLastUpdated,
    setVehicleFeedDegraded(degraded) {
      if (!document.body) return;
      if (degraded) {
        document.body.classList.add('vehicle-feed-degraded');
      } else {
        document.body.classList.remove('vehicle-feed-degraded');
      }
    },
    setServiceStatus,
    setConnectionStatus(status, label) {
      const el = document.getElementById('connection-status');
      if (!el) return;
      el.classList.remove('status-connecting', 'status-ok', 'status-warning', 'status-stale');
      const dot = el.querySelector('.live-dot');
      const text = el.querySelector('.live-text');

      if (status === 'connecting') {
        el.classList.add('status-connecting');
        if (text) text.textContent = 'CONNECTING';
      } else if (status === 'warning') {
        el.classList.add('status-warning');
        if (text) text.textContent = label || 'DELAYED';
      } else if (status === 'stale') {
        el.classList.add('status-stale');
        if (text) text.textContent = 'OFFLINE';
      } else {
        el.classList.add('status-ok');
        if (text) text.textContent = 'LIVE';
      }
    },
  };
}
