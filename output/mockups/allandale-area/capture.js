// Mockup helper (throwaway): captures the Allandale area from the running Barrie Simulator
// (plan view and 3D view) and saves each camera, so index.html can draw shapes in world metres onto them.
// Usage: node output/mockups/allandale-area/capture.js   (simulator dev server on :5173)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = __dirname;
const SIM_DATA = path.join(__dirname, '..', '..', '..', '..', 'Barrie-Simulator', 'public', 'data', 'downtown.json');
const VIEWS = [
  { name: 'plan', width: 1600, height: 900, target: [-275, 1064], tiltDeg: 0.01, headingDeg: 0, mpp: 0.31 },
  { name: 'view3d', width: 1600, height: 900, target: [-292, 1070], tiltDeg: 52, headingDeg: 22, mpp: 0.3 },
];

const buildings = JSON.parse(fs.readFileSync(SIM_DATA)).buildings;

async function sizeCanvas(page, width, height) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rect = await page.evaluate(() => {
      const r = document.querySelector('canvas').getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    if (Math.round(rect.width) === width && Math.round(rect.height) === height) return;
    const viewport = page.viewportSize();
    await page.setViewportSize({
      width: viewport.width + width - Math.round(rect.width),
      height: viewport.height + height - Math.round(rect.height),
    });
    await page.waitForTimeout(1500);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__controls && window.__controls.current && window.__store, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__store.setState((state) => ({
    layers: { ...state.layers, buses: false, transit: false, stops: false, designRoutes: false, changes: false, landmarks: true },
  })));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });

  const projections = {};
  for (const view of VIEWS) {
    await sizeCanvas(page, view.width, view.height);
    await page.evaluate(({ target, mpp, height, tiltDeg, headingDeg }) => {
      const DEG = Math.PI / 180;
      const controls = window.__controls.current;
      const camera = controls.object;
      const distance = (height * mpp / 2) / Math.tan((camera.fov * DEG) / 2);
      const polar = tiltDeg * DEG;
      const theta = -headingDeg * DEG;
      controls.target.set(target[0], 0, target[1]);
      camera.position.set(
        target[0] + distance * Math.sin(polar) * Math.sin(theta),
        distance * Math.cos(polar),
        target[1] + distance * Math.sin(polar) * Math.cos(theta)
      );
      camera.lookAt(target[0], 0, target[1]);
      controls.update();
    }, view);
    await page.waitForTimeout(10000);
    await page.locator('canvas').screenshot({ path: path.join(OUT, `${view.name}.png`) });
    projections[view.name] = await page.evaluate(({ width, height }) => {
      const camera = window.__controls.current.object;
      camera.updateMatrixWorld();
      const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
      return { width, height, viewProj: m.elements.slice(), eye: camera.position.toArray() };
    }, { width: view.width, height: view.height });
    console.log('captured', view.name);
  }
  fs.writeFileSync(path.join(OUT, 'cameras.json'), JSON.stringify(projections, null, 1));
  fs.writeFileSync(path.join(OUT, 'buildings.json'), JSON.stringify(Object.fromEntries([289243284, 804469363, 1442477381].map((id) => {
    const b = buildings.find((x) => x.osmId === id) || {};
    return [id, { footprint: b.footprint, height: b.height, name: b.name || '' }];
  })), null, 1));
  await browser.close();
})().catch((err) => { console.error(err); process.exit(1); });
