// Mockup helper (throwaway): screenshots index.html in each state for review.
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/'));
  const stage = page.locator('#stage');
  const states = [
    ['3d-restyle', []],
    ['3d-remove', ['#bld [data-v=remove]']],
    ['plan-remove', ['#view [data-v=plan]']],
    ['plan-restyle', ['#bld [data-v=restyle]']],
  ];
  for (const [name, clicks] of states) {
    for (const c of clicks) await page.click(c);
    await page.waitForTimeout(400);
    await stage.screenshot({ path: path.join(__dirname, `shot-${name}.png`) });
  }
  await page.click('#view [data-v=view3d]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'shot-page.png'), fullPage: true });
  console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
  await browser.close();
})();
