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
    expect(subject).toBe('Barrie Transit GPS Alert: 1/10 bus not tracking');
  });

  test('uses plural "buses" for multiple missing', () => {
    const subject = buildAlertSubject({ totalMissing: 3, totalExpected: 10 });
    expect(subject).toBe('Barrie Transit GPS Alert: 3/10 buses not tracking');
  });
});

describe('buildSystemSubject', () => {
  test('returns stale subject for down', () => {
    expect(buildSystemSubject({ kind: 'down' })).toBe(
      'Barrie Transit GPS Alert: Reporting pipeline stale'
    );
  });

  test('returns vehicle feed stale subject', () => {
    expect(buildSystemSubject({ kind: 'vehicle_feed_stale' })).toBe(
      'Barrie Transit GPS Alert: Vehicle positions feed stale'
    );
  });

  test('returns recovered subject', () => {
    expect(buildSystemSubject({ kind: 'recovered' })).toBe(
      'Barrie Transit GPS Alert: Monitor reporting recovered'
    );
  });
});

describe('missingSummary', () => {
  test('singular when 1 bus missing', () => {
    const result = missingSummary({ totalMissing: 1, totalExpected: 8 });
    expect(result).toBe('1 of 8 expected bus is not reporting GPS data');
  });

  test('plural when multiple buses missing', () => {
    const result = missingSummary({ totalMissing: 4, totalExpected: 12 });
    expect(result).toBe('4 of 12 expected buses are not reporting GPS data');
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
    expect(html).toContain('2 of 5 expected buses are not reporting GPS data');
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
    expect(text).toContain('2 of 5 expected buses are not reporting GPS data');
  });

  test('contains disclaimer', () => {
    const text = buildPlainText(sampleReport);
    expect(text).toContain('Some variance is normal');
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
    expect(text).toContain('Alert code: VEHICLE_FEED_STALE');
    expect(text).toContain('Feed age: 789 minutes');
  });
});
