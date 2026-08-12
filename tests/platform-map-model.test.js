import { describe, expect, test } from 'vitest';
import {
  calibrationInImagePercent,
  getRouteEightDirection,
  getVehicleLabel,
  getVehicleStyle,
  groupPlatformAssignments,
  isTerminalDisplayVehicle,
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

  test('groups current assignments without inventing retired platforms', () => {
    const grouped = groupPlatformAssignments([
      { platform: '3', route_id: '8A' },
      { platform: '13', route_id: '12A' },
    ]);
    expect(Object.keys(grouped)).toEqual(['3', '13']);
    expect(grouped['14']).toBeUndefined();
  });
});
