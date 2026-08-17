import { describe, expect, test } from 'vitest';
import regionModule from '../scripts/build-simcoe-region.js';

const { boundsFromCoordinates, expandBounds, insideBounds } = regionModule;

describe('Simcoe regional build helpers', () => {
  test('derives and pads bounds for nested route coordinates', () => {
    const bounds = boundsFromCoordinates([
      [[-80.2, 44.1], [-79.4, 44.7]],
      [[-79.9, 44.0], [-79.5, 44.8]],
    ]);
    expect(bounds).toEqual([-80.2, 44.0, -79.4, 44.8]);
    expect(expandBounds(bounds, 0.01)).toEqual([-80.21000000000001, 43.99, -79.39, 44.809999999999995]);
  });

  test('accepts only finite positions within the regional extent', () => {
    const bounds = [-80.2, 44.0, -79.4, 44.8];
    expect(insideBounds(44.4, -79.7, bounds)).toBe(true);
    expect(insideBounds(43.9, -79.7, bounds)).toBe(false);
    expect(insideBounds('missing', -79.7, bounds)).toBe(false);
  });
});
