// Renders the TV redesign mockup at 1920x1080 in its main review states.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
  const shots = [
    ['kiosk', '?kiosk', 1920, 1080, []],
    ['kiosk-stale', '?kiosk', 1920, 1080, ['t-stale']],
    ['review', '', 2340, 1128, []],
  ];
  for (const [name, query, width, height, toggles] of shots) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${name}: ${message.text()}`); });
    await page.goto(url + query);
    for (const id of toggles) await page.click(`#${id}`, { force: true }).catch(() => page.evaluate((i) => document.getElementById(i).click(), id));
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth);
    if (overflow) errors.push(`${name}: page overflows viewport`);
    await page.screenshot({ path: path.join(__dirname, `shot-${name}.png`) });
    await page.close();
  }
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
