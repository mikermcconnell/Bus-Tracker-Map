/* server/server.js */
const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config();
const {
  fetchVehicles,
  fetchTerminalTripUpdates,
  selectTerminalTripUpdate,
} = require('./vehicles');
const {
  DEFAULT_VEHICLES_URL: DEFAULT_ONTARIO_NORTHLAND_VEHICLES_URL,
  DEFAULT_TRIP_UPDATES_URL: DEFAULT_ONTARIO_NORTHLAND_TRIP_UPDATES_URL,
  DEFAULT_ALERTS_URL: DEFAULT_ONTARIO_NORTHLAND_ALERTS_URL,
  fetchOntarioNorthlandRealtime,
} = require('./ontario-northland');
const {
  DEFAULT_API_BASE: DEFAULT_METROLINX_API_BASE,
  fetchGoTransitRealtime,
} = require('./go-transit');
const {
  DEFAULT_VEHICLES_URL: DEFAULT_SIMCOE_LINX_VEHICLES_URL,
  DEFAULT_TRIP_UPDATES_URL: DEFAULT_SIMCOE_LINX_TRIP_UPDATES_URL,
  DEFAULT_ALERTS_URL: DEFAULT_SIMCOE_LINX_ALERTS_URL,
  fetchSimcoeLinxRealtime,
} = require('./simcoe-linx');
const { assessVehicleFeedFreshness } = require('../shared/feed-freshness');
const { buildServiceStatus } = require('./service-status');
const { noticeService } = require('./notices');
const {
  enrichTerminalProgressWithFallback,
  loadTerminalMetadata,
} = require('./terminal-progress');
const { buildTerminalLayout } = require('./terminal-layout');
const { createDeparturesService } = require('./departures');
const {
  buildPlatformDeparturePayload,
  parsePlatformStopCode,
} = require('./platform-departures');
const { fetchTripUpdates: fetchGtfsTripUpdates } = require('./gtfs-trip-updates');
const {
  buildShelterDepartures,
  loadShelterDepartureMetadata,
  parseShelterGroupQuery,
  parseShelterStopQuery,
  resolveShelterLocation,
} = require('./shelter-departures');

function normalizeBasePath(input) {
  if (!input) return '/';
  const trimmed = input.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailing = withLeading.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

function parseAllowedOrigins(input) {
  if (!input) return new Set();
  return new Set(
    String(input)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function isSameOrigin(req, origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host;
  } catch (err) {
    return false;
  }
}

function createCorsMiddleware(allowedOrigins) {
  return function corsGuard(req, res, next) {
    const origin = req.headers.origin;
    if (!origin) {
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      return next();
    }
    if (isSameOrigin(req, origin)) {
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      return next();
    }

    if (!allowedOrigins.size) {
      res.status(403).json({ error: 'Cross origin requests are not permitted' });
      return;
    }

    if (!allowedOrigins.has(origin)) {
      console.warn('Blocked cross-origin request:', origin);
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  };
}

function maybeSetupLiveReload(app) {
  const flag = process.env.ENABLE_LIVERELOAD;
  if (!flag || flag === '0' || flag.toLowerCase() === 'false') return;

  let livereload;
  let connectLivereload;
  try {
    livereload = require('livereload');
    connectLivereload = require('connect-livereload');
  } catch (err) {
    console.warn('Live reload disabled (missing optional dependency):', err.message);
    return;
  }

  const liveReloadPort = Number(process.env.LIVERELOAD_PORT) || 35729;
  const delayMs = Number(process.env.LIVERELOAD_DELAY_MS) || 120;
  const lrServer = livereload.createServer({
    exts: ['html', 'css', 'js', 'svg', 'png'],
    delay: delayMs,
    port: liveReloadPort
  });

  const frontendDir = path.join(__dirname, '..', 'frontend');
  lrServer.watch(path.join(frontendDir, 'dist'));
  lrServer.watch(path.join(frontendDir, 'src'));

  app.use(connectLivereload({ port: liveReloadPort }));

  lrServer.server.once('connection', () => {
    setTimeout(() => lrServer.refresh('/'), 100);
  });

  console.log('Live reload watching ' + frontendDir);
}
const app = express();
app.locals.noticeService = noticeService;

maybeSetupLiveReload(app);
const PORT = process.env.PORT || 3007;
const POLL_MS = Number(process.env.POLL_MS || 10000);
const MAPBOX_ACCESS_TOKEN = String(process.env.MAPBOX_ACCESS_TOKEN || '').trim();
const MAPBOX_USERNAME = String(process.env.MAPBOX_USERNAME || '').trim();
const MAPBOX_STYLE_ID = String(process.env.MAPBOX_STYLE_ID || '').trim();
const PLATFORM_MAPBOX_STYLE_ID = String(
  process.env.PLATFORM_MAPBOX_STYLE_ID || MAPBOX_STYLE_ID
).trim();
const RT_URL = process.env.GTFS_RT_VEHICLES_URL || '';
const RT_TRIP_UPDATES_URL = process.env.GTFS_RT_TRIP_UPDATES_URL ||
  'https://www.myridebarrie.ca/gtfs/GTFS_TripUpdates.pb';
const ONTARIO_NORTHLAND_ENABLED = !/^(?:0|false|no|off)$/i.test(
  String(process.env.ONTARIO_NORTHLAND_ENABLED || 'true').trim()
);
const ONTARIO_NORTHLAND_RT_URL =
  process.env.ONTARIO_NORTHLAND_GTFS_RT_VEHICLES_URL || DEFAULT_ONTARIO_NORTHLAND_VEHICLES_URL;
const ONTARIO_NORTHLAND_TRIP_UPDATES_URL =
  process.env.ONTARIO_NORTHLAND_GTFS_RT_TRIP_UPDATES_URL || DEFAULT_ONTARIO_NORTHLAND_TRIP_UPDATES_URL;
const BARRIE_TRIP_UPDATES_URL = process.env.GTFS_RT_TRIP_UPDATES_URL ||
  'https://www.myridebarrie.ca/gtfs/GTFS_TripUpdates.pb';
const LINX_ENABLED = !/^(?:0|false|no|off)$/i.test(String(process.env.LINX_ENABLED || 'true').trim());
const LINX_TRIP_UPDATES_URL = process.env.LINX_GTFS_RT_TRIP_UPDATES_URL ||
  'https://metrolinx.tmix.se/gtfs-realtime-simcoe/tripupdates.pb';
const ONTARIO_NORTHLAND_ALERTS_URL =
  process.env.ONTARIO_NORTHLAND_GTFS_RT_ALERTS_URL || DEFAULT_ONTARIO_NORTHLAND_ALERTS_URL;
const SIMCOE_LINX_ENABLED = !/^(?:0|false|no|off)$/i.test(
  String(process.env.SIMCOE_LINX_ENABLED || 'true').trim()
);
const SIMCOE_LINX_RT_URL =
  process.env.SIMCOE_LINX_GTFS_RT_VEHICLES_URL || DEFAULT_SIMCOE_LINX_VEHICLES_URL;
const SIMCOE_LINX_TRIP_UPDATES_URL =
  process.env.SIMCOE_LINX_GTFS_RT_TRIP_UPDATES_URL || DEFAULT_SIMCOE_LINX_TRIP_UPDATES_URL;
const SIMCOE_LINX_ALERTS_URL =
  process.env.SIMCOE_LINX_GTFS_RT_ALERTS_URL || DEFAULT_SIMCOE_LINX_ALERTS_URL;
const METROLINX_API_KEY = String(process.env.METROLINX_API_KEY || '').trim();
const GO_TRANSIT_PROXY_URL = String(process.env.GO_TRANSIT_PROXY_URL || '').trim();
const GO_TRANSIT_ENABLED = Boolean(METROLINX_API_KEY || GO_TRANSIT_PROXY_URL) && !/^(?:0|false|no|off)$/i.test(
  String(process.env.GO_TRANSIT_ENABLED || 'true').trim()
);
const METROLINX_API_BASE =
  process.env.METROLINX_API_BASE || DEFAULT_METROLINX_API_BASE;
const FEED_DELAYED_AFTER_MS = Number(process.env.FEED_DELAYED_AFTER_MIN || 2) * 60 * 1000;
const FEED_OFFLINE_AFTER_MS = Number(process.env.FEED_STALE_AFTER_MIN || 15) * 60 * 1000;
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'dist');
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
const barrieTerminalMetadata = loadTerminalMetadata(CACHE_DIR, 'barrie-transit.json');
const northlandTerminalMetadata = loadTerminalMetadata(CACHE_DIR, 'ontario-northland.json');
const goTransitTerminalMetadata = loadTerminalMetadata(CACHE_DIR, 'go-transit.json');
const simcoeLinxTerminalMetadata = loadTerminalMetadata(CACHE_DIR, 'simcoe-linx.json');
const linxTerminalMetadata = loadTerminalMetadata(CACHE_DIR, 'linx.json');
const barrieShelterMetadata = loadShelterDepartureMetadata(CACHE_DIR);
const getDepartures = createDeparturesService({
  metadata: {
    barrie_transit: barrieTerminalMetadata,
    ontario_northland: northlandTerminalMetadata,
    go_transit: goTransitTerminalMetadata,
    simcoe_linx: linxTerminalMetadata,
  },
  urls: {
    barrie: BARRIE_TRIP_UPDATES_URL,
    ontarioNorthland: ONTARIO_NORTHLAND_ENABLED ? ONTARIO_NORTHLAND_TRIP_UPDATES_URL : '',
    linx: LINX_ENABLED ? LINX_TRIP_UPDATES_URL : '',
  },
  goApiBase: METROLINX_API_BASE,
  goApiKey: METROLINX_API_KEY,
  fetchVehiclePayload: () => getCombinedVehiclePayload(),
  delayedAfterMs: FEED_DELAYED_AFTER_MS,
  offlineAfterMs: FEED_OFFLINE_AFTER_MS,
});
const hashedAssetPattern = /\.[0-9a-f]{10}\.(?:js|css)$/;
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const corsMiddleware = createCorsMiddleware(allowedOrigins);

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '<a href="https://labs.mapbox.com/contribute/" target="_blank" rel="noopener">Improve this map</a>';

function buildBasemapConfig(styleId = MAPBOX_STYLE_ID) {
  const mapboxConfigured = Boolean(
    MAPBOX_ACCESS_TOKEN && MAPBOX_USERNAME && styleId
  );
  if (!mapboxConfigured) {
    return {
      provider: 'osm',
      url: OSM_TILE_URL,
      tile_size: 256,
      zoom_offset: 0,
      max_zoom: 19,
      opacity: 1,
      attribution: OSM_ATTRIBUTION,
      fallback_url: OSM_TILE_URL,
      fallback_attribution: OSM_ATTRIBUTION,
    };
  }

  const owner = encodeURIComponent(MAPBOX_USERNAME);
  const encodedStyleId = encodeURIComponent(styleId);
  const token = encodeURIComponent(MAPBOX_ACCESS_TOKEN);
  return {
    provider: 'mapbox',
    url: `https://api.mapbox.com/styles/v1/${owner}/${encodedStyleId}/tiles/512/{z}/{x}/{y}?access_token=${token}`,
    tile_size: 512,
    zoom_offset: -1,
    max_zoom: 19,
    opacity: 1,
    attribution: MAPBOX_ATTRIBUTION,
    fallback_url: OSM_TILE_URL,
    fallback_attribution: OSM_ATTRIBUTION,
  };
}

function buildPlatformBasemapConfig() {
  const mapboxConfigured = Boolean(
    MAPBOX_ACCESS_TOKEN && MAPBOX_USERNAME && PLATFORM_MAPBOX_STYLE_ID
  );
  if (!mapboxConfigured) return buildBasemapConfig('');

  return {
    provider: 'mapbox-gl',
    style_url: `mapbox://styles/${MAPBOX_USERNAME}/${PLATFORM_MAPBOX_STYLE_ID}`,
    access_token: MAPBOX_ACCESS_TOKEN,
    attribution: MAPBOX_ATTRIBUTION,
    fallback_url: OSM_TILE_URL,
    fallback_attribution: OSM_ATTRIBUTION,
  };
}

if (allowedOrigins.size) {
  console.log('API CORS allowed for origins:', Array.from(allowedOrigins).join(', '));
} else {
  console.log('API restricted to same-origin requests (ALLOWED_ORIGINS not set).');
}

function sendCachedJson(res, filePath, maxAgeSeconds) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}`);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Failed to send cached JSON:', filePath, err.message);
      if (res.headersSent || res.destroyed) return;
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
}

function readFeatureCollection(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
      return parsed;
    }
  } catch (err) {
    console.error('Failed to read GeoJSON:', filePath, err.message || err);
  }
  return null;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('Failed to read JSON:', filePath, err.message || err);
    return null;
  }
}

function isInsideMapBounds(vehicle, bounds) {
  if (!vehicle || !Array.isArray(bounds) || bounds.length !== 4) return false;
  const lat = Number(vehicle.lat);
  const lon = Number(vehicle.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lon >= Number(bounds[0]) && lon <= Number(bounds[2]) &&
    lat >= Number(bounds[1]) && lat <= Number(bounds[3]);
}

function sendMergedRoutes(res) {
  const barriePath = path.join(CACHE_DIR, 'routes.geojson');
  const northlandPath = path.join(CACHE_DIR, 'ontario-northland-routes.geojson');
  const goTransitPath = path.join(CACHE_DIR, 'go-transit-routes.geojson');
  const simcoeLinxPath = path.join(CACHE_DIR, 'simcoe-linx-routes.geojson');
  const barrie = readFeatureCollection(barriePath);
  if (!barrie) {
    res.status(404).json({ error: 'routes.geojson not built yet' });
    return;
  }
  const northland = ONTARIO_NORTHLAND_ENABLED
    ? readFeatureCollection(northlandPath)
    : null;
  const goTransit = GO_TRANSIT_ENABLED
    ? readFeatureCollection(goTransitPath)
    : null;
  const simcoeLinx = SIMCOE_LINX_ENABLED
    ? readFeatureCollection(simcoeLinxPath)
    : null;
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.json({
    type: 'FeatureCollection',
    features: barrie.features
      .concat(northland ? northland.features : [])
      .concat(goTransit ? goTransit.features : [])
      .concat(simcoeLinx ? simcoeLinx.features : []),
  });
}

function addBarrieAgencyMetadata(payload, tripUpdates = {}) {
  return {
    ...payload,
    vehicles: (payload && Array.isArray(payload.vehicles) ? payload.vehicles : []).map((vehicle) => {
      const trip = vehicle && vehicle.trip_id &&
        barrieTerminalMetadata.trips &&
        barrieTerminalMetadata.trips[vehicle.trip_id] || {};
      const terminalUpdate = selectTerminalTripUpdate(vehicle, tripUpdates);
      return enrichTerminalProgressWithFallback({
        ...vehicle,
        shape_id: trip.shape_id || null,
        trip_headsign: trip.headsign || null,
        agency_id: 'barrie-transit',
        agency_name: 'Barrie Transit',
        source_route_id: vehicle.route_id || null,
        terminal_stop_id: terminalUpdate && terminalUpdate.stop_id || null,
        terminal_stop_sequence: terminalUpdate && terminalUpdate.stop_sequence,
        terminal_arrival_time: terminalUpdate && terminalUpdate.arrival_time || null,
        terminal_arrival_source: terminalUpdate ? 'realtime' : null,
        terminal_departure_time: terminalUpdate && terminalUpdate.departure_time || null,
      }, {
        terminalStopIds: barrieTerminalMetadata.terminal_stop_ids,
        terminalStops: Array.isArray(trip.terminal_stops) && trip.terminal_stops.length
          ? trip.terminal_stops
          : (terminalUpdate ? [terminalUpdate] : []),
        terminalApproachFallbacks: barrieTerminalMetadata.terminal_approach_fallbacks,
      });
    }),
  };
}

async function fetchBarrieRealtime() {
  const [vehicleResult, tripUpdateResult] = await Promise.allSettled([
    fetchVehicles(RT_URL),
    fetchTerminalTripUpdates(
      RT_TRIP_UPDATES_URL,
      barrieTerminalMetadata.terminal_stop_ids
    ),
  ]);
  if (vehicleResult.status === 'rejected') throw vehicleResult.reason;
  if (tripUpdateResult.status === 'rejected') {
    console.warn('[barrie-transit] Trip updates unavailable:',
      tripUpdateResult.reason && tripUpdateResult.reason.message || tripUpdateResult.reason);
  }
  const tripUpdates = tripUpdateResult.status === 'fulfilled'
    ? tripUpdateResult.value.trip_updates
    : {};
  return addBarrieAgencyMetadata(vehicleResult.value, tripUpdates);
}

function maxTimestamp(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return valid.length ? Math.max(...valid) : null;
}

async function getCombinedVehiclePayload() {
  const barriePromise = RT_URL
    ? fetchBarrieRealtime()
    : Promise.resolve({
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
    });
  const northlandPromise = fetchOntarioNorthlandRealtime({
    enabled: ONTARIO_NORTHLAND_ENABLED,
    cacheDir: CACHE_DIR,
    vehiclesUrl: ONTARIO_NORTHLAND_RT_URL,
    tripUpdatesUrl: ONTARIO_NORTHLAND_TRIP_UPDATES_URL,
    alertsUrl: ONTARIO_NORTHLAND_ALERTS_URL,
    alertsEnabled: false,
  });
  const goTransitPromise = fetchGoTransitRealtime({
    enabled: GO_TRANSIT_ENABLED,
    apiKey: METROLINX_API_KEY,
    proxyUrl: GO_TRANSIT_PROXY_URL,
    apiBase: METROLINX_API_BASE,
    cacheDir: CACHE_DIR,
  });
  const simcoeLinxPromise = fetchSimcoeLinxRealtime({
    enabled: SIMCOE_LINX_ENABLED,
    cacheDir: CACHE_DIR,
    vehiclesUrl: SIMCOE_LINX_RT_URL,
    tripUpdatesUrl: SIMCOE_LINX_TRIP_UPDATES_URL,
    alertsUrl: SIMCOE_LINX_ALERTS_URL,
  });

  const [barrieResult, northlandResult, goTransitResult, simcoeLinxResult] = await Promise.allSettled([
    barriePromise,
    northlandPromise,
    goTransitPromise,
    simcoeLinxPromise,
  ]);

  const barriePayload = barrieResult.status === 'fulfilled'
    ? barrieResult.value
    : {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      fetch_error: true,
    };
  const northlandPayload = northlandResult.status === 'fulfilled'
    ? northlandResult.value
    : {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      alerts: [],
      fetch_error: true,
    };
  const goTransitPayload = goTransitResult.status === 'fulfilled'
    ? goTransitResult.value
    : {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      fetch_error: true,
    };
  const simcoeLinxPayload = simcoeLinxResult.status === 'fulfilled'
    ? simcoeLinxResult.value
    : {
      generated_at: Date.now(),
      feed_timestamp: null,
      vehicles: [],
      alerts: [],
      fetch_error: true,
    };

  if (barrieResult.status === 'rejected') {
    console.error('[barrie-transit] Vehicle feed unavailable:', barrieResult.reason && barrieResult.reason.message || barrieResult.reason);
  }
  if (northlandResult.status === 'rejected') {
    console.error('[ontario-northland] Vehicle feed unavailable:', northlandResult.reason && northlandResult.reason.message || northlandResult.reason);
  }
  if (goTransitResult.status === 'rejected') {
    console.error('[go-transit] Vehicle feed unavailable:', goTransitResult.reason && goTransitResult.reason.message || goTransitResult.reason);
  }
  if (simcoeLinxResult.status === 'rejected') {
    console.error('[simcoe-linx] Vehicle feed unavailable:', simcoeLinxResult.reason && simcoeLinxResult.reason.message || simcoeLinxResult.reason);
  }

  const barrieFreshness = assessVehicleFeedFreshness(barriePayload, {
    configured: Boolean(RT_URL),
    delayedAfterMs: FEED_DELAYED_AFTER_MS,
    offlineAfterMs: FEED_OFFLINE_AFTER_MS,
  });
  const northlandFreshness = assessVehicleFeedFreshness(northlandPayload, {
    configured: ONTARIO_NORTHLAND_ENABLED,
    delayedAfterMs: FEED_DELAYED_AFTER_MS,
    offlineAfterMs: FEED_OFFLINE_AFTER_MS,
  });
  const goTransitFreshness = assessVehicleFeedFreshness(goTransitPayload, {
    configured: GO_TRANSIT_ENABLED,
    delayedAfterMs: FEED_DELAYED_AFTER_MS,
    offlineAfterMs: FEED_OFFLINE_AFTER_MS,
    preferFeedTimestamp: true,
  });
  const simcoeLinxFreshness = assessVehicleFeedFreshness(simcoeLinxPayload, {
    configured: SIMCOE_LINX_ENABLED,
    delayedAfterMs: FEED_DELAYED_AFTER_MS,
    offlineAfterMs: FEED_OFFLINE_AFTER_MS,
  });

  const data = {
    generated_at: Date.now(),
    feed_timestamp: maxTimestamp([
      barriePayload.feed_timestamp,
      northlandPayload.feed_timestamp,
      goTransitPayload.feed_timestamp,
      simcoeLinxPayload.feed_timestamp,
    ]),
    vehicles: (barriePayload.vehicles || [])
      .concat(northlandPayload.vehicles || [])
      .concat(goTransitPayload.vehicles || [])
      .concat(simcoeLinxPayload.vehicles || []),
    alerts: (northlandPayload.alerts || []).concat(simcoeLinxPayload.alerts || []),
    sources: {
      barrie_transit: {
        agency_name: 'Barrie Transit',
        vehicle_count: (barriePayload.vehicles || []).length,
        ...barrieFreshness,
      },
      ontario_northland: {
        agency_name: 'Ontario Northland',
        vehicle_count: (northlandPayload.vehicles || []).length,
        ...northlandFreshness,
      },
      go_transit: {
        agency_name: 'GO Transit',
        vehicle_count: (goTransitPayload.vehicles || []).length,
        ...goTransitFreshness,
      },
      simcoe_linx: {
        agency_name: 'Simcoe County LINX',
        vehicle_count: (simcoeLinxPayload.vehicles || []).length,
        ...simcoeLinxFreshness,
      },
    },
  };
  const freshness = assessVehicleFeedFreshness(data, {
    configured: Boolean(RT_URL) || ONTARIO_NORTHLAND_ENABLED || GO_TRANSIT_ENABLED || SIMCOE_LINX_ENABLED,
    delayedAfterMs: FEED_DELAYED_AFTER_MS,
    offlineAfterMs: FEED_OFFLINE_AFTER_MS,
  });
  return { ...data, ...freshness };
}

async function getSimcoeRegionVehiclePayload() {
  const regionConfig = readJsonFile(path.join(CACHE_DIR, 'simcoe-region.json'));
  if (!regionConfig || !Array.isArray(regionConfig.bounds)) {
    const error = new Error('Simcoe regional data is not built');
    error.statusCode = 503;
    throw error;
  }
  const bounds = regionConfig.bounds;
  const barriePromise = RT_URL
    ? fetchBarrieRealtime()
    : Promise.resolve({ generated_at: Date.now(), feed_timestamp: null, vehicles: [] });
  const northlandPromise = fetchOntarioNorthlandRealtime({
    enabled: ONTARIO_NORTHLAND_ENABLED,
    cacheDir: CACHE_DIR,
    vehiclesUrl: ONTARIO_NORTHLAND_RT_URL,
    tripUpdatesUrl: ONTARIO_NORTHLAND_TRIP_UPDATES_URL,
    alertsUrl: ONTARIO_NORTHLAND_ALERTS_URL,
    alertsEnabled: false,
  });
  const goPromise = fetchGoTransitRealtime({
    enabled: GO_TRANSIT_ENABLED,
    apiKey: METROLINX_API_KEY,
    proxyUrl: GO_TRANSIT_PROXY_URL,
    apiBase: METROLINX_API_BASE,
    cacheDir: CACHE_DIR,
    metadataFile: 'simcoe-region-go.json',
    routesFile: 'simcoe-region-routes.geojson',
    cacheKey: 'simcoe-region',
  });
  const linxPromise = fetchSimcoeLinxRealtime({
    enabled: SIMCOE_LINX_ENABLED,
    cacheDir: CACHE_DIR,
    vehiclesUrl: SIMCOE_LINX_RT_URL,
    tripUpdatesUrl: SIMCOE_LINX_TRIP_UPDATES_URL,
    alertsUrl: SIMCOE_LINX_ALERTS_URL,
    metadataFile: 'simcoe-region-linx.json',
    cacheKey: 'simcoe-region',
  });
  const results = await Promise.allSettled([barriePromise, northlandPromise, goPromise, linxPromise]);
  const sourceKeys = ['barrie_transit', 'ontario_northland', 'go_transit', 'simcoe_linx'];
  const sourceNames = ['Barrie Transit', 'Ontario Northland', 'GO Transit', 'Simcoe County LINX'];
  const configured = [Boolean(RT_URL), ONTARIO_NORTHLAND_ENABLED, GO_TRANSIT_ENABLED, SIMCOE_LINX_ENABLED];
  const payloads = results.map((result) => result.status === 'fulfilled'
    ? result.value
    : { generated_at: Date.now(), feed_timestamp: null, vehicles: [], alerts: [], fetch_error: true });
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[simcoe-region:${sourceKeys[index]}] Feed unavailable:`, result.reason && result.reason.message || result.reason);
    }
  });
  payloads[0] = {
    ...payloads[0],
    vehicles: (payloads[0].vehicles || []).filter((vehicle) => isInsideMapBounds(vehicle, bounds)),
  };
  payloads[1] = {
    ...payloads[1],
    vehicles: (payloads[1].vehicles || []).filter((vehicle) => isInsideMapBounds(vehicle, bounds)),
  };
  const sources = {};
  payloads.forEach((payload, index) => {
    const freshness = assessVehicleFeedFreshness(payload, {
      configured: configured[index],
      delayedAfterMs: FEED_DELAYED_AFTER_MS,
      offlineAfterMs: FEED_OFFLINE_AFTER_MS,
      preferFeedTimestamp: sourceKeys[index] === 'go_transit',
    });
    sources[sourceKeys[index]] = {
      agency_name: sourceNames[index],
      vehicle_count: (payload.vehicles || []).length,
      ...freshness,
    };
  });
  const data = {
    generated_at: Date.now(),
    feed_timestamp: maxTimestamp(payloads.map((payload) => payload.feed_timestamp)),
    vehicles: payloads.flatMap((payload) => payload.vehicles || []),
    alerts: payloads.flatMap((payload) => payload.alerts || []),
    sources,
  };
  return {
    ...data,
    ...assessVehicleFeedFreshness(data, {
      configured: configured.some(Boolean),
      delayedAfterMs: FEED_DELAYED_AFTER_MS,
      offlineAfterMs: FEED_OFFLINE_AFTER_MS,
    }),
  };
}

const router = express.Router();
const apiRouter = express.Router();

router.use(express.static(FRONTEND_DIR, {
  extensions: ['html'],
  setHeaders(res, servedPath) {
    if (path.basename(servedPath) === 'notices.html') {
      res.setHeader('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self';");
    } else {
      res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
    }
    if (servedPath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (hashedAssetPattern.test(path.basename(servedPath))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (servedPath.endsWith('.json') || servedPath.endsWith('.geojson')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

// The shared departures HTML uses relative asset URLs. Preserve those URLs
// when the same page is mounted one level deeper at /departures/downtown.
router.use('/departures/assets', express.static(path.join(FRONTEND_DIR, 'assets')));

apiRouter.get('/routes.geojson', (req, res) => {
  sendMergedRoutes(res);
});

apiRouter.get('/stops.geojson', (req, res) => {
  const fp = path.join(CACHE_DIR, 'stops.geojson');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'stops.geojson not built yet' });
  sendCachedJson(res, fp, 60 * 60 * 24 * 7);
});

apiRouter.get('/config', (req, res) => {
  const basemap = buildBasemapConfig();
  const platformBasemap = buildPlatformBasemapConfig();
  res.json({
    poll_ms: POLL_MS,
    feed_delayed_after_ms: Number.isFinite(FEED_DELAYED_AFTER_MS) && FEED_DELAYED_AFTER_MS > 0
      ? FEED_DELAYED_AFTER_MS
      : 2 * 60 * 1000,
    feed_offline_after_ms: Number.isFinite(FEED_OFFLINE_AFTER_MS) && FEED_OFFLINE_AFTER_MS > 0
      ? FEED_OFFLINE_AFTER_MS
      : 15 * 60 * 1000,
    base_path: BASE_PATH,
    basemap,
    platform_basemap: platformBasemap,
    // Keep the original field during the client migration.
    tiles: basemap.url,
    rt_feed_configured: Boolean(RT_URL) || ONTARIO_NORTHLAND_ENABLED || GO_TRANSIT_ENABLED || SIMCOE_LINX_ENABLED,
    transit_sources: {
      barrie_transit: Boolean(RT_URL),
      ontario_northland: ONTARIO_NORTHLAND_ENABLED,
      go_transit: GO_TRANSIT_ENABLED,
      simcoe_linx: SIMCOE_LINX_ENABLED,
    },
  });
});

apiRouter.get('/simcoe/config', (req, res) => {
  const regional = readJsonFile(path.join(CACHE_DIR, 'simcoe-region.json'));
  if (!regional) return res.status(503).json({ error: 'SIMCOE_REGION_NOT_BUILT' });
  const basemap = buildBasemapConfig();
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.json({
    ...regional,
    poll_ms: POLL_MS,
    feed_delayed_after_ms: FEED_DELAYED_AFTER_MS,
    feed_offline_after_ms: FEED_OFFLINE_AFTER_MS,
    base_path: BASE_PATH,
    basemap,
    transit_sources: {
      barrie_transit: Boolean(RT_URL),
      ontario_northland: ONTARIO_NORTHLAND_ENABLED,
      go_transit: GO_TRANSIT_ENABLED,
      simcoe_linx: SIMCOE_LINX_ENABLED,
    },
  });
});

apiRouter.get('/simcoe/routes.geojson', (req, res) => {
  const fp = path.join(CACHE_DIR, 'simcoe-region-routes.geojson');
  if (!fs.existsSync(fp)) return res.status(503).json({ error: 'SIMCOE_REGION_NOT_BUILT' });
  sendCachedJson(res, fp, 300);
});

apiRouter.get('/simcoe/stops.geojson', (req, res) => {
  const fp = path.join(CACHE_DIR, 'simcoe-region-stops.geojson');
  if (!fs.existsSync(fp)) return res.status(503).json({ error: 'SIMCOE_REGION_NOT_BUILT' });
  sendCachedJson(res, fp, 60 * 60 * 24);
});

apiRouter.get('/simcoe/vehicles.json', async (req, res) => {
  try {
    const data = await getSimcoeRegionVehiclePayload();
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (error) {
    res.status(Number(error.statusCode) || 502).json({
      generated_at: Date.now(),
      vehicles: [],
      feed_status: 'offline',
      status_reason: 'fetch_failed',
      error: error.message,
    });
  }
});

apiRouter.get('/terminal-layout', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.json(buildTerminalLayout({
    barrie: barrieTerminalMetadata,
    ontarioNorthland: northlandTerminalMetadata,
    goTransit: goTransitTerminalMetadata,
    simcoeLinx: simcoeLinxTerminalMetadata,
  }));
});

apiRouter.get('/departures', async (req, res) => {
  if (String(req.query && req.query.view || '').toLowerCase() === 'platform') {
    const stopCode = req.query && req.query.stop;
    if (!parsePlatformStopCode(stopCode)) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(400).json({
        error: 'INVALID_STOP_CODE',
        message: 'Use a terminal stop code from 9001 to 9014.',
      });
    }
    try {
      const terminalPayload = await getDepartures({ limit: 30, board: 'allandale' });
      const data = buildPlatformDeparturePayload({ stopCode, terminalPayload });
      res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=5');
      return res.json(data);
    } catch (err) {
      console.error('[platform-departures] Unable to build platform sign:', err.message || err);
      return res.status(Number(err.statusCode) || 502).json({ error: 'DEPARTURES_UNAVAILABLE' });
    }
  }

  const rawLimit = req.query && req.query.limit;
  if (rawLimit !== undefined && !/^\d+$/.test(String(rawLimit))) {
    return res.status(400).json({ error: 'INVALID_LIMIT' });
  }
  const limit = rawLimit === undefined ? 12 : Number(rawLimit);
  if (limit < 1 || limit > 30) return res.status(400).json({ error: 'INVALID_LIMIT' });
  const board = String(req.query && req.query.board || 'allandale').toLowerCase();
  if (!['allandale', 'downtown'].includes(board)) return res.status(400).json({ error: 'INVALID_BOARD' });
  try {
    const data = await getDepartures({ limit, board });
    res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=5');
    res.json(data);
  } catch (err) {
    console.error('[departures] Unable to build departure board:', err.message || err);
    res.status(Number(err.statusCode) || 502).json({ error: 'DEPARTURES_UNAVAILABLE' });
  }
});

apiRouter.get('/shelter-departures', async (req, res) => {
  const stopCode = req.query && req.query.stop;
  const groupId = req.query && req.query.group;
  if (!parseShelterStopQuery(stopCode) && !parseShelterGroupQuery(groupId)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({
      error: 'STOP_REQUIRED',
      message: 'Add a Barrie Transit stop using ?stop= or a named location using ?group=.',
    });
  }

  const location = resolveShelterLocation(barrieShelterMetadata, {
    stopQuery: stopCode,
    groupQuery: groupId,
  });
  if (!location) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({
      error: groupId ? 'GROUP_NOT_FOUND' : 'STOP_NOT_FOUND',
      message: groupId
        ? `Barrie Transit departure group ${String(groupId)} was not found.`
        : `Barrie Transit stop ${String(stopCode)} was not found.`,
    });
  }

  let tripUpdates = {};
  let feedTimestamp = null;
  let realtimeStatus = 'scheduled';
  if (RT_TRIP_UPDATES_URL) {
    try {
      const realtime = await fetchGtfsTripUpdates(RT_TRIP_UPDATES_URL, location.ids);
      feedTimestamp = realtime.feed_timestamp || null;
      realtimeStatus = 'live';
      for (const update of realtime.updates || []) {
        if (!tripUpdates[update.trip_id]) {
          tripUpdates[update.trip_id] = {
            start_date: update.start_date,
            schedule_relationship: update.canceled ? 3 : null,
            stop_time_updates: [],
          };
        }
        tripUpdates[update.trip_id].stop_time_updates.push({
          stop_id: update.stop_id,
          stop_sequence: update.stop_sequence,
          departure_time: update.departure_time,
          departure_delay: update.delay_seconds,
          schedule_relationship: update.skipped ? 1 : null,
        });
      }
    } catch (err) {
      console.error('[shelter-departures] Realtime data unavailable:', err && err.message || err);
      realtimeStatus = 'unavailable';
    }
  }

  const payload = buildShelterDepartures({
    metadata: barrieShelterMetadata,
    stopQuery: stopCode,
    groupQuery: groupId,
    tripUpdates,
    feedTimestamp,
    realtimeStatus,
  });
  res.setHeader('Cache-Control', 'no-store');
  return res.json(payload);
});

apiRouter.get('/service-status', (req, res) => {
  const status = buildServiceStatus({
    cacheDir: CACHE_DIR,
    date: req.query && req.query.date,
  });
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(status);
});

apiRouter.get('/notices', async (req, res) => {
  try {
    const manifest = await req.app.locals.noticeService.getManifest();
    res.setHeader('Cache-Control', 'no-cache');
    res.json(manifest);
  } catch (err) {
    const statusCode = Number(err && err.statusCode) || 500;
    res.status(statusCode).json({
      status: 'unavailable',
      error: err && err.code ? err.code : 'NOTICE_ERROR',
      retry_after_ms: 60000,
    });
  }
});

apiRouter.get('/notices/pages/:documentId/:page.jpg', async (req, res) => {
  try {
    if (req.query && Object.keys(req.query).length) {
      return res.status(400).json({ error: 'NOTICE_IMAGE_QUERY_NOT_ALLOWED' });
    }
    const image = await req.app.locals.noticeService.getPageImage(req.params.documentId, req.params.page);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable');
    res.send(image);
  } catch (err) {
    const statusCode = Number(err && err.statusCode) || 500;
    res.status(statusCode).json({
      error: err && err.code ? err.code : 'NOTICE_IMAGE_ERROR',
    });
  }
});

apiRouter.get('/vehicles.json', async (req, res) => {
  try {
    const data = await getCombinedVehiclePayload();
    // allow short caching to reduce load; front end also polls every 10s
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (e) {
    res.status(502).json({
      generated_at: Date.now(),
      vehicles: [],
      feed_status: 'offline',
      status_reason: 'fetch_failed',
      latest_data_timestamp: null,
      data_age_seconds: null,
      error: e.message,
    });
  }
});

// JSONP Endpoint (Bypasses Client XHR blocks)
apiRouter.get('/vehicles.js', async (req, res) => {
  try {
    const data = await getCombinedVehiclePayload();
    const json = JSON.stringify(data.vehicles || []);
    const js = `
      if (typeof window.updateMapFromJSONP === 'function') {
        window.updateMapFromJSONP(${json});
      }
    `;
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(js);
  } catch (e) {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`console.error("Server Error: ${e.message}");`);
  }
});

router.options('/api/*', corsMiddleware);
router.use('/api', corsMiddleware, apiRouter);

router.get('/batt.map', (req, res, next) => {
  const battPath = path.join(FRONTEND_DIR, 'batt.map.html');
  if (!fs.existsSync(battPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  res.sendFile(battPath);
});

router.get('/platform.map', (req, res, next) => {
  const platformPath = path.join(FRONTEND_DIR, 'platform.map.html');
  if (!fs.existsSync(platformPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  res.sendFile(platformPath);
});

router.get('/notices', (req, res, next) => {
  const noticesPath = path.join(FRONTEND_DIR, 'notices.html');
  if (!fs.existsSync(noticesPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self';");
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(noticesPath);
});

router.get('/departures/platform.aspx', (req, res, next) => {
  const departuresPath = path.join(FRONTEND_DIR, 'platform-departures.html');
  if (!fs.existsSync(departuresPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self';");
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(departuresPath);
});

router.get('/departures', (req, res, next) => {
  const departuresPath = path.join(FRONTEND_DIR, 'departures.html');
  if (!fs.existsSync(departuresPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self';");
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(departuresPath);
});

router.get('/shelter-departures', (req, res, next) => {
  const departuresPath = path.join(FRONTEND_DIR, 'shelter-departures.html');
  if (!fs.existsSync(departuresPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self';");
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(departuresPath);
});

router.get('/departures/downtown', (req, res, next) => {
  const departuresPath = path.join(FRONTEND_DIR, 'departures.html');
  if (!fs.existsSync(departuresPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src 'self' data:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self';");
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(departuresPath);
});

router.get('/simcoe', (req, res, next) => {
  const simcoePath = path.join(FRONTEND_DIR, 'simcoe.html');
  if (!fs.existsSync(simcoePath)) return next();
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  res.sendFile(simcoePath);
});

router.get('*', (req, res, next) => {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  res.sendFile(indexPath);
});

app.use(BASE_PATH, router);

if (require.main === module) {
  const server = app.listen(PORT);

  server.on('listening', () => {
    const addressInfo = server.address();
    const displayPort = typeof addressInfo === 'string' ? addressInfo : addressInfo && addressInfo.port;
    console.log(`Server running on http://localhost:${displayPort || PORT}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to a different value.`);
    } else {
      console.error('Failed to start server:', err);
    }
    process.exit(1);
  });
} else {
  module.exports = app;
}
