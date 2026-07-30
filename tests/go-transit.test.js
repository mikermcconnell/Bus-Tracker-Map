import AdmZip from 'adm-zip';
import { describe, expect, test } from 'vitest';
import {
  buildArtifactsFromZip,
} from '../scripts/build-go-transit.js';
import {
  parseVehicleFeed,
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
  };
  Object.entries(files).forEach(([name, lines]) => {
    zip.addFile(name, Buffer.from(lines.join('\n'), 'utf8'));
  });
  return zip.toBuffer();
}

describe('GO Transit Allandale integration', () => {
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
    expect(result.routes.features.map((feature) => feature.properties.route_id).sort())
      .toEqual(['GO-BUS', 'GO-TRAIN']);
  });

  test('live parsing filters to Allandale routes and the Barrie map area', () => {
    const metadata = {
      agency: { id: 'go-transit', name: 'GO Transit' },
      allandale_route_ids: ['feed-68', 'feed-BR'],
      map_bounds: [-79.72, 44.34, -79.66, 44.41],
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
            timestamp: 1785433120,
          },
        },
        {
          id: 'train',
          vehicle: {
            trip: { trip_id: 'train-trip', route_id: 'feed-BR' },
            vehicle: { id: '620', label: 'BR - Union Station GO' },
            position: { latitude: 44.3800, longitude: -79.6870 },
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
      lat: 44.375,
    });
    expect(vehicles.find((vehicle) => vehicle.id === 'go-transit:620')).toMatchObject({
      route_id: 'GO-TRAIN',
      route_label: 'GO TRAIN',
      route_mode: 'train',
    });
  });
});
