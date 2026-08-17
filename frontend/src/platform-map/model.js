export const MAP_IMAGE_WIDTH = 11659;
export const MAP_IMAGE_HEIGHT = 9010;
export const MAP_IMAGE_RATIO = MAP_IMAGE_WIDTH / MAP_IMAGE_HEIGHT;

const REFERENCE_VIEWPORT = Object.freeze({ width: 1920, height: 1080 });
const REFERENCE_CALIBRATION = Object.freeze([
  Object.freeze({ lat: 44.373837, lon: -79.689279, x: 54.18848167539267, y: 55.32381997804611 }),
  Object.freeze({ lat: 44.374232, lon: -79.689392, x: 47.748691099476446, y: 37.43139407244786 }),
  Object.freeze({ lat: 44.374245, lon: -79.689674, x: 43.97905759162304, y: 38.090010976948406 }),
  Object.freeze({ lat: 44.374171, lon: -79.690445, x: 33.089005235602095, y: 43.02963776070253 }),
  Object.freeze({ lat: 44.373515, lon: -79.691137, x: 23.24607329842932, y: 82.87596048298573 }),
]);

export const ROUTE_COLORS = Object.freeze({
  '2A': '#006837',
  '2B': '#006837',
  '7A': '#F58220',
  '7B': '#F58220',
  '8A': '#050505',
  '8B': '#050505',
  '10': '#662D91',
  '11': '#8DC63F',
  '12A': '#F49AC1',
  '12B': '#F49AC1',
  '100': '#BE1E2D',
  '101': '#2E3192',
  '400': '#00AEEF',
  ONTC: '#00214D',
  'GO-BUS': '#007A33',
  'GO-TRAIN': '#007A33',
  'LINX-1': '#FF7733',
  'LINX-2': '#006747',
  'LINX-3': '#339966',
});

function referenceImageRect() {
  const viewportRatio = REFERENCE_VIEWPORT.width / REFERENCE_VIEWPORT.height;
  if (viewportRatio >= MAP_IMAGE_RATIO) {
    const height = REFERENCE_VIEWPORT.height;
    const width = height * MAP_IMAGE_RATIO;
    return {
      x: (REFERENCE_VIEWPORT.width - width) / 2,
      y: 0,
      width,
      height,
    };
  }
  const width = REFERENCE_VIEWPORT.width;
  const height = width / MAP_IMAGE_RATIO;
  return {
    x: 0,
    y: (REFERENCE_VIEWPORT.height - height) / 2,
    width,
    height,
  };
}

export function calibrationInImagePercent(points = REFERENCE_CALIBRATION) {
  const rect = referenceImageRect();
  return points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    x: ((point.x * REFERENCE_VIEWPORT.width / 100) - rect.x) / rect.width * 100,
    y: ((point.y * REFERENCE_VIEWPORT.height / 100) - rect.y) / rect.height * 100,
  }));
}

export function solveAffine(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const n = points.length;
  const means = points.reduce((result, point) => ({
    lon: result.lon + point.lon / n,
    lat: result.lat + point.lat / n,
    x: result.x + point.x / n,
    y: result.y + point.y / n,
  }), { lon: 0, lat: 0, x: 0, y: 0 });

  const sums = points.reduce((result, point) => {
    const u = point.lon - means.lon;
    const v = point.lat - means.lat;
    const dx = point.x - means.x;
    const dy = point.y - means.y;
    return {
      u2: result.u2 + u * u,
      v2: result.v2 + v * v,
      uv: result.uv + u * v,
      ux: result.ux + u * dx,
      vx: result.vx + v * dx,
      uy: result.uy + u * dy,
      vy: result.vy + v * dy,
    };
  }, { u2: 0, v2: 0, uv: 0, ux: 0, vx: 0, uy: 0, vy: 0 });

  const determinant = sums.u2 * sums.v2 - sums.uv * sums.uv;
  if (Math.abs(determinant) < 1e-20) return null;
  const a = (sums.v2 * sums.ux - sums.uv * sums.vx) / determinant;
  const b = (sums.u2 * sums.vx - sums.uv * sums.ux) / determinant;
  const d = (sums.v2 * sums.uy - sums.uv * sums.vy) / determinant;
  const e = (sums.u2 * sums.vy - sums.uv * sums.uy) / determinant;
  return {
    a,
    b,
    c: means.x - a * means.lon - b * means.lat,
    d,
    e,
    f: means.y - d * means.lon - e * means.lat,
  };
}

const IMAGE_AFFINE_MATRIX = solveAffine(calibrationInImagePercent());

export function projectVehicleToImage(lat, lon) {
  const numericLat = Number(lat);
  const numericLon = Number(lon);
  if (!IMAGE_AFFINE_MATRIX || !Number.isFinite(numericLat) || !Number.isFinite(numericLon)) return null;
  const x = IMAGE_AFFINE_MATRIX.a * numericLon +
    IMAGE_AFFINE_MATRIX.b * numericLat +
    IMAGE_AFFINE_MATRIX.c;
  const y = IMAGE_AFFINE_MATRIX.d * numericLon +
    IMAGE_AFFINE_MATRIX.e * numericLat +
    IMAGE_AFFINE_MATRIX.f;
  if (![x, y].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x, y };
}

export function normalizeBearing(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return ((numeric % 360) + 360) % 360;
}

export function getRouteEightDirection(vehicle) {
  const routeId = String(vehicle && vehicle.route_id || '').trim().toUpperCase();
  if (routeId !== '8' && routeId !== '8A' && routeId !== '8B') return '';
  const directionId = Number(vehicle && vehicle.direction_id);
  if (Number.isFinite(directionId)) return directionId === 0 ? 'NORTHBOUND' : 'SOUTHBOUND';
  const bearing = normalizeBearing(vehicle && vehicle.bearing);
  if (bearing === null) return '';
  if (bearing >= 315 || bearing <= 45) return 'NORTHBOUND';
  if (bearing >= 135 && bearing <= 225) return 'SOUTHBOUND';
  return '';
}

export function computeTextColor(background) {
  const normalized = String(background || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#FFFFFF';
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#111827' : '#FFFFFF';
}

export function getVehicleStyle(vehicle, routeStyles = {}) {
  const routeId = String(vehicle && vehicle.route_id || '');
  const routeStyle = routeStyles[routeId] || {};
  const color = String(
    vehicle && vehicle.route_color ||
    routeStyle.color ||
    ROUTE_COLORS[routeId] ||
    '#0055A4'
  );
  const textColor = String(
    vehicle && vehicle.route_text_color ||
    routeStyle.textColor ||
    computeTextColor(color)
  );
  return { color, textColor };
}

export function getVehicleLabel(vehicle) {
  if (!vehicle) return '?';
  if (vehicle.agency_id === 'ontario-northland') {
    return vehicle.source_route_id ? `ON ${vehicle.source_route_id}` : 'ON';
  }
  if (vehicle.agency_id === 'go-transit') {
    if (String(vehicle.route_mode || '').toLowerCase() === 'train') return 'GO TRAIN';
    const label = String(vehicle.route_label || '').replace(/^GO\s*/i, '').trim();
    return label ? `GO ${label}` : 'GO BUS';
  }
  if (vehicle.agency_id === 'simcoe-linx') {
    const label = String(vehicle.source_route_id || vehicle.route_label || '').replace(/^LINX\s*/i, '').trim();
    return label ? `LINX ${label}` : 'LINX';
  }
  return String(vehicle.route_label || vehicle.route_id || '?');
}

export function isTerminalDisplayVehicle(vehicle) {
  if (!vehicle || !projectVehicleToImage(vehicle.lat, vehicle.lon)) return false;
  const status = String(vehicle.terminal_progress_status || '').toLowerCase();
  return status !== 'not_serving' && status !== 'departed';
}

export function groupPlatformAssignments(assignments) {
  const groups = Object.create(null);
  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    const platform = String(assignment && assignment.platform || '');
    if (!platform) return;
    if (!groups[platform]) groups[platform] = [];
    groups[platform].push(assignment);
  });
  return groups;
}
