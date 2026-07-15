import { describe, expect, test } from 'vitest';
import monitorModule from '../monitor/index.js';

const {
  deriveTripUpdatesUrl,
  getFeedAgeMinutes,
  getFeedAlertContext,
  getNoRecentGpsAlertContext,
  selectGpsAlertContext,
  shouldSendIssueAlert,
  normalizeMissingSinceEntry,
  buildRouteReport,
  getPossibleServiceMismatchContext,
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
      details: 'The vehicle positions feed is stale while the trip updates feed remains current.',
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
      details: 'The live bus locations feed is older than the allowed freshness limit.',
    }));
  });

  test('flags no recent GPS only when buses are expected', () => {
    const now = new Date('2026-05-28T15:30:00Z');
    const staleVehicles = [
      { id: 'bus-1', last_reported: Date.parse('2026-05-28T15:20:00Z') / 1000 },
      { id: 'bus-2', last_reported: Date.parse('2026-05-28T15:19:00Z') / 1000 },
    ];

    expect(getNoRecentGpsAlertContext(30, 0, staleVehicles, now, 5 * 60)).toEqual(expect.objectContaining({
      code: 'NO_RECENT_VEHICLE_GPS',
      kind: 'no_recent_vehicle_gps',
      expectedCount: 30,
      trackingCount: 0,
      latestVehicleAgeMin: 10,
    }));

    expect(getNoRecentGpsAlertContext(0, 0, staleVehicles, now, 5 * 60)).toBeNull();
  });

  test('does not flag no recent GPS when at least one expected bus has fresh GPS', () => {
    const now = new Date('2026-05-28T15:30:00Z');
    const vehicles = [
      { id: 'bus-1', last_reported: Date.parse('2026-05-28T15:28:00Z') / 1000 },
    ];

    expect(getNoRecentGpsAlertContext(30, 1, vehicles, now, 5 * 60)).toBeNull();
  });

  test('prefers no recent GPS over stale feed when buses are expected', () => {
    const now = new Date('2026-05-28T15:50:00Z');
    const vehicleData = {
      feed_timestamp: Date.parse('2026-05-28T15:05:00Z') / 1000,
      vehicles: [
        { id: 'bus-1', route_id: '1', last_reported: Date.parse('2026-05-28T15:05:00Z') / 1000 },
      ],
    };

    const result = selectGpsAlertContext({
      vehicleData,
      tripUpdatesMeta: null,
      expectedCount: 31,
      trackingCount: 0,
      now,
      staleAfterMin: 15,
      thresholdSecs: 5 * 60,
    });

    expect(result).toEqual(expect.objectContaining({
      code: 'NO_RECENT_VEHICLE_GPS',
      kind: 'no_recent_vehicle_gps',
    }));
  });

  test('resends active issues after the resend interval', () => {
    const checkedAt = new Date('2026-03-23T14:30:00Z');
    expect(shouldSendIssueAlert(null, checkedAt, 30)).toBe(true);
    expect(shouldSendIssueAlert({
      lastSentAt: '2026-03-23T14:10:00Z',
    }, checkedAt, 30)).toBe(false);
    expect(shouldSendIssueAlert({
      lastSentAt: '2026-03-23T14:00:00Z',
    }, checkedAt, 30)).toBe(true);
  });
});

describe('monitor missing-state normalization', () => {
  test('supports legacy numeric state entries', () => {
    expect(normalizeMissingSinceEntry(12345)).toEqual([12345]);
  });

  test('supports array state entries and drops invalid values', () => {
    expect(normalizeMissingSinceEntry([300, '200', null, 'bad', 100])).toEqual([100, 200, 300]);
  });

  test('drops stale and future missing-state timestamps when bounds are provided', () => {
    const nowMs = Date.UTC(2026, 4, 14, 19, 45, 0);
    expect(normalizeMissingSinceEntry([
      nowMs - (25 * 60 * 1000),
      nowMs - (5 * 60 * 1000),
      nowMs + (1 * 60 * 1000),
    ], {
      nowMs,
      maxAgeMs: 20 * 60 * 1000,
    })).toEqual([nowMs - (5 * 60 * 1000)]);
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

  test('resets impossible stale missing durations instead of reporting multi-day values', () => {
    const nowMs = Date.UTC(2026, 4, 14, 19, 45, 0);
    const expectedByRoute = new Map([['7', 2]]);
    const trackingByRoute = new Map([['7', 1]]);
    const prevState = {
      '7': [nowMs - (50 * 24 * 60 * 60 * 1000)],
    };

    const result = buildRouteReport(
      expectedByRoute,
      trackingByRoute,
      prevState,
      nowMs,
      20 * 60 * 1000,
      { maxMissingStateAgeMs: 4 * 60 * 60 * 1000 }
    );

    expect(result.totalMissing).toBe(0);
    expect(result.totalMonitoring).toBe(1);
    expect(result.newState['7']).toEqual([nowMs]);
    expect(result.rows[0]).toEqual(expect.objectContaining({
      routeId: '7',
      duration: '0 min',
      confirmedMissing: 0,
      monitoringMissing: 1,
    }));
  });
});

describe('possible service mismatch detection', () => {
  test('flags near-empty live service as a possible calendar mismatch', () => {
    const result = getPossibleServiceMismatchContext(12, 1, [
      { routeId: '2', expected: 3, tracking: 0, missing: 3 },
      { routeId: '8A', expected: 5, tracking: 1, missing: 4 },
    ]);

    expect(result).toEqual(expect.objectContaining({
      code: 'POSSIBLE_SERVICE_CALENDAR_MISMATCH',
      kind: 'possible_service_calendar_mismatch',
      severity: 'Warning',
      expectedCount: 12,
      trackingCount: 1,
      missingCount: 11,
    }));
    expect(result.details).toContain('holidays or other special service days');
  });

  test('does not flag mismatch when enough buses are still reporting', () => {
    expect(getPossibleServiceMismatchContext(12, 4, [])).toBeNull();
    expect(getPossibleServiceMismatchContext(4, 0, [])).toBeNull();
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
