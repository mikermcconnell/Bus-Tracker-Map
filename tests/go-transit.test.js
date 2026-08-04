import AdmZip from 'adm-zip';
import { describe, expect, test, vi } from 'vitest';
import {
  buildArtifactsFromZip,
} from '../scripts/build-go-transit.js';
import {
  fetchGoTransitRealtime,
  parseVehicleFeed,
  resetGoTransitCache,
} from '../server/go-transit.js';

function createStaticZip() {
  const zip = new AdmZip();
  const files = {
    'agency.txt': [
      'agency_id,agency_name,agency_url,agency_timezone',
      'GO,GO Transit,https://www.gotransit.com,America/Toronto',
      '',
    ],
    'routes.txt': [
      'route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color',
      'feed-68,GO,68,Barrie / Newmarket,3,003767,FFFFFF',
      'feed-BR,GO,BR,Barrie,2,003767,FFFFFF',
      'feed-LW,GO,LW,Lakeshore West,2,003767,FFFFFF',
      '',
    ],
    'stops.txt': [
      'stop_id,stop_name,stop_lat,stop_lon',
      '08049,Allandale Waterfront GO Bus,44.3744,-79.6893',
      'AD,Allandale Waterfront GO,44.3741,-79.6879',
      'UN,Union Station GO,43.645,-79.380',
      '',
    ],
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'bus-trip,12:00:00,12:05:00,08049,1',
      'train-trip,13:00:00,13:05:00,AD,1',
      'other-trip,14:00:00,14:05:00,UN,1',
      '',
    ],
    'trips.txt': [
      'route_id,service_id,trip_id,trip_headsign,shape_id',
      'feed-68,weekday,bus-trip,East Gwillimbury GO,bus-shape',
      'feed-BR,weekday,train-trip,Union Station GO,train-shape',
      'feed-LW,weekday,other-trip,West Harbour GO,other-shape',
      '',
    ],
    'shapes.txt': [
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
      'bus-shape,44.3600,-79.7100,1',
      'bus-shape,44.3900,-79.6800,2',
      'train-shape,44.3500,-79.6900,1',
      'train-shape,44.3900,-79.6870,2',
      'other-shape,43.6400,-79.3900,1',
      'other-shape,43.6500,-79.3700,2',
      '',
    ],
    'calendar.txt': [
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
      'weekday,1,1,1,1,1,0,0,20260701,20260831',
      '',
    ],
    'calendar_dates.txt': [
      'service_id,date,exception_type',
      'weekday,20260803,2',
      '',
    ],
  };
  Object.entries(files).forEach(([name, lines]) => {
    zip.addFile(name, Buffer.from(lines.join('\n'), 'utf8'));
  });
  return zip.toBuffer();
}

describe('GO Transit Allandale integration', () => {
  test('can use a server-side proxy when the Metrolinx key is unavailable locally', async () => {
    resetGoTransitCache();
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        feed_timestamp: 1785502325,
        sources: { go_transit: { latest_data_timestamp: 1785502320 } },
        vehicles: [
          { id: 'go-transit:8451', agency_id: 'go-transit', route_label: 'GO 68' },
          { id: 'barrie:1', agency_id: 'barrie-transit', route_id: '8B' },
        ],
      }),
    });

    const result = await fetchGoTransitRealtime({
      enabled: true,
      proxyUrl: 'https://example.test/api/vehicles.json',
      fetchImpl,
    });

    expect(result.configured).toBe(true);
    expect(result.feed_timestamp).toBe(1785502320);
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({
      id: 'go-transit:8451',
      agency_id: 'go-transit',
      route_label: 'GO 68',
    });
    resetGoTransitCache();
  });

  test('treats a successful proxy poll as available when a stationary GO bus has old GPS data', async () => {
    resetGoTransitCache();
    const nowMs = 1785504165000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const result = await fetchGoTransitRealtime({
      enabled: true,
      proxyUrl: 'https://example.test/api/vehicles.json',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          generated_at: nowMs,
          sources: {
            go_transit: {
              feed_status: 'offline',
              status_reason: 'stale',
              latest_data_timestamp: 1785503186,
            },
          },
          vehicles: [{
            id: 'go-transit:8451',
            agency_id: 'go-transit',
            route_label: 'GO 68',
            last_reported: 1785503186,
          }],
        }),
      }),
    });

    expect(result.feed_timestamp).toBe(1785504165);
    expect(result.vehicles[0].last_reported).toBe(1785503186);
    nowSpy.mockRestore();
    resetGoTransitCache();
  });

  test('uses the last successful GO response during a brief proxy failure', async () => {
    resetGoTransitCache();
    let nowMs = 1785504165000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls > 1) throw new Error('temporary proxy timeout');
      return {
        ok: true,
        json: async () => ({
          generated_at: nowMs,
          sources: { go_transit: { feed_status: 'live', status_reason: 'fresh' } },
          vehicles: [],
        }),
      };
    };

    const first = await fetchGoTransitRealtime({
      enabled: true,
      proxyUrl: 'https://example.test/api/vehicles.json',
      fetchImpl,
    });
    nowMs += 6000;
    const fallback = await fetchGoTransitRealtime({
      enabled: true,
      proxyUrl: 'https://example.test/api/vehicles.json',
      fetchImpl,
    });

    expect(fallback).toMatchObject({
      feed_timestamp: first.feed_timestamp,
      stale_if_error: true,
      configured: true,
    });
    expect(calls).toBe(2);
    nowSpy.mockRestore();
    resetGoTransitCache();
  });

  test('static build keeps only trips serving the two Allandale records', () => {
    const barrieRoutes = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { route_id: '7A' },
        geometry: {
          type: 'LineString',
          coordinates: [[-79.72, 44.34], [-79.66, 44.41]],
        },
      }],
    };
    const result = buildArtifactsFromZip(createStaticZip(), barrieRoutes);

    expect(result.metadata.allandale_stop_ids).toEqual(['08049', 'AD']);
    expect(result.metadata.allandale_route_ids).toEqual(['feed-68', 'feed-BR']);
    expect(result.metadata.routes['feed-68']).toMatchObject({
      map_route_id: 'GO-BUS',
      mode: 'bus',
    });
    expect(result.metadata.routes['feed-BR']).toMatchObject({
      map_route_id: 'GO-TRAIN',
      mode: 'train',
    });
    expect(result.metadata.trips['bus-trip'].terminal_stops).toEqual([
      {
        stop_id: '08049',
        stop_sequence: 1,
        arrival_time: '12:00:00',
        departure_time: '12:05:00',
        is_departure: false,
      },
    ]);
    expect(result.metadata.trips['train-trip'].terminal_stops).toEqual([
      {
        stop_id: 'AD',
        stop_sequence: 1,
        arrival_time: '13:00:00',
        departure_time: '13:05:00',
        is_departure: false,
      },
    ]);
    expect(result.metadata.trips['bus-trip'].service_id).toBe('weekday');
    expect(result.metadata.service_calendars.weekday.friday).toBe(true);
    expect(result.metadata.service_exceptions['20260803'].weekday).toBe(2);
    expect(result.routes.features.map((feature) => feature.properties.route_id).sort())
      .toEqual(['GO-BUS', 'GO-TRAIN']);
  });

  test('live parsing filters to Allandale routes and the Barrie map area', () => {
    const metadata = {
      agency: { id: 'go-transit', name: 'GO Transit' },
      allandale_route_ids: ['feed-68', 'feed-BR'],
      map_bounds: [-79.72, 44.34, -79.66, 44.41],
      shape_coordinates: {
        'bus-shape': [[
          [-79.6880, 44.3800],
          [-79.6880, 44.3600],
        ]],
      },
      routes: {
        'feed-68': {
          map_route_id: 'GO-BUS',
          mode: 'bus',
          long_name: 'Barrie / Newmarket',
          color: '#003767',
          text_color: '#FFFFFF',
        },
        'feed-BR': {
          map_route_id: 'GO-TRAIN',
          mode: 'train',
          long_name: 'Barrie',
          color: '#003767',
          text_color: '#FFFFFF',
        },
      },
      trips: {
        'trip-new': {
          shape_id: 'bus-shape',
          headsign: 'East Gwillimbury GO',
        },
      },
    };
    const feed = {
      header: { timestamp: 1785433127 },
      entity: [
        {
          id: 'old-bus',
          vehicle: {
            trip: { trip_id: 'trip-old', route_id: 'feed-68' },
            vehicle: { id: '2546', label: '68 - Allandale Waterfront GO' },
            position: { latitude: 44.3740, longitude: -79.6890 },
            timestamp: 1785433100,
          },
        },
        {
          id: 'new-bus',
          vehicle: {
            trip: { trip_id: 'trip-new', route_id: 'feed-68' },
            vehicle: { id: '2546', label: '68B - East Gwillimbury GO' },
            position: { latitude: 44.3750, longitude: -79.6880 },
            bearing: 0,
            speed: 0,
            stop_id: '08049',
            current_stop_sequence: 2,
            current_status: 1,
            timestamp: 1785433120,
          },
        },
        {
          id: 'train',
          vehicle: {
            trip: { trip_id: 'train-trip', route_id: 'feed-BR' },
            vehicle: { id: '620', label: 'BR - Union Station GO' },
            position: { latitude: 44.3800, longitude: -79.6870, bearing: 90, speed: 10 },
            timestamp: 1785433121,
          },
        },
        {
          id: 'outside',
          vehicle: {
            trip: { trip_id: 'outside-trip', route_id: 'feed-BR' },
            vehicle: { id: '621', label: 'BR - Aurora GO' },
            position: { latitude: 43.99, longitude: -79.46 },
            timestamp: 1785433122,
          },
        },
      ],
    };

    const vehicles = parseVehicleFeed(feed, metadata);
    expect(vehicles).toHaveLength(2);
    expect(vehicles.find((vehicle) => vehicle.id === 'go-transit:2546')).toMatchObject({
      route_id: 'GO-BUS',
      route_label: 'GO 68B',
      trip_headsign: 'East Gwillimbury GO',
      terminal_progress_status: 'departed',
      bearing: 180,
      bearing_source: 'static_shape',
      lat: 44.375,
    });
    expect(vehicles.find((vehicle) => vehicle.id === 'go-transit:620')).toMatchObject({
      route_id: 'GO-TRAIN',
      route_label: 'GO TRAIN',
      route_mode: 'train',
      bearing: 90,
      bearing_source: 'realtime',
    });
  });
});
