const { test, expect } = require('@playwright/test');

function captureRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('main map loads its locally bundled Leaflet runtime', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.route('**/api/service-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        is_special_service: false,
        upcoming_warning: {
          message: 'Upcoming Holiday Service - Civic Holiday Service: Sunday Schedules on Monday, August 3.',
        },
      }),
    });
  });
  await page.goto('/');

  await expect(page).toHaveTitle(/Find Your Bus/);
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.map-title__main')).toHaveText('Find Your Bus');
  await expect(page.locator('.service-notice__heading')).toHaveText('Upcoming Holiday Service -');
  await expect(page.locator('.service-notice__text')).toContainText(
    'Civic Holiday Service: Sunday Schedules on Monday, August 3.'
  );
  expect(errors).toEqual([]);
});

test('main map clears last-known vehicles when polling fails', async ({ page }) => {
  let failVehiclePolls = false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const transparentTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/review-tile/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: transparentTile });
  });
  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        poll_ms: 5000,
        feed_delayed_after_ms: 120000,
        feed_offline_after_ms: 900000,
        base_path: '/',
        tiles: '/review-tile/{z}/{x}/{y}.png',
        rt_feed_configured: true,
      }),
    });
  });
  await page.route('**/api/vehicles.json?*', async (route) => {
    if (failVehiclePolls) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: Date.now(),
        feed_timestamp: nowSeconds,
        latest_data_timestamp: nowSeconds,
        feed_status: 'live',
        vehicles: [{
          id: 'review-bus',
          route_id: '7A',
          route_label: '7A',
          agency_id: 'barrie-transit',
          agency_name: 'Barrie Transit',
          lat: 44.3745,
          lon: -79.6895,
          bearing: 90,
          last_reported: nowSeconds,
          terminal_progress_status: 'approaching',
        }],
        sources: {
          barrie_transit: {
            feed_status: 'live',
            latest_data_timestamp: nowSeconds,
            data_age_seconds: 0,
          },
        },
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.vehicle-bubble')).toHaveCount(1);
  failVehiclePolls = true;
  await expect(page.locator('.vehicle-bubble')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('#banner')).toContainText('Bus icons are hidden');
});
