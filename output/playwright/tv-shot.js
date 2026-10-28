// Review helper (throwaway): screenshots /platform.map at TV size.
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:3007/platform.map', { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(__dirname, process.argv[2] || 'tv-tilt.png') });
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
  await browser.close();
})();
