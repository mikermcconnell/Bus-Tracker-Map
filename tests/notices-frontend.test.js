import { describe, expect, test } from 'vitest';
import { isValidManifest } from '../frontend/src/notices/main.js';

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
