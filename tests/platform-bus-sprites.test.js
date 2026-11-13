import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { busSpriteUrl, busSpriteWidth, spriteHeadingIndex } from '../frontend/src/platform-map/bus-sprites.js';
import { GO_TRAIN_CONSIST, goTrainSpritePlacement, goTrainSpriteUrl } from '../frontend/src/platform-map/go-train.js';
import manifest from '../frontend/src/platform-map/bus-sprites/manifest.json';

const SPRITE_DIR = path.join(__dirname, '..', 'frontend', 'src', 'platform-map', 'bus-sprites');

describe('platform map bus sprites', () => {
  test('snaps a compass bearing to the nearest rendered direction', () => {
    expect(spriteHeadingIndex(0)).toBe(0);
    expect(spriteHeadingIndex(11)).toBe(0);
    expect(spriteHeadingIndex(12)).toBe(1);
    expect(spriteHeadingIndex(90)).toBe(4);
    expect(spriteHeadingIndex(355)).toBe(0);
    expect(spriteHeadingIndex(-90)).toBe(12);
  });

  test('shows the side view when no direction is known', () => {
    expect(spriteHeadingIndex(undefined)).toBe(4);
    expect(spriteHeadingIndex('unknown')).toBe(4);
  });

  test('paints a Barrie bus roof with its route colour', () => {
    const vehicle = { agency_id: 'barrie-transit', route_id: '7A' };
    expect(busSpriteUrl(vehicle, '#f58220', 90)).toBe('./assets/bus-sprites/barrie-F58220-04.webp');
  });

  test('uses brand navy for a Barrie route colour with no drawing', () => {
    const vehicle = { agency_id: 'barrie-transit', route_id: '99' };
    expect(busSpriteUrl(vehicle, '#123456', 0)).toBe(`./assets/bus-sprites/barrie-${manifest.barrie_default_color}-00.webp`);
  });

  test('uses the operator livery for regional buses, whatever the route colour', () => {
    expect(busSpriteUrl({ agency_id: 'go-transit' }, '#003767', 180)).toBe('./assets/bus-sprites/go-transit-08.webp');
    expect(busSpriteUrl({ agency_id: 'simcoe-linx' }, '#006747', 270)).toBe('./assets/bus-sprites/simcoe-linx-12.webp');
    expect(busSpriteUrl({ agency_id: 'ontario-northland' }, '#00214D', 45)).toBe('./assets/bus-sprites/ontario-northland-02.webp');
  });

  test('leaves trains on their own symbol', () => {
    expect(busSpriteUrl({ agency_id: 'go-transit', route_mode: 'train' }, '#003767', 90)).toBe('');
  });

  test('sizes a sprite from the map scale, 2.2 times life size', () => {
    const calibration = { width: 1428, metres_per_pixel: 0.35 };
    expect(busSpriteWidth(1428, calibration)).toBeCloseTo((manifest.view_metres / 0.35) * 2.2, 5);
  });

  test('has a train drawing on disk for every kind of car in the train', () => {
    const kinds = [...new Set(GO_TRAIN_CONSIST.map((car) => car.kind))];
    expect(manifest.train.cars.slice().sort()).toEqual(kinds.slice().sort());
    kinds.forEach((kind) => {
      expect(goTrainSpriteUrl(kind)).toBe(`./assets/bus-sprites/go-train-${kind}.webp`);
      expect(fs.existsSync(path.join(SPRITE_DIR, `go-train-${kind}.webp`))).toBe(true);
    });
  });

  test('centres a train car drawing on its stretch of track and scales it to the car', () => {
    const view = manifest.train.view_metres;
    const place = goTrainSpritePlacement({
      kind: 'coach',
      metres: 26,
      start: { x: 100, y: 200 },
      end: { x: 174.3, y: 206.2 },
    });
    const length = Math.hypot(74.3, 6.2);
    expect(place.width).toBeCloseTo(length * view.width / 26, 5);
    expect(place.height).toBeCloseTo(place.width * view.height / view.width, 5);
    expect(place.x + place.width / 2).toBeCloseTo(137.15, 5);
    expect(place.y + place.height / 2).toBeCloseTo(203.1, 5);
    // The track on the map is close to the angle the drawing was rendered at.
    expect(Math.abs(place.rotation)).toBeLessThan(2);
  });

  test('skips a train car with no length', () => {
    const point = { x: 10, y: 10 };
    expect(goTrainSpritePlacement({ kind: 'coach', metres: 26, start: point, end: point })).toBeNull();
  });

  test('has a drawing on disk for every direction of every livery', () => {
    const names = [
      ...[...manifest.barrie_colors, manifest.barrie_default_color].map((color) => `barrie-${color}`),
      'go-transit',
      'simcoe-linx',
      'ontario-northland',
    ];
    const missing = [];
    names.forEach((name) => {
      for (let index = 0; index < manifest.headings; index += 1) {
        const file = `${name}-${String(index).padStart(2, '0')}.webp`;
        if (!fs.existsSync(path.join(SPRITE_DIR, file))) missing.push(file);
      }
    });
    expect(missing).toEqual([]);
  });
});
