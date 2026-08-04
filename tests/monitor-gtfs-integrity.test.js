import AdmZip from 'adm-zip';
import { describe, expect, test } from 'vitest';
import integrityModule from '../monitor/gtfs-integrity.js';

const {
  inspectStaticGtfsBuffer,
  collectTripUpdateReferences,
  collectVehicleReferences,
  inspectRealtimeLinkage,
} = integrityModule;

function buildStaticZip(options = {}) {
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from('agency_id,agency_name,agency_url,agency_timezone\nBT,Barrie Transit,https://example.test,America/Toronto\n'));
  zip.addFile('routes.txt', Buffer.from('route_id,agency_id,route_short_name,route_type\n8A,BT,8A,3\n'));
  zip.addFile('calendar.txt', Buffer.from('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,1,1,20260101,20261231\n'));
  zip.addFile('feed_info.txt', Buffer.from('feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nBarrie Transit,https://example.test,en,20260101,20261231,v1\n'));
  zip.addFile('trips.txt', Buffer.from('route_id,service_id,trip_id\n8A,weekday,trip-1\n'));

  const platformRows = [
    ['9003', '3'],
    ['9004', '4'],
    ['9005', '5'],
    ['9006', '6'],
    ['9012', '12'],
    ['9013', '13'],
  ];
  const stops = [
    'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,platform_code',
    ...(options.omitAllandale
      ? ['100,Regular Stop,44.3,-79.6,0,,']
      : [
        'Barrie Allandale Transit Terminal,Barrie Allandale Transit Terminal,44.374029,-79.690216,1,,',
        ...platformRows.map(([id, code]) => `${id},Platform ${code},44.3,-79.6,0,Barrie Allandale Transit Terminal,${code}`),
      ]),
  ];
  zip.addFile('stops.txt', Buffer.from(`${stops.join('\n')}\n`));
  const stopId = options.omitAllandale ? '100' : '9003';
  zip.addFile('stop_times.txt', Buffer.from(`trip_id,arrival_time,departure_time,stop_id,stop_sequence\ntrip-1,10:00:00,10:00:00,${stopId},1\n`));

  if (!options.omitAllandale) {
    zip.addFile('transfers.txt', Buffer.from([
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time',
      '9003,9004,1,',
      '9004,9003,1,',
      '9005,9012,1,',
      '9012,9005,1,',
      '',
    ].join('\n')));
  }
  return zip.toBuffer();
}

describe('GTFS integrity monitor', () => {
  test('accepts a current feed with the required Allandale manual patch', () => {
    const result = inspectStaticGtfsBuffer(buildStaticZip(), {
      now: new Date('2026-08-04T12:00:00-04:00'),
    });

    expect(result.issues).toEqual([]);
    expect(result.feedVersion).toBe('v1');
    expect(result.counts).toEqual(expect.objectContaining({
      routes: 1,
      trips: 1,
      stops: 7,
      transfers: 4,
    }));
  });

  test('flags missing Allandale hierarchy and timed transfers', () => {
    const result = inspectStaticGtfsBuffer(buildStaticZip({ omitAllandale: true }), {
      now: new Date('2026-08-04T12:00:00-04:00'),
    });
    const codes = result.issues.map((value) => value.code);

    expect(codes).toContain('GTFS_ALLANDALE_PARENT_INVALID');
    expect(codes).toContain('GTFS_ALLANDALE_PLATFORM_HIERARCHY_INVALID');
    expect(codes).toContain('GTFS_ALLANDALE_TIMED_TRANSFERS_MISSING');
  });

  test('reports unknown scheduled realtime IDs without treating matching IDs as errors', () => {
    const staticResult = inspectStaticGtfsBuffer(buildStaticZip(), {
      now: new Date('2026-08-04T12:00:00-04:00'),
    });
    const tripUpdates = collectTripUpdateReferences({
      entity: [
        {
          tripUpdate: {
            trip: { tripId: 'trip-1', routeId: '8A', scheduleRelationship: 0 },
            stopTimeUpdate: [{ stopId: '9003' }, { stopId: 'unknown-stop' }],
          },
        },
      ],
    });
    const vehicles = collectVehicleReferences([
      { trip_id: 'unknown-trip', route_id: '8A', stop_id: '9003' },
    ]);
    const result = inspectRealtimeLinkage(staticResult.identifiers, {
      trip_updates: tripUpdates,
      vehicle_positions: vehicles,
    });

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'GTFS_RT_STOP_ID_MISMATCH' }),
      expect.objectContaining({ code: 'GTFS_RT_TRIP_ID_MISMATCH' }),
    ]));
    expect(result.metrics.trip_updates.tripIds).toEqual({
      references: 1,
      matched: 1,
      missingUnique: 0,
    });
  });
});
