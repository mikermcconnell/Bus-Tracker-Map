import { describe, expect, test } from 'vitest';
import monitorModule from '../monitor/index.js';

const {
  deriveTripUpdatesUrl,
  getFeedAgeMinutes,
  getFeedAlertContext,
  normalizeMissingSinceEntry,
  buildRouteReport,
  getWatchdogAlertDetails,
} = monitorModule;

describe('monitor feed helpers', () => {
  test('derives the trip updates URL from the vehicle positions URL', () => {
    expect(deriveTripUpdatesUrl('https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb')).toBe(
      'https://www.myridebarrie.ca/gtfs/GTFS_TripUpdates.pb'
    );
  });

  test('calculates feed age in minutes', () => {
    const nowMs = Date.parse('2026-03-23T13:40:00Z');
    expect(getFeedAgeMinutes(1774225732, nowMs)).toBe(791);
  });

  test('flags out-of-sync feeds when trip updates are fresh but vehicle positions are stale', () => {
    const now = new Date('2026-03-23T13:40:00Z');
    const result = getFeedAlertContext({
      feed_timestamp: 1774225732,
      feed_last_modified: 'Mon, 23 Mar 2026 00:30:26 GMT',
    }, {
      header_timestamp: 1774273200,
    }, now, 15);

    expect(result).toEqual(expect.objectContaining({
      code: 'VEHICLE_FEED_OUT_OF_SYNC',
      kind: 'vehicle_feed_out_of_sync',
    }));
  });

  test('flags stale vehicle feed when no fresh trip updates signal exists', () => {
    const now = new Date('2026-03-23T13:40:00Z');
    const result = getFeedAlertContext({
      feed_timestamp: 1774225732,
      feed_last_modified: 'Mon, 23 Mar 2026 00:30:26 GMT',
    }, null, now, 15);

    expect(result).toEqual(expect.objectContaining({
      code: 'VEHICLE_FEED_STALE',
      kind: 'vehicle_feed_stale',
    }));
  });
});

describe('monitor missing-state normalization', () => {
  test('supports legacy numeric state entries', () => {
    expect(normalizeMissingSinceEntry(12345)).toEqual([12345]);
  });

  test('supports array state entries and drops invalid values', () => {
    expect(normalizeMissingSinceEntry([300, '200', null, 'bad', 100])).toEqual([100, 200, 300]);
  });
});

describe('monitor route report', () => {
  test('tracks missing duration per bus instead of per route', () => {
    const nowMs = Date.UTC(2026, 1, 25, 15, 0, 0);
    const expectedByRoute = new Map([['1', 3]]);
    const trackingByRoute = new Map([['1', 1]]);
    const prevState = {
      '1': [nowMs - (25 * 60 * 1000)],
    };

    const result = buildRouteReport(
      expectedByRoute,
      trackingByRoute,
      prevState,
      nowMs,
      20 * 60 * 1000
    );

    expect(result.totalMissing).toBe(1);
    expect(result.totalMonitoring).toBe(1);
    expect(result.newState['1']).toEqual([
      nowMs - (25 * 60 * 1000),
      nowMs,
    ]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        routeId: '1',
        missing: 2,
        confirmed: true,
        confirmedMissing: 1,
        monitoringMissing: 1,
        duration: '25 min oldest (+1 monitoring)',
      }),
    ]);
  });

  test('keeps fully missing legacy routes alertable', () => {
    const nowMs = Date.UTC(2026, 1, 25, 15, 0, 0);
    const expectedByRoute = new Map([['7', 1]]);
    const trackingByRoute = new Map();
    const prevState = {
      '7': nowMs - (30 * 60 * 1000),
    };

    const result = buildRouteReport(
      expectedByRoute,
      trackingByRoute,
      prevState,
      nowMs,
      20 * 60 * 1000
    );

    expect(result.totalMissing).toBe(1);
    expect(result.totalMonitoring).toBe(0);
    expect(result.newState['7']).toEqual([nowMs - (30 * 60 * 1000)]);
    expect(result.rows[0]).toEqual(expect.objectContaining({
      routeId: '7',
      duration: '30 min',
      confirmedMissing: 1,
      monitoringMissing: 0,
    }));
  });
});

describe('monitor watchdog alerts', () => {
  test('returns stale context only when last success exceeds threshold and has not already alerted', () => {
    const now = new Date('2026-02-25T15:00:00Z');

    expect(getWatchdogAlertDetails({
      lastSuccessAt: '2026-02-25T13:20:00Z',
      alertedDown: false,
    }, now, 90)).toEqual(expect.objectContaining({
      ageMinutes: 100,
    }));

    expect(getWatchdogAlertDetails({
      lastSuccessAt: '2026-02-25T13:40:00Z',
      alertedDown: false,
    }, now, 90)).toBeNull();

    expect(getWatchdogAlertDetails({
      lastSuccessAt: '2026-02-25T13:20:00Z',
      alertedDown: true,
    }, now, 90)).toBeNull();
  });
});
