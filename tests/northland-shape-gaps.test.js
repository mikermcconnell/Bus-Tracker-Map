import { expect, test } from 'vitest';
import { splitUnsupportedConnections, buildArtifactsFromZip } from '../scripts/build-ontario-northland.js';
import AdmZip from 'adm-zip';

const northeast = [-79.63197999217681, 44.4204004723606];
const terminal = [-79.6901939, 44.374099];
const exit = [-79.68981, 44.37423];

test('removes the production ONTC:1102 diagonal but retains terminal geometry', () => {
  expect(splitUnsupportedConnections({ type: 'LineString', coordinates: [northeast, terminal, exit] }))
    .toEqual({ type: 'LineString', coordinates: [terminal, exit] });
});

test('keeps valid sections separate on both sides of a gap', () => {
  const approach = [-79.632, 44.421];
  const sections = [[approach, northeast], [terminal, exit]];
  expect(splitUnsupportedConnections({ type: 'LineString', coordinates: sections.flat() }))
    .toEqual({ type: 'MultiLineString', coordinates: sections });
  expect(splitUnsupportedConnections({ type: 'MultiLineString', coordinates: sections }))
    .toEqual({ type: 'MultiLineString', coordinates: sections });
  expect(splitUnsupportedConnections({ type: 'LineString', coordinates: [northeast, terminal] })).toBeNull();
});

test('import guards future shape IDs without removing trip or stop metadata', () => {
  const zip = new AdmZip();
  const files = {
    'agency.txt': 'agency_id,agency_name\n0,Ontario Northland',
    'routes.txt': 'route_id\n102',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n315,BARRIE ALLANDALE,44.374099,-79.6901939',
    'trips.txt': 'route_id,service_id,trip_id,shape_id\n102,daily,trip,new-shape',
    'stop_times.txt': 'trip_id,stop_id,stop_sequence\ntrip,315,1',
    'shapes.txt': 'shape_id,shape_pt_sequence,shape_pt_lon,shape_pt_lat\n' +
      [northeast, terminal, exit].map((p, i) => `new-shape,${i},${p[0]},${p[1]}`).join('\n'),
  };
  Object.entries(files).forEach(([name, text]) => zip.addFile(name, Buffer.from(text)));
  const result = buildArtifactsFromZip(zip.toBuffer(), null);
  expect(result.routes.features[0].geometry.coordinates).toEqual([terminal, exit]);
  expect(result.metadata.trips.trip.shape_id).toBe('new-shape');
  expect(result.metadata.barrie_stop_ids).toEqual(['315']);
});
