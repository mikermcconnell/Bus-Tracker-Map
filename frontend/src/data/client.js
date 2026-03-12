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
  if (typeof fetch === 'function') {
    return fetch(url, options).then((response) => {
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response.json();
    });
  }

  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest !== 'function') {
      reject(new Error('No supported HTTP client available'));
      return;
    }

    const request = new XMLHttpRequest();
    request.open((options && options.method) || 'GET', url, true);
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
      reject(new Error(`Request failed: ${request.status}`));
    };
    request.onerror = function () {
      reject(new Error('Network request failed'));
    };
    request.send(null);
  });
}

export function createDataClient(options = {}) {
  let baseUrl = options.baseUrl || '';

  function resolveUrl(path) {
    if (baseUrl.endsWith('/') && path.startsWith('/')) {
      return baseUrl + path.slice(1);
    }
    if (!baseUrl.endsWith('/') && !path.startsWith('/')) {
      return baseUrl + '/' + path;
    }
    return baseUrl + path;
  }

  return {
    fetchConfig() {
      return fetchJson(resolveUrl('/api/config'));
    },

    fetchRoutes() {
      return fetchJson(resolveUrl('/api/routes.geojson'));
    },

    fetchStops() {
      return fetchJson(resolveUrl('/api/stops.geojson'));
    },

    fetchVehicles() {
      const cacheBust = Date.now().toString(36);
      return fetchJson(resolveUrl(`/api/vehicles.json?cb=${cacheBust}`), { cache: 'no-store' });
    },

    fetchMajorRoads() {
      return fetchJson(resolveUrl('/data/major-roads.geojson'));
    },

    setBasePath(path) {
      baseUrl = path;
    }
  };
}
