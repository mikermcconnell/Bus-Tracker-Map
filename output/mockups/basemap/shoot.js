// Renders each base-map option of basemap-options.html at 1920x1080.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(path.join(__dirname, 'basemap-options.html')).href);
  await page.keyboard.press('h');
  const shots = [
    ['sim-flag-boarding', { base: 'sim', state: 'platform', yahstyle: 'flag', train: 'platform' }],
    ['sim-dot-arriving', { base: 'sim', state: 'normal', yahstyle: 'dot', train: 'arriving' }],
    ['sim-building-none', { base: 'sim', state: 'normal', yahstyle: 'building', train: 'none' }],
    ['official', { base: 'official', state: 'platform' }],
  ];
  for (const [name, settings] of shots) {
    await page.evaluate((values) => {
      Object.entries(values).forEach(([group, value]) => document.querySelector(`input[name=${group}][value=${value}]`).click());
    }, settings);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(__dirname, `option-${name}.png`) });
  }
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
