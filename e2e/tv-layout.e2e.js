const { test, expect } = require('@playwright/test');

function captureRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('TV layout puts the map and arrivals side by side on the simulator basemap', async ({ page }) => {
  const errors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route('**/api/service-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        is_special_service: false,
        upcoming_warning: {
          message: 'Upcoming Holiday Service - Thanksgiving Service: No Service on Monday, October 12.',
        },
      }),
    });
  });
  await page.goto('/?layout=tv');

  await expect(page.locator('body')).toHaveClass(/layout-tv/);
  await expect(page.locator('.leaflet-image-layer')).toHaveAttribute('src', /barrie-sim-city\.webp$/);
  await expect(page.locator('.leaflet-tile-pane img')).toHaveCount(0);
  await expect(page.locator('#tracked-services')).toBeHidden();
  // Major roads and their names are drawn over the simulator basemap.
  await expect(page.locator('.leaflet-majorRoad-pane path').first()).toBeAttached();
  await expect.poll(() => page.locator('.major-road-label').evaluateAll(
    (labels) => labels.filter((label) => label.style.visibility === 'visible').length
  )).toBeGreaterThanOrEqual(5);
  await expect(page.locator('#route-legend')).toBeVisible();
  await expect(page.locator('#route-legend')).toContainText('8A');
  await expect(page.locator('.service-notice__heading')).toHaveText('Upcoming holiday service');
  await expect(page.locator('.service-notice__track')).toHaveCSS('animation-name', 'none');

  // The arrivals column sits to the right of the map instead of over it.
  const mapBox = await page.locator('#map').boundingBox();
  const panelBox = await page.locator('#nearby-buses').boundingBox();
  expect(mapBox && panelBox).toBeTruthy();
  expect(panelBox.x).toBeGreaterThanOrEqual(mapBox.x + mapBox.width - 1);

  const overflow = await page.evaluate(() => (
    globalThis.document.documentElement.scrollWidth > globalThis.innerWidth ||
    globalThis.document.documentElement.scrollHeight > globalThis.innerHeight
  ));
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('default layout keeps the OSM/Mapbox tiles and floating panels', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveClass(/layout-tv/);
  await expect(page.locator('.leaflet-image-layer')).toHaveCount(0);
  await expect(page.locator('#tracked-services')).toBeVisible();
  await expect(page.locator('#route-legend')).toBeHidden();
});
