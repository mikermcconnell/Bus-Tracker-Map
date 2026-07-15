import { describe, expect, test } from 'vitest';
import {
  classifySlide,
  getPlaybackState,
  getSlideDurationMs,
  isValidManifest,
  organizeSlides,
} from '../frontend/src/notices/main.js';

describe('notice display manifest validation', () => {
  test('accepts fresh and stale playlists with timestamps and slide arrays', () => {
    expect(isValidManifest({ status: 'fresh', checked_at: '2026-07-14T17:00:00Z', slides: [] })).toBe(true);
    expect(isValidManifest({ status: 'stale', checked_at: '2026-07-14T17:00:00Z', slides: [{}] })).toBe(true);
  });

  test('rejects malformed or unavailable responses', () => {
    expect(isValidManifest(null)).toBe(false);
    expect(isValidManifest({ status: 'unavailable', checked_at: 'now', slides: [] })).toBe(false);
    expect(isValidManifest({ status: 'fresh', checked_at: null, slides: [] })).toBe(false);
    expect(isValidManifest({ status: 'fresh', checked_at: 'now', slides: null })).toBe(false);
  });
});

describe('notice display playlist organization', () => {
  const slide = (id, title) => ({ id, title, image_url: `api/${id}.jpg` });

  test('groups detours, stop closures, shuttles, and holiday service in display order', () => {
    const organized = organizeSlides([
      slide('shuttle-1', 'Troubadour Festival Shuttle'),
      slide('stop-1', 'Stop 265 - Route 2B'),
      slide('holiday-1', 'Christmas Holiday Service'),
      slide('detour-1', 'Livingstone Detour - Route 8A'),
      slide('detour-2', 'Mapleview Detour and Shuttle'),
      slide('stop-2', 'Stop 54 Closure - Route 12A'),
    ]);

    expect(organized.map((item) => item.id)).toEqual([
      'detour-1',
      'detour-2',
      'stop-1',
      'stop-2',
      'shuttle-1',
      'holiday-1',
    ]);
    expect(organized.map((item) => item.category)).toEqual([
      'detour',
      'detour',
      'stop-closure',
      'stop-closure',
      'shuttle',
      'holiday-service',
    ]);
  });

  test('gives stop closures less screen time than detours', () => {
    expect(classifySlide(slide('stop', 'Stop 54 Closure - Route 12A'))).toBe('stop-closure');
    expect(getSlideDurationMs(slide('stop', 'Stop 265 - Route 2B'))).toBe(10000);
    expect(getSlideDurationMs(slide('detour', 'Shanty Bay Detour'))).toBe(30000);
    expect(classifySlide(slide('shuttle', 'Festival Shuttle'))).toBe('shuttle');
    expect(classifySlide(slide('holiday', 'Canada Day Holiday Service'))).toBe('holiday-service');
  });

  test('marks the current, next, past, and waiting slides', () => {
    expect(getPlaybackState(2, 2, 5)).toBe('current');
    expect(getPlaybackState(3, 2, 5)).toBe('next');
    expect(getPlaybackState(1, 2, 5)).toBe('past');
    expect(getPlaybackState(4, 2, 5)).toBe('waiting');
    expect(getPlaybackState(0, 4, 5)).toBe('next');
  });
});
