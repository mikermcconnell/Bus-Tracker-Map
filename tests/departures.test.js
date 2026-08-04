import { describe, expect, test } from 'vitest';
import departuresModule from '../server/departures.js';

const {
  collectScheduledDepartures,
  freshness,
  mergeTripUpdates,
  parseGoNextService,
  readGoTime,
  selectScheduledDepartures,
} = departuresModule;

function metadata() {
  return {
    terminal_stop_ids: ['9003'],
    terminal_stops: [{ id: '9003', platform_code: '3' }],
    service_calendars: {
      weekday: {
        start_date: '20260801', end_date: '20260831',
        sunday: true, monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: true,
      },
    },
    service_exceptions: {},
    trips: {
      outbound: {
        route_id: '8A', service_id: 'weekday', headsign: 'RVH/YONGE to Park Place',
        terminal_stops: [{ stop_id: '9003', stop_sequence: 1, departure_time: '12:10:00', is_departure: true }],
      },
      inbound: {
        route_id: '8A', service_id: 'weekday', headsign: 'Allandale',
        terminal_stops: [{ stop_id: '9003', stop_sequence: 10, departure_time: '12:05:00', is_departure: false }],
      },
    },
  };
}

describe('departure aggregation', () => {
  test('collects outbound service in the one-hour window and excludes terminating trips', () => {
    const now = Date.parse('2026-08-04T16:00:00Z'); // 12:00 in Toronto
    const rows = collectScheduledDepartures(metadata(), 'barrie_transit', now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route_label: '8A', platform: '3', destination: 'Yonge Southbound', departure_source: 'scheduled' });
  });

  test('uses fresh trip updates and ignores stale predictions', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const scheduled = collectScheduledDepartures(metadata(), 'barrie_transit', now);
    const fresh = mergeTripUpdates(scheduled, {
      feed_timestamp: now / 1000 - 10,
      updates: [{ trip_id: 'outbound', stop_id: '9003', start_date: '20260804', departure_time: scheduled[0].scheduled_departure_time + 180 }],
    }, now, 120000, 900000);
    expect(fresh.departures[0]).toMatchObject({ departure_source: 'realtime', delay_seconds: 180 });
    expect(fresh.source.realtime_status).toBe('live');

    const rotatedTripId = mergeTripUpdates(scheduled, {
      feed_timestamp: now / 1000 - 10,
      updates: [{ trip_id: 'publisher-old-id', route_id: '8A', stop_id: '9003', departure_time: scheduled[0].scheduled_departure_time + 60 }],
    }, now, 120000, 900000);
    expect(rotatedTripId.departures[0]).toMatchObject({ departure_source: 'realtime', delay_seconds: 60 });

    const stale = mergeTripUpdates(scheduled, { feed_timestamp: now / 1000 - 1000, updates: [] }, now, 120000, 900000);
    expect(stale.departures[0].departure_source).toBe('scheduled');
    expect(stale.source.realtime_status).toBe('offline');
  });

  test('reports delayed and missing realtime timestamps explicitly', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    expect(freshness(now / 1000 - 300, now, 120000, 900000).realtime_status).toBe('delayed');
    expect(freshness(null, now, 120000, 900000)).toMatchObject({ realtime_status: 'offline', status_reason: 'missing_timestamp' });
  });

  test('selects and orders visible rows by published departure time, not realtime delay', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const start = now / 1000;
    const rows = selectScheduledDepartures([
      { id: 'expired', agency_id: 'barrie-transit', route_label: '7A', destination: 'Grove', platform: '6', scheduled_departure_time: start - 1, expected_departure_time: start + 300 },
      { id: 'first', agency_id: 'barrie-transit', route_label: '12B', destination: 'Barrie South GO', platform: '14', scheduled_departure_time: start + 300, expected_departure_time: start + 900 },
      { id: 'duplicate', agency_id: 'barrie-transit', route_label: '12B', destination: 'Barrie South GO', platform: '14', scheduled_departure_time: start + 400, expected_departure_time: start + 400 },
      { id: 'second', agency_id: 'ontario-northland', route_label: '101', destination: 'North Bay', platform: '8', scheduled_departure_time: start + 600, expected_departure_time: start + 600 },
      { id: 'same-time-later-platform', agency_id: 'barrie-transit', route_label: '8B', destination: 'Crosstown', platform: '12', scheduled_departure_time: start + 600, expected_departure_time: start + 600 },
      { id: 'outside-window', agency_id: 'ontario-northland', route_label: '201', destination: 'Sudbury', platform: '8', scheduled_departure_time: start + 3601, expected_departure_time: start + 3601 },
    ], now, 10);
    expect(rows.map((row) => row.id)).toEqual(['first', 'second', 'same-time-later-platform']);
  });

  test('uses public-facing Ontario Northland route numbers and target LINX wording', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const common = metadata().service_calendars;
    const northland = collectScheduledDepartures({
      service_calendars: common,
      service_exceptions: {},
      routes: { 101: { short_name: 'ONTC', long_name: 'Toronto - North Bay' } },
      trips: { north: { route_id: '101', service_id: 'weekday', headsign: 'NORTH BAY', terminal_stops: [{ stop_id: '315', departure_time: '12:10:00', is_departure: true }] } },
    }, 'ontario_northland', now);
    const linx = collectScheduledDepartures({
      service_calendars: common,
      service_exceptions: {},
      trips: { beach: { route_id: '2', service_id: 'weekday', headsign: 'Wasaga Beach, 25 45th Street S', terminal_stops: [{ stop_id: 'SCSTOP210', departure_time: '12:10:00', is_departure: true }] } },
    }, 'simcoe_linx', now);
    expect(northland[0]).toMatchObject({ route_label: '101', destination: 'NORTH BAY' });
    expect(linx[0]).toMatchObject({ route_label: '2', destination: 'Wasaga Beach 45th St' });
  });

  test('parses GO NextService timestamps and platform data', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const rows = parseGoNextService({ NextService: { Lines: [{ LineCode: '68', Destination: 'Aurora GO', Platform: '7', TripNumber: '123', ScheduledDepartureTime: '/Date(1785859800000)/', ComputedDepartureTime: '/Date(1785860100000)/' }] } }, '08049', now);
    expect(readGoTime('/Date(1785860100000)/')).toBe(1785860100);
    expect(readGoTime('2026-08-04T11:40:34')).toBe(Date.parse('2026-08-04T15:40:34Z') / 1000);
    expect(rows[0]).toMatchObject({ agency_id: 'go-transit', route_label: '68', destination: 'Barrie / Newmarket', platform: '7', departure_source: 'realtime' });
  });
});
