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
    '12B,12B,Barrie South GO,3,E983B6,000000',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('trips.txt', Buffer.from([
    'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
    '1,weekday,trip-1,Downtown,0,shape-1',
    '1,weekday,trip-1-branch,Downtown,0,shape-1',
    '12B,weekday,trip-12b,BARRIE SOUTH GO,1,shape-1',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('shapes.txt', Buffer.from([
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'shape-1,44.3900,-79.6900,1',
    'shape-1,44.3950,-79.6950,2',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('stops.txt', Buffer.from([
    'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station,platform_code',
    '1001,1001,Terminal,44.3900,-79.6900,0,,',
    '1002,1002,Approach,44.3800,-79.6900,0,,',
    '1003,1003,Branch,44.3810,-79.6910,0,,',
    '1,1,Downtown Hub,44.3878,-79.6903,0,,',
    '2,2,Downtown Hub,44.3877,-79.6902,0,,',
    '14,14,Essa at Gowan,44.373522,-79.691152,0,,',
    'BATT,BATT,Barrie Allandale Transit Terminal,44.3740,-79.6902,1,,',
    '9006,9006,Barrie Allandale Transit Terminal Platform 6,44.3742,-79.6897,0,BATT,6',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('stop_times.txt', Buffer.from([
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'trip-1,12:00:00,12:00:00,1001,1',
    'trip-1,12:02:00,12:02:00,1,2',
    'trip-1,12:05:00,12:05:00,1002,3',
    'trip-1,12:15:00,12:20:00,9006,4',
    'trip-1-branch,12:00:00,12:00:00,1001,1',
    'trip-1-branch,12:02:00,12:02:00,2,2',
    'trip-1-branch,12:05:00,12:05:00,1003,3',
    'trip-12b,15:34:00,15:34:00,14,1',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('calendar.txt', Buffer.from([
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'weekday,1,1,1,1,1,0,0,20260701,20260831',
    ''
  ].join('\n'), 'utf8'));

  zip.addFile('calendar_dates.txt', Buffer.from([
    'service_id,date,exception_type',
    'weekday,20260803,2',
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
    const metadataPath = path.join(cacheDir, 'barrie-transit.json');
    expect(fs.existsSync(routesPath)).toBe(true);
    expect(fs.existsSync(stopsPath)).toBe(true);
    expect(fs.existsSync(metadataPath)).toBe(true);

    const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
    expect(routes.type).toBe('FeatureCollection');
    expect(routes.features.length).toBeGreaterThan(0);
    const firstRoute = routes.features[0];
    expect(firstRoute.properties.route_short_name).toBe('1');
    expect(firstRoute.properties.direction_id).toBe('0');
    expect(firstRoute.properties.trip_headsign).toBe('Downtown');
    expect(firstRoute.properties.trip_count).toBe(2);

    const stops = JSON.parse(fs.readFileSync(stopsPath, 'utf8'));
    expect(stops.features[0].properties.stop_name).toBe('Terminal');

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata.terminal_stop_ids).toEqual(['14', '9006']);
    expect(metadata.terminal_stops).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '14', name: 'Essa at Gowan', platform_code: '14' }),
    ]));
    expect(metadata.trips['trip-12b'].terminal_stops).toEqual([
      {
        stop_id: '14',
        stop_sequence: 1,
        arrival_time: '15:34:00',
        departure_time: '15:34:00',
        is_departure: false,
      },
    ]);
    expect(metadata.trips['trip-1'].terminal_stops).toEqual([
      {
        stop_id: '9006',
        stop_sequence: 4,
        arrival_time: '12:15:00',
        departure_time: '12:20:00',
        is_departure: false,
      },
    ]);
    expect(metadata.trips['trip-1'].service_id).toBe('weekday');
    expect(metadata.trips['trip-1'].direction_id).toBe('0');
    expect(metadata.trips['trip-1'].shape_id).toBe('shape-1');
    expect(metadata.departure_boards.downtown).toMatchObject({
      name: 'Downtown Hub',
      stop_ids: ['1', '2'],
    });
    expect(metadata.departure_boards.downtown.stops).toEqual([
      expect.objectContaining({ id: '1', platform_code: '1' }),
      expect.objectContaining({ id: '2', platform_code: '2' }),
    ]);
    expect(metadata.departure_boards.downtown.trips['trip-1'].terminal_stops).toEqual([
      expect.objectContaining({ stop_id: '1', departure_time: '12:02:00', is_departure: true }),
    ]);
    expect(metadata.departure_boards.downtown.trips['trip-1-branch'].terminal_stops).toEqual([
      expect.objectContaining({ stop_id: '2', departure_time: '12:02:00', is_departure: true }),
    ]);
    expect(metadata.terminal_approach_fallbacks['1|0|1002']).toEqual({
      route_id: '1',
      direction_id: '0',
      stop_id: '1002',
      terminal_stop_ids: ['9006'],
      candidate_trip_count: 1,
    });
    expect(metadata.terminal_approach_fallbacks['1|0|1001']).toBeUndefined();
    expect(metadata.service_calendars.weekday.monday).toBe(true);
    expect(metadata.service_exceptions['20260803'].weekday).toBe(2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
