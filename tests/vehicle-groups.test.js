import { describe, expect, test } from 'vitest';
import { clusterVehicles, DEFAULT_CLUSTER_THRESHOLD_METERS } from '../frontend/src/map/vehicle-groups.js';

function makeVehicle(id, lat, lon) {
  return { id, lat, lon, route_id: '1' };
}

describe('vehicle clustering', () => {
  test('groups vehicles within the threshold', () => {
    const threshold = DEFAULT_CLUSTER_THRESHOLD_METERS;
    const list = [
      makeVehicle('a', 44.3894, -79.6903),
      makeVehicle('b', 44.3894004, -79.6902996) // ~5m offset
    ];
    const clusters = clusterVehicles(list, threshold);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].vehicles.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });

  test('separates vehicles beyond the threshold', () => {
    const list = [
      makeVehicle('a', 44.3894, -79.6903),
      makeVehicle('b', 44.3905, -79.6920) // ~150m apart
    ];
    const clusters = clusterVehicles(list, 50);
    expect(clusters).toHaveLength(2);
  });

  test('computes cluster center as running average', () => {
    const list = [
      makeVehicle('a', 44.0000, -79.0000),
      makeVehicle('b', 44.0010, -79.0010),
      makeVehicle('c', 44.0020, -79.0020)
    ];
    const clusters = clusterVehicles(list, 500);
    expect(clusters).toHaveLength(1);
    const cluster = clusters[0];
    expect(cluster.lat).toBeCloseTo(44.0010, 4);
    expect(cluster.lon).toBeCloseTo(-79.0010, 4);
  });
});
