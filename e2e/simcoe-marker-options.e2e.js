const { test, expect } = require('@playwright/test');

test('agency marker mock-up switches between all three treatments', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/simcoe-marker-options.html');
  await expect(page).toHaveTitle('Simcoe Transit Agency Marker Options');
  await expect(page.locator('.agency-key img')).toHaveCount(4);
  await expect(page.locator('.vehicle')).toHaveCount(6);
  await expect(page.locator('body')).toHaveClass('view-a');

  await page.getByRole('button', { name: /Different shapes/ }).click();
  await expect(page.locator('body')).toHaveClass('view-b');
  await expect(page.locator('#decision-title')).toHaveText('Give each agency a marker shape');

  await page.getByRole('button', { name: /Logo flags/ }).click();
  await expect(page.locator('body')).toHaveClass('view-c');
  await expect(page.locator('.option-tab[aria-pressed="true"]')).toContainText('Logo flags');
  await expect(page.locator('#decision-title')).toHaveText('Pair every route number with its agency logo');
  expect(errors).toEqual([]);
});
