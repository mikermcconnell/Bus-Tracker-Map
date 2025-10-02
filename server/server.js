/* server/server.js */
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { fetchVehicles } = require('./vehicles');

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
  lrServer.watch(frontendDir);

  app.use(connectLivereload({ port: liveReloadPort }));

  lrServer.server.once('connection', () => {
    setTimeout(() => lrServer.refresh('/'), 100);
  });

  console.log('Live reload watching ' + frontendDir);
}
const app = express();

maybeSetupLiveReload(app);
const PORT = process.env.PORT || 3000;
const POLL_MS = Number(process.env.POLL_MS || 10000);
const MAPTILER_KEY = process.env.MAPTILER_KEY || '';
const RT_URL = process.env.GTFS_RT_VEHICLES_URL || '';

app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'] }));

// small helper to send a cached file with ETag
function sendCachedJson(res, filePath, maxAgeSeconds) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}`);
  res.sendFile(filePath, (err) => {
    if (err) res.status(err.statusCode || 500).json({ error: err.message });
  });
}

app.get('/api/routes.geojson', (req, res) => {
  const fp = path.join(__dirname, '..', 'cache', 'routes.geojson');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'routes.geojson not built yet' });
  sendCachedJson(res, fp, 60 * 60 * 24 * 7);
});

app.get('/api/stops.geojson', (req, res) => {
  const fp = path.join(__dirname, '..', 'cache', 'stops.geojson');
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'stops.geojson not built yet' });
  sendCachedJson(res, fp, 60 * 60 * 24 * 7);
});

app.get('/api/config', (req, res) => {
  res.json({
    poll_ms: POLL_MS,
    tiles: MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
      : `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`,
    rt_feed_configured: Boolean(RT_URL),
  });
});

app.get('/api/vehicles.json', async (req, res) => {
  try {
    const data = await fetchVehicles(RT_URL);
    // allow short caching to reduce load; front end also polls every 10s
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(data);
  } catch (e) {
    res.status(502).json({ generated_at: Date.now(), vehicles: [], error: e.message });
  }
});

// fallback: serve index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

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

