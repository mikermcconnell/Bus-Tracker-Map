// Renders allandale-map-proposal.html in its main states at 1920x1080.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(path.join(__dirname, 'allandale-map-proposal.html')).href);
  await page.keyboard.press('h');
  const shots = [
    ['north-boarding', { heading: '0', train: 'boarding', bus: 'p6' }],
    ['north-arriving', { heading: '0', train: 'arriving', bus: 'no' }],
    ['south-boarding', { heading: '180', train: 'boarding', bus: 'no' }],
    ['east-none', { heading: '90', train: 'none', bus: 'no' }],
    ['west-boarding', { heading: '270', train: 'boarding', bus: 'no' }],
  ];
  for (const [name, settings] of shots) {
    await page.evaluate((values) => {
      Object.entries(values).forEach(([group, value]) => document.querySelector(`input[name=${group}][value="${value}"]`).click());
    }, settings);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(__dirname, `proposal-${name}.png`) });
  }
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
