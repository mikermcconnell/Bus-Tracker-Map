/**
 * Data client responsible for talking to the backend API and static assets.
 * Paths are automatically rewritten to respect the deployed base path so the SPA
 * can operate correctly when served from a subdirectory.
 */

const DEFAULT_BASE_PATH = '/';

function normalizeBasePath(value) {
  if (!value) return DEFAULT_BASE_PATH;
  if (value === '/') return value;
  const trimmed = String(value).trim();
  if (!trimmed) return DEFAULT_BASE_PATH;
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '');
}

function resolveWithBase(basePath, targetPath) {
  const sanitizedTarget = targetPath.startsWith('/')
    ? targetPath.slice(1)
    : targetPath;
  const normalizedBase = basePath === DEFAULT_BASE_PATH
    ? `${window.location.origin}/`
    : `${window.location.origin}${basePath}/`;
  const url = new URL(sanitizedTarget, normalizedBase);
  return `${url.pathname}${url.search}`;
}

function fetchJson(url, options) {
  return fetch(url, options).then((response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  });
}

export function createDataClient(initialBasePath = DEFAULT_BASE_PATH) {
  let basePath = normalizeBasePath(initialBasePath);

  return {
    setBasePath(value) {
      basePath = normalizeBasePath(value);
    },

    fetchConfig() {
      const url = resolveWithBase(basePath, '/api/config');
      return fetchJson(url);
    },

    fetchRoutes() {
      const url = resolveWithBase(basePath, '/api/routes.geojson');
      return fetchJson(url);
    },

    fetchStops() {
      const url = resolveWithBase(basePath, '/api/stops.geojson');
      return fetchJson(url);
    },

    fetchVehicles() {
      const url = resolveWithBase(basePath, '/api/vehicles.json');
      return fetchJson(url);
    },

    fetchMajorRoads() {
      const url = resolveWithBase(basePath, '/data/major-roads.geojson');
      return fetchJson(url);
    },

    getBasePath() {
      return basePath;
    }
  };
}
