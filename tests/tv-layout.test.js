import { describe, expect, it, vi } from 'vitest';
import {
  SIM_BASEMAP,
  buildRouteLegendItems,
  getSimBasemapBounds,
  getSimFocusBounds,
  getTvRouteColorOverride,
  isTvLayout,
  pickRoadLabelCandidates,
  splitDepartureLabel,
  stitchLines,
  startPixelShift,
} from '../frontend/src/tv-layout.js';

describe('isTvLayout', () => {
  it('only turns on for layout=tv', () => {
    expect(isTvLayout('?layout=tv')).toBe(true);
    expect(isTvLayout('?debug=1&layout=TV')).toBe(true);
    expect(isTvLayout('')).toBe(false);
    expect(isTvLayout('?layout=default')).toBe(false);
  });
});

describe('getSimBasemapBounds', () => {
  it('spans the render size at its metres-per-pixel scale', () => {
    const [[south, west], [north, east]] = getSimBasemapBounds();
    const heightMeters = (north - south) * 6371008.8 * Math.PI / 180;
    expect(heightMeters).toBeCloseTo(SIM_BASEMAP.height * SIM_BASEMAP.metresPerPixel, 0);
    expect((south + north) / 2).toBeCloseTo(SIM_BASEMAP.center.lat, 6);
    expect((west + east) / 2).toBeCloseTo(SIM_BASEMAP.center.lng, 6);
  });

  it('keeps the rider landmarks inside the focus area', () => {
    const [[south, west], [north, east]] = getSimFocusBounds();
    const inside = ([lat, lng]) => lat > south && lat < north && lng > west && lng < east;
    expect(inside([44.374, -79.69])).toBe(true); // Allandale terminal
    expect(inside([44.3519, -79.6284])).toBe(true); // Barrie South GO
    expect(inside([44.4144, -79.6635])).toBe(true); // RVH
    expect(inside([44.3404, -79.6803])).toBe(true); // Park Place
  });

  it('reaches well past the focus area so wide and tall screens still fill', () => {
    const [[iS, iW], [iN, iE]] = getSimBasemapBounds();
    const [[fS, fW], [fN, fE]] = getSimFocusBounds();
    expect((iE - iW) / (fE - fW)).toBeGreaterThan(1.5);
    expect((iN - iS) / (fN - fS)).toBeGreaterThan(1.25);
  });
});

describe('getTvRouteColorOverride', () => {
  it('separates 8B from 8A and deepens 12A/12B', () => {
    expect(getTvRouteColorOverride('8b')).toBe('#2563c9');
    expect(getTvRouteColorOverride('12A')).toBe('#e0569b');
    expect(getTvRouteColorOverride('8A')).toBeNull();
  });
});

describe('splitDepartureLabel', () => {
  it('splits timed labels into value, unit and caption', () => {
    expect(splitDepartureLabel('Arrives in 15 min')).toEqual({ caption: 'ARRIVES', value: '15', unit: 'min', now: false });
    expect(splitDepartureLabel('Departs in 3 min')).toEqual({ caption: 'DEPARTS', value: '3', unit: 'min', now: false });
  });

  it('shows "Now" for arriving and departing now', () => {
    expect(splitDepartureLabel('Arriving now')).toEqual({ caption: 'ARRIVING', value: 'Now', unit: '', now: true });
    expect(splitDepartureLabel('Departs now')).toEqual({ caption: 'DEPARTING', value: 'Now', unit: '', now: true });
  });

  it('returns null for empty labels and passes unknown text through', () => {
    expect(splitDepartureLabel('')).toBeNull();
    expect(splitDepartureLabel('Delayed')).toEqual({ caption: '', value: 'Delayed', unit: '', now: false });
  });
});

describe('buildRouteLegendItems', () => {
  const meta = (displayName, color, agencyId = 'barrie-transit') => ({ displayName, color, agencyId });

  it('merges same-colour routes of one agency and skips hidden routes', () => {
    const items = buildRouteLegendItems([
      { routeId: '7A', meta: meta('7A', '#F58220') },
      { routeId: '7B', meta: meta('7B', '#f58220') },
      { routeId: '8A', meta: meta('8A', '#000000') },
      { routeId: '8B', meta: meta('8B', '#2563c9') },
      { routeId: 'ONTC', meta: meta('ON', '#000000', 'ontario-northland') },
      { routeId: 'X', meta: meta('X', '#123456'), visible: false },
    ]);
    expect(items.map((item) => item.label)).toEqual(['7A / 7B', '8A', '8B', 'ON']);
  });
});

describe('startPixelShift', () => {
  it('moves the element within the limit and resets on stop', () => {
    vi.useFakeTimers();
    const element = { style: { transform: '' } };
    const stop = startPixelShift(element, { intervalMs: 1000, maxShiftPx: 3, random: () => 1 });
    vi.advanceTimersByTime(1000);
    expect(element.style.transform).toBe('translate(3px, 3px)');
    stop();
    expect(element.style.transform).toBe('');
    vi.useRealTimers();
  });
});

describe('pickRoadLabelCandidates', () => {
  const bounds = [[44.33, -79.75], [44.42, -79.59]];

  it('places names on the longest stretch inside the bounds, middle first', () => {
    // East-west road from far outside the west edge to the middle of the map.
    const road = [[44.37, -79.80], [44.37, -79.70], [44.37, -79.65]];
    const [middle, early, late] = pickRoadLabelCandidates([road], bounds);
    expect(middle.lat).toBeCloseTo(44.37, 6);
    // Only the road's own points inside the bounds count: -79.70 to -79.65.
    expect(middle.lng).toBeCloseTo(-79.675, 6);
    expect(early.lng).toBeLessThan(middle.lng);
    expect(late.lng).toBeGreaterThan(middle.lng);
  });

  it('joins short road pieces before measuring', () => {
    // Three 400 m pieces (one reversed): too short alone, long enough joined.
    const pieces = [
      [[44.37, -79.700], [44.37, -79.695]],
      [[44.37, -79.690], [44.37, -79.695]],
      [[44.37, -79.690], [44.37, -79.685]],
    ];
    expect(stitchLines(pieces)).toHaveLength(1);
    const [middle] = pickRoadLabelCandidates(pieces, bounds);
    expect(middle.lng).toBeCloseTo(-79.6925, 6);
  });

  it('skips roads with no meaningful stretch on screen', () => {
    expect(pickRoadLabelCandidates([[[44.50, -79.70], [44.51, -79.70]]], bounds)).toEqual([]);
    expect(pickRoadLabelCandidates([[[44.37, -79.70], [44.37, -79.699]]], bounds)).toEqual([]);
  });
});
