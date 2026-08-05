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
  await page.setViewportSize({ width: 1720, height: 821 });
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

  await expect(page).toHaveTitle('FIND YOUR BUS - LIVE MAP');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.leaflet-map-pane')).toHaveCSS('position', 'absolute');
  await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('position', 'absolute');
  await expect(page.locator('.map-title__main')).toHaveText('FIND YOUR BUS - LIVE MAP');
  const terminalLabelLocator = page.locator(
    '.stop-highlight[data-stop="9002"] .stop-highlight-label'
  );
  const downtownLabelLocator = page.locator(
    '.stop-highlight[data-stop="1"] .stop-highlight-label'
  );
  await expect(terminalLabelLocator).toBeVisible();
  await expect(downtownLabelLocator).toBeVisible();
  const terminalLabel = await terminalLabelLocator.boundingBox();
  const downtownLabel = await downtownLabelLocator.boundingBox();
  expect(terminalLabel).not.toBeNull();
  expect(downtownLabel).not.toBeNull();
  expect(terminalLabel.x).toBeGreaterThan(748);
  expect(terminalLabel.x).toBeLessThan(760);
  expect(terminalLabel.y).toBeGreaterThan(421);
  expect(terminalLabel.y).toBeLessThan(431);
  expect(downtownLabel.x).toBeGreaterThan(734);
  expect(downtownLabel.x).toBeLessThan(746);
  expect(downtownLabel.y).toBeGreaterThan(297);
  expect(downtownLabel.y).toBeLessThan(308);
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
  await expect(page.locator('.vehicle-bubble')).toHaveCount(0, { timeout: 12000 });
  await expect(page.locator('#banner')).toContainText('Bus icons are hidden');
});

test('main map falls back from Mapbox without restoring floating road labels', async ({ page }) => {
  let mapboxRequests = 0;
  let fallbackRequests = 0;
  let majorRoadRequests = 0;
  const transparentTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/mock-mapbox/**', (route) => {
    mapboxRequests += 1;
    return route.abort('failed');
  });
  await page.route('**/fallback-tile/**', (route) => {
    fallbackRequests += 1;
    return route.fulfill({ status: 200, contentType: 'image/png', body: transparentTile });
  });
  await page.route('**/data/major-roads.geojson', (route) => {
    majorRoadRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
    });
  });
  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      poll_ms: 5000,
      base_path: '/',
      basemap: {
        provider: 'mapbox',
        url: '/mock-mapbox/{z}/{x}/{y}.png',
        tile_size: 512,
        zoom_offset: -1,
        max_zoom: 19,
        opacity: 1,
        attribution: 'Mapbox',
        fallback_url: '/fallback-tile/{z}/{x}/{y}.png',
        fallback_attribution: 'OpenStreetMap',
      },
      rt_feed_configured: false,
    }),
  }));

  await page.goto('/');

  await expect.poll(() => mapboxRequests).toBeGreaterThanOrEqual(3);
  await expect.poll(() => fallbackRequests).toBeGreaterThan(0);
  await expect(page.locator('.major-road-label')).toHaveCount(0);
  expect(majorRoadRequests).toBe(0);
});

test('route lines explain themselves and emphasize the exact approaching trip shape', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const transparentTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/review-tile/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: transparentTile,
  }));
  await page.route('**/api/config', (route) => route.fulfill({
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
  }));
  await page.route('**/api/routes.geojson*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            shape_id: 'shape-active',
            route_id: '8A',
            route_short_name: '8A',
            route_long_name: 'RVH / Yonge',
            route_color: '#000000',
            route_text_color: '#FFFFFF',
            direction_id: '0',
            trip_headsign: 'RVH',
            trip_count: 20,
          },
          geometry: {
            type: 'LineString',
            coordinates: [[-79.697, 44.368], [-79.69, 44.374], [-79.684, 44.382]],
          },
        },
        {
          type: 'Feature',
          properties: {
            shape_id: 'shape-other-8a',
            route_id: '8A',
            route_short_name: '8A',
            route_long_name: 'RVH / Yonge',
            route_color: '#000000',
            route_text_color: '#FFFFFF',
            direction_id: '1',
            trip_headsign: 'Yonge',
            trip_count: 18,
          },
          geometry: {
            type: 'LineString',
            coordinates: [[-79.701, 44.369], [-79.69, 44.374], [-79.681, 44.38]],
          },
        },
        {
          type: 'Feature',
          properties: {
            shape_id: 'shape-context',
            route_id: '12A',
            route_short_name: '12A',
            route_long_name: 'Georgian Mall',
            route_color: '#F49AC1',
            route_text_color: '#111111',
            direction_id: '0',
            trip_headsign: 'Georgian Mall',
            trip_count: 12,
          },
          geometry: {
            type: 'LineString',
            coordinates: [[-79.693, 44.367], [-79.689, 44.375], [-79.686, 44.383]],
          },
        },
      ],
    }),
  }));
  await page.route('**/api/vehicles.json?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generated_at: Date.now(),
      feed_timestamp: nowSeconds,
      latest_data_timestamp: nowSeconds,
      feed_status: 'live',
      vehicles: [{
        id: 'approaching-8a',
        route_id: '8A',
        route_label: '8A',
        shape_id: 'shape-active',
        trip_headsign: 'RVH',
        agency_id: 'barrie-transit',
        agency_name: 'Barrie Transit',
        lat: 44.3745,
        lon: -79.6895,
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
  }));

  await page.goto('/');

  await expect(page.locator('.route-map-key')).toContainText('Bus route');
  await expect(page.locator('.route-label')).toHaveCount(0);
  await expect(page.locator('.vehicle-icon:not(.vehicle-icon--combined)').first()).toHaveCSS('width', '41px');
  await expect(page.locator('.vehicle-icon:not(.vehicle-icon--combined)').first()).toHaveCSS('height', '41px');
  await expect(page.locator('.vehicle-bubble').first()).toHaveCSS('border-radius', '50%');
  await expect(page.locator('.route-line--core.route-shape-shape-active')).toHaveCSS('stroke-opacity', '1');
  await expect(page.locator('.route-line--core.route-shape-shape-other-8a')).toHaveCSS('stroke-opacity', '0.34');
  await expect(page.locator('.route-line--core.route-shape-shape-context')).toHaveCSS('stroke-opacity', '0.25');
});

test('terminal board shows a GO train departure countdown at Allandale', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const transparentTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.route('**/review-tile/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: transparentTile,
  }));
  await page.route('**/api/config', (route) => route.fulfill({
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
  }));
  await page.route('**/api/routes.geojson*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          route_id: 'GO-TRAIN',
          route_short_name: 'GO TRAIN',
          route_long_name: 'Barrie',
          route_color: '#003767',
          route_text_color: '#FFFFFF',
          route_mode: 'train',
          agency_id: 'go-transit',
          agency_name: 'GO Transit',
        },
        geometry: {
          type: 'LineString',
          coordinates: [[-79.69, 44.374], [-79.68, 44.373]],
        },
      }],
    }),
  }));
  await page.route('**/api/vehicles.json?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generated_at: Date.now(),
      feed_timestamp: nowSeconds,
      latest_data_timestamp: nowSeconds,
      feed_status: 'live',
      vehicles: [{
        id: 'go-train-allandale',
        route_id: 'GO-TRAIN',
        route_label: 'GO TRAIN',
        route_mode: 'train',
        agency_id: 'go-transit',
        agency_name: 'GO Transit',
        trip_headsign: 'Union Station GO',
        lat: 44.3740170437343,
        lon: -79.6899831810679,
        last_reported: nowSeconds,
        terminal_progress_status: 'departed',
        terminal_departure_time: nowSeconds + 300,
      }],
      sources: {
        go_transit: {
          feed_status: 'delayed',
          latest_data_timestamp: nowSeconds,
          data_age_seconds: 0,
        },
      },
    }),
  }));

  await page.goto('/');

  const trainRow = page.locator('.nearby-bus[data-vehicle-id="go-train-allandale"]');
  await expect(trainRow).toBeVisible();
  await expect(trainRow.locator('.nearby-bus__route-agency')).toHaveText('GO');
  await expect(trainRow.locator('.nearby-bus__agency-logo')).toHaveAttribute(
    'src',
    './assets/agency-go-transit.svg'
  );
  await expect(trainRow.locator('.nearby-bus__proximity')).toHaveText('At the terminal');
  await expect(trainRow.locator('.nearby-bus__platform-type')).toHaveText('PLATFORM');
  await expect(trainRow.locator('.nearby-bus__platform-number')).toHaveText('1');
  await expect(trainRow.locator('.nearby-bus__departure')).toHaveText('Departs in 5 min');
  await expect(page.locator('#banner')).toBeHidden();
  expect(errors).toEqual([]);
});
