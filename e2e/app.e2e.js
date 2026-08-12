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

test('departures board shows every departure in the one-hour window without scrolling', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ poll_ms: 10000, base_path: '/' }) });
  });
  await page.route('**/api/departures?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: Date.now(),
        departures: Array.from({ length: 30 }, (_, index) => ({
          id: `departure-${index}`,
          agency_id: index === 0 || index === 10 ? 'go-transit' : index === 5 ? 'ontario-northland' : index === 4 ? 'simcoe-linx' : 'barrie-transit',
          agency_name: index === 0 || index === 10 ? 'GO Transit' : index === 5 ? 'Ontario Northland' : index === 4 ? 'Simcoe LINX' : 'Barrie Transit',
          route_id: index === 5 ? '201' : undefined,
          route_label: index === 0 ? 'TRAIN' : index === 10 ? '68' : index === 5 ? 'ONTC' : index === 4 ? '2' : '8A',
          destination: index === 0 ? 'Toronto / Union Station' : index === 10 ? 'Barrie / Newmarket' : index === 5 ? 'North Bay' : index === 4 ? 'Wasaga Beach 45th St' : 'Yonge Southbound',
          platform: index === 0 ? '1' : index === 8 ? '14' : index === 10 ? '7' : index === 5 ? '8' : index === 4 ? '2' : '3',
          platform_type: index === 8 ? 'stop' : 'platform',
          scheduled_departure_time: nowSeconds + (index + 1) * 300,
          expected_departure_time: nowSeconds + (index + 1) * 300 + (index === 0 ? 120 : 0),
          departure_source: index === 2 ? 'estimated' : index % 2 ? 'scheduled' : 'realtime',
        })).reverse(),
        sources: {
          barrie_transit: { display_mode: 'mixed', realtime_status: 'live' },
          ontario_northland: { display_mode: 'scheduled', realtime_status: 'offline' },
          go_transit: { display_mode: 'realtime', realtime_status: 'live' },
          simcoe_linx: { display_mode: 'scheduled', realtime_status: 'delayed' },
        },
      }),
    });
  });

  await page.goto('/departures');
  await expect(page).toHaveTitle(/Allandale Departures/);
  await expect(page.locator('.departure')).toHaveCount(11);
  await expect(page.locator('.destination').first()).toContainText('TORONTO');
  await expect(page.locator('.platform strong').first()).toHaveText('01');
  await expect(page.locator('.departure').first().locator('.departure-status')).toHaveText('LIVE');
  await expect(page.locator('.departure').first().locator('[data-departure-time]')).toHaveAttribute('data-departure-time', String(nowSeconds + 420));
  await expect(page.locator('.departure').nth(1).locator('.departure-status')).toHaveText('SCHED');
  await expect(page.locator('.departure').nth(2).locator('.departure-status')).toHaveText('SCHED');
  await expect(page.locator('.departure').nth(2).locator('.departure-status'))
    .toHaveAttribute('aria-label', 'Scheduled time');
  await expect(page.locator('#service-health')).toContainText('GO Feed active');
  await expect(page.locator('#service-health')).toContainText('ON Schedule only');
  await expect(page.locator('#service-health')).toContainText('LINX Feed delayed');
  await expect(page.locator('.agency-ontario_northland .route')).toHaveText('201');
  await expect(page.locator('.departure').nth(10).locator('.route')).toHaveText('68');
  await expect(page.locator('.departure').nth(10).locator('.destination')).toHaveText('BARRIE / NEWMARKET');
  await expect(page.locator('.departure').first()).toHaveCSS('background-color', 'rgb(217, 217, 216)');
  await expect(page.locator('.departure').nth(1)).toHaveCSS('background-color', 'rgb(187, 187, 188)');
  const logoAlignment = await page.locator('.departure').first().evaluate((row) => {
    const cell = row.querySelector('.agency-logo').getBoundingClientRect();
    const logo = row.querySelector('.agency-logo img').getBoundingClientRect();
    return {
      horizontal: Math.abs((cell.left + cell.width / 2) - (logo.left + logo.width / 2)),
      vertical: Math.abs((cell.top + cell.height / 2) - (logo.top + logo.height / 2)),
    };
  });
  expect(logoAlignment.horizontal).toBeLessThanOrEqual(1);
  expect(logoAlignment.vertical).toBeLessThanOrEqual(1);
  const routeAlignment = await page.locator('.route').evaluateAll((routes) => routes.map((route) => {
    const cell = route.getBoundingClientRect();
    const range = route.ownerDocument.createRange();
    range.selectNodeContents(route);
    const text = range.getBoundingClientRect();
    return {
      horizontal: Math.abs((cell.left + cell.width / 2) - (text.left + text.width / 2)),
      vertical: Math.abs((cell.top + cell.height / 2) - (text.top + text.height / 2)),
    };
  }));
  expect(Math.max(...routeAlignment.map((alignment) => alignment.horizontal)))
    .toBeLessThanOrEqual(1);
  expect(Math.max(...routeAlignment.map((alignment) => alignment.vertical)))
    .toBeLessThanOrEqual(1);
  const trainLabelGap = await page.locator('.departure').first().evaluate((row) => {
    const textBounds = (element) => {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const route = textBounds(row.querySelector('.route'));
    const destination = textBounds(row.querySelector('.destination'));
    return destination.left - route.right;
  });
  expect(trainLabelGap).toBeGreaterThanOrEqual(14);
  const platformNumberRightEdges = await page.locator('.platform strong').evaluateAll((numbers) => (
    numbers.map((number) => number.getBoundingClientRect().right)
  ));
  expect(Math.max(...platformNumberRightEdges) - Math.min(...platformNumberRightEdges))
    .toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const wideLayout = await page.locator('body').evaluate((body) => {
    const pageDocument = body.ownerDocument;
    const textBounds = (element) => {
      const range = pageDocument.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const train = pageDocument.querySelector('.agency-go_transit');
    const rightEdges = Array.from(pageDocument.querySelectorAll('.platform strong'))
      .map((number) => number.getBoundingClientRect().right);
    const routeAlignment = Array.from(pageDocument.querySelectorAll('.route')).map((route) => {
      const cell = route.getBoundingClientRect();
      const text = textBounds(route);
      return {
        horizontal: Math.abs((cell.left + cell.width / 2) - (text.left + text.width / 2)),
        vertical: Math.abs((cell.top + cell.height / 2) - (text.top + text.height / 2)),
      };
    });
    return {
      trainLabelGap: textBounds(train.querySelector('.destination')).left -
        textBounds(train.querySelector('.route')).right,
      platformNumberSpread: Math.max(...rightEdges) - Math.min(...rightEdges),
      routeHorizontalSpread: Math.max(...routeAlignment.map((alignment) => alignment.horizontal)),
      routeVerticalSpread: Math.max(...routeAlignment.map((alignment) => alignment.vertical)),
    };
  });
  expect(wideLayout.trainLabelGap).toBeGreaterThanOrEqual(24);
  expect(wideLayout.platformNumberSpread).toBeLessThanOrEqual(1);
  expect(wideLayout.routeHorizontalSpread).toBeLessThanOrEqual(1);
  expect(wideLayout.routeVerticalSpread).toBeLessThanOrEqual(1);
  await expect(page.locator('.agency-logo img').first()).toHaveCSS('mix-blend-mode', 'multiply');
  await expect(page.locator('.agency-simcoe_linx .agency-logo img')).toHaveCSS('mix-blend-mode', 'normal');
  const northlandLogo = page.locator('.agency-ontario_northland .agency-logo img');
  await expect(northlandLogo).toHaveCSS('width', '72px');
  await expect(northlandLogo).toHaveCSS('height', '40px');
  await expect(northlandLogo).toHaveCSS('object-fit', 'cover');
  await expect(northlandLogo).toHaveCSS('object-position', '0% 50%');
  await expect(northlandLogo).toHaveCSS('mix-blend-mode', 'normal');
  await expect(northlandLogo).not.toHaveCSS('filter', 'none');
  const dimensions = await page.locator('html').evaluate((element) => ({
    height: element.scrollHeight,
    viewport: element.clientHeight,
  }));
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('departures board keeps longer waits as minute countdowns', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.route('**/api/config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ poll_ms: 10000, base_path: '/' }) });
  });
  await page.route('**/api/departures?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generated_at: Date.now(),
        departures: [{
          id: 'long-wait',
          agency_id: 'ontario-northland',
          agency_name: 'Ontario Northland',
          route_id: '101',
          route_label: 'ONTC',
          destination: 'North Bay',
          platform: '8',
          scheduled_departure_time: nowSeconds + 90 * 60,
          expected_departure_time: nowSeconds + 90 * 60,
          departure_source: 'realtime',
        }],
        sources: {},
      }),
    });
  });

  await page.goto('/departures');
  await expect(page.locator('[data-departure-time]')).toHaveText('90 min');
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
          route_id: '8A',
          route_label: '8A',
          destination: 'Yonge Southbound',
          agency_id: 'barrie-transit',
          next_departure_time: nowSeconds + 600,
        },
        {
          platform: '13',
          route_id: '12A',
          route_label: '12A',
          destination: 'Georgian Mall',
          agency_id: 'barrie-transit',
        },
        {
          platform: '5',
          route_id: '8A',
          route_label: '8A',
          destination: 'RVH Northbound',
          agency_id: 'barrie-transit',
          next_departure_time: nowSeconds - 3600,
        },
        {
          platform: '3',
          route_id: '8B',
          route_label: '8B',
          destination: 'Essa Southbound',
          agency_id: 'barrie-transit',
          next_departure_time: nowSeconds + 1200,
        },
        {
          platform: '14',
          stop_id: '14',
          route_id: '12B',
          route_label: '12B',
          destination: 'Barrie South GO',
          agency_id: 'barrie-transit',
        },
        {
          platform: '7',
          route_id: 'GO-BUS',
          route_label: '68',
          destination: 'Aurora / East Gwillimbury',
          agency_id: 'go-transit',
        },
        {
          platform: '1',
          route_id: 'GO-TRAIN',
          route_label: 'TRAIN',
          destination: 'Toronto / Union Station',
          agency_id: 'go-transit',
          next_departure_time: nowSeconds + 3600,
        },
        {
          platform: '2',
          route_id: 'LINX-2',
          route_label: '2',
          destination: 'Wasaga Beach 45th St',
          agency_id: 'simcoe-linx',
          next_departure_time: nowSeconds + 1800,
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
        sources: {
          barrie_transit: { feed_status: 'live' },
          go_transit: { feed_status: 'live' },
          ontario_northland: { feed_status: 'live' },
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
  await expect(page.locator('.platform-card[data-platform="3"]')).toContainText('Yonge Southbound');
  await expect(page.locator('.platform-card[data-platform="3"]')).toContainText('Essa Southbound');
  await expect(page.locator('.platform-card[data-platform="3"] .platform-card__state')).toHaveText('Arriving');
  const arrivingRow = page.locator('.platform-card[data-platform="3"] .platform-card__service[data-route-id="8A"]');
  await expect(arrivingRow).toHaveClass(/platform-card__service--active/);
  await expect(arrivingRow.locator('.platform-card__service-countdown')).toHaveText('4 min');
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
  const pastDepartureRow = page.locator('.platform-card[data-platform="5"] .platform-card__service');
  await expect(pastDepartureRow.locator('.platform-card__service-countdown')).toHaveText('No time');
  await expect(pastDepartureRow).not.toContainText('9:32 AM');
  await expect(page.locator('.platform-card[data-platform="7"] .platform-card__state')).toHaveText('At platform');
  const trainRouteBadge = page.locator('.platform-card[data-platform="1"] .platform-card__route');
  await expect(trainRouteBadge).toHaveText('TRAIN');
  expect(await trainRouteBadge.evaluate((badge) => badge.scrollWidth <= badge.clientWidth)).toBe(true);
  await expect(page.locator('.platform-card[data-platform="13"]')).toContainText('Georgian Mall');
  await expect(page.locator('.platform-card[data-platform="14"] .platform-card__title')).toHaveText('Stop 14');
  await expect(page.locator('.platform-card[data-platform="14"]')).toContainText('12B');
  await expect(page.locator('.platform-card[data-platform="14"]')).toContainText('Barrie South GO');
  await expect(page.locator('.platform-card[data-platform="14"] .platform-card__route').first()).toHaveCSS('background-color', 'rgb(244, 154, 193)');
  await expect(page.locator('#map-label-layer .map-platform-card')).toHaveCount(11);
  await expect(page.locator('.map-platform-card .map-platform-card__logo')).toHaveCount(0);
  await expect(page.locator('.map-platform-card[data-platform="6"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-barrie-transit.png');
  await expect(page.locator('.map-platform-card[data-platform="7"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-go-transit.svg');
  await expect(page.locator('.map-platform-card[data-platform="8"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-ontario-northland.png');
  await expect(page.locator('.map-platform-card[data-platform="2"] .map-platform-card__brand-logo'))
    .toHaveAttribute('src', './assets/agency-simcoe-linx.png');
  await expect(page.locator('.map-platform-card[data-platform="2"]')).toContainText('2');
  await expect(page.locator('#map-label-layer .map-connection-card')).toHaveCount(1);
  await expect(page.locator('.map-connection-card[data-platform="9"]')).toContainText('On Demand');
  await expect(page.locator('.map-connection-card[data-platform="9"] .map-connection-card__logo'))
    .toHaveAttribute('src', './assets/agency-barrie-transit.png');
  await expect(page.locator('.map-connection-card[data-platform="9"]')).toContainText('Stop 900');
  await expect(page.locator('.platform-card[data-platform="2"]')).toContainText('Wasaga Beach');
  await expect(page.locator('#source-statuses .source-chip')).toHaveCount(1);
  await expect(page.locator('#source-statuses .source-chip')).toContainText('LINX');
  await expect(page.locator('#service-notice-text'))
    .toHaveText('Holiday service — Sunday schedule on Monday, August 3.');
  await expect(page.locator('#map-label-layer .map-dropoff-card')).toContainText('Passenger');
  await expect(page.locator('.map-platform-card[data-platform="3"] .map-platform-card__status')).toHaveText('8A arriving');
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

test('platform marker disappears once its vehicle has departed', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let phase = 'approaching';
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
          terminal_departure_time: nowSeconds + 240,
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
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);
  await expect(page.locator('.vehicle-marker__detail')).toHaveCount(0);

  const approachingPoll = polls;
  phase = 'at_terminal';
  await expect.poll(() => polls).toBeGreaterThan(approachingPoll);
  await expect(page.locator('.vehicle-marker')).toHaveCount(1);

  const platformPoll = polls;
  phase = 'departed';
  await expect.poll(() => polls).toBeGreaterThan(platformPoll);
  await expect(page.locator('.vehicle-marker')).toHaveCount(0);
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
