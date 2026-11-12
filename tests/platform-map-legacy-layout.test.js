import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  applyLegacyMapSizing,
  computeMapPlaneBox,
  needsLegacyMapSizing,
} from '../frontend/src/platform-map/legacy-layout.js';

const RATIO = 11659 / 9010;

function stubCssSupports(supportsFn) {
  vi.stubGlobal('window', { CSS: { supports: supportsFn } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('platform map sizing for older TV browsers', () => {
  test('matches the CSS framing on the 1920x1080 TV stage', () => {
    // Map stage on the 1920x1080 TV is about 972 x 935.
    const box = computeMapPlaneBox(972, 935);
    expect(box.width).toBeCloseTo(1.447 * 972, 5);
    expect(box.height).toBeCloseTo(box.width / RATIO, 5);
    // Centred 2.47% of the stage width right of middle, and vertically centred.
    expect(box.left + box.width / 2).toBeCloseTo(972 / 2 + 0.0247 * 972, 5);
    expect(box.top + box.height / 2).toBeCloseTo(935 / 2, 5);
  });

  test('scales to the stage height on tall stages and zooms out on narrow ones', () => {
    expect(computeMapPlaneBox(700, 900).width).toBeCloseTo(1.294 * 900, 5);
    expect(computeMapPlaneBox(500, 600).width).toBeCloseTo(Math.max(1.55 * 500, 1.1 * 600), 5);
  });

  test('ignores a stage that has not been laid out', () => {
    expect(computeMapPlaneBox(0, 935)).toBeNull();
    expect(computeMapPlaneBox(972, 0)).toBeNull();
  });

  test('is needed when container units or aspect-ratio are unsupported', () => {
    stubCssSupports(() => true);
    expect(needsLegacyMapSizing()).toBe(false);
    stubCssSupports((property, value) => !String(value).includes('cqw'));
    expect(needsLegacyMapSizing()).toBe(true);
    stubCssSupports((property) => property !== 'aspect-ratio');
    expect(needsLegacyMapSizing()).toBe(true);
    stubCssSupports(undefined);
    expect(needsLegacyMapSizing()).toBe(true);
  });

  test('writes a pixel box only on browsers that need it', () => {
    const stage = { clientWidth: 972, clientHeight: 935 };
    const plane = { style: {} };

    stubCssSupports(() => true);
    expect(applyLegacyMapSizing(stage, plane)).toBe(false);
    expect(plane.style).toEqual({});

    stubCssSupports(() => false);
    expect(applyLegacyMapSizing(stage, plane)).toBe(true);
    const box = computeMapPlaneBox(972, 935);
    expect(plane.style).toEqual({
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      transform: 'none',
    });
  });
});
