import { describe, expect, test } from 'vitest';
import {
  calibrationInImagePercent,
  departureDisplay,
  departureMatchesVehicle,
  departureSourceDisplay,
  getRouteEightDirection,
  getVehicleLabel,
  getVehicleStyle,
  groupPlatformAssignments,
  isAtPlatformDepartureEligible,
  isTerminalDisplayVehicle,
  normalizeDepartureBoard,
  projectVehicleToImage,
} from '../frontend/src/platform-map/model.js';

describe('platform map model', () => {
  test('converts viewport calibration into intrinsic image coordinates', () => {
    const points = calibrationInImagePercent();
    expect(points).toHaveLength(5);
    expect(points[0].x).toBeGreaterThan(50);
    expect(points[0].x).toBeLessThan(60);
    expect(points[0].y).toBeCloseTo(55.3238, 3);
  });

  test('projects known terminal coordinates inside the image at every viewport ratio', () => {
    const position = projectVehicleToImage(44.373837, -79.689279);
    expect(position).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
    }));
    expect(position.x).toBeGreaterThan(0);
    expect(position.x).toBeLessThan(100);
    expect(position.y).toBeGreaterThan(0);
    expect(position.y).toBeLessThan(100);
  });

  test('derives route 8 direction from trip direction before bearing', () => {
    expect(getRouteEightDirection({ route_id: '8A', direction_id: 0, bearing: 180 })).toBe('NORTHBOUND');
    expect(getRouteEightDirection({ route_id: '8B', direction_id: 1, bearing: 0 })).toBe('SOUTHBOUND');
    expect(getRouteEightDirection({ route_id: '7A', direction_id: 0 })).toBe('');
  });

  test('uses feed route colours and computes readable text contrast', () => {
    expect(getVehicleStyle({ route_id: '12A', route_color: '#F49AC1' })).toEqual({
      color: '#F49AC1',
      textColor: '#111827',
    });
  });

  test('labels Simcoe live vehicles with the LINX route number', () => {
    expect(getVehicleLabel({
      agency_id: 'simcoe-linx', source_route_id: '2', route_label: 'LINX 2'
    })).toBe('LINX 2');
  });

  test('hides departed vehicles even while their last position remains at the terminal', () => {
    const atTerminal = { lat: 44.3742256, lon: -79.6897583 };
    expect(isTerminalDisplayVehicle({ ...atTerminal, terminal_progress_status: 'departed' })).toBe(false);
    expect(isTerminalDisplayVehicle({ ...atTerminal, terminal_progress_status: 'approaching' })).toBe(true);
    expect(isTerminalDisplayVehicle({ ...atTerminal, terminal_progress_status: 'at_terminal' })).toBe(true);
  });

  test('limits at-platform highlighting to departures within twenty minutes', () => {
    const now = Date.parse('2026-08-17T16:00:00Z');
    expect(isAtPlatformDepartureEligible({
      terminal_departure_time: now / 1000 + 20 * 60,
    }, now)).toBe(true);
    expect(isAtPlatformDepartureEligible({
      terminal_departure_time: now / 1000 + 20 * 60 + 1,
    }, now)).toBe(false);
    expect(isAtPlatformDepartureEligible({}, now)).toBe(true);
  });

  test('does not treat a bus whose terminal time has passed as boardable', () => {
    const now = Date.parse('2026-10-09T15:40:00Z');
    expect(isAtPlatformDepartureEligible({
      terminal_departure_time: now / 1000 - 90,
    }, now)).toBe(true);
    expect(isAtPlatformDepartureEligible({
      terminal_departure_time: now / 1000 - 5 * 60,
    }, now)).toBe(false);
    expect(isAtPlatformDepartureEligible({
      terminal_departure_time: now / 1000 + 60,
      terminal_is_departure: false,
    }, now)).toBe(false);
  });

  test('matches a vehicle to a departure by vehicle or trip, never by route alone', () => {
    const departure = { route_id: '7A', trip_id: 'trip-1209', live_vehicle_id: null };
    expect(departureMatchesVehicle(departure, { id: 'bus-1', route_id: '7A', trip_id: 'trip-1140' })).toBe(false);
    expect(departureMatchesVehicle(departure, { id: 'bus-1', route_id: '7A', trip_id: 'trip-1209' })).toBe(true);
    expect(departureMatchesVehicle({ ...departure, live_vehicle_id: 'bus-2' }, { id: 'bus-2' })).toBe(true);
    expect(departureMatchesVehicle(null, { id: 'bus-2' })).toBe(false);
  });

  test('counts down conservatively and never shows a passed time', () => {
    const now = Date.parse('2026-10-09T15:40:00Z');
    expect(departureDisplay(now / 1000 + 61, now)).toMatchObject({ primary: '1 min', secondary: '11:41 AM' });
    expect(departureDisplay(now / 1000 + 59, now)).toMatchObject({ primary: 'Due now' });
    expect(departureDisplay(now / 1000 - 30, now)).toMatchObject({ primary: 'Due now' });
    expect(departureDisplay(now / 1000 - 5 * 60, now)).toMatchObject({ primary: 'See schedule', state: 'past' });
    expect(departureDisplay(null, now)).toMatchObject({ primary: 'See schedule', state: 'unavailable' });
  });

  test('keeps counting down to trips shortly after midnight', () => {
    const now = Date.parse('2026-10-10T03:50:00Z'); // 11:50 PM Toronto
    expect(departureDisplay(Date.parse('2026-10-10T04:15:00Z') / 1000, now))
      .toMatchObject({ primary: '25 min', secondary: '12:15 AM' });
    expect(departureDisplay(Date.parse('2026-10-10T10:00:00Z') / 1000, now))
      .toMatchObject({ primary: 'No more today', secondary: 'Next 6:00 AM' });
  });

  test('groups current assignments without inventing retired platforms', () => {
    const grouped = groupPlatformAssignments([
      { platform: '3', route_id: '8A' },
      { platform: '13', route_id: '12A' },
    ]);
    expect(Object.keys(grouped)).toEqual(['3', '13']);
    expect(grouped['14']).toBeUndefined();
  });

  test('uses adjusted departure times and labels their evidence accurately', () => {
    const normalized = normalizeDepartureBoard({
      departures: [{
        departure_source: 'estimated',
        scheduled_departure_time: 100,
        expected_departure_time: 160,
      }],
    });
    expect(normalized[0]).toMatchObject({
      departure_source: 'estimated',
      departure_time: 160,
    });
    expect(departureSourceDisplay(normalized[0])).toEqual({
      key: 'scheduled',
      label: 'Scheduled',
    });
    expect(departureSourceDisplay(normalized[0], true)).toEqual({
      key: 'live',
      label: 'Live',
    });
    expect(departureSourceDisplay({
      departure_source: 'realtime',
      live_evidence: 'trip_update',
    })).toEqual({
      key: 'scheduled',
      label: 'Scheduled',
    });
    expect(departureSourceDisplay({
      departure_source: 'realtime',
      live_vehicle_id: 'vehicle-1',
    })).toEqual({
      key: 'live',
      label: 'Live',
    });
  });
});
