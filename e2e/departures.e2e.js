const { test, expect } = require('@playwright/test');

test('legacy platform URL renders a responsive LINX departure sign', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/departures?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      stop_code: '9002',
      platform: '2',
      platform_display: '02',
      generated_at: Date.now(),
      status: 'ok',
      departures: [{
        agency_id: 'simcoe-linx',
        agency_name: 'Simcoe County LINX',
        route_id: 'LINX-2',
        route_label: '2',
        destination: 'Wasaga Beach 45th St',
        departure_time: nowSeconds + 54 * 60,
        departure_source: 'realtime',
        progress_status: 'approaching',
      }],
    }),
  }));

  await page.goto('/departures/platform.aspx?stop=9002');

  await expect(page).toHaveTitle('Platform 02 Departures');
  await expect(page.locator('#platform-number')).toHaveText('02');
  await expect(page.locator('.route-cell')).toHaveText('2 - Wasaga Beach 45th St');
  await expect(page.locator('.departure-cell')).toContainText(/Departing in 5[34] min/);
  await expect(page.locator('.agency-logo')).toHaveAttribute('alt', 'LINX');
  await expect.poll(() => page.locator('.agency-logo').evaluate((logo) => (
    logo.complete && logo.naturalWidth > 0
  ))).toBe(true);
  await expect(page.locator('#departure-clock')).not.toHaveText('--:--');
  await expect(page.locator('.departure-board')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(60, 120, 166)');
  const liveBadgeStyle = await page.locator('.departure-cell').evaluate((cell) => {
    const style = globalThis.getComputedStyle(cell, '::after');
    return { backgroundColor: style.backgroundColor, color: style.color, content: style.content };
  });
  expect(liveBadgeStyle).toEqual({
    backgroundColor: 'rgb(0, 122, 51)',
    color: 'rgb(255, 255, 255)',
    content: '"LIVE"',
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  const boardBounds = await page.locator('.departure-board').boundingBox();
  expect(boardBounds.width).toBeGreaterThan(1000);
  expect(boardBounds.width).toBeLessThanOrEqual(1152);
});

test('valid empty and invalid platform URLs show clear states', async ({ page }) => {
  await page.route('**/api/departures?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      stop_code: '9009',
      platform: '9',
      platform_display: '09',
      generated_at: Date.now(),
      status: 'no_departures',
      departures: [],
    }),
  }));

  await page.goto('/departures/platform.aspx?stop=9009');
  await expect(page.locator('#platform-number')).toHaveText('09');
  await expect(page.locator('.route-cell')).toHaveText('No departures scheduled');

  await page.goto('/departures/platform.aspx?stop=9999');
  await expect(page.locator('#platform-number')).toHaveText('--');
  await expect(page.locator('.route-cell')).toHaveText('Stop code required');
});

test('departure sign fits a 320 by 80 platform display without clipping', async ({ page }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await page.setViewportSize({ width: 320, height: 80 });
  await page.route('**/api/departures?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      stop_code: '9002',
      platform: '2',
      platform_display: '02',
      generated_at: Date.now(),
      status: 'ok',
      departures: [{
        agency_id: 'simcoe-linx',
        agency_name: 'Simcoe County LINX',
        route_id: 'LINX-2',
        route_label: '2',
        destination: 'Wasaga Beach 45th St',
        departure_time: nowSeconds + 54 * 60,
        departure_source: 'realtime',
        progress_status: 'approaching',
      }],
    }),
  }));

  await page.goto('/departures/platform.aspx?stop=9002');
  await expect(page.locator('#platform-number')).toHaveText('02');
  await expect(page.locator('.route-cell')).toHaveText('2 - Wasaga Beach 45th St');
  await expect(page.locator('.departure-cell')).toContainText(/Departing in 5[34] min/);

  const layout = await page.evaluate(() => {
    const board = globalThis.document.querySelector('.departure-board').getBoundingClientRect();
    const route = globalThis.document.querySelector('.route-cell').getBoundingClientRect();
    const departure = globalThis.document.querySelector('.departure-cell').getBoundingClientRect();
    const logo = globalThis.document.querySelector('.agency-logo').getBoundingClientRect();
    return {
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      scrollHeight: globalThis.document.documentElement.scrollHeight,
      board: { left: board.left, top: board.top, right: board.right, bottom: board.bottom },
      routeBottom: route.bottom,
      departureBottom: departure.bottom,
      logoBottom: logo.bottom,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(320);
  expect(layout.scrollHeight).toBeLessThanOrEqual(80);
  expect(layout.board.left).toBe(0);
  expect(layout.board.top).toBe(0);
  expect(layout.board.right).toBeLessThanOrEqual(320);
  expect(layout.board.bottom).toBeLessThanOrEqual(80);
  expect(layout.routeBottom).toBeLessThanOrEqual(80);
  expect(layout.departureBottom).toBeLessThanOrEqual(80);
  expect(layout.logoBottom).toBeLessThanOrEqual(80);

  if (process.env.CAPTURE_DEPARTURES_320 === '1') {
    await page.screenshot({ path: 'tmp/departures-320x80.png' });
  }
});
