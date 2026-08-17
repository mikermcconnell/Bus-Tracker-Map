import { describe, expect, test } from 'vitest';
import AdmZip from 'adm-zip';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import {
  buildArtifactsFromZip,
} from '../scripts/build-ontario-northland.js';
import {
  parseAlerts,
  parseTripUpdates,
  qualifyVehicle,
} from '../server/ontario-northland.js';

function createStaticZip() {
  const zip = new AdmZip();
  const files = {
    'agency.txt': [
      'agency_id,agency_name,agency_url,agency_timezone',
      '0,Ontario Northland,https://ontarionorthland.ca,America/Toronto',
      ''
    ],
    'routes.txt': [
      'route_id,route_short_name,route_long_name,route_type,route_color,route_text_color',
      '101,ONTC,Toronto - North Bay,3,00214D,E6B012',
      '301,ONTC,North Bay - Timmins,3,00214D,E6B012',
      ''
    ],
    'stops.txt': [
      'stop_id,stop_name,stop_lat,stop_lon',
      '315,BARRIE ALLANDALE TERMINAL,44.3741,-79.6902',
      '100,TORONTO COACH TERMINAL,43.656,-79.384',
      '900,NORTH BAY,46.3,-79.4',
      ''
    ],
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'trip-barrie,10:00:00,10:05:00,100,1',
      'trip-barrie,12:00:00,12:05:00,315,2',
      'trip-other,13:00:00,13:05:00,900,2',
      ''
    ],
    'trips.txt': [
      'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id',
      '101,weekday,trip-barrie,NORTH BAY,0,shape-barrie',
      '301,weekday,trip-other,TIMMINS,0,shape-other',
      ''
    ],
    'shapes.txt': [
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
      'shape-barrie,44.3600,-79.7100,1',
      'shape-barrie,44.3900,-79.6800,2',
      'shape-other,46.3000,-79.4000,1',
      'shape-other,46.4000,-79.3000,2',
      ''
    ],
    'calendar.txt': [
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
      'weekday,1,1,1,1,1,0,0,20260701,20260831',
      ''
    ],
    'calendar_dates.txt': [
      'service_id,date,exception_type',
      'weekday,20260803,2',
      ''
    ],
  };
  Object.entries(files).forEach(([name, lines]) => {
    zip.addFile(name, Buffer.from(lines.join('\n'), 'utf8'));
  });
  return zip.toBuffer();
}

describe('Ontario Northland integration', () => {
  test('static build keeps only routes serving Barrie and namespaces the map layer', () => {
    const barrieRoutes = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { route_id: '1' },
        geometry: {
          type: 'LineString',
          coordinates: [[-79.72, 44.35], [-79.66, 44.41]]
        }
      }]
    };
    const result = buildArtifactsFromZip(createStaticZip(), barrieRoutes);

    expect(result.metadata.barrie_route_ids).toEqual(['101']);
    expect(result.metadata.barrie_stop_ids).toEqual(['315']);
    expect(result.metadata.barrie_stops).toEqual([
      expect.objectContaining({ id: '315', lat: 44.3741, lon: -79.6902 }),
    ]);
    expect(result.metadata.trips['trip-barrie'].headsign).toBe('NORTH BAY');
    expect(result.metadata.trips['trip-barrie'].service_id).toBe('weekday');
    expect(result.metadata.service_calendars.weekday.friday).toBe(true);
    expect(result.metadata.service_exceptions['20260803'].weekday).toBe(2);
    expect(result.metadata.trips['trip-barrie'].terminal_stops).toEqual([
      {
        stop_id: '315',
        stop_sequence: 2,
        arrival_time: '12:00:00',
        departure_time: '12:05:00',
      },
    ]);
    expect(result.metadata.terminal_approach_fallbacks['101|0|100']).toMatchObject({
      terminal_stop_ids: ['315'],
      candidate_trip_count: 1,
    });
    expect(result.routes.features.length).toBeGreaterThan(0);
    expect(result.routes.features[0].properties).toMatchObject({
      route_id: 'ONTC',
      route_short_name: 'ON',
      source_route_id: '101',
    });
  });

  test('qualifies live vehicles without colliding with Barrie route 101', () => {
    const metadata = {
      agency: {
        id: 'ontario-northland',
        name: 'Ontario Northland',
        map_route_id: 'ONTC',
        map_label: 'ON',
        color: '#00214D',
        text_color: '#E6B012',
      },
      barrie_route_ids: ['101'],
      routes: { '101': { long_name: 'Toronto - North Bay' } },
      trips: { 'trip-1': { headsign: 'NORTH BAY' } },
    };
    const vehicle = qualifyVehicle({
      id: 'bus-1',
      route_id: '101',
      trip_id: 'trip-1',
      lat: 44.38,
      lon: -79.69,
    }, metadata, {
      'trip-1': { stop_id: '315', arrival_time: 1785427200, delay_seconds: 60 },
    });

    expect(vehicle).toMatchObject({
      id: 'ontario-northland:bus-1',
      route_id: 'ONTC',
      route_label: 'ON',
      source_route_id: '101',
      agency_name: 'Ontario Northland',
      terminal_stop_id: '315',
      terminal_delay_seconds: 60,
    });
  });

  test('uses a safe route-direction-stop fallback when a realtime trip id is newer than static metadata', () => {
    const metadata = buildArtifactsFromZip(createStaticZip(), {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[-79.72, 44.35], [-79.66, 44.41]] },
      }],
    }).metadata;

    const vehicle = qualifyVehicle({
      id: 'coach-new-trip',
      route_id: '101',
      trip_id: 'new-realtime-trip-id',
      direction_id: 0,
      stop_id: '100',
      current_stop_sequence: 1,
      lat: 44.2,
      lon: -79.5,
    }, metadata, {});

    expect(vehicle).toMatchObject({
      terminal_progress_status: 'approaching',
      terminal_stop_id: '315',
      terminal_progress_source: 'route_direction_stop_fallback',
    });
  });

  test('rejects a departing coach when a stale Barrie stop id conflicts with its sequence', () => {
    const metadata = {
      agency: {
        id: 'ontario-northland',
        name: 'Ontario Northland',
        map_route_id: 'ONTC',
        map_label: 'ON',
      },
      barrie_stop_ids: ['315'],
      barrie_route_ids: ['201'],
      routes: { '201': { long_name: 'Toronto - Sudbury' } },
      trips: {
        'trip-201': {
          headsign: 'SUDBURY',
          terminal_stops: [{ stop_id: '315', stop_sequence: 4 }],
        },
      },
    };

    const vehicle = qualifyVehicle({
      id: 'coach-201',
      route_id: '201',
      trip_id: 'trip-201',
      lat: 44.381,
      lon: -79.710,
      stop_id: '315',
      current_stop_sequence: 5,
      current_status: 1,
    }, metadata, {
      'trip-201': {
        stop_id: '315',
        stop_sequence: 4,
        arrival_time: 1785427200,
      },
    });

    expect(vehicle).toMatchObject({
      source_route_id: '201',
      trip_headsign: 'SUDBURY',
      terminal_stop_sequence: 4,
      terminal_progress_status: 'departed',
    });
  });

  test('reads Allandale arrival updates and keeps only cancellation alerts', () => {
    const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;
    const tripFeed = FeedMessage.create({
      header: { gtfsRealtimeVersion: '1.0' },
      entity: [{
        id: 'trip',
        tripUpdate: {
          trip: { tripId: 'trip-1', routeId: '101' },
          stopTimeUpdate: [{
            stopId: '315',
            stopSequence: 2,
            arrival: { time: 1785427200, delay: 120 },
          }]
        }
      }]
    });
    const alertFeed = FeedMessage.create({
      header: { gtfsRealtimeVersion: '1.0' },
      entity: [{
        id: 'delay-alert',
        alert: {
          headerText: { translation: [{ text: 'Terminal delay', language: 'en' }] },
          descriptionText: { translation: [{ text: 'Expect delays.', language: 'en' }] },
        }
      }, {
        id: 'cancel-alert',
        alert: {
          headerText: { translation: [{ text: 'Trip cancelled', language: 'en' }] },
          descriptionText: { translation: [{ text: 'The scheduled coach will not operate.', language: 'en' }] },
          effect: 1,
        }
      }]
    });

    expect(parseTripUpdates(tripFeed, ['315'])['trip-1']).toMatchObject({
      stop_id: '315',
      arrival_time: 1785427200,
      delay_seconds: 120,
    });
    expect(parseAlerts(alertFeed)).toEqual([
      expect.objectContaining({
        id: 'cancel-alert',
        header: 'Trip cancelled',
        description: 'The scheduled coach will not operate.',
        effect: 1,
      }),
    ]);
  });
});
