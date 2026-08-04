import { describe, expect, test } from 'vitest';
import {
  classifyTerminalProgress,
  enrichTerminalProgress,
  inferScheduledDepartureEpochSeconds,
  scheduledTimeToEpochSeconds,
} from '../server/terminal-progress.js';

const terminalStops = [
  { stop_id: '9006', stop_sequence: 70 },
];
const terminalStopIds = ['9006'];

describe('BATT trip progress classification', () => {
  test('converts a Toronto GTFS departure into an absolute timestamp', () => {
    expect(scheduledTimeToEpochSeconds('20260731', '09:02:00'))
      .toBe(Date.parse('2026-07-31T13:02:00Z') / 1000);
  });

  test('adds the scheduled terminal departure to a vehicle at its first stop', () => {
    const enriched = enrichTerminalProgress({
      start_date: '20260731',
      stop_id: 'AD',
      trip_headsign: 'Union Station GO',
    }, {
      terminalStops: [{
        stop_id: 'AD',
        stop_sequence: 1,
        arrival_time: '08:57:00',
        departure_time: '09:02:00',
      }],
      terminalStopIds: ['AD'],
      inboundHeadsignPattern: /Allandale Waterfront/i,
    });

    expect(enriched).toMatchObject({
      terminal_progress_status: 'departed',
      terminal_departure_time: Date.parse('2026-07-31T13:02:00Z') / 1000,
      terminal_departure_source: 'static',
    });
  });

  test('infers today for a Barrie vehicle whose realtime feed omits its service date', () => {
    const nowMs = Date.parse('2026-07-31T13:07:00Z');
    const enriched = enrichTerminalProgress({
      stop_id: '9005',
      current_stop_sequence: 238,
      current_status: 1,
    }, {
      nowMs,
      terminalStops: [{
        stop_id: '9005',
        stop_sequence: 238,
        departure_time: '09:12:00',
      }],
      terminalStopIds: ['9005'],
    });

    expect(enriched).toMatchObject({
      terminal_progress_status: 'at_terminal',
      terminal_departure_time: Date.parse('2026-07-31T13:12:00Z') / 1000,
      terminal_departure_source: 'static',
    });
  });

  test('uses the previous service date for an after-midnight GTFS departure', () => {
    const nowMs = Date.parse('2026-08-01T04:32:00Z');
    expect(inferScheduledDepartureEpochSeconds('24:35:00', { nowMs }))
      .toBe(Date.parse('2026-08-01T04:35:00Z') / 1000);
  });

  test('keeps a bus whose BATT stop sequence is still ahead', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: 45,
      stop_id: '500',
    }, {
      terminalStops,
      terminalStopIds,
    }).status).toBe('approaching');
  });

  test('keeps a bus currently at a BATT platform', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: 70,
      stop_id: '9006',
      current_status: 1,
    }, {
      terminalStops,
      terminalStopIds,
    }).status).toBe('at_terminal');
  });

  test('keeps a bus approaching BATT as approaching when BATT is its next stop', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: 70,
      stop_id: '9006',
      current_status: 2,
    }, {
      terminalStops,
      terminalStopIds,
    }).status).toBe('approaching');
  });

  test('rejects a bus after it passes BATT', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: 96,
      stop_id: '577',
    }, {
      terminalStops,
      terminalStopIds,
    }).status).toBe('departed');
  });

  test('rejects a stale terminal stop id after the stop sequence has advanced', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: 71,
      stop_id: '9006',
      current_status: 1,
    }, {
      terminalStops,
      terminalStopIds,
    }).status).toBe('departed');
  });

  test('selects a later terminal visit when the stop id lags between visits', () => {
    const result = classifyTerminalProgress({
      current_stop_sequence: 80,
      stop_id: '9006',
      current_status: 1,
    }, {
      terminalStops: [
        { stop_id: '9006', stop_sequence: 70 },
        { stop_id: '9006', stop_sequence: 110 },
      ],
      terminalStopIds,
    });

    expect(result).toMatchObject({
      status: 'approaching',
      terminalStop: { stop_id: '9006', stop_sequence: 110 },
    });
  });

  test('rejects a trip that starts at BATT once its current stop is elsewhere', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: 0,
      stop_id: '651',
    }, {
      terminalStops: [{ stop_id: '9003', stop_sequence: 0 }],
      terminalStopIds: ['9003'],
    }).status).toBe('departed');
  });

  test('keeps an inbound GO vehicle when the feed omits stop sequence and status', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: null,
      current_status: null,
      stop_id: 'AD',
      trip_headsign: 'Allandale Waterfront GO',
    }, {
      terminalStops: [{ stop_id: 'AD', stop_sequence: 35 }],
      terminalStopIds: ['AD'],
      inboundHeadsignPattern: /Allandale Waterfront/i,
    }).status).toBe('approaching');
  });

  test('rejects an outbound GO vehicle whose trip starts at Allandale', () => {
    expect(classifyTerminalProgress({
      current_stop_sequence: null,
      current_status: null,
      stop_id: 'AD',
      trip_headsign: 'Union Station GO',
    }, {
      terminalStops: [{ stop_id: 'AD', stop_sequence: 1 }],
      terminalStopIds: ['AD'],
      inboundHeadsignPattern: /Allandale Waterfront/i,
    }).status).toBe('departed');
  });

  test('selects a later BATT visit when a trip serves the terminal more than once', () => {
    const enriched = enrichTerminalProgress({
      current_stop_sequence: 80,
      stop_id: '500',
    }, {
      terminalStops: [
        { stop_id: '9006', stop_sequence: 70 },
        { stop_id: '9006', stop_sequence: 110 },
      ],
      terminalStopIds,
    });

    expect(enriched).toMatchObject({
      terminal_progress_status: 'approaching',
      terminal_stop_sequence: 110,
    });
  });
});
