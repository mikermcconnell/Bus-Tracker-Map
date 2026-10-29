// Throwaway test: capture the Allandale site from the Barrie Simulator at a 3/4 (tilted) angle.
// Same steps as scripts/capture-platform-basemap.js, but with a camera tilt. Changes nothing in either project.
const path = require('path');
const { chromium } = require('playwright');

const WIDTH = 1428;
const HEIGHT = 1104;
const CENTER = { lat: 44.37385, lon: -79.68955 };
const shots = [
  { name: 'tilt-45-close', tiltDeg: 45, headingDeg: -20, mpp: 0.16 },
  { name: 'tilt-30-close', tiltDeg: 30, headingDeg: 0, mpp: 0.18 },
];
const unused = [
  { name: 'tilt-35', tiltDeg: 35, headingDeg: 0, mpp: 0.35 },
  { name: 'tilt-50', tiltDeg: 50, headingDeg: 0, mpp: 0.35 },
  { name: 'tilt-50-from-south-east', tiltDeg: 50, headingDeg: -30, mpp: 0.35 },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__controls && window.__controls.current && window.__store, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__store.setState((state) => ({
    layers: { ...state.layers, buses: false, transit: false, stops: false, designRoutes: false, changes: false, landmarks: true },
  })));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rect = await page.evaluate(() => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    if (Math.round(rect.width) === WIDTH && Math.round(rect.height) === HEIGHT) break;
    const viewport = page.viewportSize();
    await page.setViewportSize({
      width: viewport.width + WIDTH - Math.round(rect.width),
      height: viewport.height + HEIGHT - Math.round(rect.height),
    });
    await page.waitForTimeout(1500);
  }

  for (const shot of shots) {
    await page.evaluate(({ center, mpp, height, tiltDeg, headingDeg }) => {
      const R = 6371008.8;
      const DEG = Math.PI / 180;
      const origin = { lat: 44.3835, lon: -79.685 };
      const tx = (center.lon - origin.lon) * Math.cos(origin.lat * DEG) * R * DEG;
      const tz = -(center.lat - origin.lat) * R * DEG;
      const controls = window.__controls.current;
      const camera = controls.object;
      const distance = (height * mpp / 2) / Math.tan((camera.fov * DEG) / 2);
      const polar = tiltDeg * DEG;
      const theta = -headingDeg * DEG;
      controls.target.set(tx, 0, tz);
      camera.position.set(
        tx + distance * Math.sin(polar) * Math.sin(theta),
        distance * Math.cos(polar),
        tz + distance * Math.sin(polar) * Math.cos(theta)
      );
      camera.lookAt(tx, 0, tz);
      controls.update();
    }, { center: CENTER, height: HEIGHT, ...shot });
    await page.waitForTimeout(9000);
    await page.locator('canvas').screenshot({ path: path.join(__dirname, `${shot.name}.png`) });
    console.log('saved', shot.name);
  }
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
