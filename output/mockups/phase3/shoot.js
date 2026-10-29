// Renders the Phase 3 mockup on top of the live page at TV resolution.
// Usage: node shoot.js <baseUrl> <outDir>
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

const baseUrl = process.argv[2] || 'http://localhost:3007';
const outDir = process.argv[3] || __dirname;
const css = fs.readFileSync(path.join(__dirname, 'proto.css'), 'utf8');

function applyMockup(degraded) {
  const title = document.getElementById('platform-directory-title');
  if (title) title.textContent = 'Next departures';
  const label = document.getElementById('departure-page-label');
  if (label) label.textContent = 'All platforms';
  // Minutes up to an hour; clock time beyond.
  document.querySelectorAll('.platform-card__service').forEach((row) => {
    const countdown = row.querySelector('.platform-card__service-countdown');
    const scheduled = row.querySelector('.platform-card__service-scheduled');
    const minutes = Number((countdown && countdown.textContent.match(/^(\d+) min$/) || [])[1]);
    if (minutes > 60 && scheduled && scheduled.textContent) countdown.textContent = scheduled.textContent;
    if (countdown && countdown.textContent === 'Due now') countdown.textContent = 'Due';
  });
  if (degraded) {
    const board = document.querySelector('.platform-directory__header');
    const banner = document.createElement('p');
    banner.className = 'proto-banner';
    banner.textContent = 'Live bus tracking is unavailable. Times shown are scheduled.';
    board.after(banner);
    document.querySelectorAll('.platform-card__service-source').forEach((badge) => {
      badge.dataset.source = 'scheduled';
    });
  }
}

(async () => {
  const browser = await chromium.launch();
  for (const variant of ['normal', 'degraded']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${baseUrl}/platform.map`, { waitUntil: 'load' });
    await page.waitForTimeout(12000);
    await page.addStyleTag({ content: css });
    await page.evaluate(applyMockup, variant === 'degraded');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `mockup-${variant}.png`) });
    await page.close();
  }
  await browser.close();
})();
