import { describe, expect, test } from 'vitest';
import notifyModule from '../monitor/notify.js';

const {
  escapeHtml,
  buildAlertSubject,
  buildTaggedSubject,
  buildSystemSubject,
  buildSystemMessage,
  buildGtfsStaticChangeMessage,
  buildHealthCheckSubject,
  buildHealthCheckMessage,
  formatIsoTimestamp,
  missingSummary,
  buildHtml,
  buildPlainText,
} = notifyModule;

describe('buildGtfsStaticChangeMessage', () => {
  test('creates an actionable manual re-upload alert', () => {
    const { subject, text, html } = buildGtfsStaticChangeMessage({
      url: 'https://www.myridebarrie.ca/gtfs/google_transit.zip',
      previous: { feedVersion: '20260628' },
      current: {
        feedVersion: '20260901',
        feedStartDate: '20260901',
        feedEndDate: '20261231',
        hasTransfersFile: false,
        matchingAllandaleTransfers: 0,
        expectedAllandaleTransfers: 4,
        checkedAt: '2026-08-15T14:00:00Z',
      },
    });

    expect(subject).toContain('Re-upload required');
    expect(subject).toContain('20260901');
    expect(text).toContain('transfers.txt is missing');
    expect(text).toContain('Do not re-upload the previous patched ZIP');
    expect(html).toContain('BARRIE TRANSIT GTFS STATIC CHANGED');
  });
});

describe('escapeHtml', () => {
  test('escapes all HTML special characters', () => {
    expect(escapeHtml('a & b < c > d "e" \'f\'')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;'
    );
  });

  test('returns empty string for non-string input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('');
  });

  test('passes through plain text unchanged', () => {
    expect(escapeHtml('No special chars here')).toBe('No special chars here');
  });
});

describe('buildAlertSubject', () => {
  test('uses singular "bus" for 1 missing', () => {
    const subject = buildAlertSubject({ totalMissing: 1, totalExpected: 10 });
    expect(subject).toBe('Barrie Transit GPS Alert | BUSES_NOT_REPORTING | 1 of 10 expected buses is not reporting live GPS');
  });

  test('uses plural "buses" for multiple missing', () => {
    const subject = buildAlertSubject({ totalMissing: 3, totalExpected: 10 });
    expect(subject).toBe('Barrie Transit GPS Alert | BUSES_NOT_REPORTING | 3 of 10 expected buses are not reporting live GPS');
  });
});

describe('buildTaggedSubject', () => {
  test('uses a stable tagged pattern for forwarding rules', () => {
    expect(buildTaggedSubject('VEHICLE_FEED_OUT_OF_SYNC', 'Trip updates current, live vehicle locations delayed')).toBe(
      'Barrie Transit GPS Alert | VEHICLE_FEED_OUT_OF_SYNC | Trip updates current, live vehicle locations delayed'
    );
  });
});

describe('buildSystemSubject', () => {
  test('returns stale subject for down', () => {
    expect(buildSystemSubject({ kind: 'down' })).toBe(
      'Barrie Transit Watchdog Alert | MONITOR_WATCHDOG_DOWN | Monitoring check overdue'
    );
  });

  test('returns vehicle feed stale subject', () => {
    expect(buildSystemSubject({ kind: 'vehicle_feed_stale', code: 'VEHICLE_FEED_STALE' })).toBe(
      'Barrie Transit GPS Alert | VEHICLE_FEED_STALE | Live vehicle location feed delayed'
    );
  });

  test('returns no recent GPS subject', () => {
    expect(buildSystemSubject({ kind: 'no_recent_vehicle_gps', code: 'NO_RECENT_VEHICLE_GPS' })).toBe(
      'Barrie Transit GPS Alert | NO_RECENT_VEHICLE_GPS | No expected buses have recent GPS'
    );
  });

  test('returns recovered subject', () => {
    expect(buildSystemSubject({ kind: 'recovered', code: 'SYSTEM_RECOVERED' })).toBe(
      'Barrie Transit Watchdog Alert | SYSTEM_RECOVERED | Monitoring restored'
    );
  });

  test('returns service mismatch subject', () => {
    expect(buildSystemSubject({
      kind: 'possible_service_calendar_mismatch',
      code: 'POSSIBLE_SERVICE_CALENDAR_MISMATCH',
    })).toBe(
      'Barrie Transit GPS Alert | POSSIBLE_SERVICE_CALENDAR_MISMATCH | Expected service may not match holiday or special-day service'
    );
  });
});

describe('buildHealthCheckMessage', () => {
  test('uses a subject that does not match GPS alert rules', () => {
    const subject = buildHealthCheckSubject({ status: 'ok' });

    expect(subject).toBe('Barrie Transit Monitor Daily Check-In | Working');
    expect(subject).not.toContain('Barrie Transit GPS Alert');
  });

  test('calls out disabled workflow state in the daily check-in body', () => {
    const { subject, text, html } = buildHealthCheckMessage({
      status: 'attention',
      checkedAt: new Date('2026-06-23T14:15:00Z'),
      summary: 'The GitHub manual backup workflow is disabled_manually.',
      rows: [
        ['Workflow state', 'disabled_manually'],
        ['Disable reason visible here', 'GitHub reports this workflow was manually disabled.'],
      ],
    });

    expect(subject).toBe('Barrie Transit Monitor Daily Check-In | Attention needed');
    expect(text).toContain('Workflow state: disabled_manually');
    expect(text).toContain('GitHub reports this workflow was manually disabled.');
    expect(html).toContain('BARRIE TRANSIT MONITOR DAILY CHECK-IN');
    expect(subject).not.toContain('Barrie Transit GPS Alert');
  });
});

describe('formatIsoTimestamp', () => {
  test('formats feed timestamps in Toronto time for emails', () => {
    const result = formatIsoTimestamp(Date.parse('2026-05-28T15:05:16Z') / 1000);

    expect(result).toContain('11:05');
    expect(result).toContain('EDT');
    expect(result).not.toContain('T15:05:16.000Z');
  });
});

describe('missingSummary', () => {
  test('singular when 1 bus missing', () => {
    const result = missingSummary({ totalMissing: 1, totalExpected: 8 });
    expect(result).toBe('1 of 8 expected buses is not reporting live GPS');
  });

  test('plural when multiple buses missing', () => {
    const result = missingSummary({ totalMissing: 4, totalExpected: 12 });
    expect(result).toBe('4 of 12 expected buses are not reporting live GPS');
  });
});

const sampleReport = {
  rows: [
    { routeId: '1', expected: 2, tracking: 2, missing: 0, duration: null },
    { routeId: '3', expected: 3, tracking: 1, missing: 2, duration: '25 min' },
  ],
  totalExpected: 5,
  totalTracking: 3,
  totalMissing: 2,
  checkedAt: new Date('2026-02-25T15:00:00Z'),
};

const mixedThresholdReport = {
  rows: [
    {
      routeId: '8',
      expected: 3,
      tracking: 1,
      missing: 2,
      duration: '25 min oldest (+1 monitoring)',
      confirmed: true,
      confirmedMissing: 1,
      monitoringMissing: 1,
    },
  ],
  totalExpected: 3,
  totalTracking: 1,
  totalMissing: 1,
  totalMonitoring: 1,
  checkedAt: new Date('2026-02-25T15:00:00Z'),
};

describe('buildHtml', () => {
  test('contains route data in table', () => {
    const html = buildHtml(sampleReport);
    expect(html).toContain('Route');
    expect(html).toContain('Expected');
    expect(html).toContain('TOTAL');
    expect(html).toContain('25 min');
  });

  test('contains missing summary', () => {
    const html = buildHtml(sampleReport);
    expect(html).toContain('2 of 5 expected buses are not reporting live GPS');
  });

  test('uses the GPS alert heading', () => {
    const html = buildHtml(sampleReport);
    expect(html).toContain('BARRIE TRANSIT GPS ALERT');
  });

  test('does not show monitoring state in the email table', () => {
    const html = buildHtml(mixedThresholdReport);
    expect(html).toContain('1 of 3 expected buses is not reporting live GPS');
    expect(html).toContain('25 min');
    expect(html).not.toContain('being monitored');
    expect(html).not.toContain('monitoring');
    expect(html).not.toContain('confirmed');
    expect(html).not.toContain('+1');
  });
});

describe('buildPlainText', () => {
  test('contains header and route data', () => {
    const text = buildPlainText(sampleReport);
    expect(text).toContain('BARRIE TRANSIT GPS ALERT');
    expect(text).toContain('TOTAL');
    expect(text).toContain('25 min');
  });

  test('contains missing summary', () => {
    const text = buildPlainText(sampleReport);
    expect(text).toContain('2 of 5 expected buses are not reporting live GPS');
  });

  test('contains alert explanation', () => {
    const text = buildPlainText(sampleReport);
    expect(text).toContain('How this alert works');
    expect(text).toContain('The monitor checks the live bus GPS feed every 10 minutes during service hours.');
    expect(text).toContain('2 consecutive pings, about 20 minutes');
  });

  test('plain text only reports confirmed missing buses', () => {
    const text = buildPlainText(mixedThresholdReport);
    expect(text).toContain('1 of 3 expected buses is not reporting live GPS');
    expect(text).toContain('25 min');
    expect(text).not.toContain('being monitored');
    expect(text).not.toContain('monitoring');
    expect(text).not.toContain('confirmed');
    expect(text).not.toContain('+1');
  });
});

describe('buildSystemMessage', () => {
  test('includes GPS Alert text in system subjects', () => {
    const { subject, text } = buildSystemMessage({
      kind: 'vehicle_feed_stale',
      code: 'VEHICLE_FEED_STALE',
      checkedAt: new Date('2026-03-23T13:40:00Z'),
      feedUrl: 'https://example.com/GTFS_VehiclePositions.pb',
      feedTimestamp: 1774225732,
      feedAgeMin: 789,
      lastModified: 'Mon, 23 Mar 2026 00:30:26 GMT',
      details: 'Vehicle positions feed stopped updating.',
    });
    expect(subject).toContain('Barrie Transit GPS Alert');
    expect(text).toContain('Alert ID: VEHICLE_FEED_STALE');
    expect(text).toContain('How old it is: 789 minutes');
  });

  test('uses actionable wording for out-of-sync alerts', () => {
    const { subject, text } = buildSystemMessage({
      kind: 'vehicle_feed_out_of_sync',
      code: 'VEHICLE_FEED_OUT_OF_SYNC',
      checkedAt: new Date('2026-03-23T18:21:00Z'),
      feedUrl: 'https://example.com/GTFS_VehiclePositions.pb',
      feedTimestamp: 1774225732,
      feedAgeMin: 1073,
      tripUpdatesUrl: 'https://example.com/GTFS_TripUpdates.pb',
      tripUpdatesTimestamp: 1774290062,
      tripUpdatesAgeMin: 0,
      details: 'The vehicle positions feed is stale while the trip updates feed remains current.',
    });

    expect(subject).toBe(
      'Barrie Transit GPS Alert | VEHICLE_FEED_OUT_OF_SYNC | Trip updates current, live vehicle locations delayed'
    );
    expect(text).toContain('What is going wrong: The vehicle positions feed is stale even though the trip updates feed is still refreshing.');
    expect(text).toContain('Likely cause: The AVL or GPS source may not be reaching the vehicle position publisher');
    expect(text).toContain('Recommended action: Check whether fresh AVL or GPS data is reaching the publisher');
  });

  test('describes holiday mismatch alerts in plain language', () => {
    const { subject, text } = buildSystemMessage({
      kind: 'possible_service_calendar_mismatch',
      code: 'POSSIBLE_SERVICE_CALENDAR_MISMATCH',
      checkedAt: new Date('2026-04-03T14:10:00Z'),
      expectedCount: 31,
      trackingCount: 0,
      missingCount: 31,
      details: 'The monitor expected 31 buses, but no buses reported live GPS.',
    });

    expect(subject).toContain('POSSIBLE_SERVICE_CALENDAR_MISMATCH');
    expect(text).toContain('Summary: Expected service may not match the actual holiday or special-day service pattern.');
    expect(text).toContain('Recommended action: Check whether today has holiday or special service');
  });

  test('describes no recent GPS alerts in plain language', () => {
    const { subject, text } = buildSystemMessage({
      kind: 'no_recent_vehicle_gps',
      code: 'NO_RECENT_VEHICLE_GPS',
      checkedAt: new Date('2026-05-28T15:30:00Z'),
      expectedCount: 30,
      trackingCount: 0,
      vehicleCount: 31,
      latestVehicleAgeMin: 10,
      details: 'Buses are expected, but none have reported GPS within the recent window.',
    });

    expect(subject).toBe(
      'Barrie Transit GPS Alert | NO_RECENT_VEHICLE_GPS | No expected buses have recent GPS'
    );
    expect(text).toContain('Summary: Buses are expected, but no buses have recent GPS updates.');
    expect(text).toContain('Recommended action: Check the live GPS feed first');
  });
});
