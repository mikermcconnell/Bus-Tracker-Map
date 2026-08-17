import { describe, expect, test } from 'vitest';
import terminalLayout from '../server/terminal-layout.js';

const { buildTerminalLayout, cleanHeadsign } = terminalLayout;

describe('terminal platform layout', () => {
  test('derives current Barrie platform assignments from GTFS metadata', () => {
    const layout = buildTerminalLayout({
      barrie: {
        generated_at: '2026-07-30T18:42:08.922Z',
        source_url: 'https://example.test/barrie.zip',
        terminal_stops: [
          { id: '14', platform_code: '14' },
          { id: '9003', platform_code: '3' },
          { id: '9013', platform_code: '13' },
        ],
        trips: {
          south: {
            route_id: '8A',
            headsign: 'RVH/YONGE to Park Place',
            terminal_stops: [{ stop_id: '9003' }],
          },
          mall: {
            route_id: '12A',
            headsign: 'GEORGIAN MALL',
            terminal_stops: [{ stop_id: '9013' }],
          },
          southGo: {
            route_id: '12B',
            headsign: 'BARRIE SOUTH GO',
            terminal_stops: [{ stop_id: '14' }],
          },
        },
      },
    });

    expect(layout.assignments).toEqual([
      expect.objectContaining({
        platform: '3',
        route_id: '8A',
        destination: 'Yonge Southbound',
      }),
      expect.objectContaining({
        platform: '13',
        route_id: '12A',
        destination: 'Georgian Mall',
      }),
      expect.objectContaining({
        platform: '14',
        stop_id: '14',
        route_id: '12B',
        destination: 'Barrie South GO',
      }),
    ]);
  });

  test('falls back to stable Allandale stop IDs when platform codes are missing', () => {
    const layout = buildTerminalLayout({
      barrie: {
        terminal_stops: [
          { id: '9003', platform_code: null },
          { id: '9005', platform_code: null },
        ],
        trips: {
          southbound: {
            route_id: '8A',
            terminal_stops: [{ stop_id: '9003' }],
          },
          northbound: {
            route_id: '8A',
            terminal_stops: [{ stop_id: '9005' }],
          },
        },
      },
    });

    expect(layout.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: '3', stop_id: '9003', destination: 'Yonge Southbound' }),
      expect.objectContaining({ platform: '5', stop_id: '9005', destination: 'RVH Northbound' }),
    ]));
  });

  test('maps regional stop identifiers to physical platforms', () => {
    const layout = buildTerminalLayout({
      ontarioNorthland: {
        trips: {
          coach: {
            route_id: '201',
            headsign: 'SUDBURY',
            terminal_stops: [{ stop_id: '315' }],
          },
        },
      },
      goTransit: {
        trips: {
          bus: {
            route_id: '06260926-68',
            headsign: '68 - Aurora GO',
            terminal_stops: [{ stop_id: '08049' }],
          },
          train: {
            route_id: '06260926-BR',
            headsign: 'BR - Union Station GO',
            terminal_stops: [{ stop_id: 'AD' }],
          },
        },
      },
      simcoeLinx: {
        trips: {
          linx: {
            route_id: '2',
            headsign: 'Wasaga Beach, 25 45th Street S',
            terminal_stops: [{ stop_id: 'SCSTOP210' }],
          },
        },
      },
    });

    expect(layout.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: '1', route_id: 'GO-TRAIN', destination: 'Toronto / Union Station' }),
      expect.objectContaining({ platform: '7', route_id: 'GO-BUS', route_label: '68' }),
      expect.objectContaining({ platform: '8', route_id: 'ONTC', route_label: 'ON' }),
      expect.objectContaining({
        platform: '2', route_id: 'LINX-2', route_label: '2', destination: 'Wasaga Beach'
      }),
    ]));
  });

  test('cleans regional route prefixes from headsigns', () => {
    expect(cleanHeadsign('68B - East Gwillimbury GO', 'go-transit')).toBe('East Gwillimbury GO');
  });

  test('shows the next scheduled departure for each route sharing a platform', () => {
    const layout = buildTerminalLayout({
      now: '2026-07-31T13:00:00Z',
      barrie: {
        terminal_stops: [{ id: '9006', platform_code: '6' }],
        service_calendars: {
          weekday: {
            start_date: '20260701', end_date: '20260831',
            monday: true, tuesday: true, wednesday: true, thursday: true,
            friday: true, saturday: false, sunday: false,
          },
        },
        service_exceptions: {},
        trips: {
          route7a: {
            route_id: '7A', service_id: 'weekday',
            terminal_stops: [{ stop_id: '9006', departure_time: '09:05:00' }],
          },
          route7b: {
            route_id: '7B', service_id: 'weekday',
            terminal_stops: [{ stop_id: '9006', departure_time: '09:15:00' }],
          },
        },
      },
    });

    expect(layout.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        platform: '6', route_id: '7A',
        next_departure_time: Date.parse('2026-07-31T13:05:00Z') / 1000,
        next_departure_source: 'static',
      }),
      expect.objectContaining({
        platform: '6', route_id: '7B',
        next_departure_time: Date.parse('2026-07-31T13:15:00Z') / 1000,
        next_departure_source: 'static',
      }),
    ]));
  });

  test('honours service exceptions when advancing the scheduled departure', () => {
    const layout = buildTerminalLayout({
      now: '2026-07-31T13:00:00Z',
      barrie: {
        terminal_stops: [{ id: '9006', platform_code: '6' }],
        service_calendars: {
          daily: {
            start_date: '20260701', end_date: '20260831',
            monday: true, tuesday: true, wednesday: true, thursday: true,
            friday: true, saturday: true, sunday: true,
          },
        },
        service_exceptions: { '20260731': { daily: 2 } },
        trips: {
          route7a: {
            route_id: '7A', service_id: 'daily',
            terminal_stops: [{ stop_id: '9006', departure_time: '09:05:00' }],
          },
        },
      },
    });

    expect(layout.assignments[0].next_departure_time)
      .toBe(Date.parse('2026-08-01T13:05:00Z') / 1000);
  });

  test('finds after-midnight GTFS times on the previous service date', () => {
    const layout = buildTerminalLayout({
      now: '2026-08-01T04:45:00Z',
      barrie: {
        terminal_stops: [{ id: '9006', platform_code: '6' }],
        service_calendars: {
          friday: {
            start_date: '20260701', end_date: '20260831',
            monday: false, tuesday: false, wednesday: false, thursday: false,
            friday: true, saturday: false, sunday: false,
          },
        },
        service_exceptions: {},
        trips: {
          late: {
            route_id: '7A', service_id: 'friday',
            terminal_stops: [{ stop_id: '9006', departure_time: '24:50:00' }],
          },
        },
      },
    });

    expect(layout.assignments[0].next_departure_time)
      .toBe(Date.parse('2026-08-01T04:50:00Z') / 1000);
  });
});
