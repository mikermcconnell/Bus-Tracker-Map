// Renders split-circle.html for review.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(pathToFileURL(path.join(__dirname, 'split-circle.html')).href);
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(__dirname, 'split-circle.png'), fullPage: true });
  console.log(errors.join('\n') || 'no errors');
  await b.close();
})();
