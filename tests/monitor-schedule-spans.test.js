import { describe, expect, test } from 'vitest';
import AdmZip from 'adm-zip';
import scheduleModule from '../monitor/schedule.js';

const { getTripTimeSpans } = scheduleModule;

function createZipWithTables(files) {
  const zip = new AdmZip();
  Object.entries(files).forEach(([name, content]) => {
    zip.addFile(name, Buffer.from(content));
  });
  return zip;
}

describe('monitor schedule trip spans', () => {
  test('uses both arrival and departure times when building trip bounds', () => {
    const zip = createZipWithTables({
      'trips.txt': [
        'route_id,service_id,trip_id,block_id',
        '1,weekday,trip-1,block-1',
      ].join('\n'),
      'stop_times.txt': [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        'trip-1,10:00:00,10:05:00,100,1',
        'trip-1,10:30:00,10:35:00,101,2',
      ].join('\n'),
    });

    const spans = getTripTimeSpans(zip, new Set(['weekday']));

    expect(spans).toEqual([
      {
        tripId: 'trip-1',
        routeId: '1',
        blockId: 'block-1',
        startSecs: 10 * 3600,
        endSecs: 10 * 3600 + (35 * 60),
      },
    ]);
  });
});
