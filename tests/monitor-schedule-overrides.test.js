import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import AdmZip from 'adm-zip';
import scheduleModule from '../monitor/schedule.js';

const { getExpectedBuses, loadServiceOverrides } = scheduleModule;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bus-monitor-overrides-'));
}

function writeGtfsZip(cacheDir) {
  const zip = new AdmZip();
  zip.addFile('calendar.txt', Buffer.from([
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'weekday,1,1,1,1,1,0,0,20260101,20261231',
    'sunday,0,0,0,0,0,0,1,20260101,20261231',
  ].join('\n')));
  zip.addFile('trips.txt', Buffer.from([
    'route_id,service_id,trip_id,block_id',
    '1,weekday,trip-weekday,block-1',
    '1,sunday,trip-sunday,block-2',
  ].join('\n')));
  zip.addFile('stop_times.txt', Buffer.from([
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'trip-weekday,10:00:00,10:30:00,100,1',
    'trip-sunday,10:00:00,10:30:00,100,1',
  ].join('\n')));

  zip.writeZip(path.join(cacheDir, 'google_transit.zip'));
}

function writeOverrides(cacheDir, overrides) {
  fs.writeFileSync(
    path.join(cacheDir, 'service-overrides.json'),
    JSON.stringify(overrides, null, 2)
  );
}

describe('monitor schedule service overrides', () => {
  test('treats configured no-service holidays as zero expected buses', async () => {
    const cacheDir = makeTempDir();
    writeGtfsZip(cacheDir);
    writeOverrides(cacheDir, {
      '2026-04-03': { mode: 'no_service' },
    });

    const result = await getExpectedBuses(
      'https://example.invalid/gtfs.zip',
      cacheDir,
      24,
      0,
      {
        now: new Date('2026-04-03T10:15:00-04:00'),
        timeZone: 'America/Toronto',
      }
    );

    expect(result.totalExpected).toBe(0);
    expect(result.byRoute.size).toBe(0);
  });

  test('applies sunday-style holiday service on a non-sunday date', async () => {
    const cacheDir = makeTempDir();
    writeGtfsZip(cacheDir);
    writeOverrides(cacheDir, {
      '2026-12-26': { mode: 'sunday' },
    });

    const result = await getExpectedBuses(
      'https://example.invalid/gtfs.zip',
      cacheDir,
      24,
      0,
      {
        now: new Date('2026-12-26T10:15:00-05:00'),
        timeZone: 'America/Toronto',
      }
    );

    expect(result.totalExpected).toBe(1);
    expect(result.byRoute.get('1')).toBe(1);
  });

  test('prefers a cache override file over the repo-level default file', () => {
    const cacheDir = makeTempDir();
    writeOverrides(cacheDir, {
      '2026-12-26': { mode: 'no_service' },
    });

    const overrides = loadServiceOverrides(cacheDir);
    expect(overrides['20261226']).toEqual({ mode: 'no_service' });
  });

  test('falls back to normal GTFS service when the override file is malformed', async () => {
    const cacheDir = makeTempDir();
    writeGtfsZip(cacheDir);
    fs.writeFileSync(path.join(cacheDir, 'service-overrides.json'), '{bad json');

    const result = await getExpectedBuses(
      'https://example.invalid/gtfs.zip',
      cacheDir,
      24,
      0,
      {
        now: new Date('2026-04-02T10:15:00-04:00'),
        timeZone: 'America/Toronto',
      }
    );

    expect(result.totalExpected).toBe(1);
    expect(result.byRoute.get('1')).toBe(1);
  });
});
