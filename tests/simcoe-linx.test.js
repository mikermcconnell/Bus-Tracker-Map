import { describe, expect, test } from 'vitest';
import AdmZip from 'adm-zip';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import path from 'node:path';
import { buildArtifactsFromZip } from '../scripts/build-simcoe-linx.js';
import { loadMetadata, parseTripUpdates, qualifyVehicle } from '../server/simcoe-linx.js';

function createStaticZip() {
  const zip = new AdmZip();
  const files = {
    'agency.txt': [
      'agency_id,agency_name,agency_url,agency_timezone',
      '0,Simcoe County Linx,https://simcoe.ca/dpt/linx,America/Toronto',
      '',
    ],
    'routes.txt': [
      'route_id,route_short_name,route_long_name,route_type,route_color,route_text_color',
      '2,2,Barrie-Wasaga Beach,3,006747,FFFFFF',
      '4,4,Collingwood-Wasaga,3,CC33FF,FFFFFF',
      '',
    ],
    'stops.txt': [
      'stop_id,stop_name,stop_lat,stop_lon',
      'SCSTOP210,Barrie Allandale Bus Station - Detour,44.373913,-79.689146',
      'SCSTOP405,Collingwood Terminal,44.50,-80.21',
      '',
    ],
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'linx-2-trip,09:00:00,09:05:00,SCSTOP210,6',
      'linx-4-trip,10:00:00,10:05:00,SCSTOP405,2',
      '',
    ],
    'trips.txt': [
      'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
      '2,weekday,linx-2-trip,Wasaga Beach,0,linx-shape-2',
      '4,weekday,linx-4-trip,Collingwood,0,linx-shape-4',
      '',
    ],
    'shapes.txt': [
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
      'linx-shape-2,44.3600,-79.7100,1',
      'linx-shape-2,44.4100,-79.6700,2',
      'linx-shape-4,44.4900,-80.2200,1',
      'linx-shape-4,44.5100,-80.1900,2',
      '',
    ],
    'calendar.txt': [
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
      'weekday,1,1,1,1,1,0,0,20260701,20270831',
      '',
    ],
    'calendar_dates.txt': ['service_id,date,exception_type', ''],
  };
  Object.entries(files).forEach(([name, lines]) => {
    zip.addFile(name, Buffer.from(lines.join('\n'), 'utf8'));
  });
  return zip.toBuffer();
}

function barrieBounds() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [[-79.73, 44.34], [-79.65, 44.43]],
      },
    }],
  };
}

describe('Simcoe LINX integration', () => {
  test('keeps Barrie-serving routes without inventing a GTFS platform code', () => {
    const result = buildArtifactsFromZip(createStaticZip(), barrieBounds());

    expect(result.metadata.barrie_route_ids).toEqual(['2']);
    expect(result.metadata.terminal_stop_ids).toEqual(['SCSTOP210']);
    expect(result.metadata.terminal_stops).toEqual([
      expect.objectContaining({
        id: 'SCSTOP210', platform_code: null, lat: 44.373913, lon: -79.689146,
      }),
    ]);
    expect(result.metadata.trips['linx-2-trip']).toMatchObject({
      route_id: '2',
      headsign: 'Wasaga Beach',
      terminal_stops: [expect.objectContaining({ stop_id: 'SCSTOP210', stop_sequence: 6 })],
    });
    expect(result.routes.features).toHaveLength(1);
    expect(result.routes.features[0].properties).toMatchObject({
      route_id: 'LINX-2',
      route_short_name: 'LINX 2',
      agency_id: 'simcoe-linx',
      source_route_id: '2',
    });
  });

  test('accepts only exact Simcoe trip IDs from the shared Ontario vehicle feed', () => {
    const metadata = buildArtifactsFromZip(createStaticZip(), barrieBounds()).metadata;
    const accepted = qualifyVehicle({
      id: '3494106017',
      route_id: '2',
      trip_id: 'linx-2-trip',
      lat: 44.3745,
      lon: -79.6906,
      stop_id: 'SCSTOP210',
      current_stop_sequence: 6,
      current_status: 1,
    }, metadata);
    const collision = qualifyVehicle({
      id: 'other-agency-route-2',
      route_id: '2',
      trip_id: 'not-a-simcoe-trip',
      lat: 46.5,
      lon: -84.3,
    }, metadata);

    expect(accepted).toMatchObject({
      id: 'simcoe-linx:3494106017',
      route_id: 'LINX-2',
      route_label: 'LINX 2',
      agency_id: 'simcoe-linx',
      terminal_stop_id: 'SCSTOP210',
      platform: '2',
      terminal_progress_status: 'at_terminal',
    });
    expect(collision).toBeNull();
  });

  test('rejects a shared-feed vehicle when its route disagrees with the static trip', () => {
    const metadata = buildArtifactsFromZip(createStaticZip(), barrieBounds()).metadata;
    expect(qualifyVehicle({
      id: 'other-agency-trip-collision',
      route_id: '6',
      trip_id: 'linx-2-trip',
      lat: 44.3745,
      lon: -79.6906,
    }, metadata)).toBeNull();
  });

  test('fails explicitly when generated static metadata is unavailable', () => {
    const missingDir = path.join(process.cwd(), 'definitely-missing-simcoe-cache');
    expect(() => loadMetadata(missingDir)).toThrowError(expect.objectContaining({
      code: 'SIMCOE_LINX_METADATA_UNAVAILABLE',
    }));
  });

  test('uses only Simcoe trip updates at the Allandale stop', () => {
    const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;
    const feed = FeedMessage.create({
      header: { gtfsRealtimeVersion: '1.0' },
      entity: [{
        id: 'simcoe',
        tripUpdate: {
          trip: { tripId: 'linx-2-trip', routeId: '2' },
          stopTimeUpdate: [{
            stopId: 'SCSTOP210',
            stopSequence: 6,
            arrival: { time: 1786037000 },
            departure: { time: 1786037300, delay: 60 },
          }],
        },
      }, {
        id: 'collision',
        tripUpdate: {
          trip: { tripId: 'other-trip', routeId: '2' },
          stopTimeUpdate: [{ stopId: 'SCSTOP210', arrival: { time: 1786037000 } }],
        },
      }],
    });

    expect(parseTripUpdates(feed, ['SCSTOP210'], new Set(['linx-2-trip']))).toEqual({
      'linx-2-trip': expect.objectContaining({
        stop_id: 'SCSTOP210',
        stop_sequence: 6,
        arrival_time: 1786037000,
        departure_time: 1786037300,
        delay_seconds: 60,
      }),
    });
  });
});
