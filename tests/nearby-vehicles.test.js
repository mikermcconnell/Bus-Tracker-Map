import { describe, expect, test } from 'vitest';
import {
  BATT_COORDS,
  formatTerminalArrival,
  formatTerminalDeparture,
  formatTerminalDistance,
  getTerminalEventTime,
  getTerminalDisplayStatus,
  getRouteEightDirectionLabel,
  getTerminalListStatus,
  selectNearestVehicles
} from '../frontend/src/map/nearby-vehicles.js';

describe('nearest BATT vehicle selection', () => {
  test('keeps a GO bus at the terminal even after its trip marks Allandale as passed', () => {
    const goBus = {
      id: 'go-68b',
      agency_id: 'go-transit',
      terminal_progress_status: 'passed_terminal',
      lat: BATT_COORDS.lat,
      lon: BATT_COORDS.lon
    };

    expect(getTerminalListStatus(goBus, 0)).toBe('at_terminal');
    expect(selectNearestVehicles([goBus])).toHaveLength(1);
  });

  test('does not keep a passed GO bus after it leaves the terminal area', () => {
    const goBus = {
      id: 'go-68b',
      agency_id: 'go-transit',
      terminal_progress_status: 'passed_terminal',
      lat: 44.38,
      lon: -79.69
    };

    expect(selectNearestVehicles([goBus])).toHaveLength(0);
  });

  test('keeps a GO train when its feed first appears at Allandale', () => {
    const goTrain = {
      id: 'go-train',
      agency_id: 'go-transit',
      route_mode: 'train',
      terminal_progress_status: 'departed',
      lat: BATT_COORDS.lat,
      lon: BATT_COORDS.lon
    };

    expect(getTerminalListStatus(goTrain, 0)).toBe('at_terminal');
    expect(selectNearestVehicles([goTrain])).toHaveLength(1);
  });

  test('uses a stopped vehicle physically at its terminal platform over a lagging stop sequence', () => {
    const barrieBus = {
      id: 'route-8-at-platform',
      agency_id: 'barrie-transit',
      terminal_progress_status: 'approaching',
      stop_id: '9004',
      terminal_stop_id: '9004',
      current_status: 1,
      current_stop_sequence: 127,
      terminal_stop_sequence: 142,
      lat: BATT_COORDS.lat,
      lon: BATT_COORDS.lon
    };

    expect(getTerminalListStatus(barrieBus, 0)).toBe('at_terminal');
    expect(selectNearestVehicles([barrieBus])).toHaveLength(1);
  });

  test('does not override an approaching vehicle outside the terminal geofence', () => {
    const barrieBus = {
      agency_id: 'barrie-transit',
      terminal_progress_status: 'approaching',
      stop_id: '9004',
      terminal_stop_id: '9004',
      current_status: 1
    };

    expect(getTerminalListStatus(barrieBus, 151)).toBe('approaching');
  });

  test('labels both Route 8 directions clearly', () => {
    expect(getRouteEightDirectionLabel('8B', 0)).toBe('North');
    expect(getRouteEightDirectionLabel('8B', 1)).toBe('South');
    expect(getRouteEightDirectionLabel('7B', 0)).toBe('');
  });

  test('sorts valid vehicles without realtime events by distance from the terminal', () => {
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

  test('puts terminal buses first, then sorts each status by its next event', () => {
    const now = Date.parse('2026-08-04T15:00:00Z');
    const vehicles = [
      {
        id: 'near-later-arrival',
        terminal_progress_status: 'approaching',
        terminal_arrival_time: now / 1000 + 12 * 60,
        lat: 44.38,
        lon: -79.69
      },
      {
        id: 'terminal-next-departure',
        terminal_progress_status: 'at_terminal',
        terminal_departure_time: now / 1000 + 5 * 60,
        lat: BATT_COORDS.lat,
        lon: BATT_COORDS.lon
      },
      {
        id: 'far-first-arrival',
        terminal_progress_status: 'approaching',
        terminal_arrival_time: now / 1000 + 2 * 60,
        lat: 44.3894,
        lon: -79.6903
      },
      {
        id: 'unknown-time',
        terminal_progress_status: 'approaching',
        lat: 44.378,
        lon: -79.69
      }
    ];

    expect(selectNearestVehicles(vehicles, { nowMs: now }).map((entry) => entry.vehicle.id))
      .toEqual([
        'terminal-next-departure',
        'far-first-arrival',
        'near-later-arrival',
        'unknown-time'
      ]);
  });

  test('sorts a physically near approaching bus as arriving now', () => {
    const now = Date.parse('2026-08-04T15:00:00Z');
    const vehicles = [
      {
        id: 'far-feed-first',
        terminal_progress_status: 'approaching',
        terminal_arrival_time: now / 1000 + 60,
        lat: 44.38,
        lon: -79.69
      },
      {
        id: 'near-feed-later',
        terminal_progress_status: 'approaching',
        terminal_arrival_time: now / 1000 + 7 * 60,
        lat: 44.3749,
        lon: -79.69
      }
    ];

    expect(selectNearestVehicles(vehicles, { nowMs: now }).map((entry) => entry.vehicle.id))
      .toEqual(['near-feed-later', 'far-feed-first']);
  });

  test('treats stale and GPS-contradicted due event times as unknown', () => {
    const now = Date.parse('2026-08-04T15:00:00Z');
    expect(getTerminalEventTime({
      terminal_arrival_time: now / 1000 - 301
    }, 'approaching', now)).toBeNull();
    expect(getTerminalEventTime({
      terminal_arrival_time: now / 1000 - 20
    }, 'approaching', now, 1300)).toBeNull();
    expect(getTerminalEventTime({
      terminal_departure_time: now / 1000 + 60
    }, 'at_terminal', now)).toBe(now / 1000 + 60);
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

describe('BATT departure labels', () => {
  const now = Date.parse('2026-07-31T13:00:00Z');

  test('shows whole minutes until departure', () => {
    expect(formatTerminalDeparture(now / 1000 + 121, now)).toBe('Departs in 3 min');
    expect(formatTerminalDeparture(now / 1000 + 20, now)).toBe('Departs in 1 min');
  });

  test('handles due and stale departures', () => {
    expect(formatTerminalDeparture(now / 1000 - 20, now)).toBe('Departs now');
    expect(formatTerminalDeparture(now / 1000 - 301, now)).toBe('');
    expect(formatTerminalDeparture(null, now)).toBe('');
  });
});

describe('BATT arrival labels', () => {
  const now = Date.parse('2026-07-31T13:00:00Z');

  test('shows whole minutes until arrival', () => {
    expect(formatTerminalArrival(now / 1000 + 121, now)).toBe('Arrives in 3 min');
    expect(formatTerminalArrival(now / 1000 + 20, now)).toBe('Arrives in 1 min');
  });

  test('handles due and stale arrivals', () => {
    expect(formatTerminalArrival(now / 1000 - 20, now)).toBe('Arriving now');
    expect(formatTerminalArrival(now / 1000 - 301, now)).toBe('');
    expect(formatTerminalArrival(null, now)).toBe('');
  });

  test('uses physical proximity over a terminal arrival pushed to departure time', () => {
    expect(formatTerminalArrival(now / 1000 + 7 * 60, now, 100)).toBe('Arriving now');
    expect(formatTerminalArrival(now / 1000 + 7 * 60, now, 251)).toBe('Arrives in 7 min');
  });

  test('hides an expired prediction when GPS still shows the vehicle far away', () => {
    expect(formatTerminalArrival(now / 1000 - 20, now, 1300)).toBe('');
    expect(formatTerminalArrival(now / 1000 - 20, now, 250)).toBe('Arriving now');
  });
});
