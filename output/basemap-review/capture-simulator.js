// Renders the Allandale terminal area from the running Barrie Simulator dev
// server (read-only: it only moves the camera and toggles layers in the
// browser) and projects every feature in features.json into image pixels.
//
// Usage: node capture-simulator.js <outDir> [metresPerPixel] [headings...]
//   heading = compass direction that is "up" on the map (0 = north up, 180 = south up).
// Env: SIM_URL (default http://localhost:5173/)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));

const outDir = path.resolve(process.argv[2] || __dirname);
const metresPerPixel = Number(process.argv[3] || 0.3985);
const headings = (process.argv.slice(4).length ? process.argv.slice(4) : ['0']).map(Number);
const simUrl = process.env.SIM_URL || 'http://localhost:5173/';
const WIDTH = 972;
const HEIGHT = 876;
const features = JSON.parse(fs.readFileSync(path.join(__dirname, 'features.json'), 'utf8'));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(simUrl);
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__controls && window.__controls.current && window.__store, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  // Our page draws its own buses, routes and stops.
  await page.evaluate(() => window.__store.setState((state) => ({
    layers: { ...state.layers, buses: false, transit: false, stops: false, designRoutes: false, changes: false, landmarks: true },
  })));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });

  const manifest = { metresPerPixel, width: WIDTH, height: HEIGHT, views: {} };
  for (const heading of headings) {
    await page.evaluate(({ center, mpp, height, headingDeg }) => {
      const R = 6371008.8;
      const DEG = Math.PI / 180;
      const origin = { lat: 44.3835, lon: -79.685 }; // pipeline/area.ts CITY_ORIGIN
      const tx = (center[1] - origin.lon) * Math.cos(origin.lat * DEG) * R * DEG;
      const tz = -(center[0] - origin.lat) * R * DEG;
      const controls = window.__controls.current;
      const camera = controls.object;
      const distance = (height * mpp / 2) / Math.tan((camera.fov * DEG) / 2);
      // Nearly straight down; the tiny tilt sets which compass direction is "up" on screen.
      const polar = 0.0001;
      const theta = -headingDeg * DEG;
      controls.target.set(tx, 0, tz);
      camera.position.set(
        tx + distance * Math.sin(polar) * Math.sin(theta),
        distance * Math.cos(polar),
        tz + distance * Math.sin(polar) * Math.cos(theta)
      );
      camera.lookAt(tx, 0, tz);
      controls.update();
    }, { center: features.center, mpp: metresPerPixel, height: HEIGHT, headingDeg: heading });
    await page.waitForTimeout(7000);

    const projected = await page.evaluate(({ data, width, height }) => {
      const R = 6371008.8;
      const DEG = Math.PI / 180;
      const origin = { lat: 44.3835, lon: -79.685 };
      const kx = Math.cos(origin.lat * DEG) * R * DEG;
      const kz = R * DEG;
      const camera = window.__controls.current.object;
      camera.updateMatrixWorld();
      const project = ([lat, lon]) => {
        const v = new camera.position.constructor((lon - origin.lon) * kx, 0, -(lat - origin.lat) * kz);
        v.project(camera);
        return [Math.round((v.x + 1) / 2 * width * 10) / 10, Math.round((1 - v.y) / 2 * height * 10) / 10];
      };
      const platforms = {};
      Object.entries(data.platforms).forEach(([key, point]) => { platforms[key] = project(point); });
      const lines = {};
      Object.entries(data.lines).forEach(([key, points]) => { lines[key] = points.map(project); });
      return { platforms, lines };
    }, { data: features, width: WIDTH, height: HEIGHT });

    const file = `simulator-h${heading}.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    manifest.views[heading] = { image: file, ...projected };
    console.log(`heading ${heading}: ${file}`);
  }
  fs.writeFileSync(path.join(outDir, 'simulator-views.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
})();
