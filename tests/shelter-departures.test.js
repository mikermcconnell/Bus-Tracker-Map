import { describe, expect, test } from 'vitest';
import shelterModule from '../server/shelter-departures.js';
import {
  formatDepartureCountdown,
  parseGroupQuery,
  parseStopQuery,
  readQueryParameter,
} from '../frontend/src/shelter-departures/main.js';

const {
  DEPARTURE_STOP_GROUPS,
  buildShelterDepartures,
  normalizeDestination,
  resolveShelterGroup,
  resolveShelterStop,
} = shelterModule;

function metadataFixture() {
  return {
    time_zone: 'America/Toronto',
    service_calendars: {
      weekday: {
        start_date: '20260801', end_date: '20261031',
        sunday: false, monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: false,
      },
    },
    service_exceptions: {},
    stops: {
      '1': { id: '1', code: '1', name: 'Downtown Hub' },
      '2': { id: '2', code: '2', name: 'Downtown Hub' },
    },
    stop_ids_by_code: { '1': '1', '2': '2' },
    routes: {
      '100': { short_name: '100', long_name: 'Red Express' },
      '8A': { short_name: '8A', long_name: 'RVH/Yonge' },
    },
    trips: {
      red: {
        route_id: '100', service_id: 'weekday', direction_id: '0',
        headsign: 'Red Express to Downtown Barrie Terminal',
      },
      rvh: {
        route_id: '8A', service_id: 'weekday', direction_id: '0',
        headsign: 'RVH/YONGE to Georgian College',
      },
      grove: {
        route_id: '8A', service_id: 'weekday', direction_id: '1',
        headsign: 'Grove to Downtown Barrie Terminal',
      },
    },
    departures_by_stop: {
      '1': [
        ['grove', '16:03:00', 12, null],
      ],
      '2': [
        ['red', '16:05:00', 139, null],
        ['rvh', '16:10:00', 268, null],
      ],
    },
  };
}

describe('Barrie shelter departure aggregation', () => {
  const now = Date.parse('2026-08-11T16:00:00-04:00');

  test('resolves a stop code and returns sorted scheduled departures', () => {
    const metadata = metadataFixture();
    expect(resolveShelterStop(metadata, '2')).toMatchObject({
      id: '2', code: '2', name: 'Downtown Hub', ids: ['2'],
    });
    const result = buildShelterDepartures({ metadata, stopQuery: '2', now });
    expect(result).toMatchObject({
      realtime_status: 'scheduled',
      stop: { code: '2', name: 'Downtown Hub' },
    });
    expect(result.departures.slice(0, 2).map((departure) => departure.destination)).toEqual([
      'RED', 'RVH NORTHBOUND',
    ]);
    expect(result.departures.every((departure) => departure.source === 'scheduled')).toBe(true);
  });

  test('prefers a matching realtime prediction and applies delays', () => {
    const result = buildShelterDepartures({
      metadata: metadataFixture(),
      stopQuery: '2',
      now,
      realtimeStatus: 'live',
      tripUpdates: {
        red: {
          start_date: '20260811',
          stop_time_updates: [
            { stop_id: '1', stop_sequence: 1, departure_time: now / 1000 + 30 },
            { stop_id: '2', stop_sequence: 139, departure_time: now / 1000 + 120 },
          ],
        },
        rvh: {
          start_date: '20260811',
          stop_time_updates: [{ stop_id: '2', stop_sequence: 268, departure_delay: 180 }],
        },
      },
    });
    expect(result.departures[0]).toMatchObject({
      trip_id: 'red', source: 'realtime', predicted_departure_time: now / 1000 + 120,
    });
    expect(result.departures[1].predicted_departure_time)
      .toBe(result.departures[1].scheduled_departure_time + 180);
  });

  test('removes canceled trips and skipped stops', () => {
    const result = buildShelterDepartures({
      metadata: metadataFixture(),
      stopQuery: '2',
      now,
      tripUpdates: {
        red: { start_date: '20260811', schedule_relationship: 3, stop_time_updates: [] },
        rvh: {
          start_date: '20260811',
          stop_time_updates: [{ stop_id: '2', stop_sequence: 268, schedule_relationship: 1 }],
        },
      },
    });
    expect(result.departures.every((departure) => departure.service_date !== '20260811')).toBe(true);
    expect(result.departures.every((departure) => departure.source === 'scheduled')).toBe(true);
  });

  test('normalizes known and fallback destinations', () => {
    expect(normalizeDestination('8B', '1', 'Crosstown/Essa to Park Place'))
      .toBe('ESSA SOUTHBOUND');
    expect(normalizeDestination('7A', '0', 'GROVE to Georgian College')).toBe('GROVE');
  });

  test('combines Downtown Barrie stops, sorts globally, and labels each boarding stop', () => {
    const result = buildShelterDepartures({
      metadata: metadataFixture(),
      groupQuery: 'downtown-barrie',
      now,
    });

    expect(result.stop).toEqual({
      id: 'downtown-barrie',
      code: null,
      name: 'Downtown Barrie',
      is_group: true,
      stop_codes: ['1', '2'],
      unavailable_stop_codes: [],
    });
    expect(result.departures.slice(0, 3).map((departure) => ({
      trip: departure.trip_id,
      stop: departure.stop_code,
      label: departure.stop_label,
    }))).toEqual([
      { trip: 'grove', stop: '1', label: 'STOP 1' },
      { trip: 'red', stop: '2', label: 'STOP 2' },
      { trip: 'rvh', stop: '2', label: 'STOP 2' },
    ]);
  });

  test('defines the complete Allandale group including stop 14', () => {
    const allandaleCodes = DEPARTURE_STOP_GROUPS['barrie-allandale'].stops
      .map((stop) => stop.code);
    expect(allandaleCodes).toEqual([
      '9001', '9002', '9003', '9004', '9005', '9006', '9007',
      '9008', '9009', '9010', '9011', '9012', '9013', '14',
    ]);

    const stops = Object.fromEntries(allandaleCodes.map((code) => [
      code,
      { id: code, code, name: code === '14' ? 'Essa at Gowan' : `Platform ${code.slice(-2)}` },
    ]));
    const group = resolveShelterGroup({
      stops,
      stop_ids_by_code: Object.fromEntries(allandaleCodes.map((code) => [code, code])),
    }, 'barrie-allandale');
    expect(group).toMatchObject({
      id: 'barrie-allandale',
      name: 'Barrie Allandale Transit Terminal',
      ids: allandaleCodes,
    });
    expect(group.stop_labels_by_id['14']).toBe('STOP 14');
    expect(group.stop_labels_by_id['9003']).toBe('PLATFORM 3');
  });

  test('keeps Allandale usable when optional configured platforms are absent from the feed', () => {
    const presentCodes = ['9003', '9004', '9005', '9006', '9012', '9013', '14'];
    const stops = Object.fromEntries(presentCodes.map((code) => [
      code,
      { id: code, code, name: `Stop ${code}` },
    ]));
    const group = resolveShelterGroup({
      stops,
      stop_ids_by_code: Object.fromEntries(presentCodes.map((code) => [code, code])),
    }, 'barrie-allandale');

    expect(group.ids).toEqual(presentCodes);
    expect(group.unavailable_stop_codes).toEqual([
      '9001', '9002', '9007', '9008', '9009', '9010', '9011',
    ]);
  });
});

describe('shelter departure browser helpers', () => {
  test('reads and validates the stop query', () => {
    expect(readQueryParameter('?stop=2&mode=sign', 'stop')).toBe('2');
    expect(parseStopQuery('9003')).toBe('9003');
    expect(parseStopQuery('../2')).toBe('');
    expect(parseGroupQuery('Downtown-Barrie')).toBe('downtown-barrie');
    expect(parseGroupQuery('../downtown')).toBe('');
  });

  test('formats the compact countdown for an 80-pixel screen', () => {
    expect(formatDepartureCountdown(1_120, 1_000_000)).toBe('2 min');
    expect(formatDepartureCountdown(1_000, 1_000_000)).toBe('Due');
  });
});
