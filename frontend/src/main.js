import { createDataClient } from './data/client.js';
import { createMapController } from './map/controller.js';
import { createUiController } from './ui/controller.js';


document.addEventListener('DOMContentLoaded', function () {
  setupDebugPanel();

  var dataClient = createDataClient({
    // baseUrl: 'http://localhost:3000' // Removed to allow relative path (works on any port)
  });

  var ui = createUiController();
  ui.init();

  var mapController = createMapController({
    containerId: 'map',
    dataClient: dataClient,
    ui: ui
  });

  // Start everything
  mapController.initialize();
});

function setupDebugPanel() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  if (!hasDebugFlag()) {
    return null;
  }
  const panel = document.getElementById('debug-panel');
  if (!panel) {
    return null;
  }
  panel.hidden = false;

  const state = Object.create(null);
  const logs = [];

  const escapeHtml = (value) => {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const getBuildId = () => {
    const meta = document.querySelector('meta[name="app-build-id"]');
    return meta && meta.getAttribute('content') ? meta.getAttribute('content') : 'unknown';
  };

  const getOverlaySnapshot = () => {
    const elements = [
      { label: 'legend', element: document.getElementById('legend') },
      { label: 'mini-map', element: document.getElementById('mini-map') },
      { label: 'stop-legend', element: document.getElementById('stop-legend') },
      { label: 'weather', element: document.querySelector('.town-image-container') }
    ];
    const lines = [];
    elements.forEach(({ label, element: el }) => {
      if (!el) {
        lines.push(`${label}: missing`);
        return;
      }
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle ? window.getComputedStyle(el) : null;
      lines.push(
        `${label}: ${Math.round(rect.width)}x${Math.round(rect.height)} ` +
        `(${Math.round(rect.left)}, ${Math.round(rect.top)}) ` +
        `display = ${styles ? styles.display : 'n/a'} hidden = ${el.hidden} `
      );
    });
    return lines;
  };

  const updatePanel = () => {
    const width = Math.round(window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0);
    const height = Math.round(window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0);
    const docWidth = Math.round(document.documentElement ? document.documentElement.clientWidth : 0);
    const docHeight = Math.round(document.documentElement ? document.documentElement.clientHeight : 0);
    const dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio.toFixed(2) : '1';
    const mediaQuery = '(min-width: 500px) and (min-height: 360px)';
    const mediaMatch = typeof window.matchMedia === 'function'
      ? window.matchMedia(mediaQuery).matches
      : 'n/a';
    const buildId = getBuildId();
    const stateEntries = Object.keys(state)
      .sort()
      .map((key) => `${key}: ${state[key]} `);
    const overlayDetails = getOverlaySnapshot();
    const infoLines = [
      `build: ${buildId} `,
      `viewport: ${width}x${height} @${dpr} `,
      `doc: ${docWidth}x${docHeight} `,
      `media ${mediaQuery}: ${mediaMatch} `
    ]
      .concat(stateEntries.length ? stateEntries : ['legend/mini-map state pending'])
      .concat(overlayDetails);

    const logLines = logs.slice(-6);
    panel.innerHTML = ''
      + '<div class="debug-panel__section">'
      + escapeHtml(infoLines.join('\n'))
      + '</div>'
      + '<div class="debug-panel__section">'
      + '<div>Recent events:</div>'
      + '<div class="debug-panel__logs">'
      + escapeHtml(logLines.join('\n') || '—')
      + '</div>'
      + '</div>';
  };

  const setState = (key, value) => {
    state[key] = value;
    updatePanel();
  };

  const log = (message) => {
    const entry = `${new Date().toISOString()} ${message} `;
    logs.push(entry);
    if (logs.length > 12) {
      logs.splice(0, logs.length - 12);
    }
    updatePanel();
  };

  window.addEventListener('resize', updatePanel);
  window.addEventListener('orientationchange', updatePanel);
  window.addEventListener('error', (event) => {
    const msg = event && event.message ? event.message : (event && event.error ? event.error : event);
    log('Error: ' + msg);
  });

  window.__APP_DEBUG__ = { setState, log };
  updatePanel();
  return window.__APP_DEBUG__;
}

function hasDebugFlag() {
  if (typeof window === 'undefined') {
    return false;
  }
  if (typeof URLSearchParams === 'function') {
    return new URLSearchParams(window.location.search).has('debug');
  }
  return /(?:\?|&)debug(?:=|&|$)/.test(window.location.search || '');
}
