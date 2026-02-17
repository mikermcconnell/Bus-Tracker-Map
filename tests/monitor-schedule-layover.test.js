import { describe, expect, test } from 'vitest';
import scheduleModule from '../monitor/schedule.js';

const { applyLayoverGrace, getActiveTripsNow } = scheduleModule;

describe('monitor layover grace', () => {
  test('bridges short same-route layovers within the same block', () => {
    const spans = [
      { tripId: 'a', routeId: '2', blockId: 'block-1', startSecs: 11 * 3600, endSecs: 11 * 3600 + 58 * 60 },
      { tripId: 'b', routeId: '2', blockId: 'block-1', startSecs: 12 * 3600 + 5 * 60, endSecs: 12 * 3600 + 41 * 60 },
    ];

    const merged = applyLayoverGrace(spans, 7 * 60);
    expect(merged).toHaveLength(1);

    const at1200 = getActiveTripsNow(merged, 12 * 3600).byRoute.get('2') || 0;
    expect(at1200).toBe(1);
  });

  test('does not bridge gaps larger than grace window', () => {
    const spans = [
      { tripId: 'a', routeId: '101', blockId: 'block-2', startSecs: 11 * 3600, endSecs: 11 * 3600 + 50 * 60 },
      { tripId: 'b', routeId: '101', blockId: 'block-2', startSecs: 12 * 3600 + 10 * 60, endSecs: 12 * 3600 + 50 * 60 },
    ];

    const merged = applyLayoverGrace(spans, 7 * 60);
    expect(merged).toHaveLength(2);

    const at1200 = getActiveTripsNow(merged, 12 * 3600).byRoute.get('101') || 0;
    expect(at1200).toBe(0);
  });

  test('does not merge across different blocks', () => {
    const spans = [
      { tripId: 'a', routeId: '7', blockId: 'block-a', startSecs: 11 * 3600, endSecs: 11 * 3600 + 57 * 60 },
      { tripId: 'b', routeId: '7', blockId: 'block-b', startSecs: 12 * 3600, endSecs: 12 * 3600 + 57 * 60 },
    ];

    const merged = applyLayoverGrace(spans, 10 * 60);
    expect(merged).toHaveLength(2);
  });
});

