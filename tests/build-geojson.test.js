import { expect, test } from 'vitest';
import { createServer } from 'http';
import { once } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '..');

function createGtfsZipBuffer() {
  const zip = new AdmZip();

  zip.addFile('routes.txt', Buffer.from([
    'route_id,route_short_name,route_long_name,route_type,route_color,route_text_color',
    '1,1,Downtown Shuttle,3,0099FF,FFFFFF',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('trips.txt', Buffer.from([
    'route_id,service_id,trip_id,shape_id',
    '1,weekday,trip-1,shape-1',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('shapes.txt', Buffer.from([
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'shape-1,44.3900,-79.6900,1',
    'shape-1,44.3950,-79.6950,2',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('stops.txt', Buffer.from([
    'stop_id,stop_code,stop_name,stop_lat,stop_lon',
    '1001,1001,Terminal,44.3900,-79.6900',
    ''
  ].join('\n'), 'utf8'));

  return zip.toBuffer();
}

test('build-geojson emits routes and stops artefacts', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geojson-cache-'));
  const zipBuffer = createGtfsZipBuffer();

  const server = createServer((req, res) => {
    if (req.url === '/gtfs.zip') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const port = server.address().port;
    const env = {
      ...process.env,
      GTFS_STATIC_URL: `http://127.0.0.1:${port}/gtfs.zip`,
      CACHE_DIR: cacheDir,
    };

    await execFileAsync(process.execPath, ['scripts/build-geojson.js', '--force-refresh'], {
      cwd: projectRoot,
      env
    });

    const routesPath = path.join(cacheDir, 'routes.geojson');
    const stopsPath = path.join(cacheDir, 'stops.geojson');
    expect(fs.existsSync(routesPath)).toBe(true);
    expect(fs.existsSync(stopsPath)).toBe(true);

    const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
    expect(routes.type).toBe('FeatureCollection');
    expect(routes.features.length).toBeGreaterThan(0);
    const firstRoute = routes.features[0];
    expect(firstRoute.properties.route_short_name).toBe('1');

    const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));
    expect(stops.features[0].properties.stop_name).toBe('Terminal');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
