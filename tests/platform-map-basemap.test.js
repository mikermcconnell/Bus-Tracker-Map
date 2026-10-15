import { describe, expect, test } from 'vitest';
import calibration from '../frontend/src/platform-map/basemap-calibration.json';
import {
  basemapPixel,
  projectToBasemap,
  snapToTrack,
  trackPoint,
} from '../frontend/src/platform-map/model.js';
import { describeGoTrain, isGoTrain } from '../frontend/src/platform-map/go-train.js';

const GO_TRACK = [[44.373855, -79.6925], [44.37316, -79.6835]];

describe('simulator base map calibration', () => {
  test('puts the capture centre in the middle of the image', () => {
    const centre = projectToBasemap(calibration.center.lat, calibration.center.lon, calibration);
    expect(centre.x).toBeCloseTo(50, 1);
    expect(centre.y).toBeCloseTo(50, 1);
  });

  test('keeps every platform and the pick-up point inside the visible map at 1920x1080', () => {
    // The map window shows image x 203-1175 and y 101-977; cards cover the top and bottom 125 px.
    const points = [
      [44.373611, -79.688611], [44.373833, -79.689111], [44.373917, -79.689806], [44.374250, -79.689722],
      [44.374306, -79.688944], [44.374167, -79.690444], [44.374028, -79.690528], [44.373583, -79.691111],
      [44.373639, -79.687411],
    ];
    points.forEach(([lat, lon]) => {
      const pixel = basemapPixel(lat, lon, calibration);
      expect(pixel.x).toBeGreaterThan(203 + 40);
      expect(pixel.x).toBeLessThan(1175 - 40);
      expect(pixel.y).toBeGreaterThan(101 + 125);
      expect(pixel.y).toBeLessThan(977 - 125);
    });
  });

  test('places north up: a point further north is higher on the image', () => {
    const south = basemapPixel(44.3735, -79.689, calibration);
    const north = basemapPixel(44.3745, -79.689, calibration);
    expect(north.y).toBeLessThan(south.y);
  });

  test('rejects missing coordinates', () => {
    expect(basemapPixel(null, -79.689, calibration)).toBeNull();
    expect(projectToBasemap(44.37, 'x', calibration)).toBeNull();
  });
});

describe('GO track placement', () => {
  test('measures distance along and away from the track', () => {
    const middle = trackPoint(GO_TRACK, 300);
    const snapped = snapToTrack(GO_TRACK, middle[0], middle[1]);
    expect(snapped.along).toBeCloseTo(300, 0);
    expect(snapped.offset).toBeLessThan(0.5);
    // The P1 GO platform pointer is a few metres north of the track.
    const p1 = snapToTrack(GO_TRACK, 44.373611, -79.688611);
    expect(p1.offset).toBeLessThan(15);
    // A bus on Tiffin St is far off the track.
    expect(snapToTrack(GO_TRACK, 44.3745, -79.6905).offset).toBeGreaterThan(60);
  });
});

describe('GO train status label', () => {
  const now = Date.parse('2026-10-09T18:00:00Z');
  const train = {
    agency_id: 'go-transit',
    route_mode: 'train',
    trip_headsign: 'Union Station',
    terminal_is_departure: true,
  };

  test('recognises GO trains but not GO buses', () => {
    expect(isGoTrain(train)).toBe(true);
    expect(isGoTrain({ agency_id: 'go-transit', route_mode: 'bus' })).toBe(false);
    expect(isGoTrain({ agency_id: 'barrie-transit', route_mode: 'train' })).toBe(false);
  });

  test('says Boarding only for a departing trip within 20 minutes', () => {
    expect(describeGoTrain({ ...train, terminal_progress_status: 'at_terminal', terminal_departure_time: now / 1000 + 600 }, now))
      .toMatchObject({ state: 'boarding', title: 'GO Train · Boarding', detail: 'to Union Station · departs 2:10 PM' });
    expect(describeGoTrain({ ...train, terminal_progress_status: 'at_terminal', terminal_departure_time: now / 1000 + 45 * 60 }, now))
      .toMatchObject({ state: 'platform' });
    expect(describeGoTrain({
      ...train, terminal_progress_status: 'at_terminal', terminal_departure_time: now / 1000 + 600, terminal_is_departure: false,
    }, now)).toMatchObject({ state: 'platform' });
  });

  test('says Arriving while approaching and nothing once departed', () => {
    expect(describeGoTrain({ ...train, terminal_progress_status: 'approaching' }, now)).toMatchObject({ state: 'arriving' });
    expect(describeGoTrain({ ...train, terminal_progress_status: 'departed' }, now)).toBeNull();
  });
});
