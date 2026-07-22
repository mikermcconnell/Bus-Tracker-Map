import { describe, expect, test } from 'vitest';
import freshnessModule from '../shared/feed-freshness.js';

const { assessVehicleFeedFreshness } = freshnessModule;
const NOW = Date.parse('2026-07-22T15:30:00Z');

function seconds(iso) {
  return Date.parse(iso) / 1000;
}

describe('vehicle feed freshness', () => {
  test('labels recently reported vehicle positions live', () => {
    const result = assessVehicleFeedFreshness({
      feed_timestamp: seconds('2026-07-22T15:29:30Z'),
      vehicles: [{ last_reported: seconds('2026-07-22T15:29:20Z') }],
    }, { nowMs: NOW });

    expect(result).toMatchObject({
      feed_status: 'live',
      status_reason: 'fresh',
      data_age_seconds: 40,
    });
  });

  test('labels a temporarily lagging feed delayed', () => {
    const result = assessVehicleFeedFreshness({
      feed_timestamp: seconds('2026-07-22T15:24:00Z'),
      vehicles: [{ last_reported: seconds('2026-07-22T15:24:00Z') }],
    }, { nowMs: NOW });

    expect(result).toMatchObject({
      feed_status: 'delayed',
      status_reason: 'delayed',
      data_age_seconds: 360,
    });
  });

  test('labels a frozen HTTP 200 payload offline using vehicle timestamps', () => {
    const result = assessVehicleFeedFreshness({
      feed_timestamp: seconds('2026-07-22T15:29:50Z'),
      vehicles: [
        { last_reported: seconds('2026-07-22T13:56:10Z') },
        { last_reported: seconds('2026-07-22T13:56:01Z') },
      ],
    }, { nowMs: NOW });

    expect(result.feed_status).toBe('offline');
    expect(result.status_reason).toBe('stale');
    expect(result.latest_data_timestamp).toBe(seconds('2026-07-22T13:56:10Z'));
  });

  test('uses a current feed header when the valid payload has no buses', () => {
    const result = assessVehicleFeedFreshness({
      feed_timestamp: seconds('2026-07-22T15:29:40Z'),
      vehicles: [],
    }, { nowMs: NOW });

    expect(result.feed_status).toBe('live');
    expect(result.data_age_seconds).toBe(20);
  });

  test('labels failed, invalid, and unconfigured feeds offline', () => {
    expect(assessVehicleFeedFreshness(
      { vehicles: [], fetch_error: true },
      { nowMs: NOW }
    ).status_reason).toBe('fetch_failed');
    expect(assessVehicleFeedFreshness(null, { nowMs: NOW }).status_reason).toBe('invalid_payload');
    expect(assessVehicleFeedFreshness(
      { vehicles: [] },
      { nowMs: NOW, configured: false }
    ).status_reason).toBe('feed_not_configured');
  });
});
