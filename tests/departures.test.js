import { describe, expect, test } from 'vitest';
import departuresModule from '../server/departures.js';
import {
  formatDepartureText,
  parseStopCode,
  readQueryParameter,
  routeDescription,
} from '../frontend/src/departures/main.js';

const {
  assignmentMatchesVehicle,
  buildPlatformDepartures,
  buildTerminalDepartures,
  parsePlatformStopCode,
} = departuresModule;

describe('platform departure aggregation', () => {
  const assignment = {
    platform: '2',
    stop_id: 'SCSTOP210',
    agency_id: 'simcoe-linx',
    agency_name: 'Simcoe County LINX',
    route_id: 'LINX-2',
    route_label: '2',
    source_route_id: '2',
    destination: 'Wasaga Beach',
    next_departure_time: 1_800,
  };

  test('maps terminal URL stop codes to two-digit platform labels', () => {
    expect(parsePlatformStopCode('9002')).toEqual({
      stop_code: '9002',
      platform: '2',
      platform_display: '02',
    });
    expect(parsePlatformStopCode('9014').platform).toBe('14');
    expect(parsePlatformStopCode('9000')).toBeNull();
    expect(parsePlatformStopCode('9999')).toBeNull();
  });

  test('matches agency-prefixed realtime route labels to their assignment', () => {
    expect(assignmentMatchesVehicle(assignment, {
      platform: '2',
      agency_id: 'simcoe-linx',
      route_id: 'LINX-2',
      route_label: 'LINX 2',
      source_route_id: '2',
    })).toBe(true);
  });

  test('prefers a fresh approaching realtime departure', () => {
    const result = buildPlatformDepartures({
      stopCode: '9002',
      now: 1_000_000,
      layout: { assignments: [assignment] },
      vehiclePayload: {
        sources: { simcoe_linx: { feed_status: 'live' } },
        vehicles: [{
          id: 'linx-bus',
          platform: '2',
          agency_id: 'simcoe-linx',
          route_id: 'LINX-2',
          source_route_id: '2',
          terminal_progress_status: 'approaching',
          terminal_departure_time: 1_120,
          terminal_departure_source: 'realtime',
        }],
      },
    });
    expect(result).toMatchObject({ stop_code: '9002', platform: '2', platform_display: '02' });
    expect(result.departures[0]).toMatchObject({
      route_label: '2',
      departure_time: 1_120,
      departure_source: 'realtime',
      progress_status: 'approaching',
    });
  });

  test('falls back to schedule when the agency feed is delayed', () => {
    const result = buildPlatformDepartures({
      stopCode: '9002',
      now: 1_000_000,
      layout: { assignments: [assignment] },
      vehiclePayload: {
        sources: { simcoe_linx: { feed_status: 'delayed' } },
        vehicles: [{
          platform: '2',
          agency_id: 'simcoe-linx',
          route_id: 'LINX-2',
          terminal_progress_status: 'approaching',
          terminal_departure_time: 1_120,
          terminal_departure_source: 'realtime',
        }],
      },
    });
    expect(result.departures[0]).toMatchObject({
      departure_time: 1_800,
      departure_source: 'static',
      progress_status: 'scheduled',
    });
  });

  test('sorts multiple routes by effective departure time and supports empty platforms', () => {
    const result = buildPlatformDepartures({
      stopCode: '9006',
      now: 1_000_000,
      layout: {
        assignments: [
          { ...assignment, platform: '6', route_id: '7A', route_label: '7A', next_departure_time: 1_900 },
          { ...assignment, platform: '6', route_id: '7B', route_label: '7B', next_departure_time: 1_500 },
        ],
      },
      vehiclePayload: { vehicles: [] },
    });
    expect(result.departures.map((departure) => departure.route_label)).toEqual(['7B', '7A']);
    expect(buildPlatformDepartures({
      stopCode: '9009',
      layout: { assignments: [] },
      vehiclePayload: { vehicles: [] },
    })).toMatchObject({ status: 'no_departures', platform_display: '09', departures: [] });
  });

  test('builds one merged realtime departure list for the terminal display', () => {
    const layout = {
      assignments: [
        assignment,
        { ...assignment, platform: '3', stop_id: '9003', agency_id: 'barrie-transit', route_id: '8A', route_label: '8A' },
      ],
    };
    const result = buildTerminalDepartures({
      layout,
      now: 1_000_000,
      vehiclePayload: {
        sources: {
          simcoe_linx: { feed_status: 'live' },
          barrie_transit: { feed_status: 'live' },
        },
        vehicles: [{
          platform: '2',
          agency_id: 'simcoe-linx',
          route_id: 'LINX-2',
          source_route_id: '2',
          terminal_progress_status: 'approaching',
          terminal_departure_time: 1_120,
          terminal_departure_source: 'realtime',
        }],
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      platform: '2',
      route_label: '2',
      departure_source: 'realtime',
      departure_time: 1_120,
    });
    expect(result[1]).toMatchObject({
      platform: '3',
      route_label: '8A',
      departure_source: 'static',
    });
  });
});

describe('platform departure browser helpers', () => {
  test('reads and validates the stop query without URLSearchParams', () => {
    expect(readQueryParameter('?stop=9002&mode=sign', 'stop')).toBe('9002');
    expect(parseStopCode('9002')).toMatchObject({ platform: '2', display: '02' });
    expect(parseStopCode('9015')).toBeNull();
  });

  test('formats countdown and route copy', () => {
    expect(formatDepartureText(1_120, 1_000_000)).toBe('Departing in 2 min');
    expect(formatDepartureText(1_000, 1_000_000)).toBe('Departing now');
    expect(routeDescription({ route_label: '2', destination: 'Wasaga Beach' }))
      .toBe('2 - Wasaga Beach');
  });
});
