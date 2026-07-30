/**
 * UI controller encapsulates banner messaging, legend interactions,
 * and service notice behaviour. Map logic injects callbacks and state snapshots
 * through the legend context so this module remains unaware of Leaflet internals.
 */

import { buildNearbyRenderSignature } from '../map/tracked-services.js';

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
  let nearbyBusesListEl = null;
  let trackedServicesListEl = null;
  let nearbyRowNodes = Object.create(null);
  let trackedServiceNodes = Object.create(null);
  let lastNearbySignature = null;
  let lastTrackedServicesSignature = null;
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
    nearbyBusesListEl = document.getElementById('nearby-buses-list');
    trackedServicesListEl = document.getElementById('tracked-services-list');

    if (bannerEl) {
      bannerDefaultText = bannerEl.textContent || 'Live data unavailable, retrying';
      bannerEl.hidden = true;
    }

    setupServiceNotice();
    initClock();
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
      lastUpdatedEl.textContent = 'JUST NOW';
      lastUpdatedEl.setAttribute('aria-label', 'Updated just now');
    } else if (seconds < 60) {
      lastUpdatedEl.textContent = `${seconds}s AGO`;
      lastUpdatedEl.setAttribute('aria-label', `Updated ${seconds} seconds ago`);
    } else {
      const minutes = Math.floor(seconds / 60);
      lastUpdatedEl.textContent = `${minutes}m AGO`;
      lastUpdatedEl.setAttribute('aria-label', `Updated ${minutes} minutes ago`);
    }
  }

  // Refresh the "Updated X ago" display every 5 seconds
  setInterval(refreshLastUpdatedDisplay, 5000);


  function createNearbyRow(id) {
    const item = document.createElement('li');
    item.className = 'nearby-bus';
    item.dataset.vehicleId = id;

    const route = document.createElement('span');
    route.className = 'nearby-bus__route';

    const routeAgency = document.createElement('span');
    routeAgency.className = 'nearby-bus__route-agency';

    const routeCode = document.createElement('span');
    routeCode.className = 'nearby-bus__route-code';

    const details = document.createElement('span');
    details.className = 'nearby-bus__details';

    const title = document.createElement('strong');
    title.className = 'nearby-bus__title';

    const agency = document.createElement('span');
    agency.className = 'nearby-bus__agency';

    const distance = document.createElement('strong');
    distance.className = 'nearby-bus__distance';

    details.appendChild(title);
    details.appendChild(agency);
    route.appendChild(routeAgency);
    route.appendChild(routeCode);
    item.appendChild(route);
    item.appendChild(details);
    item.appendChild(distance);
    item.__nearbyParts = { route, routeAgency, routeCode, title, agency, distance };
    return item;
  }

  function updateNearbyRow(item, entry) {
    const parts = item.__nearbyParts;
    const terminalStatus = String(entry.terminalStatus || '').toLowerCase();
    const terminal = terminalStatus === 'at_terminal';
    const agencyId = String(entry.agencyId || 'barrie-transit');
    const regionalAgencyMark = agencyId === 'go-transit'
      ? 'GO'
      : (agencyId === 'ontario-northland' ? 'ON' : '');
    item.classList.toggle('nearby-bus--terminal', terminal);
    item.dataset.agencyId = agencyId;
    item.dataset.terminalStatus = terminalStatus;
    parts.routeAgency.textContent = regionalAgencyMark;
    parts.routeCode.textContent = String(entry.routeCode || entry.routeLabel || 'Bus');
    parts.route.style.setProperty('--route-color', String(entry.color || '#004e80'));
    parts.route.style.setProperty('--route-text-color', String(entry.textColor || '#ffffff'));
    parts.title.textContent = entry.destination
      ? String(entry.destination)
      : String(entry.agencyLabel || 'Live bus');
    parts.agency.textContent = String(entry.serviceLabel || entry.agencyLabel || 'Live vehicle');
    parts.distance.textContent = String(entry.distanceLabel || '');
  }

  function renderNearbyVehicles(rows) {
    if (!nearbyBusesListEl) return;
    const entries = Array.isArray(rows) ? rows : [];
    const nextSignature = buildNearbyRenderSignature(entries);
    if (nextSignature === lastNearbySignature) return;

    if (!entries.length) {
      while (nearbyBusesListEl.firstChild) {
        nearbyBusesListEl.removeChild(nearbyBusesListEl.firstChild);
      }
      const holding = document.createElement('li');
      holding.className = 'nearby-buses__holding';
      holding.textContent = 'No vehicles are currently approaching Barrie Allandale Transit Terminal';
      nearbyBusesListEl.appendChild(holding);
      nearbyRowNodes = Object.create(null);
      lastNearbySignature = nextSignature;
      return;
    }

    const desiredNodes = [];
    const seen = Object.create(null);
    entries.forEach((entry, index) => {
      const id = String(entry && entry.id || `nearby-${index}`);
      let item = nearbyRowNodes[id];
      if (!item) {
        item = createNearbyRow(id);
        nearbyRowNodes[id] = item;
      }
      updateNearbyRow(item, entry || {});
      desiredNodes.push(item);
      seen[id] = true;
    });

    Object.keys(nearbyRowNodes).forEach((id) => {
      if (seen[id]) return;
      const stale = nearbyRowNodes[id];
      if (stale.parentNode === nearbyBusesListEl) {
        nearbyBusesListEl.removeChild(stale);
      }
      delete nearbyRowNodes[id];
    });

    desiredNodes.forEach((item, index) => {
      const current = nearbyBusesListEl.children[index] || null;
      if (current !== item) {
        nearbyBusesListEl.insertBefore(item, current);
      }
    });
    while (nearbyBusesListEl.children.length > desiredNodes.length) {
      nearbyBusesListEl.removeChild(nearbyBusesListEl.lastElementChild);
    }
    lastNearbySignature = nextSignature;
  }

  function createTrackedAgencyRow(id) {
    const item = document.createElement('li');
    item.className = 'tracked-agency';
    item.dataset.agencyId = id;

    const identity = document.createElement('span');
    identity.className = 'tracked-agency__identity';

    const logo = document.createElement('img');
    logo.className = 'tracked-agency__logo';

    const name = document.createElement('strong');
    name.className = 'tracked-agency__name';

    const services = document.createElement('ul');
    services.className = 'tracked-agency__services';

    identity.appendChild(logo);
    identity.appendChild(name);
    item.appendChild(identity);
    item.appendChild(services);
    item.__trackedParts = { logo, name, services, serviceNodes: Object.create(null) };
    return item;
  }

  function createTrackedModeRow(id) {
    const item = document.createElement('li');
    item.className = 'tracked-agency__service';
    item.dataset.serviceId = id;

    const type = document.createElement('span');
    type.className = 'tracked-agency__type';

    const status = document.createElement('span');
    status.className = 'tracked-agency__status';
    const dot = document.createElement('span');
    dot.className = 'tracked-service__status-dot';

    const statusText = document.createElement('span');
    statusText.className = 'tracked-service__status-text';

    status.appendChild(dot);
    status.appendChild(statusText);
    item.appendChild(type);
    item.appendChild(status);
    item.__trackedParts = { type, dot, statusText };
    return item;
  }

  function updateTrackedAgencyRow(item, agency) {
    const parts = item.__trackedParts;
    const logoSrc = String(agency.logoSrc || '');
    item.classList.toggle('tracked-agency--text-logo', !logoSrc);
    parts.logo.hidden = !logoSrc;
    if (logoSrc) parts.logo.src = logoSrc;
    parts.logo.alt = String(agency.logoAlt || agency.agencyLabel || '');
    parts.name.textContent = String(agency.logoText || agency.agencyLabel || 'Transit service');

    const desiredNodes = [];
    const seen = Object.create(null);
    const services = Array.isArray(agency.services) ? agency.services : [];
    services.forEach((service, index) => {
      const id = String(service && service.id || `mode-${index}`);
      let serviceItem = parts.serviceNodes[id];
      if (!serviceItem) {
        serviceItem = createTrackedModeRow(id);
        parts.serviceNodes[id] = serviceItem;
      }
      const serviceParts = serviceItem.__trackedParts;
      const status = String(service.status || 'unavailable');
      serviceItem.dataset.status = status;
      serviceParts.type.textContent = String(service.serviceType || '');
      serviceParts.dot.className = `tracked-service__status-dot tracked-service__status-dot--${status}`;
      serviceParts.statusText.textContent = String(service.statusLabel || 'Unavailable');
      desiredNodes.push(serviceItem);
      seen[id] = true;
    });

    Object.keys(parts.serviceNodes).forEach((id) => {
      if (seen[id]) return;
      const stale = parts.serviceNodes[id];
      if (stale.parentNode === parts.services) parts.services.removeChild(stale);
      delete parts.serviceNodes[id];
    });
    desiredNodes.forEach((serviceItem, index) => {
      const current = parts.services.children[index] || null;
      if (current !== serviceItem) parts.services.insertBefore(serviceItem, current);
    });
  }

  function renderTrackedServices(rows) {
    if (!trackedServicesListEl) return;
    const entries = Array.isArray(rows) ? rows : [];
    const signature = JSON.stringify(entries);
    if (signature === lastTrackedServicesSignature) return;

    const desiredNodes = [];
    const seen = Object.create(null);
    entries.forEach((entry, index) => {
      const id = String(entry && entry.id || `service-${index}`);
      let item = trackedServiceNodes[id];
      if (!item) {
        item = createTrackedAgencyRow(id);
        trackedServiceNodes[id] = item;
      }
      updateTrackedAgencyRow(item, entry || {});
      desiredNodes.push(item);
      seen[id] = true;
    });

    Object.keys(trackedServiceNodes).forEach((id) => {
      if (seen[id]) return;
      const stale = trackedServiceNodes[id];
      if (stale.parentNode === trackedServicesListEl) {
        trackedServicesListEl.removeChild(stale);
      }
      delete trackedServiceNodes[id];
    });
    desiredNodes.forEach((item, index) => {
      const current = trackedServicesListEl.children[index] || null;
      if (current !== item) {
        trackedServicesListEl.insertBefore(item, current);
      }
    });
    while (trackedServicesListEl.children.length > desiredNodes.length) {
      trackedServicesListEl.removeChild(trackedServicesListEl.lastElementChild);
    }
    lastTrackedServicesSignature = signature;
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
        const upcomingMatch = message.match(/^Upcoming Holiday Service\s*(?::|-)\s*(.*)$/i);
        segment.textContent = '';
        if (upcomingMatch) {
          const heading = document.createElement('strong');
          heading.className = 'service-notice__heading';
          heading.textContent = 'Upcoming Holiday Service -';
          segment.appendChild(heading);
          if (upcomingMatch[1]) {
            segment.appendChild(document.createTextNode(` ${upcomingMatch[1]}`));
          }
        } else {
          segment.textContent = message;
        }
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

  function scopeBarrieServiceMessage(message) {
    const text = String(message || '').trim();
    if (!text || /^Barrie Transit\b/i.test(text)) return text;
    return `Barrie Transit — ${text}`;
  }

  function stripBarrieServicePrefix(message) {
    return String(message || '')
      .trim()
      .replace(/^Barrie Transit\s*(?:—|-|:)\s*/i, '');
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
        const display = scopeBarrieServiceMessage(getSpecialServiceDisplay(status, today));
        serviceStatusEl.textContent = display;
        serviceStatusEl.title = display;
        serviceStatusEl.hidden = false;
        serviceStatusEl.classList.add(today.mode === 'no_service'
          ? 'service-status-pill--no-service'
          : 'service-status-pill--special');
      }
    }

    if (!isSpecial) {
      setServiceNoticeText(stripBarrieServicePrefix(warningMessage));
      return;
    }

    setServiceNoticeText(stripBarrieServicePrefix(getSpecialServiceDisplay(status, status.today || {})));
  }

  function showBanner(source, message) {
    if (!bannerEl) return;
    if (message) {
      bannerMessages[source] = message;
    } else {
      delete bannerMessages[source];
    }

    let nextMessage = null;
    let nextSource = '';
    for (let i = 0; i < BANNER_PRIORITY.length; i += 1) {
      const key = BANNER_PRIORITY[i];
      if (bannerMessages[key]) {
        nextMessage = bannerMessages[key];
        nextSource = key;
        break;
      }
    }
    if (!nextMessage) {
      const keys = Object.keys(bannerMessages);
      if (keys.length > 0) {
        nextSource = keys[0];
        nextMessage = bannerMessages[nextSource];
      }
    }

    if (!nextMessage) {
      bannerEl.textContent = bannerDefaultText;
      delete bannerEl.dataset.source;
      bannerEl.hidden = true;
    } else {
      bannerEl.textContent = nextMessage;
      bannerEl.dataset.source = nextSource;
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
    routesTitle.setAttribute('aria-label', 'Live route layers by transit agency');
    routesTitle.innerHTML = [
      '<span class="legend-section-title__line">Live Route Layers</span>'
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

    const agencyGroups = {
      'barrie-transit': {
        label: 'Barrie Transit',
        logoSrc: './assets/agency-barrie-transit.png',
        className: 'legend-agency--barrie',
        routes: []
      },
      'ontario-northland': {
        label: 'Ontario Northland',
        logoSrc: './assets/agency-ontario-northland.png',
        className: 'legend-agency--northland',
        routes: []
      },
      'go-transit': {
        label: 'GO Transit',
        logoSrc: null,
        className: 'legend-agency--go',
        routes: []
      }
    };

    routeIds.forEach((routeId) => {
      const entry = routeLayers[routeId];
      if (!entry) return;

      // Only show visible/active routes
      if (entry.visible === false) return;

      const meta = context.getRouteMeta(routeId);
      const agencyId = Object.prototype.hasOwnProperty.call(agencyGroups, meta.agencyId)
        ? meta.agencyId
        : 'barrie-transit';
      agencyGroups[agencyId].routes.push({ routeId, entry, meta });
    });

    Object.keys(agencyGroups).forEach((agencyId) => {
      const group = agencyGroups[agencyId];
      if (!group.routes.length) return;

      const agencySection = document.createElement('section');
      agencySection.className = `legend-agency ${group.className}`;

      const agencyTitle = document.createElement('div');
      agencyTitle.className = 'legend-agency-title';
      agencyTitle.setAttribute('aria-label', group.label);
      if (group.logoSrc) {
        const agencyLogo = document.createElement('img');
        agencyLogo.className = 'legend-agency-logo';
        agencyLogo.src = group.logoSrc;
        agencyLogo.alt = group.label;
        agencyTitle.appendChild(agencyLogo);
      } else {
        const agencyName = document.createElement('span');
        agencyName.className = 'legend-agency-name';
        agencyName.textContent = group.label;
        agencyTitle.appendChild(agencyName);
      }
      agencySection.appendChild(agencyTitle);

      const agencyRoutes = document.createElement('div');
      agencyRoutes.className = 'route-list';

      group.routes.forEach(({ routeId, entry, meta }) => {
      const item = document.createElement('div');
      item.className = `route-item route-item--display route-item--${agencyId}`;
      item.title = meta.longName ? `${meta.displayName} - ${meta.longName}` : meta.displayName;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = meta.color;
      item.appendChild(swatch);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'route-name';
      nameSpan.textContent = agencyId === 'go-transit'
        ? (routeId === 'GO-TRAIN' ? 'BARRIE TRAIN' : 'BUS 68')
        : meta.displayName;
      item.appendChild(nameSpan);

        if (agencyId === 'ontario-northland' && Array.isArray(entry.sourceRouteIds) && entry.sourceRouteIds.length) {
          const details = document.createElement('span');
          details.className = 'route-details';
          details.textContent = `Routes ${entry.sourceRouteIds.join(' • ')}`;
          item.appendChild(details);
          item.title = `${group.label}: ${details.textContent}`;
        }
        if (agencyId === 'go-transit') {
          item.title = routeId === 'GO-TRAIN'
            ? `${group.label}: Barrie Line train`
            : `${group.label}: Route 68 bus`;
        }

        agencyRoutes.appendChild(item);
      });

      agencySection.appendChild(agencyRoutes);
      routeList.appendChild(agencySection);
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
    renderNearbyVehicles,
    renderTrackedServices,
    setVehicleFeedDegraded(degraded) {
      if (!document.body) return;
      if (degraded) {
        document.body.classList.add('vehicle-feed-degraded');
      } else {
        document.body.classList.remove('vehicle-feed-degraded');
      }
    },
    setServiceStatus,
    setSourceStatuses(sources) {
      updateSourceStatusPill(
        document.getElementById('source-status-barrie'),
        sources && sources.barrie_transit,
        'Barrie Transit'
      );
      updateSourceStatusPill(
        document.getElementById('source-status-northland'),
        sources && sources.ontario_northland,
        'Ontario Northland'
      );
      updateSourceStatusPill(
        document.getElementById('source-status-go'),
        sources && sources.go_transit,
        'GO Transit'
      );
    },
    setConnectionStatus(status, label) {
      const el = document.getElementById('connection-status');
      if (!el) return;
      const text = el.querySelector('.live-feed-summary__text');
      const overallLabel = status === 'connecting'
        ? 'Connecting to transit feeds'
        : (status === 'warning'
          ? (label || 'Some transit data is delayed')
          : (status === 'stale' ? 'Transit feeds offline' : 'Transit feeds available'));
      el.dataset.overallStatus = status || 'ok';
      el.setAttribute('aria-label', overallLabel);
      el.classList.remove('status-connecting', 'status-ok', 'status-warning', 'status-stale');
      el.classList.add(
        status === 'connecting'
          ? 'status-connecting'
          : (status === 'warning' ? 'status-warning' : (status === 'stale' ? 'status-stale' : 'status-ok'))
      );
      if (text) {
        text.textContent = status === 'connecting'
          ? 'CONNECTING'
          : (status === 'warning'
            ? (label || 'DELAYED')
            : (status === 'stale' ? 'OFFLINE' : 'LIVE'));
      }
    },
  };
}

function updateSourceStatusPill(element, source, agencyName) {
  if (!element) return;
  const text = element.querySelector('.live-text');
  const status = source && source.feed_status ? source.feed_status : 'offline';
  element.classList.remove('status-connecting', 'status-ok', 'status-warning', 'status-stale');

  if (!source) {
    element.classList.add('status-stale');
    if (text) text.textContent = 'OFFLINE';
  } else if (status === 'live') {
    element.classList.add('status-ok');
    if (text) text.textContent = 'LIVE';
  } else if (status === 'delayed') {
    element.classList.add('status-warning');
    if (text) text.textContent = 'DELAYED';
  } else if (status === 'empty') {
    element.classList.add('status-warning');
    if (text) text.textContent = 'NO BUSES';
  } else {
    element.classList.add('status-stale');
    if (text) text.textContent = 'OFFLINE';
  }

  const age = source && Number.isFinite(Number(source.data_age_seconds))
    ? `, last data ${Math.max(0, Number(source.data_age_seconds))} seconds ago`
    : '';
  element.title = `${agencyName}: ${text ? text.textContent : status}${age}`;
}
