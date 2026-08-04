import { describe, expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';

const stylePath = path.resolve(__dirname, '../mapbox/barrie-transit-tv-v1.style.json');
const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));

describe('Mapbox TV basemap style', () => {
  test('uses a classic style compatible with the Static Tiles API', () => {
    expect(style.version).toBe(8);
    expect(style.imports).toBeUndefined();
    expect(style.sources.composite.url).toBe('mapbox://mapbox.mapbox-streets-v8');
  });

  test('renders roads by hierarchy and places labels along road geometry', () => {
    const layers = Object.fromEntries(style.layers.map((layer) => [layer.id, layer]));

    expect(layers['local-road-casing']).toBeDefined();
    expect(layers['major-road-casing']).toBeDefined();
    expect(layers['major-road-labels'].layout['symbol-placement']).toBe('line');
    expect(layers['nearby-road-labels'].layout['symbol-placement']).toBe('line');
    expect(JSON.stringify(layers['nearby-road-labels'].filter)).toContain('Tiffin Street');
    expect(JSON.stringify(layers['nearby-road-labels'].filter)).toContain('Lakeshore Drive');
  });

  test('does not add competing POI or transit symbol layers', () => {
    expect(style.layers.some((layer) => /poi|transit/i.test(layer.id))).toBe(false);
  });

  test('renders every basemap layer at full opacity', () => {
    style.layers.forEach((layer) => {
      const paint = layer.paint || {};
      ['fill-opacity', 'line-opacity', 'background-opacity'].forEach((property) => {
        if (Object.prototype.hasOwnProperty.call(paint, property)) {
          expect(paint[property], `${layer.id} ${property}`).toBe(1);
        }
      });
    });
  });
});
