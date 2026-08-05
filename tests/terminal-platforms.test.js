import { describe, expect, test } from 'vitest';
import {
  buildTerminalAssignmentIndex,
  formatPlatformLabel,
  resolveTerminalAssignment,
} from '../frontend/src/map/terminal-platforms.js';

const assignments = buildTerminalAssignmentIndex({
  assignments: [
    { agency_id: 'barrie-transit', route_id: '8A', stop_id: '9003', platform: '3', destination: 'Yonge Southbound' },
    { agency_id: 'barrie-transit', route_id: '8A', stop_id: '9005', platform: '5', destination: 'RVH Northbound' },
    { agency_id: 'barrie-transit', route_id: '7A', stop_id: '9006', platform: '6', destination: 'Grove' },
    { agency_id: 'barrie-transit', route_id: '12B', stop_id: '14', platform: '14', destination: 'Barrie South GO' },
  ],
});

describe('terminal platform resolution', () => {
  test('uses terminal stop and route to distinguish directional platforms', () => {
    expect(resolveTerminalAssignment({
      agency_id: 'barrie-transit', route_id: '8A', terminal_stop_id: '9005',
    }, assignments)).toMatchObject({ platform: '5', destination: 'RVH Northbound' });
  });

  test('does not guess when a route has multiple possible platforms', () => {
    expect(resolveTerminalAssignment({
      agency_id: 'barrie-transit', route_id: '8A',
    }, assignments)).toBeNull();
  });

  test('uses a unique route assignment when the terminal stop is unavailable', () => {
    expect(resolveTerminalAssignment({
      agency_id: 'barrie-transit', route_id: '7A',
    }, assignments)).toMatchObject({ platform: '6' });
  });

  test('formats platforms, external stops, and unknown assignments safely', () => {
    expect(formatPlatformLabel({ platform: '6' })).toBe('PLATFORM 6');
    expect(formatPlatformLabel({ platform: '14' })).toBe('STOP 14');
    expect(formatPlatformLabel(null)).toBe('CHECK BOARD');
  });
});
