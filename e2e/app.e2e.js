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

test('BATT map loads without runtime errors', async ({ page }) => {
  const errors = captureRuntimeErrors(page);

  await page.goto('/batt.map');
  await expect(page.locator('#batt-map')).toHaveClass(/leaflet-container/);

  expect(errors).toEqual([]);
});

test('platform map loads without runtime errors', async ({ page }) => {
  const errors = captureRuntimeErrors(page);

  await page.goto('/platform.map', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Barrie Allandale Terminal/);
  await expect(page.locator('#platform-canvas')).toBeVisible();
  await expect(page.locator('#bus-layer')).toBeAttached();

  expect(errors).toEqual([]);
});

test('platform map renders current assignments and updates markers in place', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let vehiclePoll = 0;

  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      poll_ms: 750,
      feed_delayed_after_ms: 120000,
      feed_offline_after_ms: 900000,
      base_path: '/',
    }),
  }));
  await page.route('**/api/routes.geojson?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: null,
        properties: {
          route_id: '8A',
          route_color: '000000',
          route_text_color: 'FFFFFF',
        },
      }],
    }),
  }));
  await page.route('**/api/terminal-layout?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generated_at: new Date().toISOString(),
      assignments: [
        {
          platform: '3',
          route_id: '8A',
          route_label: '8A',
          destination: 'Yonge Southbound',
          agency_id: 'barrie-transit',
        },
        {
          platform: '13',
          route_id: '12A',
          route_label: '12A',
          destination: 'Georgian Mall',
          agency_id: 'barrie-transit',
        },
      ],
    }),
  }));
  await page.route('**/api/service-status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ is_special_service: false }),
  }));
  await page.route('**/api/vehicles.json?*', (route) => {
    vehiclePoll += 1;
    const lat = 44.373837 + Math.min(vehiclePoll - 1, 10) * 0.000005;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        feed_timestamp: nowSeconds,
        vehicles: [{
          id: 'platform-bus',
          route_id: '8A',
          route_label: '8A',
          direction_id: 1,
          agency_id: 'barrie-transit',
          agency_name: 'Barrie Transit',
          lat,
          lon: -79.689279,
          bearing: 180,
          last_reported: nowSeconds,
          terminal_progress_status: 'at_terminal',
          terminal_stop_id: '9003',
        }],
        sources: {
          barrie_transit: { feed_status: 'live' },
          go_transit: { feed_status: 'live' },
          ontario_northland: { feed_status: 'live' },
        },
      }),
    });
  });

  await page.goto('/platform.map');
  await expect(page.locator('.platform-card[data-platform="3"]')).toContainText('Yonge Southbound');
  await expect(page.locator('.platform-card[data-platform="13"]')).toContainText('Georgian Mall');
  await expect(page.locator('.platform-card[data-platform="14"]')).toContainText('No scheduled service');
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);
  await expect(page.locator('.vehicle-marker__detail')).toContainText('SOUTHBOUND');
  const initialPosition = await page.locator('.vehicle-marker').evaluate(
    (element) => `${element.style.left}|${element.style.top}`
  );
  await page.locator('.vehicle-marker').evaluate((element) => {
    element.dataset.auditIdentity = 'preserved';
  });
  await expect.poll(() => vehiclePoll).toBeGreaterThan(1);
  await expect.poll(
    () => page.locator('.vehicle-marker').evaluate(
      (element) => `${element.style.left}|${element.style.top}`
    )
  ).not.toBe(initialPosition);
  await expect(page.locator('.vehicle-marker')).toHaveAttribute('data-audit-identity', 'preserved');
});

test('platform map calibration stays inside the image at a 4:3 viewport', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.route('**/api/vehicles.json?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      feed_timestamp: nowSeconds,
      vehicles: [{
        id: 'aspect-bus',
        route_id: '7A',
        route_label: '7A',
        agency_id: 'barrie-transit',
        lat: 44.373837,
        lon: -79.689279,
        last_reported: nowSeconds,
      }],
      sources: {
        barrie_transit: { feed_status: 'live' },
        go_transit: { feed_status: 'live' },
        ontario_northland: { feed_status: 'live' },
      },
    }),
  }));

  await page.goto('/platform.map');
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);
  const bounds = await page.evaluate(() => {
    const canvas = globalThis.document.getElementById('platform-canvas').getBoundingClientRect();
    const marker = globalThis.document.querySelector('.vehicle-marker').getBoundingClientRect();
    const header = globalThis.document.querySelector('.platform-header').getBoundingClientRect();
    return {
      inside:
        marker.left >= canvas.left &&
        marker.right <= canvas.right &&
        marker.top >= header.bottom &&
        marker.bottom <= canvas.bottom,
    };
  });
  expect(bounds.inside).toBe(true);
});

test('platform map hides vehicle icons when the live feed goes offline', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let pollCount = 0;
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      poll_ms: 750,
      feed_delayed_after_ms: 120000,
      feed_offline_after_ms: 900000,
      base_path: '/',
    }),
  }));
  await page.route('**/api/vehicles.json?*', (route) => {
    pollCount += 1;
    const offline = pollCount > 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetch_error: offline ? 'upstream unavailable' : undefined,
        feed_timestamp: nowSeconds,
        vehicles: offline ? [] : [{
          id: 'offline-bus',
          route_id: '7A',
          route_label: '7A',
          agency_id: 'barrie-transit',
          lat: 44.373837,
          lon: -79.689279,
          last_reported: nowSeconds,
        }],
        sources: {
          barrie_transit: { feed_status: offline ? 'offline' : 'live' },
          go_transit: { feed_status: offline ? 'offline' : 'live' },
          ontario_northland: { feed_status: offline ? 'offline' : 'live' },
        },
      }),
    });
  });

  await page.goto('/platform.map');
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);
  await expect(page.locator('.vehicle-marker')).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('#connection-label')).toHaveText('OFFLINE');
  await expect(page.locator('#platform-status')).toContainText('Icons are hidden');
});

test('notice display renders a holding state', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.route('**/api/notices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'fresh',
        checked_at: new Date().toISOString(),
        refresh_after_ms: 120000,
        slides: [],
      }),
    });
  });

  await page.goto('/notices');
  await expect(page).toHaveTitle(/Service Notices/);
  await expect(page.locator('#holding-title')).toContainText(/No active .*service notices/i);
  expect(errors).toEqual([]);
});
