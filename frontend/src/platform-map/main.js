import { createDataClient } from '../data/client.js';
import feedFreshness from '../../../shared/feed-freshness.js';

const { assessVehicleFeedFreshness, selectVehiclesForDisplay } = feedFreshness;
const DEFAULT_POLL_MS = 10000;
const CALIBRATION_DATA = [
  { lat: 44.373837, lon: -79.689279, x: 54.18848167539267, y: 55.32381997804611 },
  { lat: 44.374232, lon: -79.689392, x: 47.748691099476446, y: 37.43139407244786 },
  { lat: 44.374245, lon: -79.689674, x: 43.97905759162304, y: 38.090010976948406 },
  { lat: 44.374171, lon: -79.690445, x: 33.089005235602095, y: 43.02963776070253 },
  { lat: 44.373515, lon: -79.691137, x: 23.24607329842932, y: 82.87596048298573 }
];
const ROUTE_COLORS = {
  '2A': '#006837',
  '2B': '#006837',
  '7A': '#F58220',
  '7B': '#F58220',
  '8A': '#000000',
  '8B': '#000000',
  '10': '#662D91',
  '11': '#8DC63F',
  '12A': '#F49AC1',
  '12B': '#F49AC1',
  '100': '#BE1E2D',
  '101': '#2E3192',
  '400': '#00AEEF',
  'ONTC': '#00214D',
  'GO-BUS': '#003767',
  'GO-TRAIN': '#003767'
};

function solveAffine(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const n = points.length;
  let sumLon = 0;
  let sumLat = 0;
  let sumX = 0;
  let sumY = 0;
  points.forEach((point) => {
    sumLon += point.lon;
    sumLat += point.lat;
    sumX += point.x;
    sumY += point.y;
  });
  const meanLon = sumLon / n;
  const meanLat = sumLat / n;
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sumU2 = 0;
  let sumV2 = 0;
  let sumUV = 0;
  let sumUX = 0;
  let sumVX = 0;
  let sumUY = 0;
  let sumVY = 0;
  points.forEach((point) => {
    const u = point.lon - meanLon;
    const v = point.lat - meanLat;
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    sumU2 += u * u;
    sumV2 += v * v;
    sumUV += u * v;
    sumUX += u * dx;
    sumVX += v * dx;
    sumUY += u * dy;
    sumVY += v * dy;
  });
  const determinant = sumU2 * sumV2 - sumUV * sumUV;
  if (Math.abs(determinant) < 1e-20) return null;
  const a = (sumV2 * sumUX - sumUV * sumVX) / determinant;
  const b = (sumU2 * sumVX - sumUV * sumUX) / determinant;
  const d = (sumV2 * sumUY - sumUV * sumVY) / determinant;
  const e = (sumU2 * sumVY - sumUV * sumUY) / determinant;
  return {
    a,
    b,
    c: meanX - a * meanLon - b * meanLat,
    d,
    e,
    f: meanY - d * meanLon - e * meanLat
  };
}

const affineMatrix = solveAffine(CALIBRATION_DATA);

function getPixelPosition(lat, lon) {
  if (!affineMatrix) return null;
  const x = affineMatrix.a * lon + affineMatrix.b * lat + affineMatrix.c;
  const y = affineMatrix.d * lon + affineMatrix.e * lat + affineMatrix.f;
  if (![x, y].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100) {
    return null;
  }
  return { x, y };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderVehicles(vehicles) {
  const layer = document.getElementById('bus-layer');
  if (!layer) return;
  layer.innerHTML = '';

  (Array.isArray(vehicles) ? vehicles : []).forEach((vehicle) => {
    const lat = Number(vehicle && vehicle.lat);
    const lon = Number(vehicle && vehicle.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const position = getPixelPosition(lat, lon);
    if (!position) return;

    const routeId = String(vehicle.route_id || '');
    const displayLabel = vehicle.agency_id === 'ontario-northland' && vehicle.source_route_id
      ? `ON ${vehicle.source_route_id}`
      : String(vehicle.route_label || routeId || '?');
    const routeColor = vehicle.route_color || ROUTE_COLORS[routeId] || '#0055A4';
    const marker = document.createElement('div');
    marker.className = `bus-marker${vehicle.route_mode === 'train' ? ' bus-marker--train' : ''}`;
    marker.style.left = `${position.x}%`;
    marker.style.top = `${position.y}%`;
    marker.title = vehicle.agency_name
      ? `${vehicle.agency_name}${vehicle.source_route_id ? ` ${vehicle.source_route_id}` : ''}`
      : `Route ${displayLabel}`;
    const vehicleIcon = vehicle.route_mode === 'train'
      ? '<div class="train-icon" aria-label="GO train">TRAIN</div>'
      : '<img src="./assets/bus_icon.jpg" class="bus-icon-image" alt="Bus">';
    marker.innerHTML =
      `<div class="bus-icon-wrapper" style="border-color:${escapeHtml(routeColor)}">` +
      `${vehicleIcon}</div>` +
      `<div class="bus-label" style="background-color:${escapeHtml(routeColor)}">${escapeHtml(displayLabel)}</div>`;
    layer.appendChild(marker);
  });
}

function setStatus(message, state) {
  const status = document.getElementById('platform-status');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.state = state || 'ok';
  status.hidden = !message;
}

async function bootstrap() {
  const dataClient = createDataClient();
  let pollMs = DEFAULT_POLL_MS;
  let delayedAfterMs = 2 * 60 * 1000;
  let offlineAfterMs = 15 * 60 * 1000;

  try {
    const config = await dataClient.fetchConfig();
    if (config && config.base_path) dataClient.setBasePath(config.base_path);
    if (Number.isFinite(Number(config && config.poll_ms))) pollMs = Number(config.poll_ms);
    if (Number.isFinite(Number(config && config.feed_delayed_after_ms))) {
      delayedAfterMs = Number(config.feed_delayed_after_ms);
    }
    if (Number.isFinite(Number(config && config.feed_offline_after_ms))) {
      offlineAfterMs = Number(config.feed_offline_after_ms);
    }
  } catch (err) {
    console.warn('Using default platform-map configuration:', err);
  }

  const tick = async () => {
    try {
      const payload = await dataClient.fetchVehicles();
      const freshness = assessVehicleFeedFreshness(payload, {
        delayedAfterMs,
        offlineAfterMs
      });
      renderVehicles(selectVehiclesForDisplay(payload, freshness, {
        maxAgeMs: offlineAfterMs
      }));
      if (freshness.feed_status === 'offline') {
        setStatus('Live vehicles unavailable — retrying…', 'offline');
      } else if (freshness.feed_status === 'delayed') {
        setStatus('Live vehicle locations are delayed', 'warning');
      } else if (freshness.feed_status === 'empty') {
        setStatus('No buses are currently reporting', 'warning');
      } else {
        setStatus('', 'ok');
      }
    } catch (err) {
      renderVehicles([]);
      setStatus('Live vehicles unavailable — retrying…', 'offline');
      console.warn('Platform vehicle poll failed:', err);
    }
    setTimeout(tick, pollMs);
  };

  tick();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
