// Screenshots the live map at 1920x1080 in the default and TV (?layout=tv) layouts.
// Usage: node shoot.js [baseUrl]   (default http://localhost:3007/)
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

const base = process.argv[2] || 'http://localhost:3007/';

(async () => {
  const browser = await chromium.launch();
  for (const [name, query] of [['tv', '?layout=tv'], ['default', '']]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + query);
    await page.waitForTimeout(12000);
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      rows: document.querySelectorAll('.nearby-bus').length,
      buses: document.querySelectorAll('.vehicle-icon').length,
      legend: (document.getElementById('route-legend') || {}).textContent || '',
      notice: document.body.classList.contains('has-service-notice'),
    }));
    await page.screenshot({ path: path.join(__dirname, `${name}.png`) });
    console.log(name, JSON.stringify(info), errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
    await page.close();
  }
  await browser.close();
})();
