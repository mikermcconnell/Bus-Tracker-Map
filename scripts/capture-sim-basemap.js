// Renders the TV map basemap (frontend/src/assets/barrie-sim-city.webp) from a
// running Barrie Simulator dev server. Read-only: it only moves the camera and
// toggles layers in the browser.
//
// The image is larger than the area the TV must always show (SIM_BASEMAP.focus in
// frontend/src/tv-layout.js), so screens of any shape fill edge to edge.
//
// Usage: node scripts/capture-sim-basemap.js
// Env:   SIM_URL (default http://localhost:5173/)
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');

const CENTER = [44.3778, -79.67];
const METRES_PER_PIXEL = 5.4; // 2x the 10.8 m/px design scale, for sharp text-free detail on large TVs
const WIDTH = 3700;
const HEIGHT = 2200;
const simUrl = process.env.SIM_URL || 'http://localhost:5173/';
const outFile = path.resolve(__dirname, '../frontend/src/assets/barrie-sim-city.webp');

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.goto(simUrl);
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => globalThis.__controls && globalThis.__controls.current && globalThis.__store, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  // The live map draws its own buses, routes, stops and labels. Operations mode
  // would also draw the day's detours, so use the plain transit mode.
  await page.evaluate(() => globalThis.__store.getState().setMode('transit'));
  await page.evaluate(() => globalThis.__store.setState((state) => ({
    layers: { ...state.layers, buses: false, transit: false, stops: false, designRoutes: false, changes: false, landmarks: false, streetNames: false },
  })));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  const expectedDistance = await page.evaluate(({ center, mpp, height }) => {
    const R = 6371008.8;
    const DEG = Math.PI / 180;
    const origin = { lat: 44.3835, lon: -79.685 }; // simulator pipeline/area.ts CITY_ORIGIN
    const tx = (center[1] - origin.lon) * Math.cos(origin.lat * DEG) * R * DEG;
    const tz = -(center[0] - origin.lat) * R * DEG;
    const controls = globalThis.__controls.current;
    const camera = controls.object;
    const distance = (height * mpp / 2) / Math.tan((camera.fov * DEG) / 2);
    // The simulator's controls stop the camera at 20° of tilt and 15 km away.
    // Either clamp would turn this into a tilted, zoomed-in view that no longer
    // lines up with lat/lon, so lift both before placing the camera.
    controls.enableDamping = false;
    controls.minPolarAngle = 0;
    controls.maxDistance = Infinity;
    controls.target.set(tx, 0, tz);
    camera.position.set(tx, distance, tz + distance * 0.0001); // straight down, north up
    camera.lookAt(tx, 0, tz);
    controls.update();
    return distance;
  }, { center: CENTER, mpp: METRES_PER_PIXEL, height: HEIGHT });
  await page.waitForTimeout(12000);
  // SIM_BASEMAP assumes a straight-down camera filling the whole viewport; refuse to write anything else.
  const pose = await page.evaluate(() => {
    const controls = globalThis.__controls.current;
    const offset = controls.object.position.clone().sub(controls.target);
    const canvas = globalThis.document.querySelector('canvas').getBoundingClientRect();
    return { distance: offset.length(), tiltDeg: controls.getPolarAngle() * 180 / Math.PI, canvas: [canvas.x, canvas.y, canvas.width, canvas.height] };
  });
  if (pose.tiltDeg > 0.1 || Math.abs(pose.distance - expectedDistance) > expectedDistance * 0.001 ||
      pose.canvas.join() !== [0, 0, WIDTH, HEIGHT].join()) {
    await browser.close();
    throw new Error(`camera is not straight down over the full viewport: ${JSON.stringify(pose)}, wanted distance ${expectedDistance.toFixed(0)}`);
  }
  const png = await page.screenshot({ type: 'png' });
  await browser.close();
  await sharp(png).webp({ quality: 82 }).toFile(outFile);
  console.log(`wrote ${outFile}`);
  console.log(`SIM_BASEMAP: center ${CENTER.join(', ')} · ${METRES_PER_PIXEL} m/px · ${WIDTH}x${HEIGHT}`);
})();
