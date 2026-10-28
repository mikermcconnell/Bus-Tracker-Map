// Renders a north-up, city-scale view of Barrie from the running Barrie Simulator
// dev server (read-only: it only moves the camera and toggles layers in the browser).
// The output fills the TV mockup's map pane exactly (1156x844).
//
// Usage: node capture-city.js [metresPerPixel...]
// Env: SIM_URL (default http://localhost:5173/)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../../node_modules/playwright'));

const WIDTH = 1156;
const HEIGHT = 844;
const CENTER = [44.3778, -79.6700]; // fits RVH, Georgian Mall, Park Place and Barrie South GO with Allandale left of centre
const scales = (process.argv.slice(2).length ? process.argv.slice(2) : ['9']).map(Number);
const simUrl = process.env.SIM_URL || 'http://localhost:5173/';
const outDir = path.join(__dirname, 'assets');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(simUrl);
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__controls && window.__controls.current && window.__store, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  // The mockup draws its own buses, routes, stops and labels.
  await page.evaluate(() => window.__store.setState((state) => ({
    layers: { ...state.layers, buses: false, transit: false, stops: false, designRoutes: false, changes: false, landmarks: false },
  })));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });

  const manifest = { center: CENTER, width: WIDTH, height: HEIGHT, views: {} };
  for (const mpp of scales) {
    await page.evaluate(({ center, mpp: m, height }) => {
      const R = 6371008.8;
      const DEG = Math.PI / 180;
      const origin = { lat: 44.3835, lon: -79.685 }; // pipeline/area.ts CITY_ORIGIN
      const tx = (center[1] - origin.lon) * Math.cos(origin.lat * DEG) * R * DEG;
      const tz = -(center[0] - origin.lat) * R * DEG;
      const controls = window.__controls.current;
      const camera = controls.object;
      const distance = (height * m / 2) / Math.tan((camera.fov * DEG) / 2);
      controls.target.set(tx, 0, tz);
      camera.position.set(tx, distance, tz + distance * 0.0001); // straight down, north up
      camera.lookAt(tx, 0, tz);
      controls.update();
    }, { center: CENTER, mpp, height: HEIGHT });
    await page.waitForTimeout(9000);
    const file = `city-${mpp}mpp.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    manifest.views[mpp] = file;
    console.log(`${mpp} m/px -> ${file}`);
  }
  fs.writeFileSync(path.join(outDir, 'city-views.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
})();
