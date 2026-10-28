// Captures the live map (no rail cards, no buses) as the mockup background
// and records pointer positions so the HTML mockup can draw overlays.
// Usage: node capture-map.js <baseUrl>
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

const baseUrl = process.argv[2] || 'http://localhost:3017';
const css = fs.readFileSync(path.join(__dirname, 'proto.css'), 'utf8') + `
  .map-label-rail, .bus-layer, .map-terminal-building__here { display: none !important; }
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${baseUrl}/platform.map`, { waitUntil: 'load' });
  await page.waitForTimeout(12000);
  await page.addStyleTag({ content: css });
  await page.waitForTimeout(1500);
  // Clear live highlight states so the mockup can draw its own.
  await page.evaluate(() => {
    document.querySelectorAll('[data-live-state]').forEach((el) => { el.dataset.liveState = ''; });
    document.querySelectorAll('.map-platform-anchor__state').forEach((el) => { el.hidden = true; });
  });
  const stage = page.locator('.map-stage');
  await stage.screenshot({ path: path.join(__dirname, 'assets', 'map.png') });
  const geometry = await page.evaluate(() => {
    const stageBox = document.querySelector('.map-stage').getBoundingClientRect();
    const rel = (el) => {
      const box = el.getBoundingClientRect();
      return {
        x: Math.round(box.left - stageBox.left),
        y: Math.round(box.top - stageBox.top),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    };
    const anchors = {};
    document.querySelectorAll('.map-platform-anchor__label').forEach((label) => {
      anchors[label.textContent.trim()] = rel(label);
    });
    const building = document.querySelector('.map-terminal-building__pin') ||
      document.querySelector('.map-terminal-building');
    return {
      stage: { w: Math.round(stageBox.width), h: Math.round(stageBox.height) },
      anchors,
      building: building ? rel(building) : null,
    };
  });
  fs.writeFileSync(path.join(__dirname, 'assets', 'map-geometry.json'), JSON.stringify(geometry, null, 2));
  console.log(JSON.stringify(geometry));
  await browser.close();
})();
