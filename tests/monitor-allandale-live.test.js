import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';
import allandaleModule from '../monitor/allandale-live.js';

const {
  advanceState,
  endpointFailure,
  evaluatePayload,
  fetchPayload,
  loadState,
  saveState,
} = allandaleModule;

function barrieRow(overrides = {}) {
  return {
    agency_id: 'barrie-transit',
    trip_id: 'static-trip',
    prediction_trip_id: 'realtime-trip',
    departure_source: 'estimated',
    prediction_match_type: 'fallback',
    ...overrides,
  };
}

function payload(rows, source = {}) {
  return {
    departures: rows,
    sources: {
      barrie_transit: {
        realtime_status: 'live',
        status_reason: 'fresh_feed',
        latest_data_timestamp: 1788192494000,
        ...source,
      },
    },
  };
}

describe('Allandale live-data evaluation', () => {
  test('detects the current fresh-feed static/realtime trip mismatch', () => {
    const result = evaluatePayload(payload([
      barrieRow({ trip_id: 'static-1', prediction_trip_id: 'rt-1' }),
      barrieRow({ trip_id: 'static-2', prediction_trip_id: 'rt-2' }),
      barrieRow({ trip_id: 'static-3', prediction_trip_id: 'rt-3' }),
    ]));

    expect(result).toEqual(expect.objectContaining({
      status: 'degraded',
      reason: 'static_realtime_trip_mismatch',
      sourceStatus: 'live',
      sourceTimestamp: 1788192494,
    }));
    expect(result.counts).toEqual(expect.objectContaining({
      departures: 3,
      exact: 0,
      fallback: 3,
      estimated: 3,
    }));
    expect(result.tripPairs[0]).toBe('static-1 -> rt-1');
  });

  test('is healthy when an exact Barrie live match is available', () => {
    const result = evaluatePayload(payload([
      barrieRow({
        trip_id: 'same-trip',
        prediction_trip_id: 'same-trip',
        departure_source: 'realtime',
        prediction_match_type: 'exact',
      }),
      barrieRow(),
    ]));

    expect(result.status).toBe('healthy');
    expect(result.counts.exact).toBe(1);
  });

  test('detects a stale or offline Barrie realtime source', () => {
    const result = evaluatePayload(payload([
      barrieRow(),
      barrieRow(),
    ], {
      realtime_status: 'offline',
      status_reason: 'stale_feed',
    }));

    expect(result).toEqual(expect.objectContaining({
      status: 'degraded',
      reason: 'realtime_source_unavailable',
      sourceStatus: 'offline',
    }));
  });

  test('does not evaluate another agency or a single Barrie departure', () => {
    const result = evaluatePayload(payload([
      barrieRow(),
      { agency_id: 'simcoe-linx', departure_source: 'realtime' },
    ]));

    expect(result).toEqual(expect.objectContaining({
      status: 'neutral',
      reason: 'insufficient_departures',
    }));
    expect(result.counts.departures).toBe(1);
  });

  test('turns endpoint failures into a degraded observation', () => {
    expect(endpointFailure(new Error('connection refused'))).toEqual(expect.objectContaining({
      status: 'degraded',
      reason: 'departures_endpoint_unreachable',
      details: 'connection refused',
    }));
  });
});

describe('Allandale live-data incident state', () => {
  const degraded = evaluatePayload(payload([barrieRow(), barrieRow()]));
  const healthy = evaluatePayload(payload([
    barrieRow({ departure_source: 'realtime', prediction_match_type: 'exact' }),
    barrieRow(),
  ]));
  const neutral = evaluatePayload(payload([barrieRow()]));
  const activeState = {
    status: 'active',
    firstDetectedAt: '2026-08-31T12:00:00.000Z',
    lastObservedAt: '2026-08-31T13:00:00.000Z',
    alertedAt: '2026-08-31T13:00:00.000Z',
    recoveryChecks: 0,
    lastEvaluation: degraded,
  };

  test('waits 60 continuous minutes before one alert', () => {
    let current = advanceState(null, degraded, new Date('2026-08-31T12:00:00Z'), {
      alertAfterMinutes: 60,
    });
    expect(current.action).toBeNull();
    for (let minute = 10; minute < 60; minute += 10) {
      current = advanceState(current.state, degraded, new Date(`2026-08-31T12:${minute}:00Z`), {
        alertAfterMinutes: 60,
      });
      expect(current.action).toBeNull();
    }
    const due = advanceState(current.state, degraded, new Date('2026-08-31T13:00:00Z'), {
      alertAfterMinutes: 60,
    });
    const stillActive = advanceState(due.state, degraded, new Date('2026-08-31T14:00:00Z'), {
      alertAfterMinutes: 60,
    });

    expect(due.action).toEqual(expect.objectContaining({ kind: 'alert', durationMinutes: 60 }));
    expect(due.state.status).toBe('active');
    expect(stillActive.action).toBeNull();
  });

  test('resets a pending incident after an evaluable healthy check', () => {
    const pending = advanceState(null, degraded, new Date('2026-08-31T12:00:00Z'));
    const result = advanceState(pending.state, healthy, new Date('2026-08-31T12:30:00Z'));

    expect(result.action).toBeNull();
    expect(result.state.status).toBe('idle');
  });

  test('requires two healthy checks before one recovery email', () => {
    const firstGood = advanceState(activeState, healthy, new Date('2026-08-31T13:10:00Z'), {
      recoveryChecks: 2,
    });
    const recovered = advanceState(firstGood.state, healthy, new Date('2026-08-31T13:20:00Z'), {
      recoveryChecks: 2,
    });

    expect(firstGood.action).toBeNull();
    expect(firstGood.state.recoveryChecks).toBe(1);
    expect(recovered.action).toEqual(expect.objectContaining({ kind: 'recovery' }));
    expect(recovered.state.status).toBe('idle');
  });

  test('does not treat an insufficient sample as recovery', () => {
    const result = advanceState(activeState, neutral, new Date('2026-08-31T13:10:00Z'));

    expect(result.action).toBeNull();
    expect(result.state.status).toBe('active');
    expect(result.state.recoveryChecks).toBe(0);
  });

  test('persists pending timing across process restarts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'allandale-live-'));
    const stateFile = path.join(directory, 'state.json');
    let pending = advanceState(null, degraded, new Date('2026-08-31T12:00:00Z'));
    for (let minute = 10; minute <= 50; minute += 10) {
      pending = advanceState(pending.state, degraded, new Date(`2026-08-31T12:${minute}:00Z`));
    }

    saveState(stateFile, pending.state);
    const reloaded = loadState(stateFile);
    const due = advanceState(reloaded, degraded, new Date('2026-08-31T13:00:00Z'));

    expect(due.action).toEqual(expect.objectContaining({ kind: 'alert' }));
  });

  test('does not bridge an unobserved monitoring gap into the 60-minute timer', () => {
    const first = advanceState(null, degraded, new Date('2026-08-31T12:00:00Z'));
    const afterGap = advanceState(first.state, degraded, new Date('2026-08-31T13:00:00Z'));

    expect(afterGap.action).toBeNull();
    expect(afterGap.state.firstDetectedAt).toBe('2026-08-31T13:00:00.000Z');
  });
});

describe('Allandale departures fetch', () => {
  test('requests fresh production data and parses JSON', async () => {
    const fetchImpl = async (url, options) => {
      expect(url).toBe('https://example.com/api/departures');
      expect(options.headers['Cache-Control']).toBe('no-cache');
      return { ok: true, json: async () => ({ departures: [] }) };
    };

    await expect(fetchPayload('https://example.com/api/departures', fetchImpl))
      .resolves.toEqual({ departures: [] });
  });

  test('rejects non-success responses', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    await expect(fetchPayload('https://example.com/api/departures', fetchImpl))
      .rejects.toThrow('HTTP 503');
  });
});
