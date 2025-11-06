const PLATFORM_IMAGE_URL = './assets/batt-platform-map.jpg';
const PLATFORM_BOUNDS = [
  [44.372905996, -79.692075326], // Tuned overlay (≈25m east / 5m north overall)
  [44.375211996, -79.686492326]
];
const PLATFORM_LAT_MIN = Math.min(PLATFORM_BOUNDS[0][0], PLATFORM_BOUNDS[1][0]);
const PLATFORM_LAT_MAX = Math.max(PLATFORM_BOUNDS[0][0], PLATFORM_BOUNDS[1][0]);
const PLATFORM_LON_MIN = Math.min(PLATFORM_BOUNDS[0][1], PLATFORM_BOUNDS[1][1]);
const PLATFORM_LON_MAX = Math.max(PLATFORM_BOUNDS[0][1], PLATFORM_BOUNDS[1][1]);
const DEFAULT_POLL_MS = 10000;
const MAX_MARKER_AGE_MS = 60000;
const MARKER_ANIMATION_DURATION_MS = 4050;
const MIN_ANIMATION_DISTANCE_METERS = 0.75;

export function createBattMapController({ dataClient }) {
  let map = null;
  let vehicleLayer = null;
  let statusEl = null;
  let pollMs = DEFAULT_POLL_MS;
  let pollTimer = null;
  let animationFrameHandle = null;
  const markerIndex = Object.create(null);
  const routeStyles = Object.create(null);
  const requestFrame = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
    ? window.requestAnimationFrame.bind(window)
    : ((cb) => setTimeout(() => cb(Date.now()), 16));

  function registerRouteMeta(meta, props) {
    if (!meta || !meta.id) return;
    const aliases = buildRouteAliasKeys(meta, props);
    for (let i = 0; i < aliases.length; i += 1) {
      const key = aliases[i];
      if (!key) continue;
      if (!routeStyles[key]) {
        routeStyles[key] = meta;
      }
    }
  }

  function buildRouteAliasKeys(meta, props) {
    const keys = [];
    const seen = new Set();
    const pushKey = (value) => {
      const normalized = normalizeRouteKey(value);
      if (normalized && !seen.has(normalized)) {
        keys.push(normalized);
        seen.add(normalized);
      }
      const numeric = extractNumericAlias(normalized);
      if (numeric && !seen.has(numeric)) {
        keys.push(numeric);
        seen.add(numeric);
      }
    };

    pushKey(meta.id);
    pushKey(meta.displayName);
    if (props) {
      pushKey(props.route_id);
      pushKey(props.route_short_name);
      pushKey(props.route_long_name);
    }
    return keys;
  }

  function initialize() {
    if (!dataClient) {
      return Promise.reject(new Error('Missing data client'));
    }

    statusEl = document.getElementById('batt-status');
    showStatus('Loading platform map…');

    return dataClient.fetchConfig()
      .then((cfg) => {
        if (cfg && typeof cfg === 'object') {
          if (cfg.base_path) {
            dataClient.setBasePath(cfg.base_path);
          }
          if (cfg.poll_ms) {
            const parsed = Number(cfg.poll_ms);
            if (Number.isFinite(parsed) && parsed > 0) {
              pollMs = parsed;
            }
          }
        }
      })
      .catch((err) => {
        console.warn('Using default configuration for BATT map:', err);
      })
      .then(() => Promise.all([
        loadRouteStyles()
      ]))
      .finally(() => {
        setupMap();
        showStatus('Loading live vehicles…');
        startVehiclePolling();
      });
  }

  function setupMap() {
    const container = document.getElementById('batt-map');
    if (!container) {
      throw new Error('Missing #batt-map container');
    }

    const bounds = L.latLngBounds(PLATFORM_BOUNDS);
    const center = bounds.getCenter();

    map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      tap: false
    });

    L.imageOverlay(PLATFORM_IMAGE_URL, bounds, {
      opacity: 1,
      interactive: false
    }).addTo(map);

    map.fitBounds(bounds, { padding: [0, 0] });
    const lockedZoom = map.getZoom();
    map.setView(center, lockedZoom, { animate: false });
    map.setMinZoom(lockedZoom);
    map.setMaxZoom(lockedZoom);
    map.setMaxBounds(bounds.pad(0.015));

    vehicleLayer = L.layerGroup().addTo(map);
  }

  function startVehiclePolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    const tick = () => {
      dataClient.fetchVehicles()
        .then((data) => {
          if (data && data.error) {
            throw new Error(data.error);
          }
          hideStatus();
          const list = data && Array.isArray(data.vehicles) ? data.vehicles : [];
          updateVehicles(list);
        })
        .catch((err) => {
          console.error('Failed to fetch vehicles for BATT map:', err);
          showStatus('Live vehicles unavailable — retrying…');
        })
        .finally(() => {
          pollTimer = setTimeout(tick, pollMs);
        });
    };

    tick();
  }

  function loadRouteStyles() {
    return dataClient.fetchRoutes()
      .then((geojson) => {
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          return;
        }
        geojson.features.forEach((feature) => {
          if (!feature || typeof feature !== 'object') return;
          const props = feature.properties || {};
          const rawId = props.route_id || props.shape_id || props.route_short_name;
          if (!rawId) return;
          const meta = {
            id: String(rawId),
            displayName: deriveRouteLabel(props, rawId),
            color: normalizeHexColor(props.route_color) || '#004E80',
            textColor: normalizeHexColor(props.route_text_color) || computeTextColor(props.route_color || '#004E80')
          };
          registerRouteMeta(meta, props);
        });
      })
      .catch((err) => {
        console.warn('Failed to load routes metadata for BATT map:', err);
      });
  }

  function updateVehicles(list) {
    if (!vehicleLayer) return;
    const seen = Object.create(null);
    const now = Date.now();

    for (let i = 0; i < list.length; i += 1) {
      const vehicle = list[i];
      if (!vehicle) continue;
      const lat = Number(vehicle.lat);
      const lon = Number(vehicle.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!isWithinPlatformBounds(lat, lon)) continue;
      const nextLatLng = L.latLng(lat, lon);

      const key = String(vehicle.id || vehicle.vehicle_id || vehicle.route_id || 'vehicle-' + i);
      seen[key] = true;

      const routeMeta = resolveRouteMeta(vehicle.route_id);
      const bearing = normalizeBearing(vehicle.bearing);
      const markerData = markerIndex[key];

      if (!markerData) {
        const marker = L.marker(nextLatLng, {
          icon: createBusIcon(routeMeta, bearing),
          interactive: false
        });
        marker.addTo(vehicleLayer);
        markerIndex[key] = {
          marker,
          routeMeta,
          lastUpdated: now,
          animation: null
        };
      } else {
        const marker = markerData.marker;
        if (!marker) continue;
        const currentLatLng = marker.getLatLng ? marker.getLatLng() : null;
        marker.setIcon(createBusIcon(routeMeta, bearing));
        markerData.routeMeta = routeMeta;
        markerData.lastUpdated = now;
        if (shouldAnimateMarker(currentLatLng, nextLatLng)) {
          startMarkerAnimation(markerData, nextLatLng);
        } else {
          marker.setLatLng(nextLatLng);
          markerData.animation = null;
        }
      }
    }

    Object.keys(markerIndex).forEach((id) => {
      const entry = markerIndex[id];
      if (!seen[id] || (entry && entry.lastUpdated && now - entry.lastUpdated > MAX_MARKER_AGE_MS)) {
        if (entry && entry.marker) {
          vehicleLayer.removeLayer(entry.marker);
        }
        if (entry) {
          entry.animation = null;
        }
        delete markerIndex[id];
      }
    });
  }

  function shouldAnimateMarker(currentLatLng, nextLatLng) {
    if (!currentLatLng || !nextLatLng) return false;
    const distance = computeDistanceMeters(currentLatLng, nextLatLng);
    return Number.isFinite(distance) && distance >= MIN_ANIMATION_DISTANCE_METERS;
  }

  function startMarkerAnimation(entry, targetLatLng) {
    if (!entry || !entry.marker || !targetLatLng) return;
    const startLatLng = entry.marker.getLatLng ? entry.marker.getLatLng() : null;
    if (!startLatLng) {
      entry.marker.setLatLng(targetLatLng);
      entry.animation = null;
      return;
    }
    entry.animation = {
      startLatLng: L.latLng(startLatLng.lat, startLatLng.lng),
      targetLatLng: L.latLng(targetLatLng.lat, targetLatLng.lng),
      startTime: null,
      duration: MARKER_ANIMATION_DURATION_MS
    };
    ensureAnimationLoop();
  }

  function ensureAnimationLoop() {
    if (animationFrameHandle !== null) return;
    animationFrameHandle = requestFrame(stepMarkerAnimations);
  }

  function stepMarkerAnimations(timestamp) {
    animationFrameHandle = null;
    let hasActive = false;

    Object.keys(markerIndex).forEach((id) => {
      const entry = markerIndex[id];
      const anim = entry && entry.animation;
      if (!entry || !anim || !entry.marker) return;

      if (anim.startTime === null) {
        anim.startTime = timestamp;
      }

      const start = anim.startLatLng;
      const target = anim.targetLatLng;
      if (!start || !target) {
        entry.animation = null;
        return;
      }

      const elapsed = Math.max(0, timestamp - anim.startTime);
      const progress = anim.duration > 0 ? Math.min(1, elapsed / anim.duration) : 1;
      const eased = easeInOutCubic(progress);
      const lat = start.lat + (target.lat - start.lat) * eased;
      const lon = start.lng + (target.lng - start.lng) * eased;
      entry.marker.setLatLng([lat, lon]);

      if (progress < 1) {
        hasActive = true;
      } else {
        entry.animation = null;
        entry.marker.setLatLng([target.lat, target.lng]);
      }
    });

    if (hasActive) {
      animationFrameHandle = requestFrame(stepMarkerAnimations);
    }
  }

  function computeDistanceMeters(a, b) {
    if (!a || !b) return 0;
    if (typeof a.distanceTo === 'function') {
      try {
        return a.distanceTo(b);
      } catch (err) {
        // fall through to manual calculation if Leaflet distance fails
      }
    }
    const toRadians = Math.PI / 180;
    const lat1 = a.lat * toRadians;
    const lat2 = b.lat * toRadians;
    const dLat = (b.lat - a.lat) * toRadians;
    const dLon = (b.lng - a.lng) * toRadians;
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
    return 2 * 6378137 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function easeInOutCubic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function resolveRouteMeta(routeId) {
    const key = normalizeRouteKey(routeId);
    const meta = key && routeStyles[key] ? routeStyles[key] : null;
    if (meta) return meta;
    const fallbackId = routeId ? String(routeId) : '?';
    return {
      id: fallbackId,
      displayName: fallbackId,
      color: '#004E80',
      textColor: '#FFFFFF'
    };
  }

  function showStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  function hideStatus() {
    if (!statusEl) return;
    statusEl.textContent = '';
    statusEl.hidden = true;
  }

  return {
    initialize
  };
}

function normalizeRouteKey(value) {
  if (!value) return '';
  return String(value).trim().toUpperCase();
}

function isWithinPlatformBounds(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    lat >= PLATFORM_LAT_MIN &&
    lat <= PLATFORM_LAT_MAX &&
    lon >= PLATFORM_LON_MIN &&
    lon <= PLATFORM_LON_MAX
  );
}

function extractNumericAlias(value) {
  if (!value) return '';
  const match = value.match(/^([0-9]+)(?:[A-Z])?$/);
  if (!match) return '';
  return match[1];
}

function normalizeHexColor(color) {
  if (!color) return null;
  const cleaned = String(color).trim();
  if (!cleaned) return null;
  const noHash = cleaned.startsWith('#') ? cleaned.slice(1) : cleaned;
  if (!/^[0-9a-fA-F]{3,6}$/.test(noHash)) return null;
  if (noHash.length === 3) {
    return '#' + noHash.split('').map((ch) => ch + ch).join('').toUpperCase();
  }
  return '#' + noHash.toUpperCase();
}

function computeTextColor(color) {
  const hex = normalizeHexColor(color);
  if (!hex) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#222222' : '#FFFFFF';
}

function deriveRouteLabel(props, fallbackId) {
  if (!props) return String(fallbackId || '?');
  if (props.route_short_name && String(props.route_short_name).trim()) {
    return String(props.route_short_name).trim();
  }
  if (props.route_id && String(props.route_id).trim()) {
    return String(props.route_id).trim();
  }
  return String(fallbackId || '?');
}

function sanitizeVehicleText(value, fallback) {
  const source = value === undefined || value === null ? (fallback || '') : value;
  return String(source)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeColorValue(value, fallback) {
  const color = value === undefined || value === null || value === '' ? (fallback || '#444444') : value;
  return String(color).replace(/[^#0-9a-zA-Z(),.% -]/g, '');
}

function shouldForceWhiteArrow(meta) {
  if (!meta) return false;
  const candidates = [meta.displayName, meta.id];
  for (let i = 0; i < candidates.length; i += 1) {
    const key = normalizeRouteKey(candidates[i]);
    if (key === '8' || key === '8A' || key === '8B') {
      return true;
    }
  }
  return false;
}

function normalizeBearing(value) {
  if (!Number.isFinite(value)) return null;
  let deg = value % 360;
  if (deg < 0) deg += 360;
  return deg;
}

function createBusIcon(meta = {}, bearing) {
  const scale = 0.75; // 25% smaller than the primary map markers
  const bubbleScale = Math.max(0.5, Math.min(2, scale));
  const bubbleBorderWidth = Math.max(1.5, 3 * bubbleScale);
  const bubbleInnerInset = Math.max(3, 7 * bubbleScale);
  const bubbleShadow = bubbleScale < 1 ? 'var(--shadow-soft)' : 'var(--shadow-medium)';
  const label = meta.displayName || meta.id || '?';
  const background = meta.color || '#444444';
  const textColor = meta.textColor || computeTextColor(meta.color || '#444444');
  const safeLabel = sanitizeVehicleText(label, '?');
  const safeBg = sanitizeColorValue(background, '#444444');
  const safeText = sanitizeColorValue(textColor || '#FFFFFF', '#FFFFFF');
  const hasBearing = Number.isFinite(bearing);
  const normalizedBearing = hasBearing ? normalizeBearing(bearing) : null;
  const bearingValue = normalizedBearing === null ? '0deg' : `${normalizedBearing.toFixed(1)}deg`;
  const labelLength = String(label || '').replace(/\s+/g, '').length;
  const baseLabelSize = labelLength >= 3 ? 15 : 19;
  const labelScale = Math.max(0.75, Math.min(1, bubbleScale));
  const labelSize = Math.round(baseLabelSize * labelScale);
  let arrowColor;
  let arrowStroke = 'rgba(255, 255, 255, 0.8)';
  if (shouldForceWhiteArrow(meta)) {
    arrowColor = '#FFFFFF';
    arrowStroke = '#000000';
  } else if (textColor && String(textColor).toUpperCase() === '#FFFFFF') {
    arrowColor = 'rgba(20,20,20,0.88)';
  } else {
    arrowColor = textColor || '#222222';
  }
  const safeArrow = sanitizeColorValue(arrowColor || '#222222', '#222222');
  const safeArrowStroke = sanitizeColorValue(arrowStroke, 'rgba(255, 255, 255, 0.8)');

  const bubbleStyle = [
    `--route-color:${safeBg}`,
    `--text-color:${safeText}`,
    `--label-size:${labelSize}px`,
    `--bearing:${bearingValue}`,
    `--arrow-color:${safeArrow}`,
    `--arrow-stroke:${safeArrowStroke}`,
    `--bubble-scale:${bubbleScale}`,
    `--bubble-border-width:${bubbleBorderWidth.toFixed(2)}px`,
    `--bubble-inner-inset:${bubbleInnerInset.toFixed(2)}px`,
    `--bubble-shadow:${bubbleShadow}`
  ].join(';');

  let attrs = `class="vehicle-bubble" style="${bubbleStyle};"`;
  if (!hasBearing) {
    attrs += ' data-no-bearing="true"';
  }

  const baseSize = 44;
  const iconSize = Math.round(baseSize * scale);
  const anchor = Math.round((baseSize / 2) * scale);
  const popupAnchor = Math.round(-anchor);

  const html = `
    <div ${attrs}>
      <svg class="vehicle-arrow" viewBox="0 0 24 16" role="presentation" focusable="false">
        <path d="M12 0L24 16H0Z"></path>
      </svg>
      <span class="vehicle-label">${safeLabel}</span>
    </div>
  `;

  return L.divIcon({
    className: 'vehicle-icon',
    html,
    iconSize: [iconSize, iconSize],
    iconAnchor: [anchor, anchor],
    popupAnchor: [0, popupAnchor]
  });
}
