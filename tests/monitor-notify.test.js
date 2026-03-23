import { describe, expect, test } from 'vitest';
import notifyModule from '../monitor/notify.js';

const {
  escapeHtml,
  buildAlertSubject,
  buildSystemSubject,
  buildSystemMessage,
  missingSummary,
  buildHtml,
  buildPlainText,
} = notifyModule;

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
    expect(subject).toBe('Barrie Transit GPS Alert: 1 bus out of 10 is not sending live updates');
  });

  test('uses plural "buses" for multiple missing', () => {
    const subject = buildAlertSubject({ totalMissing: 3, totalExpected: 10 });
    expect(subject).toBe('Barrie Transit GPS Alert: 3 buses out of 10 are not sending live updates');
  });
});

describe('buildSystemSubject', () => {
  test('returns stale subject for down', () => {
    expect(buildSystemSubject({ kind: 'down' })).toBe(
      'Barrie Transit GPS Alert: Monitoring is overdue'
    );
  });

  test('returns vehicle feed stale subject', () => {
    expect(buildSystemSubject({ kind: 'vehicle_feed_stale' })).toBe(
      'Barrie Transit GPS Alert: Live bus locations are out of date'
    );
  });

  test('returns recovered subject', () => {
    expect(buildSystemSubject({ kind: 'recovered' })).toBe(
      'Barrie Transit GPS Alert: Monitoring is back to normal'
    );
  });
});

describe('missingSummary', () => {
  test('singular when 1 bus missing', () => {
    const result = missingSummary({ totalMissing: 1, totalExpected: 8 });
    expect(result).toBe('1 bus out of 8 is not sending live updates');
  });

  test('plural when multiple buses missing', () => {
    const result = missingSummary({ totalMissing: 4, totalExpected: 12 });
    expect(result).toBe('4 buses out of 12 are not sending live updates');
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
    expect(html).toContain('2 buses out of 5 are not sending live updates');
  });

  test('uses the GPS alert heading', () => {
    const html = buildHtml(sampleReport);
    expect(html).toContain('BARRIE TRANSIT GPS ALERT');
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
    expect(text).toContain('2 buses out of 5 are not sending live updates');
  });

  test('contains disclaimer', () => {
    const text = buildPlainText(sampleReport);
    expect(text).toContain('Some change is normal when buses are between trips or drivers change.');
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
});
