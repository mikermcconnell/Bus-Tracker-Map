import { afterEach, describe, expect, test } from 'vitest';
import http from 'node:http';
import bindings from 'gtfs-realtime-bindings';
import module from '../server/gtfs-trip-updates.js';

const { parseTripUpdates, fetchTripUpdates, resetTripUpdatesCache } = module;
const { FeedMessage } = bindings.transit_realtime;
let server;

afterEach(async () => {
  resetTripUpdatesCache();
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

function decoded(stops) {
  return FeedMessage.decode(FeedMessage.encode(FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: '2.0', timestamp: 1790955148 },
    entity: [{ id: 'bus', tripUpdate: { trip: { tripId: 'outbound', routeId: '2', startDate: '20261002' }, stopTimeUpdate: stops } }],
  })).finish());
}

describe('GTFS trip-update parsing and cache boundaries', () => {
  test('protobuf defaults do not turn missing event fields into a zero-delay prediction', () => {
    const rows = parseTripUpdates(decoded([{ stopId: 'SCSTOP210', departure: {} }]), ['SCSTOP210']);
    expect(rows[0]).toMatchObject({ departure_time: null, delay_seconds: null });
  });

  test('explicit protobuf zero delay remains distinct from absent fields', () => {
    const rows = parseTripUpdates(decoded([{ stopId: 'SCSTOP210', departure: { delay: 0 } }]), ['SCSTOP210']);
    expect(rows[0]).toMatchObject({ departure_time: null, delay_seconds: 0 });
  });

  test('does not reuse a stop-filtered cache across different departure boards', async () => {
    const feed = decoded([
      { stopId: '9003', departure: { time: 1790958600 } },
      { stopId: '1', departure: { time: 1790958600 } },
    ]);
    const body = FeedMessage.encode(feed).finish();
    server = http.createServer((_request, response) => { response.end(Buffer.from(body)); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/tripupdates.pb`;
    const first = await fetchTripUpdates(url, ['9003']);
    const second = await fetchTripUpdates(url, ['1']);
    expect(first.updates.map((row) => row.stop_id)).toEqual(['9003']);
    expect(second.updates.map((row) => row.stop_id)).toEqual(['1']);
  });
});
