import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockNoticeService = {
  getManifest: vi.fn(),
  getPageImage: vi.fn(),
};

const serverModulePath = path.resolve(__dirname, '../server/server.js');

async function initApp(extraEnv = {}) {
  vi.resetModules();
  Object.assign(process.env, extraEnv);
  const mod = await import(serverModulePath);
  const app = mod.default || mod;
  app.locals.noticeService = mockNoticeService;
  return app;
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
    process.env.ONTARIO_NORTHLAND_ENABLED = 'false';
    process.env.SIMCOE_LINX_ENABLED = 'false';
    process.env.GO_TRANSIT_ENABLED = 'false';
    process.env.METROLINX_API_KEY = '';
    process.env.MAPBOX_ACCESS_TOKEN = '';
    process.env.MAPBOX_USERNAME = '';
    process.env.MAPBOX_STYLE_ID = '';
    process.env.LOG_LEVEL = 'info';
    mockNoticeService.getManifest.mockReset();
    mockNoticeService.getPageImage.mockReset();
    mockNoticeService.getManifest.mockResolvedValue({
      status: 'fresh',
      checked_at: '2026-07-14T17:00:00.000Z',
      refresh_after_ms: 600000,
      slides: [],
    });
    mockNoticeService.getPageImage.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

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
    delete process.env.ONTARIO_NORTHLAND_ENABLED;
    delete process.env.SIMCOE_LINX_ENABLED;
    delete process.env.GO_TRANSIT_ENABLED;
    delete process.env.METROLINX_API_KEY;
    delete process.env.MAPBOX_ACCESS_TOKEN;
    delete process.env.MAPBOX_USERNAME;
    delete process.env.MAPBOX_STYLE_ID;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.LOG_LEVEL;
    delete process.env.FEED_DELAYED_AFTER_MIN;
    delete process.env.FEED_STALE_AFTER_MIN;
    vi.resetModules();
  });

  test('serves cached routes and stops', async () => {
    const app = await initApp();
    const routesRes = await request(app).get('/api/routes.geojson');
    expect(routesRes.status).toBe(200);
    expect(routesRes.body.features).toHaveLength(1);
    expect(routesRes.headers['cache-control']).toContain('max-age=300');

    const stopsRes = await request(app).get('/api/stops.geojson');
    expect(stopsRes.status).toBe(200);
    expect(stopsRes.body.features[0].properties.stop_name).toBe('Terminal');
  });

  test('merges Ontario Northland route segments when the source is enabled', async () => {
    writeJson(path.join(cacheDir, 'ontario-northland-routes.geojson'), {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-79.70, 44.37], [-79.69, 44.38]] },
          properties: { route_id: 'ONTC', route_short_name: 'ON' }
        }
      ]
    });
    const app = await initApp({ ONTARIO_NORTHLAND_ENABLED: 'true' });
    const routesRes = await request(app).get('/api/routes.geojson');

    expect(routesRes.status).toBe(200);
    expect(routesRes.body.features.map((feature) => feature.properties.route_id)).toEqual(['1', 'ONTC']);
  });

  test('merges Simcoe LINX Barrie route segments when enabled', async () => {
    writeJson(path.join(cacheDir, 'simcoe-linx-routes.geojson'), {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[-79.70, 44.37], [-79.68, 44.41]] },
        properties: { route_id: 'LINX-2', route_short_name: 'LINX 2', agency_id: 'simcoe-linx' }
      }]
    });
    const app = await initApp({ SIMCOE_LINX_ENABLED: 'true' });
    const routesRes = await request(app).get('/api/routes.geojson');

    expect(routesRes.status).toBe(200);
    expect(routesRes.body.features.map((feature) => feature.properties.route_id))
      .toEqual(['1', 'LINX-2']);
  });

  test('merges the two GO Allandale layers when Metrolinx is configured', async () => {
    writeJson(path.join(cacheDir, 'go-transit-routes.geojson'), {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-79.70, 44.37], [-79.69, 44.38]] },
          properties: { route_id: 'GO-BUS', route_short_name: 'GO BUS', agency_id: 'go-transit' }
        },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-79.69, 44.37], [-79.68, 44.39]] },
          properties: { route_id: 'GO-TRAIN', route_short_name: 'GO TRAIN', agency_id: 'go-transit' }
        }
      ]
    });
    const app = await initApp({
      GO_TRANSIT_ENABLED: 'true',
      METROLINX_API_KEY: 'test-key',
    });
    const routesRes = await request(app).get('/api/routes.geojson');

    expect(routesRes.status).toBe(200);
    expect(routesRes.body.features.map((feature) => feature.properties.route_id))
      .toEqual(['1', 'GO-BUS', 'GO-TRAIN']);
  });

  test('returns config with defaults and base path', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      base_path: '/',
      rt_feed_configured: false,
      feed_delayed_after_ms: 120000,
      feed_offline_after_ms: 900000,
    });
    expect(res.body.poll_ms).toBeGreaterThan(0);
    expect(res.body.basemap).toMatchObject({
      provider: 'osm',
      tile_size: 256,
      zoom_offset: 0,
      opacity: 1,
    });
    expect(res.body.tiles).toBe(res.body.basemap.url);
  });

  test('returns a 512-pixel Mapbox TV basemap when all settings are configured', async () => {
    const app = await initApp({
      MAPBOX_ACCESS_TOKEN: 'pk.test-token',
      MAPBOX_USERNAME: 'barrie maps',
      MAPBOX_STYLE_ID: 'tv/style-v1',
    });
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.basemap).toMatchObject({
      provider: 'mapbox',
      tile_size: 512,
      zoom_offset: -1,
      max_zoom: 19,
      opacity: 1,
    });
    expect(res.body.basemap.url).toContain('/barrie%20maps/tv%2Fstyle-v1/tiles/512/{z}/{x}/{y}');
    expect(res.body.basemap.url).toContain('access_token=pk.test-token');
    expect(res.body.basemap.attribution).toContain('Mapbox');
    expect(res.body.tiles).toBe(res.body.basemap.url);
  });

  test('does not expose a partial Mapbox configuration', async () => {
    const app = await initApp({
      MAPBOX_ACCESS_TOKEN: 'pk.test-token',
      MAPBOX_USERNAME: 'barrie',
      MAPBOX_STYLE_ID: '',
    });
    const res = await request(app).get('/api/config');

    expect(res.body.basemap.provider).toBe('osm');
    expect(res.body.basemap.url).toContain('tile.openstreetmap.org');
    expect(res.body.basemap.url).not.toContain('pk.test-token');
  });

  test('validates the departure-board limit before accessing feeds', async () => {
    const app = await initApp();
    const invalidText = await request(app).get('/api/departures?limit=twelve');
    const invalidRange = await request(app).get('/api/departures?limit=31');
    expect(invalidText.status).toBe(400);
    expect(invalidRange.status).toBe(400);
    expect(invalidText.body.error).toBe('INVALID_LIMIT');
  });

  test('returns a controlled unavailable response when no schedule metadata exists', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/departures');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'DEPARTURES_UNAVAILABLE' });
  });

  test('serves current terminal platform assignments from generated GTFS metadata', async () => {
    writeJson(path.join(cacheDir, 'barrie-transit.json'), {
      generated_at: '2026-07-30T18:42:08.922Z',
      source_url: 'https://example.test/google_transit.zip',
      terminal_stop_ids: ['14', '9003', '9013'],
      terminal_stops: [
        { id: '14', name: 'Essa at Gowan', platform_code: '14' },
        { id: '9003', platform_code: '3' },
        { id: '9013', platform_code: '13' }
      ],
      trips: {
        route8: {
          route_id: '8A',
          headsign: 'RVH/YONGE to Park Place',
          terminal_stops: [{ stop_id: '9003', stop_sequence: 10 }]
        },
        route12: {
          route_id: '12A',
          headsign: 'GEORGIAN MALL',
          terminal_stops: [{ stop_id: '9013', stop_sequence: 20 }]
        },
        route12b: {
          route_id: '12B',
          headsign: 'BARRIE SOUTH GO',
          terminal_stops: [{ stop_id: '14', stop_sequence: 1 }]
        }
      }
    });
    const app = await initApp();
    const res = await request(app).get('/api/terminal-layout');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=300');
    expect(res.body.assignments).toEqual([
      expect.objectContaining({ platform: '3', route_id: '8A', destination: 'Yonge Southbound' }),
      expect.objectContaining({ platform: '13', route_id: '12A', destination: 'Georgian Mall' }),
      expect.objectContaining({ platform: '14', stop_id: '14', route_id: '12B', destination: 'Barrie South GO' })
    ]);
  });

  test('returns configured feed freshness thresholds to the browser', async () => {
    const app = await initApp({
      FEED_DELAYED_AFTER_MIN: '4',
      FEED_STALE_AFTER_MIN: '20',
    });
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      feed_delayed_after_ms: 240000,
      feed_offline_after_ms: 1200000,
    });
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
    expect(res.body).toMatchObject({
      vehicles: [],
      feed_status: 'offline',
      status_reason: 'feed_not_configured',
    });
  });

  test('returns holiday service status', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/service-status?date=2026-07-01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      date: '2026-07-01',
      is_special_service: true,
      message: 'Canada Day Service: Sunday Schedules',
    }));
  });

  test('returns the service notice manifest without browser caching', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/notices');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toEqual(expect.objectContaining({
      status: 'fresh',
      refresh_after_ms: 600000,
    }));
  });

  test('serves versioned notice pages as long-lived JPEGs', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/notices/pages/document-1/1.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(mockNoticeService.getPageImage).toHaveBeenCalledWith('document-1', '1');
  });

  test('rejects query-string cache busting on rendered notice pages', async () => {
    const app = await initApp();
    const res = await request(app).get('/api/notices/pages/document-1/1.jpg?random=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NOTICE_IMAGE_QUERY_NOT_ALLOWED');
    expect(mockNoticeService.getPageImage).not.toHaveBeenCalled();
  });

  test('returns a retryable notice error without exposing upstream details', async () => {
    mockNoticeService.getManifest.mockRejectedValue({
      statusCode: 503,
      code: 'NOTICES_UNAVAILABLE',
      message: 'private upstream detail',
    });
    const app = await initApp();
    const res = await request(app).get('/api/notices');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      error: 'NOTICES_UNAVAILABLE',
      retry_after_ms: 60000,
    });
  });
});
