import { describe, expect, test } from 'vitest';
import routesModule from '../monitor/routes.js';

const { normalizeRouteId } = routesModule;

describe('monitor route normalization', () => {
  test('merges 2A and 2B into route 2', () => {
    expect(normalizeRouteId('2A')).toBe('2');
    expect(normalizeRouteId('2B')).toBe('2');
  });

  test('merges 7A and 7B into route 7', () => {
    expect(normalizeRouteId('7A')).toBe('7');
    expect(normalizeRouteId('7B')).toBe('7');
  });

  test('merges 12A and 12B into route 12', () => {
    expect(normalizeRouteId('12A')).toBe('12');
    expect(normalizeRouteId('12B')).toBe('12');
  });

  test('keeps 8A and 8B separate', () => {
    expect(normalizeRouteId('8A')).toBe('8A');
    expect(normalizeRouteId('8B')).toBe('8B');
  });

  test('preserves already-merged and numeric routes', () => {
    expect(normalizeRouteId('2')).toBe('2');
    expect(normalizeRouteId('10')).toBe('10');
    expect(normalizeRouteId('100')).toBe('100');
    expect(normalizeRouteId('101')).toBe('101');
    expect(normalizeRouteId('400')).toBe('400');
  });
});

