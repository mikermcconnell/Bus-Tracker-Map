/**
 * UI controller encapsulates banner messaging, legend interactions,
 * and service notice behaviour. Map logic injects callbacks and state snapshots
 * through the legend context so this module remains unaware of Leaflet internals.
 */

const SERVICE_NOTICE_TEXT = '';
const HAS_SERVICE_NOTICE_COPY = typeof SERVICE_NOTICE_TEXT === 'string' && SERVICE_NOTICE_TEXT.trim().length > 0;
// Hide notice after Nov 3, 2024 (month is zero-indexed).
const SERVICE_NOTICE_END = (() => {
  const now = new Date();
  const currentYearEnd = new Date(now.getFullYear(), 10, 3, 0, 0, 0, 0);
  if (now >= currentYearEnd) {
    return new Date(now.getFullYear() + 1, 10, 3, 0, 0, 0, 0);
  }
  return currentYearEnd;
})();
const BANNER_PRIORITY = ['routes', 'vehicles'];

export function createUiController() {
  let bannerEl = null;
  let bannerDefaultText = '';
  let legendEl = null;
  let stopLegendEl = null;
  let serviceNoticeEl = null;
  let serviceNoticeTimer = null;
  const bannerMessages = Object.create(null);

  function init() {
    bannerEl = document.getElementById('banner');
    legendEl = document.getElementById('legend');
    stopLegendEl = document.getElementById('stop-legend');
    serviceNoticeEl = document.getElementById('service-notice');

    if (bannerEl) {
      bannerDefaultText = bannerEl.textContent || 'Live data unavailable, retrying';
      bannerEl.hidden = true;
    }

    setupServiceNotice();
    initWeather();
  }

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
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=44.3894&longitude=-79.6903&current=temperature_2m,weather_code&timezone=America%2FNew_York'
        );
        if (!res.ok) throw new Error('Weather fetch failed');
        const data = await res.json();
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
    if (!HAS_SERVICE_NOTICE_COPY) {
      serviceNoticeEl.hidden = true;
      return;
    }
    const track = serviceNoticeEl.querySelector('.service-notice__track');
    if (track) {
      const segments = track.querySelectorAll('.service-notice__text');
      segments.forEach((segment) => {
        segment.textContent = SERVICE_NOTICE_TEXT;
      });
    }
    updateServiceNoticeVisibility();
    scheduleServiceNoticeCheck();
  }

  function shouldShowServiceNotice(now) {
    if (!HAS_SERVICE_NOTICE_COPY) return false;
    const current = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(current.getTime())) return false;
    if (!(SERVICE_NOTICE_END instanceof Date) || !Number.isFinite(SERVICE_NOTICE_END.getTime())) {
      return false;
    }
    return current < SERVICE_NOTICE_END;
  }

  function updateServiceNoticeVisibility() {
    if (!serviceNoticeEl) return;
    serviceNoticeEl.hidden = !shouldShowServiceNotice(new Date());
  }

  function scheduleServiceNoticeCheck() {
    if (!serviceNoticeEl || !HAS_SERVICE_NOTICE_COPY) return;
    if (serviceNoticeTimer) {
      clearTimeout(serviceNoticeTimer);
      serviceNoticeTimer = null;
    }
    const now = new Date();
    if (!shouldShowServiceNotice(now)) return;
    const remaining = SERVICE_NOTICE_END.getTime() - now.getTime();
    if (remaining <= 0) {
      updateServiceNoticeVisibility();
      return;
    }
    const maxDelay = 6 * 60 * 60 * 1000;
    const delay = Math.min(remaining, maxDelay);
    serviceNoticeTimer = setTimeout(() => {
      serviceNoticeTimer = null;
      updateServiceNoticeVisibility();
      scheduleServiceNoticeCheck();
    }, delay);
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
    routesTitle.className = 'legend-section-title';
    routesTitle.textContent = 'Routes';
    routesSection.appendChild(routesTitle);

    const actions = document.createElement('div');
    actions.className = 'legend-actions';
    routesSection.appendChild(actions);

    const showAllBtn = document.createElement('button');
    showAllBtn.type = 'button';
    showAllBtn.id = 'btnShowAllRoutes';
    showAllBtn.textContent = 'Show All';
    actions.appendChild(showAllBtn);

    const hideAllBtn = document.createElement('button');
    hideAllBtn.type = 'button';
    hideAllBtn.id = 'btnHideAllRoutes';
    hideAllBtn.textContent = 'Hide All';
    actions.appendChild(hideAllBtn);

    const routeList = document.createElement('div');
    routeList.className = 'route-list';
    routeList.id = 'routeList';
    routesSection.appendChild(routeList);

    routeList.addEventListener('change', (event) => {
      const target = event.target;
      if (target && target.matches('input[type="checkbox"][data-route]')) {
        const routeId = target.getAttribute('data-route');
        context.setRouteVisibility(routeId, target.checked);
        updateRouteLegendState(context);
      }
    });

    showAllBtn.addEventListener('click', () => {
      context.getRouteIds().forEach((id) => context.setRouteVisibility(id, true));
      updateRouteLegendState(context);
    });

    hideAllBtn.addEventListener('click', () => {
      context.getRouteIds().forEach((id) => context.setRouteVisibility(id, false));
      updateRouteLegendState(context);
    });

    const vehiclesLabel = document.createElement('label');
    vehiclesLabel.className = 'legend-check';
    const vehiclesCheckbox = document.createElement('input');
    vehiclesCheckbox.type = 'checkbox';
    vehiclesCheckbox.id = 'chkVehicles';
    vehiclesCheckbox.checked = context.isVehiclesVisible();
    vehiclesLabel.appendChild(vehiclesCheckbox);
    const vehiclesText = document.createElement('span');
    vehiclesText.textContent = 'Vehicles';
    vehiclesLabel.appendChild(vehiclesText);
    legendEl.appendChild(vehiclesLabel);

    vehiclesCheckbox.addEventListener('change', (event) => {
      if (event.target.checked) {
        context.showVehicles();
      } else {
        context.hideVehicles();
      }
    });

    renderRouteLegend(context);
    renderStopLegend(context);
  }

  function renderRouteLegend(context) {
    if (!legendEl) return;
    const routeList = legendEl.querySelector('#routeList');
    if (!routeList) return;

    routeList.innerHTML = '';
    const routeIds = context.getRouteIds();

    routeIds.forEach((routeId) => {
      const entry = context.getRouteLayers()[routeId];
      if (!entry) return;

      const meta = context.getRouteMeta(routeId);
      const label = document.createElement('label');
      label.className = 'route-item';
      label.title = meta.longName ? `${meta.displayName} - ${meta.longName}` : meta.displayName;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = entry.visible !== false;
      input.setAttribute('data-route', routeId);
      label.appendChild(input);

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = meta.color;
      label.appendChild(swatch);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'route-name';
      nameSpan.textContent = meta.displayName;
      label.appendChild(nameSpan);

      routeList.appendChild(label);
    });

    updateRouteLegendState(context);
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
    if (!legendEl) return;
    const routeList = legendEl.querySelector('#routeList');
    if (!routeList) return;
    const routeLayers = context.getRouteLayers();

    routeList.querySelectorAll('label.route-item').forEach((label) => {
      const input = label.querySelector('input[type="checkbox"][data-route]');
      if (!input) return;
      const routeId = input.getAttribute('data-route');
      const entry = routeLayers[routeId];
      if (!entry) return;
      if (entry.visible !== false) {
        label.classList.remove('route-hidden');
        input.checked = true;
      } else {
        label.classList.add('route-hidden');
        input.checked = false;
      }
    });
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
    setConnectionStatus(status) {
      const el = document.getElementById('connection-status');
      if (!el) return;
      el.classList.remove('status-ok', 'status-warning', 'status-stale');
      const dot = el.querySelector('.live-dot');
      const text = el.querySelector('.live-text');

      if (status === 'warning') {
        el.classList.add('status-warning');
        if (text) text.textContent = 'DELAYED';
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
