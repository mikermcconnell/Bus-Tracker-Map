import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const serverModulePath = path.resolve(__dirname, '../server/server.js');

async function initApp(extraEnv = {}) {
  vi.resetModules();
  Object.assign(process.env, extraEnv);
  const mod = await import(serverModulePath);
  return mod.default || mod;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

describe('API smoke tests', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-cache-'));
    process.env.CACHE_DIR = cacheDir;
    process.env.GTFS_RT_VEHICLES_URL = '';
    process.env.LOG_LEVEL = 'info';

    writeJson(path.join(cacheDir, 'routes.geojson'), {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-79.69, 44.39], [-79.70, 44.40]] },
          properties: { route_id: '1', route_short_name: '1', route_long_name: 'Test Route' }
        }
      ]
    });

    writeJson(path.join(cacheDir, 'stops.geojson'), {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-79.69, 44.39] },
          properties: { stop_id: '1001', stop_code: '1001', stop_name: 'Terminal' }
        }
      ]
    });
  });

  afterEach(() => {
    if (cacheDir && fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    delete process.env.CACHE_DIR;
    delete process.env.GTFS_RT_VEHICLES_URL;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.LOG_LEVEL;
    vi.resetModules();
  });

  test('serves cached routes and stops', async () => {
    const app = await initApp();
    const routesRes = await request(app).get('/api/routes.geojson');
    expect(routesRes.status).toBe(200);
    expect(routesRes.body.features).toHaveLength(1);

    const stopsRes = await request(app).get('/api/stops.geojson');
    expect(stopsRes.status).toBe(200);
    expect(stopsRes.body.features[0].properties.stop_name).toBe('Terminal');
  });

  test('returns config with defaults and base path', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      base_path: '/',
      rt_feed_configured: false
    });
    expect(res.body.poll_ms).toBeGreaterThan(0);
  });

  test('blocks cross-origin requests when not whitelisted', async () => {
    const app = await initApp();
    const res = await request(app)
      .get('/api/routes.geojson')
      .set('Origin', 'https://blocked.test');
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  test('allows configured origins', async () => {
    const allowedOrigin = 'https://allowed.test';
    const app = await initApp({ ALLOWED_ORIGINS: allowedOrigin });
    const res = await request(app)
      .get('/api/routes.geojson')
      .set('Origin', allowedOrigin);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  test('returns empty vehicles payload when feed is not configured', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/vehicles.json');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ vehicles: [] });
  });
});
