import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDataClient } from '../frontend/src/data/client.js';

describe('frontend data client route loading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('bypasses a previously cached route collection', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] })
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDataClient().fetchRoutes();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/routes.geojson?cb=3f',
      { cache: 'no-store' }
    );
  });

  test('bypasses cached terminal assignments', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(456);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ assignments: [] })
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDataClient().fetchTerminalLayout();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/terminal-layout?cb=co',
      { cache: 'no-store' }
    );
  });
});
