const { test, expect } = require('@playwright/test');

test('stop 2 shelter board fits 320 by 80 and rotates three-row pages', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 320, height: 80 });
  await page.route('**/api/departures?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generated_at: Date.now(),
      realtime_status: 'live',
      stop: { id: '2', code: '2', name: 'Downtown Hub' },
      status: 'ok',
      departures: [
        ['100', 'RED', 1],
        ['12A', 'GEORGIAN MALL', 5],
        ['7A', 'GROVE', 7],
        ['8A', 'RVH NORTHBOUND', 11],
        ['10', 'NORTH LOOP', 23],
        ['100', 'RED', 26],
      ].map(([routeLabel, destination, minutes], index) => ({
        trip_id: `trip-${index}`,
        route_id: routeLabel,
        route_label: routeLabel,
        destination,
        scheduled_departure_time: nowSeconds + minutes * 60,
        predicted_departure_time: nowSeconds + minutes * 60,
        effective_departure_time: nowSeconds + minutes * 60,
        source: 'realtime',
      })),
    }),
  }));

  await page.goto('/departures?stop=2');
  await expect(page).toHaveTitle('Stop 2 Departures');
  await expect(page.locator('#shelter-stop')).toHaveText('STOP 2 — Downtown Hub');
  await expect(page.locator('#shelter-page')).toHaveText('Page 1 of 2');
  await expect(page.locator('.shelter-row')).toHaveCount(3);
  await expect(page.locator('.shelter-row').first()).toContainText('100');
  await expect(page.locator('.realtime-icon')).toHaveCount(3);
  await expect(page.locator('.realtime-icon').first()).toHaveText('LIVE');

  const overflow = await page.evaluate(() => ({
    width: globalThis.document.documentElement.scrollWidth,
    height: globalThis.document.documentElement.scrollHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(320);
  expect(overflow.height).toBeLessThanOrEqual(80);

  await expect(page.locator('#shelter-page')).toHaveText('Page 2 of 2', { timeout: 12_000 });
  await expect(page.locator('.shelter-row').first()).toContainText('8A');
});

test('missing and unknown shelter stops show compact errors', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 80 });
  await page.goto('/departures');
  await expect(page.locator('#shelter-stop')).toHaveText('STOP REQUIRED');

  await page.route('**/api/departures?*', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'STOP_NOT_FOUND', message: 'Stop not found.' }),
  }));
  await page.goto('/departures?stop=9999');
  await expect(page.locator('.shelter-row--message')).toHaveText('Location not found');
});

test('named Downtown group combines stops and shows boarding-stop badges', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 320, height: 80 });
  await page.route('**/api/departures?group=downtown-barrie', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generated_at: Date.now(),
      realtime_status: 'live',
      stop: {
        id: 'downtown-barrie', code: null, name: 'Downtown Barrie',
        is_group: true, stop_codes: ['1', '2'],
      },
      status: 'ok',
      departures: [
        { trip_id: 'stop-1', route_id: '100', route_label: '100', destination: 'RED', stop_code: '1', stop_label: 'STOP 1' },
        { trip_id: 'stop-2', route_id: '8A', route_label: '8A', destination: 'RVH NORTHBOUND', stop_code: '2', stop_label: 'STOP 2' },
      ].map((departure, index) => ({
        ...departure,
        scheduled_departure_time: nowSeconds + (index + 2) * 60,
        effective_departure_time: nowSeconds + (index + 2) * 60,
        source: 'scheduled',
      })),
    }),
  }));

  await page.goto('/departures?group=downtown-barrie');
  await expect(page).toHaveTitle('Downtown Barrie Departures');
  await expect(page.locator('#shelter-stop')).toHaveText('Downtown Barrie');
  await expect(page.locator('.shelter-row__stop')).toHaveText(['STOP 1', 'STOP 2']);

  const overflow = await page.evaluate(() => ({
    width: globalThis.document.documentElement.scrollWidth,
    height: globalThis.document.documentElement.scrollHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(320);
  expect(overflow.height).toBeLessThanOrEqual(80);
});

test('route content and arrival time share the same vertical row center', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 1568, height: 588 });
  await page.route('**/api/departures?stop=2', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      generated_at: Date.now(),
      realtime_status: 'live',
      stop: { id: '2', code: '2', name: 'Downtown Hub', is_group: false },
      status: 'ok',
      departures: [{
        trip_id: 'route-alignment',
        route_id: '7A',
        route_label: '7A',
        destination: 'GROVE',
        scheduled_departure_time: nowSeconds + 5 * 60,
        predicted_departure_time: nowSeconds + 5 * 60,
        effective_departure_time: nowSeconds + 5 * 60,
        source: 'realtime',
      }],
    }),
  }));

  await page.goto('/departures?stop=2');
  const centers = await page.locator('.shelter-row').first().evaluate((row) => {
    const contentCenter = (element) => {
      const range = globalThis.document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return rect.top + rect.height / 2;
    };
    return {
      service: contentCenter(row.querySelector('.shelter-row__service-content')),
      arrival: contentCenter(row.querySelector('.shelter-row__arrival')),
    };
  });

  expect(Math.abs(centers.service - centers.arrival)).toBeLessThanOrEqual(1);
});
