import { describe, expect, test } from 'vitest';
import departuresModule from '../server/departures.js';

const {
  collectScheduledDepartures,
  freshness,
  mergeTripUpdates,
  parseGoNextService,
  readGoTime,
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
  test('collects outbound service in the 24-hour window and excludes terminating trips', () => {
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

  test('parses GO NextService timestamps and platform data', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const rows = parseGoNextService({ NextService: { Lines: [{ LineCode: '68', Destination: 'Aurora GO', Platform: '7', TripNumber: '123', ScheduledDepartureTime: '/Date(1785859800000)/', ComputedDepartureTime: '/Date(1785860100000)/' }] } }, '08049', now);
    expect(readGoTime('/Date(1785860100000)/')).toBe(1785860100);
    expect(rows[0]).toMatchObject({ agency_id: 'go-transit', route_label: '68', platform: '7', departure_source: 'realtime' });
  });
});
