import { describe, expect, test } from 'vitest';
import {
  parseTerminalTripUpdates,
  selectTerminalTripUpdate,
} from '../server/vehicles.js';

describe('Barrie terminal trip updates', () => {
  test('extracts realtime terminal arrival and departure timestamps', () => {
    const feed = {
      entity: [{
        tripUpdate: {
          trip: { tripId: 'trip-8a' },
          stopTimeUpdate: [
            { stopId: '500', stopSequence: 20, arrival: { time: 1000 } },
            {
              stopId: '9003',
              stopSequence: 165,
              arrival: { time: 2000 },
              departure: { time: 2300 },
            },
          ],
        },
      }],
    };

    expect(parseTerminalTripUpdates(feed, ['9003'])).toEqual({
      'trip-8a': [{
        stop_id: '9003',
        stop_sequence: 165,
        arrival_time: 2000,
        departure_time: 2300,
      }],
    });
  });

  test('selects the next terminal visit when a trip serves it more than once', () => {
    const selected = selectTerminalTripUpdate({
      trip_id: 'loop-trip',
      current_stop_sequence: 80,
    }, {
      'loop-trip': [
        { stop_id: '9003', stop_sequence: 20, arrival_time: 1000 },
        { stop_id: '9004', stop_sequence: 100, arrival_time: 2000 },
      ],
    });

    expect(selected).toMatchObject({
      stop_id: '9004',
      stop_sequence: 100,
      arrival_time: 2000,
    });
  });
});
