const { test, expect } = require('@playwright/test');

const transparentTile = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('regional map loads, focuses a route, and reveals live service status', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/region-tile/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentTile }));
  await page.route('**/api/simcoe/config?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      bounds: [-80.23, 44.05, -79.4, 44.79],
      barrie_reveal_zoom: 11,
      stops_reveal_zoom: 12,
      poll_ms: 30000,
      feed_offline_after_ms: 900000,
      basemap: { url: '/region-tile/{z}/{x}/{y}.png', tile_size: 256, zoom_offset: 0, max_zoom: 19 },
    }),
  }));
  await page.route('**/api/simcoe/routes.geojson?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { agency_id: 'simcoe-linx', agency_name: 'Simcoe County LINX', route_id: 'LINX-4', route_short_name: 'LINX 4', route_long_name: 'Collingwood–Wasaga Beach', route_color: '#006747' }, geometry: { type: 'LineString', coordinates: [[-80.22, 44.49], [-80.0, 44.52]] } },
      { type: 'Feature', properties: { agency_id: 'go-transit', agency_name: 'GO Transit', route_id: 'GO-TRAIN', route_short_name: 'GO TRAIN', route_long_name: 'Barrie line', route_color: '#003767' }, geometry: { type: 'LineString', coordinates: [[-79.7, 44.1], [-79.69, 44.38]] } },
      { type: 'Feature', properties: { agency_id: 'ontario-northland', agency_name: 'Ontario Northland', route_id: 'ONTC', route_short_name: 'ON', route_long_name: 'Ontario Northland', route_color: '#00214D' }, geometry: { type: 'LineString', coordinates: [[-79.7, 44.3], [-79.5, 44.7]] } },
      { type: 'Feature', properties: { agency_id: 'barrie-transit', agency_name: 'Barrie Transit', route_id: '8A', route_short_name: '8A', route_long_name: 'RVH / Yonge', route_color: '#A6192E' }, geometry: { type: 'LineString', coordinates: [[-79.72, 44.35], [-79.67, 44.42]] } },
    ] }),
  }));
  await page.route('**/api/simcoe/stops.geojson?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
  }));
  await page.route('**/api/simcoe/vehicles.json?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      feed_status: 'live',
      vehicles: [{ id: 'linx-4', route_id: 'LINX-4', route_label: 'LINX 4', agency_id: 'simcoe-linx', agency_name: 'Simcoe County LINX', lat: 44.51, lon: -80.1, last_reported: now, route_color: '#006747', trip_headsign: 'Wasaga Beach' }],
      sources: {
        simcoe_linx: { feed_status: 'live', vehicle_count: 1 },
        go_transit: { feed_status: 'live', vehicle_count: 0 },
        ontario_northland: { feed_status: 'live', vehicle_count: 0 },
        barrie_transit: { feed_status: 'live', vehicle_count: 0 },
      },
    }),
  }));

  await page.goto('/simcoe');
  await expect(page).toHaveTitle('Simcoe Region Live Transit');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('#overall-status')).toHaveText('1 live vehicle');
  await expect(page.locator('.agency-card')).toHaveCount(4);
  await page.getByRole('button', { name: /LINX 4/ }).click();
  await expect(page.locator('#selection-card')).toBeVisible();
  await expect(page.locator('#selection-title')).toHaveText('LINX 4');
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);
  expect(errors).toEqual([]);
});
