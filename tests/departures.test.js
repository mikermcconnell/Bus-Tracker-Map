import { describe, expect, test } from 'vitest';
import departuresModule from '../server/departures.js';

const {
  applyVehicleEvidence,
  barrieDowntownDestination,
  collectScheduledDepartures,
  createDeparturesService,
  freshness,
  isBoardableTerminalDeparture,
  isFreshVehiclePosition,
  mergeTripUpdates,
  metadataForBoard,
  parsePrefixedGoTripId,
  parseGoNextService,
  readGoTime,
  selectScheduledDepartures,
  vehicleMatchesDepartureTrip,
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
  test('uses concise Downtown Hub route names', () => {
    expect(barrieDowntownDestination('100', 'RED EXPRESS TO DOWNTOWN BARRIE TERMINAL')).toBe('Red');
    expect(barrieDowntownDestination('101', 'BLUE EXPRESS TO DOWNTOWN BARRIE TERMINAL')).toBe('Blue');
    expect(barrieDowntownDestination('7B', 'BEAR CREEK TO PARK PLACE')).toBe('BEAR CREEK');
    expect(barrieDowntownDestination('8A', 'RVH/YONGE TO GEORGIAN COLLEGE')).toBe('RVH/YONGE');
    expect(barrieDowntownDestination('12A', 'GEORGIAN MALL')).toBe('GEORGIAN MALL');
  });

  test('selects and merges Downtown Hub stop 1 and stop 2 metadata', () => {
    const source = {
      ...metadata(),
      departure_boards: {
        downtown: {
          stop_ids: ['1', '2'],
          stops: [
            { id: '1', platform_code: '1' },
            { id: '2', platform_code: '2' },
          ],
          trips: {
            stop1: {
              route_id: '2A', service_id: 'weekday', headsign: 'Park Place',
              terminal_stops: [{ stop_id: '1', departure_time: '12:10:00', is_departure: true }],
            },
            stop2: {
              route_id: '8A', service_id: 'weekday', headsign: 'Georgian College',
              terminal_stops: [{ stop_id: '2', departure_time: '12:15:00', is_departure: true }],
            },
          },
        },
      },
    };

    const selected = metadataForBoard(source, 'barrie_transit', 'downtown');
    const rows = collectScheduledDepartures(
      selected,
      'barrie_transit',
      Date.parse('2026-08-04T16:00:00Z')
    );

    expect(rows).toEqual([
      expect.objectContaining({ stop_id: '1', platform: '1', platform_type: 'stop', route_label: '2A', destination: 'Park Place' }),
      expect.objectContaining({ stop_id: '2', platform: '2', platform_type: 'stop', route_label: '8A', destination: 'Georgian College' }),
    ]);
  });

  test('builds the Downtown board without starting unrelated agency requests', async () => {
    const source = {
      ...metadata(),
      departure_boards: {
        downtown: {
          stop_ids: ['1', '2'],
          stops: [{ id: '1', platform_code: '1' }, { id: '2', platform_code: '2' }],
          trips: {
            stop1: {
              route_id: '2A', service_id: 'weekday', headsign: 'Park Place',
              terminal_stops: [{ stop_id: '1', departure_time: '12:10:00', is_departure: true }],
            },
            stop2: {
              route_id: '8A', service_id: 'weekday', headsign: 'Georgian College',
              terminal_stops: [{ stop_id: '2', departure_time: '12:15:00', is_departure: true }],
            },
          },
        },
      },
    };
    const getDepartures = createDeparturesService({
      metadata: { barrie_transit: source },
      fetchVehiclePayload: () => ({ vehicles: [] }),
    });

    const result = await getDepartures({
      board: 'downtown',
      limit: 10,
      now: Date.parse('2026-08-04T16:00:00Z'),
    });

    expect(result.board).toBe('downtown');
    expect(result.departures.map((row) => row.stop_id)).toEqual(['1', '2']);
    expect(Object.keys(result.sources)).toEqual(['barrie_transit']);
  });

  test('collects outbound service in the one-hour window and excludes terminating trips', () => {
    const now = Date.parse('2026-08-04T16:00:00Z'); // 12:00 in Toronto
    const rows = collectScheduledDepartures(metadata(), 'barrie_transit', now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route_label: '8A', platform: '3', destination: 'Yonge Southbound', departure_source: 'scheduled' });
  });

  test('shows only the outgoing 8A/8B route during Allandale changeovers', () => {
    const serviceCalendars = {
      weekday: {
        start_date: '20260801', end_date: '20260831',
        sunday: false, monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: false,
      },
      saturday: {
        start_date: '20260801', end_date: '20260831',
        sunday: false, monday: false, tuesday: false, wednesday: false,
        thursday: false, friday: false, saturday: true,
      },
      sunday: {
        start_date: '20260801', end_date: '20260831',
        sunday: true, monday: false, tuesday: false, wednesday: false,
        thursday: false, friday: false, saturday: false,
      },
    };
    const trips = {};
    Object.keys(serviceCalendars).forEach((serviceId) => {
      trips[`${serviceId}-arriving-8a`] = {
        route_id: '8A', service_id: serviceId, headsign: 'Allandale',
        terminal_stops: [{ stop_id: '9005', departure_time: '20:07:00', is_departure: false }],
      };
      trips[`${serviceId}-outgoing-8b`] = {
        route_id: '8B', service_id: serviceId, headsign: 'Georgian College',
        terminal_stops: [{ stop_id: '9012', departure_time: '20:12:00', is_departure: true }],
      };
      trips[`${serviceId}-arriving-8b`] = {
        route_id: '8B', service_id: serviceId, headsign: 'Allandale',
        terminal_stops: [{ stop_id: '9012', departure_time: '20:37:00', is_departure: false }],
      };
      trips[`${serviceId}-outgoing-8a`] = {
        route_id: '8A', service_id: serviceId, headsign: 'Georgian College',
        terminal_stops: [{ stop_id: '9005', departure_time: '20:42:00', is_departure: true }],
      };
    });
    const changeoverMetadata = {
      terminal_stops: [
        { id: '9005', platform_code: '5' },
        { id: '9012', platform_code: '12' },
      ],
      service_calendars: serviceCalendars,
      service_exceptions: {},
      trips,
    };

    [
      '2026-08-07T20:05:00-04:00', // Weekday evening
      '2026-08-08T20:05:00-04:00', // Saturday evening
      '2026-08-09T20:05:00-04:00', // Sunday
    ].forEach((localTime) => {
      const rows = collectScheduledDepartures(
        changeoverMetadata,
        'barrie_transit',
        Date.parse(localTime)
      );
      expect(rows.map((row) => ({
        route: row.route_label,
        destination: row.destination,
        platform: row.platform,
      }))).toEqual([
        { route: '8B', destination: 'Crosstown Northbound', platform: '12' },
        { route: '8A', destination: 'RVH Northbound', platform: '5' },
      ]);
      expect(rows.every((row) => !row.id.includes('arriving'))).toBe(true);
    });
  });

  test('requires an explicit outgoing marker at an Allandale platform', () => {
    expect(isBoardableTerminalDeparture('barrie_transit', {
      stop_id: '9005', is_departure: true,
    })).toBe(true);
    expect(isBoardableTerminalDeparture('barrie_transit', {
      stop_id: '9005', is_departure: false,
    })).toBe(false);
    expect(isBoardableTerminalDeparture('barrie_transit', {
      stop_id: '9005',
    })).toBe(false);
  });

  test('uses fresh trip updates and ignores stale predictions', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const scheduled = collectScheduledDepartures(metadata(), 'barrie_transit', now);
    const fresh = mergeTripUpdates(scheduled, {
      feed_timestamp: now / 1000 - 10,
      updates: [{ trip_id: 'outbound', stop_id: '9003', start_date: '20260804', departure_time: scheduled[0].scheduled_departure_time + 180 }],
    }, now, 120000, 900000);
    expect(fresh.departures[0]).toMatchObject({
      departure_source: 'estimated',
      prediction_match_type: 'exact',
      prediction_trip_id: 'outbound',
      delay_seconds: 180,
    });
    expect(fresh.source.realtime_status).toBe('live');

    const rotatedTripId = mergeTripUpdates(scheduled, {
      feed_timestamp: now / 1000 - 10,
      updates: [{ trip_id: 'publisher-old-id', route_id: '8A', stop_id: '9003', departure_time: scheduled[0].scheduled_departure_time + 60 }],
    }, now, 120000, 900000);
    expect(rotatedTripId.departures[0]).toMatchObject({
      departure_source: 'estimated',
      prediction_match_type: 'fallback',
      prediction_trip_id: 'publisher-old-id',
      delay_seconds: 60,
    });

    const stale = mergeTripUpdates(scheduled, { feed_timestamp: now / 1000 - 1000, updates: [] }, now, 120000, 900000);
    expect(stale.departures[0].departure_source).toBe('scheduled');
    expect(stale.source.realtime_status).toBe('offline');
  });

  test('keeps an exact fresh Barrie trip prediction LIVE when vehicle evidence briefly disappears', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const scheduled = collectScheduledDepartures(metadata(), 'barrie_transit', now);
    const exactPrediction = mergeTripUpdates(scheduled, {
      feed_timestamp: now / 1000 - 10,
      updates: [{
        trip_id: 'outbound',
        stop_id: '9003',
        start_date: '20260804',
        departure_time: scheduled[0].scheduled_departure_time + 180,
      }],
    }, now, 120000, 900000).departures;
    const freshVehicle = {
      id: 'bus-24', agency_id: 'barrie-transit', trip_id: 'outbound', start_date: '20260804',
      lat: 44.37, lon: -79.69, last_reported: now / 1000 - 10,
    };

    expect(applyVehicleEvidence(exactPrediction, { vehicles: [freshVehicle] }, now, 120000)[0])
      .toMatchObject({
        departure_source: 'realtime', live_evidence: 'trip_update_and_vehicle', live_vehicle_id: 'bus-24',
      });
    expect(applyVehicleEvidence(exactPrediction, { vehicles: [] }, now, 120000)[0])
      .toMatchObject({ departure_source: 'realtime', live_evidence: 'trip_update', live_vehicle_id: null });
    expect(applyVehicleEvidence(exactPrediction, {
      vehicles: [{ ...freshVehicle, last_reported: now / 1000 - 121 }],
    }, now, 120000)[0]).toMatchObject({ departure_source: 'realtime', live_evidence: 'trip_update' });
    expect(applyVehicleEvidence(exactPrediction, {
      vehicles: [{ ...freshVehicle, trip_id: 'different-trip' }],
    }, now, 120000)[0]).toMatchObject({ departure_source: 'realtime', live_evidence: 'trip_update' });
    expect(applyVehicleEvidence([{
      ...exactPrediction[0], prediction_trip_id: 'different-trip',
    }], { vehicles: [freshVehicle] }, now, 120000)[0].departure_source).toBe('estimated');
    expect(isFreshVehiclePosition(freshVehicle, now, 120000)).toBe(true);
    expect(isFreshVehiclePosition({ ...freshVehicle, lat: null }, now, 120000)).toBe(false);
  });

  test('still requires fresh vehicle evidence for other agencies', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const exactPrediction = {
      agency_id: 'simcoe-linx', trip_id: 'linx-trip', service_date: '20260804',
      expected_departure_time: now / 1000 + 600, departure_source: 'estimated',
      prediction_match_type: 'exact', prediction_trip_id: 'linx-trip',
    };
    expect(applyVehicleEvidence([exactPrediction], { vehicles: [] }, now, 120000)[0])
      .toMatchObject({ departure_source: 'estimated', live_evidence: null });
  });

  test('recognizes a fresh inbound LINX vehicle as the Allandale outbound handoff', () => {
    const now = Date.parse('2026-08-07T17:28:00Z');
    const exactPrediction = {
      agency_id: 'simcoe-linx', route_id: '2', stop_id: 'SCSTOP210',
      trip_id: 'outbound-trip', service_date: '20260807',
      expected_departure_time: Date.parse('2026-08-07T17:31:46Z') / 1000,
      departure_source: 'estimated', prediction_match_type: 'exact',
      prediction_trip_id: 'outbound-trip',
    };
    const inboundVehicle = {
      id: 'simcoe-linx:6017', agency_id: 'simcoe-linx', route_id: 'LINX-2',
      source_route_id: '2', trip_id: 'inbound-trip', start_date: '20260807',
      trip_headsign: 'Barrie Allandale Bus Station', terminal_stop_id: 'SCSTOP210',
      terminal_progress_status: 'approaching',
      terminal_departure_time: Date.parse('2026-08-07T17:31:24Z') / 1000,
      lat: 44.37, lon: -79.69, last_reported: now / 1000 - 10,
    };

    expect(applyVehicleEvidence([exactPrediction], { vehicles: [inboundVehicle] }, now, 120000)[0])
      .toMatchObject({
        departure_source: 'realtime',
        live_evidence: 'trip_update_and_terminal_handoff_vehicle',
        live_vehicle_id: 'simcoe-linx:6017',
      });

    const rejectedVariants = [
      { source_route_id: '6', route_id: 'LINX-6' },
      { trip_headsign: 'Wasaga Beach, 25 45th Street S' },
      { start_date: '20260806' },
      { terminal_stop_id: 'DIFFERENT_STOP' },
      { terminal_progress_status: 'departed' },
      { terminal_departure_time: Date.parse('2026-08-07T18:10:00Z') / 1000 },
      { last_reported: now / 1000 - 121 },
    ];
    rejectedVariants.forEach((changes) => {
      expect(applyVehicleEvidence([exactPrediction], {
        vehicles: [{ ...inboundVehicle, ...changes }],
      }, now, 120000)[0].departure_source).toBe('estimated');
    });

    expect(applyVehicleEvidence([exactPrediction], {
      vehicles: [inboundVehicle, { ...inboundVehicle, id: 'simcoe-linx:6018' }],
    }, now, 120000)[0].departure_source).toBe('estimated');
  });

  test('never promotes a route-and-time fallback prediction to LIVE', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const scheduled = collectScheduledDepartures(metadata(), 'barrie_transit', now);
    const fallbackPrediction = mergeTripUpdates(scheduled, {
      feed_timestamp: now / 1000 - 10,
      updates: [{
        trip_id: 'publisher-old-id', route_id: '8A', stop_id: '9003',
        departure_time: scheduled[0].scheduled_departure_time + 60,
      }],
    }, now, 120000, 900000).departures;
    const result = applyVehicleEvidence(fallbackPrediction, { vehicles: [{
      id: 'bus-24', agency_id: 'barrie-transit', trip_id: 'outbound',
      lat: 44.37, lon: -79.69, last_reported: now / 1000 - 10,
    }] }, now, 120000);
    expect(result[0]).toMatchObject({ departure_source: 'estimated', live_vehicle_id: null });
  });

  test('matches a prefixed GO vehicle trip only on the same date and route', () => {
    const now = Date.parse('2026-08-07T14:46:00Z');
    const departure = {
      agency_id: 'go-transit', route_id: '68', trip_id: '68550', service_date: '20260807',
      scheduled_departure_time: Date.parse('2026-08-07T15:00:00Z') / 1000,
      expected_departure_time: Date.parse('2026-08-07T15:00:00Z') / 1000,
      departure_source: 'estimated', prediction_match_type: 'exact', prediction_trip_id: '68550',
    };
    const vehicle = {
      id: 'go-transit:2546', agency_id: 'go-transit', trip_id: '20260807-68-68550',
      start_date: '20260807', lat: 44.37, lon: -79.69, last_reported: now / 1000 - 10,
    };

    expect(parsePrefixedGoTripId(vehicle.trip_id)).toEqual({
      service_date: '20260807', route_id: '68', trip_id: '68550',
    });
    expect(vehicleMatchesDepartureTrip(vehicle, departure)).toBe(true);
    expect(applyVehicleEvidence([departure], { vehicles: [vehicle] }, now, 120000)[0])
      .toMatchObject({ departure_source: 'realtime', live_vehicle_id: 'go-transit:2546' });

    ['20260806-68-68550', '20260807-69-68550'].forEach((tripId) => {
      expect(applyVehicleEvidence([departure], {
        vehicles: [{ ...vehicle, trip_id: tripId, start_date: null }],
      }, now, 120000)[0].departure_source).toBe('estimated');
    });
    expect(applyVehicleEvidence([departure], {
      vehicles: [{ ...vehicle, last_reported: now / 1000 - 121 }],
    }, now, 120000)[0].departure_source).toBe('estimated');
  });

  test('matches the equivalent prefixed GO train trip format', () => {
    const now = Date.parse('2026-08-07T14:46:00Z');
    const departure = {
      agency_id: 'go-transit', route_id: 'BR', route_label: 'TRAIN', trip_id: '407',
      service_date: '20260807', scheduled_departure_time: now / 1000 + 600,
      expected_departure_time: now / 1000 + 600, departure_source: 'estimated',
      prediction_match_type: 'exact', prediction_trip_id: '407',
    };
    const vehicle = {
      id: 'go-transit:620', agency_id: 'go-transit', trip_id: '20260807-BR-407',
      start_date: '20260807', lat: 44.38, lon: -79.68, last_reported: now / 1000 - 10,
    };
    expect(applyVehicleEvidence([departure], { vehicles: [vehicle] }, now, 120000)[0].departure_source)
      .toBe('realtime');
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
      { id: 'expired', agency_id: 'barrie-transit', route_label: '7A', destination: 'Grove', platform: '6', scheduled_departure_time: start - 1, expected_departure_time: start + 300, departure_source: 'realtime' },
      { id: 'prediction-expired', agency_id: 'barrie-transit', route_label: '7A', destination: 'Grove', platform: '6', scheduled_departure_time: start + 60, expected_departure_time: start - 1, departure_source: 'realtime' },
      { id: 'first', agency_id: 'barrie-transit', route_label: '12B', destination: 'Barrie South GO', platform: '14', scheduled_departure_time: start + 300, expected_departure_time: start + 900 },
      { id: 'duplicate', agency_id: 'barrie-transit', route_label: '12B', destination: 'Barrie South GO', platform: '14', scheduled_departure_time: start + 400, expected_departure_time: start + 400 },
      { id: 'second', agency_id: 'ontario-northland', route_label: '101', destination: 'North Bay', platform: '8', scheduled_departure_time: start + 600, expected_departure_time: start + 600 },
      { id: 'same-time-later-platform', agency_id: 'barrie-transit', route_label: '8B', destination: 'Crosstown', platform: '12', scheduled_departure_time: start + 600, expected_departure_time: start + 600 },
      { id: 'outside-window', agency_id: 'ontario-northland', route_label: '201', destination: 'Sudbury', platform: '8', scheduled_departure_time: start + 3601, expected_departure_time: start + 3601 },
    ], now, 10);
    expect(rows.map((row) => row.id)).toEqual(['expired', 'first', 'second', 'same-time-later-platform']);
  });

  test('uses public-facing Ontario Northland route numbers and target LINX wording', () => {
    const now = Date.parse('2026-08-04T16:00:00Z');
    const common = metadata().service_calendars;
    const northland = collectScheduledDepartures({
      service_calendars: common,
      service_exceptions: {},
      routes: { ONTC: { short_name: 'ONTC', long_name: 'Toronto - North Bay' } },
      trips: { '101:north': { route_id: 'ONTC', service_id: 'weekday', headsign: 'NORTH BAY', terminal_stops: [{ stop_id: '315', departure_time: '12:10:00', is_departure: true }] } },
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
    expect(rows[0]).toMatchObject({
      agency_id: 'go-transit', route_label: '68', destination: 'Barrie / Newmarket', platform: '7',
      service_date: '20260804', departure_source: 'estimated', prediction_match_type: 'exact', prediction_trip_id: '123',
    });
  });
});
