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
  const sanitizedTarget = targetPath.charAt(0) === '/'
    ? targetPath.slice(1)
    : targetPath;
  const normalizedBase = basePath === DEFAULT_BASE_PATH
    ? `${window.location.origin}/`
    : `${window.location.origin}${basePath}/`;
  const url = new URL(sanitizedTarget, normalizedBase);
  return `${url.pathname}${url.search}`;
}

function fetchJson(url, options) {
  const timeoutMs = Number(options && options.timeoutMs);
  const requestOptions = { ...(options || {}) };
  delete requestOptions.timeoutMs;
  if (typeof fetch === 'function') {
    return new Promise((resolve, reject) => {
      const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortController === 'function'
        ? new AbortController()
        : null;
      if (controller) requestOptions.signal = controller.signal;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback(value);
      };
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
          if (controller) controller.abort();
          finish(reject, new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs)
        : null;
      fetch(url, requestOptions)
        .then((response) => {
          if (!response.ok) throw new Error(`Request failed: ${response.status}`);
          return response.json();
        })
        .then((payload) => finish(resolve, payload), (error) => finish(reject, error));
    });
  }

  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest !== 'function') {
      reject(new Error('No supported HTTP client available'));
      return;
    }

    const request = new XMLHttpRequest();
    request.open(requestOptions.method || 'GET', url, true);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) request.timeout = timeoutMs;
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
    request.ontimeout = function () {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    };
    request.send(null);
  });
}

export function createDataClient(options = {}) {
  let baseUrl = options.baseUrl || '';

  function resolveUrl(path) {
    const baseHasTrailingSlash = baseUrl.charAt(baseUrl.length - 1) === '/';
    const pathHasLeadingSlash = path.charAt(0) === '/';
    if (baseHasTrailingSlash && pathHasLeadingSlash) {
      return baseUrl + path.slice(1);
    }
    if (!baseHasTrailingSlash && !pathHasLeadingSlash) {
      return baseUrl + '/' + path;
    }
    return baseUrl + path;
  }

  return {
    fetchConfig(options) {
      return fetchJson(resolveUrl('/api/config'), options);
    },

    fetchRoutes() {
      const cacheBust = Date.now().toString(36);
      return fetchJson(resolveUrl(`/api/routes.geojson?cb=${cacheBust}`), { cache: 'no-store' });
    },

    fetchStops() {
      return fetchJson(resolveUrl('/api/stops.geojson'));
    },

    fetchServiceStatus(date) {
      const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
      return fetchJson(resolveUrl(`/api/service-status${suffix}`), { cache: 'no-store' });
    },

    fetchTerminalLayout() {
      const cacheBust = Date.now().toString(36);
      return fetchJson(resolveUrl(`/api/terminal-layout?cb=${cacheBust}`), { cache: 'no-store' });
    },

    fetchDepartures(limit = 12, options = {}) {
      const cacheBust = Date.now().toString(36);
      const { board, ...fetchOptions } = options;
      const boardQuery = board ? `&board=${encodeURIComponent(board)}` : '';
      return fetchJson(resolveUrl(`/api/departures?limit=${encodeURIComponent(limit)}${boardQuery}&cb=${cacheBust}`), {
        ...fetchOptions,
        cache: 'no-store',
      });
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
