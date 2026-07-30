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
    ]);
    expect(layout.assignments.some((entry) => entry.platform === '14')).toBe(false);
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
    });

    expect(layout.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: '1', route_id: 'GO-TRAIN', destination: 'Toronto / Union Station' }),
      expect.objectContaining({ platform: '7', route_id: 'GO-BUS', route_label: '68' }),
      expect.objectContaining({ platform: '8', route_id: 'ONTC', route_label: 'ON' }),
    ]));
  });

  test('cleans regional route prefixes from headsigns', () => {
    expect(cleanHeadsign('68B - East Gwillimbury GO', 'go-transit')).toBe('East Gwillimbury GO');
  });
});
