import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDataClient } from '../frontend/src/data/client.js';

describe('frontend data client route loading', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('uses a stable route URL so Vercel can share the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] })
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDataClient().fetchRoutes();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/routes.geojson',
      {}
    );
  });

  test('times out a stalled departures request so polling can recover', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const request = createDataClient().fetchDepartures(11, { timeoutMs: 1000 });
    const rejection = expect(request).rejects.toThrow('Request timed out after 1000ms');
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/departures?limit=11',
      expect.objectContaining({ signal: expect.anything() })
    );
    vi.useRealTimers();
  });

  test('requests the merged Downtown Hub departure board explicitly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ departures: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDataClient().fetchDepartures(11, { board: 'downtown' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/departures?limit=11&board=downtown',
      {}
    );
  });

  test('requests the supported Allandale departure maximum explicitly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ departures: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDataClient().fetchDepartures(30, { board: 'allandale' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/departures?limit=30&board=allandale',
      {}
    );
  });

  test('uses a stable realtime URL without disabling the shared CDN cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vehicles: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDataClient().fetchVehicles();

    expect(fetchMock).toHaveBeenCalledWith('/api/vehicles.json', {});
  });

});
