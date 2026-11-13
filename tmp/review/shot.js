const os = require('os');
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
const { chromium } = require('playwright');
(async () => {
  const hard = setTimeout(() => process.exit(2), 90000);
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true });
    const sizes = [['4x3-large', 1440, 1080], ['hd720', 1366, 768]];
    for (const [name, width, height] of sizes) {
      const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const logs = [];
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
      page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
      page.on('requestfailed', (r) => logs.push('reqfailed: ' + r.url()));
      page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url()); });
      await page.goto('http://localhost:3017/platform.map', { waitUntil: 'load' });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `tmp/review/${name}.png` });
      if (name === 'tv') {
        const info = await page.evaluate(() => ({
          conn: document.getElementById('connection-label').textContent,
          updated: document.getElementById('last-updated').textContent,
          status: document.getElementById('platform-status').textContent,
          cards: document.querySelectorAll('.platform-card').length,
          markers: document.querySelectorAll('.vehicle-marker').length,
          overflowY: (() => { const a = document.querySelector('.platform-directory'); return [a.scrollHeight, a.clientHeight]; })(),
          assignOverflow: (() => { const a = document.getElementById('assignment-layer'); return [a.scrollHeight, a.clientHeight]; })(),
          minFont: Math.min(...Array.from(document.querySelectorAll('.platform-app *')).filter(e => e.childNodes.length && Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent).map(e => parseFloat(getComputedStyle(e).fontSize))),
          smallText: Array.from(document.querySelectorAll('.platform-app *')).filter(e => Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.className + ':' + getComputedStyle(e).fontSize + ':' + e.textContent.trim().slice(0, 30)).slice(0, 25),
        }));
        console.log(JSON.stringify(info, null, 1));
      }
      console.log(name, JSON.stringify(logs.slice(0, 12)));
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    clearTimeout(hard);
  }
})();
