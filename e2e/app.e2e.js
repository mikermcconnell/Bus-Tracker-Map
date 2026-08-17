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

  await expect(page).toHaveTitle('FIND YOUR BUS - LIVE MAP');
  await expect(page.locator('#map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.map-title__main')).toHaveText('FIND YOUR BUS - LIVE MAP');
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
  await page.setViewportSize({ width: 1920, height: 1080 });

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
          stop_lat: 44.3738731374332,
          stop_lon: -79.6893515732343,
          route_id: '8A',
          route_label: '8A',
          destination: 'Yonge Southbound',
          agency_id: 'barrie-transit',
          next_departure_time: nowSeconds + 600,
        },
        {
          platform: '13',
          stop_lat: 44.3741351975798,
          stop_lon: -79.6904420505482,
          route_id: '12A',
          route_label: '12A',
          destination: 'Georgian Mall',
          agency_id: 'barrie-transit',
        },
        {
          platform: '5',
          stop_lat: 44.3739253232581,
          stop_lon: -79.6897531198448,
          route_id: '8A',
          route_label: '8A',
          destination: 'RVH Northbound',
          agency_id: 'barrie-transit',
          next_departure_time: nowSeconds - 3600,
        },
        {
          platform: '3',
          stop_lat: 44.3738731374332,
          stop_lon: -79.6893515732343,
          route_id: '8B',
          route_label: '8B',
          destination: 'Essa Southbound',
          agency_id: 'barrie-transit',
          next_departure_time: nowSeconds + 1200,
        },
        {
          platform: '14',
          stop_id: '14',
          stop_lat: 44.373522,
          stop_lon: -79.691152,
          route_id: '12B',
          route_label: '12B',
          destination: 'Barrie South GO',
          agency_id: 'barrie-transit',
        },
        {
          platform: '7',
          stop_lat: 44.3744078047372,
          stop_lon: -79.6892602227835,
          route_id: 'GO-BUS',
          route_label: '68',
          destination: 'Aurora / East Gwillimbury',
          agency_id: 'go-transit',
        },
        {
          platform: '8',
          stop_lat: 44.374194,
          stop_lon: -79.689194,
          route_id: 'ONTC',
          route_label: 'ON',
          source_route_id: '202',
          destination: 'Toronto Union Station',
          agency_id: 'ontario-northland',
        },
        {
          platform: '1',
          stop_lat: 44.374139,
          stop_lon: -79.687858,
          route_id: 'GO-TRAIN',
          route_label: 'TRAIN',
          destination: 'Toronto / Union Station',
          agency_id: 'go-transit',
          next_departure_time: nowSeconds + 3600,
        },
        {
          platform: '2',
          stop_id: 'SCSTOP210',
          stop_lat: 44.373913,
          stop_lon: -79.689146,
          route_id: 'LINX-2',
          route_label: 'LINX 2',
          source_route_id: '2',
          destination: 'Wasaga Beach',
          agency_id: 'simcoe-linx',
          departure_label: 'Schedule',
        },
      ],
    }),
  }));
  await page.route('**/api/service-status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      is_special_service: false,
      upcoming_warning: {
        message: 'Upcoming Holiday Service - Civic Holiday Service: Sunday Schedules on Monday, August 3.',
      },
    }),
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
          terminal_progress_status: 'approaching',
          stop_id: '9003',
          current_status: 2,
          terminal_stop_id: '9003',
          terminal_departure_time: nowSeconds + 240,
        }, {
          id: 'platform-bus-companion',
          route_id: '68',
          route_label: '68',
          agency_id: 'go-transit',
          agency_name: 'GO Transit',
          lat,
          lon: -79.689279,
          last_reported: nowSeconds,
          terminal_progress_status: 'at_terminal',
          terminal_stop_id: '9007',
          terminal_departure_time: nowSeconds + 540,
        }],
        terminal_departures: [{
          platform: '3',
          agency_id: 'barrie-transit',
          route_id: '8A',
          route_label: '8A',
          departure_time: nowSeconds + 240,
          scheduled_departure_time: nowSeconds + 600,
          departure_source: 'realtime',
          progress_status: 'approaching',
        }, {
          platform: '3',
          agency_id: 'barrie-transit',
          route_id: '8B',
          route_label: '8B',
          departure_time: nowSeconds + 1200,
          scheduled_departure_time: nowSeconds + 1200,
          departure_source: 'static',
          progress_status: 'scheduled',
        }, {
          platform: '13',
          agency_id: 'barrie-transit',
          route_id: '12A',
          route_label: '12A',
          departure_time: nowSeconds + 330,
          scheduled_departure_time: nowSeconds + 600,
          departure_source: 'realtime',
          progress_status: 'approaching',
        }, {
          platform: '7',
          agency_id: 'go-transit',
          route_id: 'GO-BUS',
          route_label: '68',
          departure_time: nowSeconds + 540,
          departure_source: 'realtime',
          progress_status: 'at_terminal',
        }],
        sources: {
          barrie_transit: { feed_status: 'live' },
          go_transit: { feed_status: 'live' },
          ontario_northland: { feed_status: 'live' },
          simcoe_linx: { feed_status: 'offline' },
        },
      }),
    });
  });

  await page.goto('/platform.map');
  await expect(page.locator('.vehicle-marker img')).toHaveCount(0);
  await expect(page.locator('.vehicle-marker__route')).toHaveCount(2);
  await expect(page.locator('.vehicle-marker__route').first()).toHaveCSS('border-radius', '50%');
  await expect(page.locator('.vehicle-marker__route').first()).toContainText('8A');
  await expect(page.locator('.vehicle-marker__route').nth(1)).toContainText('GO');
  await expect(page.locator('.vehicle-marker__route').nth(1)).toContainText('68');
  await expect(page.locator('.platform-directory #assignment-layer')).toBeVisible();
  await expect(page.locator('#departure-page-label')).toHaveText('P1–P6');
  await expect(page.locator('#departure-page-count')).toHaveText('1 / 2');
  await expect(page.locator('#departure-page-countdown')).toHaveText(/Next page in (?:14|15)s/);
  await expect(page.locator('.platform-card[data-platform="3"]')).toBeVisible();
  await expect(page.locator('.platform-card[data-platform="7"]')).toBeHidden();
  await expect(page.locator('.platform-card[data-platform="2"]')).toBeVisible();
  await expect(page.locator('.platform-card[data-platform="2"]')).toContainText('Wasaga Beach');
  await expect(page.locator('.platform-card[data-platform="2"]')).toContainText('Schedule');
  await expect(page.locator('.platform-connection[data-platform="9"]')).toHaveCount(0);
  await page.evaluate(() => globalThis.__platformMapApp.showDeparturePage(1));
  await expect(page.locator('#departure-page-label')).toHaveText('P7–P13 + Stop 14');
  await expect(page.locator('#departure-page-count')).toHaveText('2 / 2');
  await expect(page.locator('.platform-card[data-platform="7"]')).toBeVisible();
  await expect(page.locator('.platform-card[data-platform="8"] .platform-card__route')).toHaveText('202');
  await expect(page.locator('.platform-card[data-platform="13"]')).toBeVisible();
  await expect(page.locator('.platform-card[data-platform="14"]')).toBeVisible();
  await expect(page.locator('.platform-card[data-platform="1"]')).toBeHidden();
  await expect(page.locator('.platform-card[data-platform="2"]')).toBeHidden();
  await page.evaluate(() => globalThis.__platformMapApp.showDeparturePage(0));
  await expect(page.locator('.platform-card[data-platform="3"]')).toContainText('Yonge Southbound');
  await expect(page.locator('.platform-card[data-platform="3"]')).toContainText('Essa Southbound');
  await expect(page.locator('.platform-card[data-platform="3"] .platform-card__state')).toHaveText('Arriving');
  const arrivingRow = page.locator('.platform-card[data-platform="3"] .platform-card__service[data-route-id="8A"]');
  await expect(arrivingRow).toHaveClass(/platform-card__service--active/);
  await expect(arrivingRow.locator('.platform-card__service-countdown')).toHaveText('4 min');
  await expect(arrivingRow.locator('.platform-card__service-source')).toHaveText('Live');
  await expect(arrivingRow.locator('.platform-card__service-source')).toHaveAttribute('data-source', 'live');
  const inactiveRow = page.locator('.platform-card[data-platform="3"] .platform-card__service[data-route-id="8B"]');
  const inactiveScheduledTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date((nowSeconds + 1200) * 1000));
  await expect(inactiveRow).not.toHaveClass(/platform-card__service--active/);
  await expect(inactiveRow.locator('.platform-card__service-countdown'))
    .toHaveText('20 min');
  await expect(inactiveRow.locator('.platform-card__service-scheduled'))
    .toHaveText(inactiveScheduledTime);
  await expect(inactiveRow.locator('.platform-card__service-source')).toHaveText('Scheduled');
  await expect(inactiveRow.locator('.platform-card__service-source')).toHaveAttribute('data-source', 'scheduled');
  const predictedWithoutNearbyVehicle = page.locator(
    '.platform-card[data-platform="13"] .platform-card__service[data-route-id="12A"]'
  );
  await expect(predictedWithoutNearbyVehicle.locator('.platform-card__service-source')).toHaveText('Live');
  await expect(predictedWithoutNearbyVehicle.locator('.platform-card__service-countdown')).toHaveText('6 min');
  await expect(predictedWithoutNearbyVehicle).not.toHaveClass(/platform-card__service--active/);
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P13"]'))
    .toHaveAttribute('data-live-state', '');
  const pastDepartureRow = page.locator('.platform-card[data-platform="5"] .platform-card__service');
  await expect(pastDepartureRow.locator('.platform-card__service-countdown')).toHaveText('No time');
  await expect(pastDepartureRow).not.toContainText('9:32 AM');
  await expect(page.locator('.platform-card[data-platform="7"] .platform-card__state')).toHaveText('At platform');
  const trainRouteBadge = page.locator('.platform-card[data-platform="1"] .platform-card__route');
  await expect(trainRouteBadge).toHaveText('TRAIN');
  expect(await trainRouteBadge.evaluate((badge) => badge.scrollWidth <= badge.clientWidth)).toBe(true);
  await expect(page.locator('.platform-card[data-platform="13"]')).toHaveCount(1);
  await expect(page.locator('.platform-card[data-platform="13"]')).toBeHidden();
  await expect(page.locator('.platform-card[data-platform="14"] .platform-card__title')).toHaveText('Stop 14');
  await expect(page.locator('.platform-card[data-platform="14"]')).toContainText('12B');
  await expect(page.locator('.platform-card[data-platform="14"]')).toContainText('Barrie South GO');
  await expect(page.locator('.platform-card[data-platform="14"] .platform-card__route').first()).toHaveCSS('background-color', 'rgb(244, 154, 193)');
  await expect(page.locator('.platform-card[data-platform="1"] .platform-card__agency-logo'))
    .toHaveAttribute('src', './assets/agency-go-transit.svg');
  await expect(page.locator('.platform-card[data-platform="3"] .platform-card__agency-logo'))
    .toHaveAttribute('src', './assets/agency-barrie-transit.png');
  await expect(page.locator('.platform-card[data-platform="2"] .platform-card__agency-logo'))
    .toHaveAttribute('src', './assets/agency-simcoe-linx.png');
  await expect(page.locator('#map-label-layer .map-platform-card')).toHaveCount(11);
  await expect(page.locator('#map-label-layer .map-platform-card[data-geographic-anchor]')).toHaveCount(0);
  await expect(page.locator('#map-connector-layer')).toHaveCount(0);
  await expect(page.locator('.map-platform-leader, .map-platform-leader-halo')).toHaveCount(0);
  await expect(page.locator('#map-platform-layer .map-platform-anchor')).toHaveCount(12);
  await expect(page.locator('#map-label-layer > .map-platform-anchor__label')).toHaveCount(12);
  await expect(page.locator('#map-platform-layer .map-platform-anchor--pickup-dropoff')).toHaveCount(0);
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P2"]')).toHaveText('P2');
  for (const platform of ['2', '3', '4', '5']) {
    await expect(page.locator(`.map-platform-anchor__label[data-pointer-label="P${platform}"]`))
      .toHaveAttribute('data-label-placement', 'below');
  }
  for (const platform of ['6', '7', '8']) {
    await expect(page.locator(`.map-platform-anchor__label[data-pointer-label="P${platform}"]`))
      .toHaveAttribute('data-label-placement', 'above');
  }
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P/D"]')).toHaveCount(0);
  const manualPointers = await page.locator(
    '.map-platform-card[data-manual-pointer="true"], .map-connection-card[data-manual-pointer="true"]'
  )
    .evaluateAll((cards) => Object.fromEntries(cards.map((card) => [card.dataset.platform, {
      lat: card.dataset.pointerLat,
      lon: card.dataset.pointerLon,
    }])));
  expect(manualPointers).toEqual({
    1: { lat: '44.373611', lon: '-79.688611' },
    2: { lat: '44.373833', lon: '-79.689111' },
    3: { lat: '44.373861', lon: '-79.689333' },
    4: { lat: '44.373889', lon: '-79.689583' },
    5: { lat: '44.373917', lon: '-79.689806' },
    6: { lat: '44.37425', lon: '-79.689722' },
    7: { lat: '44.37425', lon: '-79.689472' },
    8: { lat: '44.374194', lon: '-79.689194' },
    9: { lat: '44.374306', lon: '-79.688944' },
    12: { lat: '44.374167', lon: '-79.690444' },
    13: { lat: '44.374028', lon: '-79.690528' },
    14: { lat: '44.373583', lon: '-79.691111' },
  });
  await expect(page.locator('#map-label-rail-top > *')).toHaveCount(6);
  await expect(page.locator('#map-label-rail-bottom > *')).toHaveCount(6);
  await expect(page.locator('#map-label-rail-right > *')).toHaveCount(0);
  const lowerRailOrder = await page.locator('#map-label-rail-bottom > *').evaluateAll((cards) => cards
    .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left)
    .map((card) => card.dataset.platform));
  expect(lowerRailOrder).toEqual(['14', '5', '4', '3', '2', '1']);
  const lowerRailTops = await page.locator('#map-label-rail-bottom > *').evaluateAll((cards) => (
    cards.map((card) => Math.round(card.getBoundingClientRect().top))
  ));
  expect(new Set(lowerRailTops).size).toBe(1);
  const locationBadgeSizes = await page.locator('.map-platform-anchor__label').evaluateAll((labels) => labels.map((label) => {
    const bounds = label.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  expect(locationBadgeSizes.every(({ width, height }) => width >= 32 && height >= 32)).toBe(true);
  const platformCardSizes = await page.locator('.map-platform-card').evaluateAll((cards) => Object.fromEntries(cards.map((card) => {
    const bounds = card.getBoundingClientRect();
    return [card.dataset.platform, { width: bounds.width, height: bounds.height }];
  })));
  expect(platformCardSizes['4'].width).toBeLessThan(platformCardSizes['3'].width);
  expect(platformCardSizes['4'].height).toBeLessThan(platformCardSizes['3'].height);
  await expect(page.locator('.map-platform-card[data-platform="4"] .map-platform-card__body')).toBeHidden();
  await expect(page.locator('.map-platform-card[data-platform="3"] .map-platform-card__body')).toBeVisible();
  await expect(page.locator('.map-platform-card .map-platform-card__logo')).toHaveCount(0);
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-barrie-transit.png');
  await expect(page.locator('.map-platform-card[data-platform="7"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-go-transit.svg');
  await expect(page.locator('.map-platform-card[data-platform="8"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-ontario-northland.png');
  await expect(page.locator('.map-platform-card[data-platform="8"] .map-platform-card__route')).toHaveText('202');
  await expect(page.locator('.map-platform-card[data-platform="2"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-simcoe-linx.png');
  await expect(page.locator('.vehicle-marker__route[data-agency-id="go-transit"]'))
    .toHaveCSS('background-color', 'rgb(0, 132, 61)');
  await expect(page.locator('#map-label-layer .map-connection-card')).toHaveCount(1);
  await expect(page.locator('.map-connection-card[data-platform="9"]')).toContainText('On Demand');
  await expect(page.locator('.map-connection-card[data-platform="9"] .map-connection-card__logo'))
    .toHaveAttribute('src', './assets/agency-barrie-transit.png');
  await expect(page.locator('#source-statuses .source-chip')).toHaveCount(1);
  await expect(page.locator('#source-statuses .source-chip')).toContainText('LINX');
  await expect(page.locator('#service-notice-text'))
    .toHaveText('Holiday service — Sunday schedule on Monday, August 3.');
  const pickupDropoff = page.locator('#map-label-layer .map-dropoff-card');
  await expect(pickupDropoff).toContainText('Passenger');
  await expect(pickupDropoff).toContainText('Pick-up / drop-off');
  await expect(pickupDropoff).toHaveAttribute('data-pointer-lat', '44.373639');
  await expect(pickupDropoff).toHaveAttribute('data-pointer-lon', '-79.687411');
  await expect(pickupDropoff).toHaveAttribute('data-geographic-card', 'true');
  await expect(page.locator('.map-platform-card[data-platform="3"] .map-platform-card__status')).toHaveText('8A arriving');
  await expect(page.locator('.map-platform-card[data-platform="3"] .map-platform-card__route--active')).toHaveText('8A');
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P3"]'))
    .toHaveAttribute('data-live-state', 'approaching');
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P3"] .map-platform-anchor__state'))
    .toHaveText('Arriving');
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P3"] .map-platform-anchor__state'))
    .toBeHidden();
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P7"]'))
    .toHaveAttribute('data-live-state', 'occupied');
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P7"] .map-platform-anchor__state'))
    .toHaveText('At platform');
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P7"] .map-platform-anchor__state'))
    .toBeHidden();
  const badgeSizes = await page.locator('.map-platform-anchor__label').evaluateAll((labels) => Object.fromEntries(
    labels.map((label) => [label.dataset.pointerLabel, {
      width: label.getBoundingClientRect().width,
      height: label.getBoundingClientRect().height,
    }])
  ));
  expect(badgeSizes.P3).toEqual(badgeSizes.P2);
  expect(badgeSizes.P7).toEqual(badgeSizes.P8);
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P3"]'))
    .toHaveCSS('box-shadow', /rgba?\(74, 222, 128/);
  await expect(page.locator('.map-terminal-building__name')).toHaveText('Allandale Terminal Building');
  await expect(page.locator('.map-terminal-building__here')).toHaveText('You Are Here');
  await expect(page.locator('#map-platform-layer > .map-terminal-building__footprint--map')).toHaveCount(1);
  await expect(page.locator('#map-label-layer .map-terminal-building__footprint')).toHaveCount(0);
  await expect(page.locator('.platform-card__destination').first()).toHaveCSS('text-overflow', 'clip');
  await expect(page.locator('.platform-card__destination').first()).toHaveCSS('white-space', 'normal');
  await expect(page.locator('.map-platform-card[data-platform="7"] .map-platform-card__status')).toContainText('Departs');
  await expect(page.locator('.map-platform-card[data-platform="7"] .map-platform-card__route')).toContainText('68');
  await expect(page.locator('.map-platform-card[data-platform="14"]')).toContainText('12B');
  const rowsOverlap = await page.locator('.platform-card:not([hidden])').evaluateAll((cards) => cards.some((card, index) => {
    if (index === 0) return false;
    const previous = cards[index - 1].getBoundingClientRect();
    const current = card.getBoundingClientRect();
    return current.top < previous.bottom;
  }));
  expect(rowsOverlap).toBe(false);
  const tvTypography = await page.locator('.platform-card[data-platform="3"]').evaluate((card) => ({
    platform: Number.parseFloat(globalThis.getComputedStyle(card.querySelector('.platform-card__title')).fontSize),
    destination: Number.parseFloat(globalThis.getComputedStyle(card.querySelector('.platform-card__destination')).fontSize),
    state: Number.parseFloat(globalThis.getComputedStyle(card.querySelector('.platform-card__state')).fontSize),
    scheduledTime: Number.parseFloat(globalThis.getComputedStyle(
      card.querySelector('.platform-card__service[data-route-id="8B"] .platform-card__service-countdown')
    ).fontSize),
    insidePanel: card.getBoundingClientRect().right <= card.closest('.platform-directory').getBoundingClientRect().right,
  }));
  expect(tvTypography.platform).toBeGreaterThanOrEqual(26);
  expect(tvTypography.destination).toBeGreaterThanOrEqual(20);
  expect(tvTypography.state).toBeGreaterThanOrEqual(16);
  expect(tvTypography.scheduledTime).toBeGreaterThanOrEqual(20);
  expect(tvTypography.insidePanel).toBe(true);
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);
  await expect(page.locator('.vehicle-marker__count')).toHaveText('2 vehicles');
  await expect(page.locator('.vehicle-marker__detail')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  const compactDirectoryFits = await page.locator('.platform-directory').evaluate((directory) => {
    const visibleCards = Array.from(directory.querySelectorAll('.platform-card:not([hidden])'));
    const lastItem = visibleCards[visibleCards.length - 1];
    if (!lastItem) return false;
    return lastItem.getBoundingClientRect().bottom <= directory.getBoundingClientRect().bottom;
  });
  expect(compactDirectoryFits).toBe(true);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('#map-label-layer').evaluate((labelLayer) => {
      const stage = labelLayer.closest('.map-stage').getBoundingClientRect();
      const cards = Array.from(labelLayer.querySelectorAll(
        '.map-platform-card, .map-connection-card, .map-dropoff-card'
      )).map((card) => {
        const bounds = card.getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        };
      });
      const clipped = cards
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => (
          card.left < stage.left || card.right > stage.right ||
          card.top < stage.top || card.bottom > stage.bottom
        ))
        .map(({ card, index }) => ({
          index,
          card: [card.left, card.top, card.right, card.bottom].map(Math.round),
          stage: [stage.left, stage.top, stage.right, stage.bottom].map(Math.round),
        }));
      const overlaps = cards.some((card, index) => cards.slice(index + 1).some((other) => (
        card.left < other.right && card.right > other.left &&
        card.top < other.bottom && card.bottom > other.top
      )));
      return { clipped, overlaps };
    })).toEqual({ clipped: [], overlaps: false });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
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

test('platform marker action strip omits duplicate at-platform countdowns', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let phase = 'approaching';
  let departureTime = nowSeconds + 240;
  let polls = 0;

  await page.route('**/api/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      poll_ms: 500,
      feed_delayed_after_ms: 120000,
      feed_offline_after_ms: 900000,
      base_path: '/',
    }),
  }));
  await page.route('**/api/vehicles.json?*', (route) => {
    polls += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        feed_timestamp: nowSeconds,
        vehicles: [{
          id: 'state-bus',
          route_id: '7B',
          route_label: '7B',
          agency_id: 'barrie-transit',
          agency_name: 'Barrie Transit',
          lat: 44.3745,
          lon: -79.6895,
          bearing: 180,
          last_reported: nowSeconds,
          terminal_progress_status: phase,
          terminal_stop_id: '9006',
          terminal_departure_time: departureTime,
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
  const platformSix = page.locator('.platform-card[data-platform="6"]');
  await expect(platformSix).toBeVisible();
  expect(await platformSix.evaluate((card) => {
    const services = card.querySelector('.platform-card__services').getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    return services.top >= bounds.top && services.bottom <= bounds.bottom;
  })).toBe(true);
  await expect(page.locator('.vehicle-marker__detail')).toHaveCount(0);
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__status'))
    .toHaveText('7B arriving');
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__route--active'))
    .toHaveText('7B');
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__route:not(.map-platform-card__route--active)'))
    .toHaveText('7A');

  const approachingPoll = polls;
  phase = 'at_terminal';
  await expect.poll(() => polls).toBeGreaterThan(approachingPoll);
  await expect(platformSix).toHaveAttribute('data-live-state', 'occupied');

  const overduePoll = polls;
  departureTime = nowSeconds - 120;
  await expect.poll(() => polls).toBeGreaterThan(overduePoll);
  await expect(platformSix.locator('.platform-card__service[data-route-id="7B"] .platform-card__service-countdown'))
    .toHaveText('Now');
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__status'))
    .toHaveText('At platform');

  const platformPoll = polls;
  phase = 'departed';
  await expect.poll(() => polls).toBeGreaterThan(platformPoll);
  await expect(page.locator('.vehicle-marker')).toHaveCount(0);
  await expect(platformSix).toHaveAttribute('data-live-state', '');
  await expect(platformSix.locator('.platform-card__service[data-route-id="7B"] .platform-card__service-source'))
    .toHaveText('Scheduled');
  await expect(page.locator('.map-platform-anchor__label[data-pointer-label="P6"]'))
    .toHaveAttribute('data-live-state', '');
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__route--active'))
    .toHaveCount(0);
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
    const image = globalThis.document.querySelector('.map-plane').getBoundingClientRect();
    return {
      inside:
        marker.left >= canvas.left &&
        marker.right <= canvas.right &&
        marker.top >= header.bottom &&
        marker.bottom <= canvas.bottom,
      mapRatio: image.width / image.height,
    };
  });
  expect(bounds.inside).toBe(true);
  expect(bounds.mapRatio).toBeCloseTo(11659 / 9010, 2);
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
