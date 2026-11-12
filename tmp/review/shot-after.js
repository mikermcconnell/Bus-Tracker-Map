const os = require('os');
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
const { chromium } = require('playwright');
(async () => {
  const hard = setTimeout(() => process.exit(2), 110000);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true });
    const only = process.argv[2];
    const sizes = [
      ['tv', 1920, 1080], ['4x3-large', 1440, 1080], ['4x3', 1024, 768],
      ['laptop', 1280, 800], ['hd720', 1366, 768], ['phone', 390, 844],
    ].filter(([name]) => !only || only.split(',').includes(name));
    for (const [name, width, height] of sizes) {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const logs = [];
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
      page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
      page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url()); });
      await page.goto('http://localhost:3017/platform.map', { waitUntil: 'load' });
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `tmp/review/after-${name}.png`, fullPage: name === 'phone' });
      const info = await page.evaluate(() => {
        const stage = document.querySelector('.map-stage').getBoundingClientRect();
        const plane = document.querySelector('.map-plane').getBoundingClientRect();
        const cards = Array.from(document.querySelectorAll('.map-label-rail > *')).map((c) => c.getBoundingClientRect());
        let overlaps = 0;
        cards.forEach((a, i) => cards.slice(i + 1).forEach((b) => {
          if (a.width && b.width && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overlaps += 1;
        }));
        const small = Array.from(document.querySelectorAll('.map-stage *')).filter((e) => e.offsetParent &&
          Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) &&
          parseFloat(getComputedStyle(e).fontSize) < 12)
          .map((e) => `${e.className}:${getComputedStyle(e).fontSize}:${e.textContent.trim().slice(0, 16)}`);
        const p14 = document.querySelector('.map-platform-badge[data-platform="14"], [data-bay="14"]');
        return {
          stage: [Math.round(stage.width), Math.round(stage.height)],
          planeCovers: plane.left <= stage.left + 1 && plane.right >= stage.right - 1 && plane.top <= stage.top + 1 && plane.bottom >= stage.bottom - 1,
          cardOverlaps: overlaps,
          footerHidden: document.getElementById('platform-footer').hidden,
          docScroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
          small: small.slice(0, 10),
        };
      });
      console.log(name, JSON.stringify(info), JSON.stringify(logs.slice(0, 8)));
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    clearTimeout(hard);
  }
})();
