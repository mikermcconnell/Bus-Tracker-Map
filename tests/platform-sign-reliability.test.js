import { afterEach, describe, expect, test, vi } from 'vitest';
import departures from '../server/departures.js';
import tripUpdates from '../server/gtfs-trip-updates.js';
import platform from '../server/platform-departures.js';
import { displayPayload, formatDepartureText, requestJson, validPayload, readCachedDepartures } from '../frontend/src/platform-departures/main.js';

const now = Date.parse('2026-10-02T16:01:01Z');
const serviceDate = '20261002';
const scheduledAt = now / 1000 - 61;
const calendars = { weekday: {
  start_date: '20260101', end_date: '20261231',
  monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
} };

function metadata() {
  return {
    terminal_stop_ids: ['SCSTOP210'], service_calendars: calendars,
    trips: { outbound: { route_id: '2', service_id: 'weekday', headsign: 'Wasaga Beach',
      terminal_stops: [{ stop_id: 'SCSTOP210', departure_time: '12:00:00', stop_sequence: 1, is_departure: true }],
    } },
  };
}

function scheduledRow(date = serviceDate) {
  return { id: `row-${date}`, agency_id: 'simcoe-linx', trip_id: 'outbound', service_date: date,
    route_id: '2', route_label: '2', platform: '2', stop_id: 'SCSTOP210', destination: 'Wasaga Beach',
    scheduled_departure_time: scheduledAt, expected_departure_time: scheduledAt, departure_source: 'scheduled' };
}

function parsedFeed(stopTimeUpdate = [], changes = {}) {
  return {
    feed_timestamp: now / 1000,
    updates: tripUpdates.parseTripUpdates({ entity: [{ tripUpdate: {
      trip: { tripId: 'outbound', routeId: '2', startDate: serviceDate, ...changes }, stopTimeUpdate,
    } }] }, ['SCSTOP210']),
  };
}

function vehicle() {
  return { id: 'bus', agency_id: 'simcoe-linx', trip_id: 'outbound', start_date: serviceDate,
    lat: 44.37, lon: -79.69, last_reported: now / 1000 };
}

function payload() {
  return { stop_code: '9002', platform_display: '02', generated_at: now, status: 'ok', horizon_hours: 72,
    departures: [{ departure_source: 'realtime', departure_time: now / 1000 + 1200,
      scheduled_departure_time: now / 1000 + 600, live_valid_until: now + 120000,
      prediction_timestamp: now, trip_id: 'outbound', route_label: '2' }] };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('platform sign backend reliability', () => {
  test('retains a delayed departure through collection, merging, evidence, and platform selection', async () => {
    const get = departures.createDeparturesService({
      metadata: { simcoe_linx: metadata() }, urls: { linx: 'fixture' },
      fetchTripUpdates: async () => parsedFeed([{ stopId: 'SCSTOP210', departure: { time: now / 1000 + 600 } }]),
      fetchVehiclePayload: async () => ({ vehicles: [vehicle()] }),
    });
    const result = platform.buildPlatformDeparturePayload({ stopCode: '9002',
      terminalPayload: await get({ now, platform: '2' }) });
    expect(result.departures).toHaveLength(1);
    expect(result.departures[0]).toMatchObject({ departure_source: 'realtime', departure_time: now / 1000 + 600 });
    expect(result.departures[0].live_valid_until).toBe(now + 120000);
  });

  test.each([[], undefined])('honours whole-trip cancellation without stop rows: %s', (stops) => {
    const rt = parsedFeed(stops, { scheduleRelationship: 3 });
    expect(rt.updates[0]).toMatchObject({ trip_level: true, canceled: true });
    const result = departures.mergeTripUpdates([scheduledRow(), scheduledRow('20261003')], rt, now, 120000, 900000);
    expect(result.departures.map((row) => row.service_date)).toEqual(['20261003']);
  });

  test('undated cancellations do not remove the next service date in the 72-hour window', () => {
    const rt = parsedFeed([], { scheduleRelationship: 3, startDate: undefined });
    expect(departures.mergeTripUpdates([scheduledRow(), scheduledRow('20261005')], rt, now, 120000, 900000)
      .departures.map((row) => row.service_date)).toEqual(['20261005']);
  });

  test.each([{ scheduleRelationship: 2 }, {}])('does not invent a prediction from missing data: %s', (stop) => {
    const rt = parsedFeed([{ stopId: 'SCSTOP210', ...stop }]);
    const merged = departures.mergeTripUpdates([scheduledRow()], rt, now, 120000, 900000);
    expect(departures.applyVehicleEvidence(merged.departures, { vehicles: [vehicle()] }, now, 120000)[0]
      .departure_source).toBe('scheduled');
  });

  test('explicit zero-delay prediction remains valid', () => {
    const merged = departures.mergeTripUpdates([scheduledRow()], parsedFeed([
      { stopId: 'SCSTOP210', departure: { delay: 0 } },
    ]), now, 120000, 900000);
    expect(departures.applyVehicleEvidence(merged.departures, { vehicles: [vehicle()] }, now, 120000)[0]
      .departure_source).toBe('realtime');
  });

  test('valid skipped-stop updates remove the departure', () => {
    const result = departures.mergeTripUpdates([scheduledRow()], parsedFeed([
      { stopId: 'SCSTOP210', scheduleRelationship: 1 },
    ]), now, 120000, 900000);
    expect(result.departures).toEqual([]);
  });

  test('platform searches include the next service after a weekend and do not fetch other agencies', async () => {
    const load = vi.fn(async () => ({ feed_timestamp: 0, updates: [] }));
    const get = departures.createDeparturesService({ metadata: { simcoe_linx: metadata() },
      urls: { linx: 'linx', barrie: 'barrie', ontarioNorthland: 'northland' }, fetchTripUpdates: load });
    const result = await get({ now: Date.parse('2026-10-02T22:00:00Z'), platform: '2' });
    expect(result.horizon_hours).toBe(72);
    expect(result.departures[0].service_date).toBe('20261005');
    expect(Object.keys(result.sources)).toEqual(['simcoe_linx']);
    expect(load.mock.calls.map((call) => call[0])).toEqual(['linx']);
  });

  test.each([undefined, { ...metadata(), feed_end_date: '20261001' }, { ...metadata(), feed_start_date: '20261003' }])(
    'fails closed for missing or out-of-date platform schedule: %s', async (linx) => {
      const get = departures.createDeparturesService({ metadata: { simcoe_linx: linx, barrie_transit: metadata() } });
      await expect(get({ now, platform: '2' })).rejects.toMatchObject({ statusCode: 503 });
    });

  test('distinguishes unavailable schedules from valid empty service', () => {
    expect(platform.buildPlatformDeparturePayload({ stopCode: '9002', terminalPayload: {
      departures: [], sources: { simcoe_linx: { schedule_status: 'unavailable' } },
    } }).status).toBe('schedule_unavailable');
    expect(platform.buildPlatformDeparturePayload({ stopCode: '9002', terminalPayload: {
      departures: [], sources: { simcoe_linx: { schedule_status: 'available' } },
    } }).status).toBe('no_departures');
  });

  test('selects the earliest effective departure when a delayed bus is overtaken', () => {
    const first = { ...scheduledRow(), scheduled_departure_time: now / 1000 - 600,
      expected_departure_time: now / 1000 + 1200, departure_source: 'realtime' };
    const next = { ...scheduledRow(), id: 'next', scheduled_departure_time: now / 1000 + 600,
      expected_departure_time: now / 1000 + 600 };
    expect(departures.selectScheduledDepartures([first, next], now, 30, 72, true)[0].id).toBe('next');
  });
});

describe('platform sign frontend reliability', () => {
  test('immediately downgrades cached and failed-request LIVE data to scheduled times', () => {
    for (const state of [{ provisional: true }, { failed: true }]) {
      expect(displayPayload(payload(), now, state).departures[0]).toMatchObject({
        departure_source: 'scheduled', departure_time: now / 1000 + 600,
      });
    }
  });
  test('expires evidence even when the page continues running', () => {
    expect(displayPayload(payload(), now + 120001).departures[0].departure_source).toBe('scheduled');
    const earlyExpiry = payload(); earlyExpiry.departures[0].live_valid_until = now + 10000;
    expect(displayPayload(earlyExpiry, now + 10001).departures[0].departure_source).toBe('scheduled');
  });
  test('old rows expire and cannot regain LIVE from a recent cache save', () => {
    expect(displayPayload(payload(), now + 30 * 60000 + 1)).toMatchObject({
      status: 'data_unavailable', departures: [],
    });
  });
  test('a stale empty board is unavailable data, not confirmed absence of service', () => {
    expect(displayPayload({ ...payload(), status: 'no_departures', departures: [] }, now,
      { failed: true }).status).toBe('data_unavailable');
  });
  test('rejects corrupt cache rows and a response for a different platform', () => {
    const good = payload();
    expect(validPayload(good, '9002')).toBe(true);
    expect(validPayload({ ...good, platform_display: '03' }, '9002')).toBe(false);
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({
      saved_at: now, payload: { ...good, departures: [null] },
    }) } });
    expect(readCachedDepartures('9002', now)).toBeNull();
  });
  test('removes already-departed rows rather than retaining an unavailable countdown with LIVE', () => {
    const old = payload(); old.departures[0].departure_time = now / 1000 - 61;
    expect(displayPayload(old, now).departures).toEqual([]);
  });
  test('uses the next Toronto calendar day across the fall-back transition', () => {
    expect(formatDepartureText(Date.parse('2026-11-02T00:10:00-05:00') / 1000,
      Date.parse('2026-11-01T00:30:00-04:00'))).toBe('Departs tomorrow at 12:10 AM');
  });
  test('fetch deadline aborts a stalled request, ignores late results, and permits recovery', async () => {
    vi.useFakeTimers();
    let finishFirst; let signal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise((resolve) => { finishFirst = resolve; });
    }));
    const pending = requestJson('/api/departures');
    const timeout = expect(pending).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(15001);
    await timeout;
    expect(signal.aborted).toBe(true);
    finishFirst({ ok: true, json: async () => ({ stale: true }) });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ recovered: true }) })));
    await expect(requestJson('/api/departures')).resolves.toEqual({ recovered: true });
  });
});
