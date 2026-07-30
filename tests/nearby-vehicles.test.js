import { describe, expect, test } from 'vitest';
import {
  BATT_COORDS,
  formatTerminalDistance,
  getTerminalDisplayStatus,
  selectNearestVehicles
} from '../frontend/src/map/nearby-vehicles.js';

describe('nearest BATT vehicle selection', () => {
  test('sorts valid vehicles by distance from the terminal', () => {
    const vehicles = [
      { id: 'far', route_id: '8A', terminal_progress_status: 'approaching', lat: 44.3894, lon: -79.6903 },
      { id: 'terminal', route_id: '7B', terminal_progress_status: 'at_terminal', lat: BATT_COORDS.lat, lon: BATT_COORDS.lon },
      { id: 'near', route_id: '12A', terminal_progress_status: 'approaching', lat: 44.376, lon: -79.69 },
      { id: 'invalid', route_id: '7A', terminal_progress_status: 'approaching', lat: null, lon: null }
    ];

    const selected = selectNearestVehicles(vehicles, { limit: 3 });

    expect(selected.map((entry) => entry.vehicle.id)).toEqual(['terminal', 'near', 'far']);
    expect(selected[0].distanceMeters).toBeCloseTo(0, 3);
  });

  test('respects the requested row limit', () => {
    const vehicles = [
      { id: 'one', terminal_progress_status: 'approaching', lat: 44.3741, lon: -79.69 },
      { id: 'two', terminal_progress_status: 'approaching', lat: 44.375, lon: -79.69 },
      { id: 'three', terminal_progress_status: 'approaching', lat: 44.376, lon: -79.69 }
    ];

    expect(selectNearestVehicles(vehicles, { limit: 2 })).toHaveLength(2);
  });

  test('includes inbound trains and excludes vehicles that left BATT', () => {
    const vehicles = [
      { id: 'inbound', terminal_progress_status: 'approaching', lat: 44.38, lon: -79.69 },
      { id: 'departed', terminal_progress_status: 'departed', lat: 44.375, lon: -79.69 },
      { id: 'train', route_mode: 'train', terminal_progress_status: 'approaching', lat: 44.376, lon: -79.69 },
    ];

    expect(selectNearestVehicles(vehicles).map((entry) => entry.vehicle.id))
      .toEqual(['train', 'inbound']);
  });
});

describe('BATT distance labels', () => {
  test('requires an at-terminal status instead of using distance alone', () => {
    expect(formatTerminalDistance(100, 'approaching')).toBe('100 m away');
    expect(formatTerminalDistance(20, 'approaching')).toBe('50 m away');
    expect(formatTerminalDistance(100, 'at_terminal')).toBe('At the terminal');
    expect(formatTerminalDistance(576, 'at_terminal')).toBe('600 m away');
    expect(formatTerminalDistance(430)).toBe('450 m away');
    expect(formatTerminalDistance(1525)).toBe('1.5 km away');
  });

  test('rejects an at-terminal feed status outside the terminal radius', () => {
    expect(getTerminalDisplayStatus('at_terminal', 150)).toBe('at_terminal');
    expect(getTerminalDisplayStatus('at_terminal', 151)).toBe('approaching');
    expect(getTerminalDisplayStatus('approaching', 500)).toBe('approaching');
  });
});
