/**
 * UI controller encapsulates banner messaging, legend interactions,
 * and service notice behaviour. Map logic injects callbacks and state snapshots
 * through the legend context so this module remains unaware of Leaflet internals.
 */

const SERVICE_NOTICE_TEXT = 'For passenger pick up and drop off, please use the passenger vehicle loop beside the GO Train.';
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
  }

  function setupServiceNotice() {
    if (!serviceNoticeEl) return;
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
    if (!serviceNoticeEl) return;
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
  };
}
