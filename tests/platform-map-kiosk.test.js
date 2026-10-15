import { describe, expect, test } from 'vitest';
import {
  extractBuildId,
  isNewBuild,
  isNightlyReloadDue,
  isPollStalled,
} from '../frontend/src/platform-map/kiosk.js';

describe('platform map kiosk recovery rules', () => {
  test('reloads once in the early-morning window after at least an hour of uptime', () => {
    const at0335 = Date.parse('2026-10-09T07:35:00Z'); // 3:35 AM Toronto (EDT)
    const longAgo = at0335 - 6 * 60 * 60 * 1000;
    expect(isNightlyReloadDue(at0335, longAgo)).toBe(true);
    // A page that just reloaded inside the window must not reload again.
    expect(isNightlyReloadDue(at0335, at0335 - 5 * 60 * 1000)).toBe(false);
    expect(isNightlyReloadDue(Date.parse('2026-10-09T07:25:00Z'), longAgo)).toBe(false);
    expect(isNightlyReloadDue(Date.parse('2026-10-09T08:05:00Z'), longAgo)).toBe(false);
  });

  test('uses Toronto time across the daylight-saving change', () => {
    const at0340Est = Date.parse('2026-11-02T08:40:00Z'); // 3:40 AM Toronto (EST)
    expect(isNightlyReloadDue(at0340Est, at0340Est - 24 * 60 * 60 * 1000)).toBe(true);
  });

  test('detects a newly deployed build from the served page', () => {
    const html = '<head><meta name="app-build-id" content="2026-10-09T16:00:00.000Z"></head>';
    expect(extractBuildId(html)).toBe('2026-10-09T16:00:00.000Z');
    expect(isNewBuild('2026-10-01T00:00:00.000Z', html)).toBe(true);
    expect(isNewBuild('2026-10-09T16:00:00.000Z', html)).toBe(false);
    // An error page without a build id must never trigger a reload.
    expect(isNewBuild('2026-10-01T00:00:00.000Z', '<h1>502 Bad Gateway</h1>')).toBe(false);
    expect(isNewBuild('', html)).toBe(false);
  });

  test('treats the poll loop as stalled only well past its interval', () => {
    const now = 1_000_000;
    expect(isPollStalled(now - 30 * 1000, now, 10000)).toBe(false);
    expect(isPollStalled(now - 61 * 1000, now, 10000)).toBe(true);
    expect(isPollStalled(now - 61 * 1000, now, 30000)).toBe(false);
  });
});
