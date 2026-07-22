import { describe, expect, test } from 'vitest';
import freshnessModule from '../shared/feed-freshness.js';

const { assessVehicleFeedFreshness, selectVehiclesForDisplay } = freshnessModule;
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

  test('does not label a current but empty feed live', () => {
    const result = assessVehicleFeedFreshness({
      feed_timestamp: seconds('2026-07-22T15:29:40Z'),
      vehicles: [],
    }, { nowMs: NOW });

    expect(result.feed_status).toBe('empty');
    expect(result.status_reason).toBe('no_vehicles');
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

  test('shows only individually current vehicles while a feed remains available', () => {
    const payload = {
      vehicles: [
        { id: 'fresh', last_reported: seconds('2026-07-22T15:29:30Z') },
        { id: 'stale', last_reported: seconds('2026-07-22T14:00:00Z') },
        { id: 'unknown', last_reported: null },
      ],
    };
    const visible = selectVehiclesForDisplay(payload, { feed_status: 'live' }, {
      nowMs: NOW,
      maxAgeMs: 15 * 60 * 1000,
    });

    expect(visible.map((vehicle) => vehicle.id)).toEqual(['fresh']);
  });

  test('shows no vehicles for offline or empty feed states', () => {
    const payload = {
      vehicles: [{ id: 'bus-1', last_reported: seconds('2026-07-22T15:29:30Z') }],
    };

    expect(selectVehiclesForDisplay(payload, { feed_status: 'offline' }, { nowMs: NOW })).toEqual([]);
    expect(selectVehiclesForDisplay(payload, { feed_status: 'empty' }, { nowMs: NOW })).toEqual([]);
  });
});
