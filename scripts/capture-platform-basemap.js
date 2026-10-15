#!/usr/bin/env node
/* global window, document -- used inside page.evaluate(), which runs in the simulator page */
// Renders the Allandale terminal base map for the /platform.map TV display
// from the Barrie Simulator, and records how latitude/longitude map onto it.
//
// The simulator is a separate project (mike_apps/Barrie-Simulator). Start its
// dev server first (`npm run dev` there), then run:
//
//   node scripts/capture-platform-basemap.js [--url http://localhost:5173/] [--heading 0]
//
// heading = compass direction shown at the top of the map (0 = north up).
// The script only moves the simulator's camera and hides its own buses, routes
// and stops in the browser; it changes nothing in the simulator project.
//
// Output (commit both):
//   frontend/src/platform-map/allandale-sim-basemap.webp
//   frontend/src/platform-map/basemap-calibration.json
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

// Same shape as .map-plane (11659 / 9010) at 1920x1080, so the TV shows the image at 1:1.
const WIDTH = 1428;
const HEIGHT = 1104;
// About 14% closer than the former Leaflet zoom 18.1 (0.3985 m/px). Closer than
// this pushes Stop 14 or the passenger pick-up point off the visible map.
const METRES_PER_PIXEL = 0.35;
// Plane centre. Shifted slightly east of the platforms so Stop 14 (west) and the
// pick-up point (east) both stay inside the visible part of the plane.
const CENTER = { lat: 44.373974, lon: -79.689174 };
const SIM_URL = option('url', 'http://localhost:5173/');
const HEADING = Number(option('heading', '0'));
const OUT_DIR = path.join(__dirname, '..', 'frontend', 'src', 'platform-map');

// Inputs are offsets from the map centre scaled by INPUT_SCALE (about 10 m per unit)
// so the fit is well conditioned.
const INPUT_SCALE = 10000;

function solveLinear(m, v) {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    for (let r = i + 1; r < n; r += 1) {
      const factor = a[r][i] / a[i][i];
      for (let c = i; c <= n; c += 1) a[r][c] -= factor * a[i][c];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = a[i][n];
    for (let c = i + 1; c < n; c += 1) sum -= a[i][c] * out[c];
    out[i] = sum / a[i][i];
  }
  return out;
}

// The simulator camera is tilted (it cannot look straight down), so ground points
// map to the image through a perspective transform (homography), not a linear one:
//   x = (h0 u + h1 v + h2) / (h6 u + h7 v + 1),  y = (h3 u + h4 v + h5) / (h6 u + h7 v + 1)
// with u = dLon * INPUT_SCALE and v = dLat * INPUT_SCALE.
function fitHomography(samples) {
  const rows = [];
  const values = [];
  samples.forEach(({ u, v, x, y }) => {
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); values.push(x);
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y]); values.push(y);
  });
  const m = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const b = new Array(8).fill(0);
  rows.forEach((row, index) => {
    for (let i = 0; i < 8; i += 1) {
      b[i] += row[i] * values[index];
      for (let j = 0; j < 8; j += 1) m[i][j] += row[i] * row[j];
    }
  });
  return solveLinear(m, b);
}

function applyHomography(h, u, v) {
  const w = h[6] * u + h[7] * v + 1;
  return { x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(SIM_URL);
  await page.waitForSelector('canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__controls && window.__controls.current && window.__store, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__store.setState((state) => ({
    layers: { ...state.layers, buses: false, transit: false, stops: false, designRoutes: false, changes: false, landmarks: true },
  })));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });

  // The 3D canvas sits below the simulator's toolbar. Grow the window until the
  // canvas itself is exactly WIDTH x HEIGHT; projection and capture use the canvas.
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

  await page.evaluate(({ center, mpp, height, headingDeg }) => {
    const R = 6371008.8;
    const DEG = Math.PI / 180;
    const origin = { lat: 44.3835, lon: -79.685 }; // Barrie-Simulator pipeline/area.ts CITY_ORIGIN
    const tx = (center.lon - origin.lon) * Math.cos(origin.lat * DEG) * R * DEG;
    const tz = -(center.lat - origin.lat) * R * DEG;
    const controls = window.__controls.current;
    const camera = controls.object;
    const distance = (height * mpp / 2) / Math.tan((camera.fov * DEG) / 2);
    // Straight down; the tiny tilt only sets which compass direction is "up".
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
  }, { center: CENTER, mpp: METRES_PER_PIXEL, height: HEIGHT, headingDeg: HEADING });
  await page.waitForTimeout(8000);

  // Project a grid of points through the simulator's own camera for an exact calibration.
  const samples = await page.evaluate(({ center, width, height, scale }) => {
    const R = 6371008.8;
    const DEG = Math.PI / 180;
    const origin = { lat: 44.3835, lon: -79.685 };
    const kx = Math.cos(origin.lat * DEG) * R * DEG;
    const kz = R * DEG;
    const camera = window.__controls.current.object;
    camera.updateMatrixWorld();
    const out = [];
    for (let i = -3; i <= 3; i += 1) {
      for (let j = -3; j <= 3; j += 1) {
        const lat = center.lat + i * 0.0005;
        const lon = center.lon + j * 0.0008;
        const v = new camera.position.constructor((lon - origin.lon) * kx, 0, -(lat - origin.lat) * kz);
        v.project(camera);
        out.push({ u: (lon - center.lon) * scale, v: (lat - center.lat) * scale, x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height });
      }
    }
    return out;
  }, { center: CENTER, width: WIDTH, height: HEIGHT, scale: INPUT_SCALE });

  const png = await page.locator('canvas').first().screenshot();
  await browser.close();

  const homography = fitHomography(samples);
  const residual = Math.max(...samples.map((s) => {
    const p = applyHomography(homography, s.u, s.v);
    return Math.hypot(p.x - s.x, p.y - s.y);
  }));
  const imagePath = path.join(OUT_DIR, 'allandale-sim-basemap.webp');
  await sharp(png).webp({ quality: 86 }).toFile(imagePath);
  const calibration = {
    source: 'Barrie Simulator (OpenStreetMap data, ODbL)',
    generated_at: new Date().toISOString(),
    width: WIDTH,
    height: HEIGHT,
    metres_per_pixel: METRES_PER_PIXEL,
    heading: HEADING,
    center: CENTER,
    // See fitHomography: u = (lon - center.lon) * input_scale, v = (lat - center.lat) * input_scale.
    input_scale: INPUT_SCALE,
    homography,
    max_residual_px: Math.round(residual * 1000) / 1000,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'basemap-calibration.json'), `${JSON.stringify(calibration, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), imagePath)} (${Math.round(fs.statSync(imagePath).size / 1024)} KB); max calibration residual ${calibration.max_residual_px} px`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
