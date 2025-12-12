/* server/server.js */
const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config();
const { fetchVehicles } = require('./vehicles');

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

maybeSetupLiveReload(app);
const PORT = process.env.PORT || 3007;
const POLL_MS = Number(process.env.POLL_MS || 10000);
const MAPTILER_KEY = process.env.MAPTILER_KEY || '';
const RT_URL = process.env.GTFS_RT_VEHICLES_URL || '';
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'dist');
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
const hashedAssetPattern = /\.[0-9a-f]{10}\.(?:js|css)$/;
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const corsMiddleware = createCorsMiddleware(allowedOrigins);

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
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
}

const router = express.Router();
const apiRouter = express.Router();

router.use(express.static(FRONTEND_DIR, {
  extensions: ['html'],
  setHeaders(res, servedPath) {
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
    if (servedPath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (hashedAssetPattern.test(path.basename(servedPath))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (servedPath.endsWith('.json') || servedPath.endsWith('.geojson')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

apiRouter.get('/routes.geojson', (req, res) => {
  const fp = path.join(CACHE_DIR, 'routes.geojson');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'routes.geojson not built yet' });
  sendCachedJson(res, fp, 60 * 60 * 24 * 7);
});

apiRouter.get('/stops.geojson', (req, res) => {
  const fp = path.join(CACHE_DIR, 'stops.geojson');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'stops.geojson not built yet' });
  sendCachedJson(res, fp, 60 * 60 * 24 * 7);
});

apiRouter.get('/config', (req, res) => {
  res.json({
    poll_ms: POLL_MS,
    base_path: BASE_PATH,
    tiles: MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
      : `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`,
    rt_feed_configured: Boolean(RT_URL),
  });
});

apiRouter.get('/vehicles.json', async (req, res) => {
  try {
    const data = await fetchVehicles(RT_URL);
    // allow short caching to reduce load; front end also polls every 10s
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (e) {
    res.status(502).json({ generated_at: Date.now(), vehicles: [], error: e.message });
  }
});

// JSONP Endpoint (Bypasses Client XHR blocks)
apiRouter.get('/vehicles.js', async (req, res) => {
  try {
    const data = await fetchVehicles(RT_URL);
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
    // Return valid JS even on error to prevent console syntax errors
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
