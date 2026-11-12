#!/usr/bin/env node
/* global window -- used inside page.evaluate(), which runs in the render page */
// Renders the bus drawings for the /platform.map TV display from the Blender models in
// the Barrie Simulator (tools/blender/out/*.glb). The camera matches the base map: north
// up, tilted 40 degrees from straight down, so a bus sits on the road like the buildings.
//
//   node scripts/render-platform-bus-sprites.js [--sim "../City Simulator 2"] [--trains-only]
//
// Blender is not needed: the models are already exported. The script reads three.js and
// the models from the simulator project and changes nothing there.
//
// Output (commit all of it): frontend/src/platform-map/bus-sprites/
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const simIndex = args.indexOf('--sim');
const SIM_DIR = path.resolve(simIndex >= 0 && args[simIndex + 1]
  ? args[simIndex + 1]
  : path.join(__dirname, '..', '..', 'City Simulator 2'));
const OUT_DIR = path.join(__dirname, '..', 'frontend', 'src', 'platform-map', 'bus-sprites');
const TRAINS_ONLY = args.includes('--trains-only');

const HEADINGS = 16;
const VIEW_METRES = 18;
const SIZE = 256;
const TILT_DEGREES = 40;
// The Barrie route colours in the GTFS feed; each paints the roof panel of the Barrie bus.
const BARRIE_COLORS = ['000000', '006838', '00C4DC', '2464A2', '681757', '910005', 'B2D235', 'F58220', 'F8A1BE'];
const BARRIE_DEFAULT_COLOR = '00457C'; // brand navy, for a route with no known colour
const SPRITES = [
  ...[...BARRIE_COLORS, BARRIE_DEFAULT_COLOR].map((color) => ({ name: `barrie-${color}`, model: 'barrie-bus-hero', color })),
  { name: 'go-transit', model: 'go-hero' },
  { name: 'simcoe-linx', model: 'linx-hero' },
  { name: 'ontario-northland', model: 'ontario-northland-hero' },
];

// One drawing per car, at the fixed bearing of the GO track (GO_TRACK in platform-map/main.js).
// A car keeps its real length so the train fits the map, and is drawn wider and taller to match
// the buses. Each car's front faces away from the train: the cab car west, the locomotive east.
const TRAIN_TRACK_BEARING = 96.2;
const TRAIN_STRETCH = 2.2;
const TRAIN_VIEW_METRES = { width: 30, height: 20 };
const TRAIN_PIXELS_PER_METRE = 12.8;
const TRAIN_CARS = [
  { kind: 'cab', model: 'go-train-cab-hero', bearing: TRAIN_TRACK_BEARING + 180 },
  { kind: 'coach', model: 'go-train-coach-hero', bearing: TRAIN_TRACK_BEARING },
  { kind: 'loco', model: 'go-train-loco-hero', bearing: TRAIN_TRACK_BEARING },
];

const RENDER_PAGE = `<!doctype html>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${SIZE}, ${SIZE});
renderer.setClearColor(0, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc8, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.9);
sun.position.set(-10, 18, -6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 60 });
sun.shadow.radius = 4;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.3 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const half = ${VIEW_METRES / 2};
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 200);
const tilt = ${TILT_DEGREES} * Math.PI / 180;
camera.position.set(0, Math.cos(tilt) * 60, Math.sin(tilt) * 60);
camera.lookAt(0, 0, 0);
const loader = new GLTFLoader();
window.renderSprite = async (model, color, headings) => {
  const bus = (await loader.loadAsync('/out/' + model + '.glb')).scene;
  bus.traverse((part) => {
    if (!part.isMesh) return;
    part.castShadow = true;
    if (color && part.material.name === 'ROUTE') {
      part.material = part.material.clone();
      part.material.color.set('#' + color);
    }
  });
  scene.add(bus);
  const images = [];
  for (let index = 0; index < headings; index += 1) {
    // The model's front is +x; north is -z and east is +x, so a compass bearing b turns it by 90 - b.
    bus.rotation.y = (90 - index * 360 / headings) * Math.PI / 180;
    renderer.render(scene, camera);
    images.push(renderer.domElement.toDataURL('image/png'));
  }
  scene.remove(bus);
  return images;
};
window.renderTrainCar = async (model, bearing, stretch, width, height, pixelsPerMetre) => {
  renderer.setSize(width * pixelsPerMetre, height * pixelsPerMetre);
  Object.assign(camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
  camera.updateProjectionMatrix();
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
  sun.shadow.camera.updateProjectionMatrix();
  const car = (await loader.loadAsync('/out/' + model + '.glb')).scene;
  car.traverse((part) => { if (part.isMesh) part.castShadow = true; });
  car.scale.set(1, stretch, stretch);
  car.rotation.y = (90 - bearing) * Math.PI / 180;
  scene.add(car);
  renderer.render(scene, camera);
  scene.remove(car);
  return renderer.domElement.toDataURL('image/png');
};
window.renderReady = true;
</script>`;

const CONTENT_TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary' };

async function launch() {
  const gpu = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
  return chromium.launch({ channel: 'chromium', args: gpu }).catch(() => chromium.launch());
}

async function main() {
  if (!fs.existsSync(path.join(SIM_DIR, 'tools', 'blender', 'out', 'barrie-bus-hero.glb'))) {
    throw new Error(`No bus models under ${SIM_DIR}. Pass the simulator folder with --sim.`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error('Render page error:', error.message));
    await page.route('http://sprites.local/**', (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url === '/render.html') return route.fulfill({ contentType: 'text/html', body: RENDER_PAGE });
      const file = url.startsWith('/three/')
        ? path.join(SIM_DIR, 'node_modules', 'three', url.slice('/three/'.length))
        : path.join(SIM_DIR, 'tools', 'blender', 'out', url.slice('/out/'.length));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
        body: fs.readFileSync(file),
      });
    });
    await page.goto('http://sprites.local/render.html');
    await page.waitForFunction('window.renderReady === true', null, { timeout: 30000 });

    let totalBytes = 0;
    for (const sprite of TRAINS_ONLY ? [] : SPRITES) {
      const images = await page.evaluate(
        ([model, color, headings]) => window.renderSprite(model, color, headings),
        [sprite.model, sprite.color || null, HEADINGS]
      );
      for (let index = 0; index < images.length; index += 1) {
        const png = Buffer.from(images[index].split(',')[1], 'base64');
        const webp = await sharp(png).webp({ quality: 85 }).toBuffer();
        totalBytes += webp.length;
        fs.writeFileSync(path.join(OUT_DIR, `${sprite.name}-${String(index).padStart(2, '0')}.webp`), webp);
      }
      console.log(`Rendered ${sprite.name}`);
    }
    for (const car of TRAIN_CARS) {
      const image = await page.evaluate(
        ([model, bearing, stretch, width, height, scale]) => window.renderTrainCar(model, bearing, stretch, width, height, scale),
        [car.model, car.bearing, TRAIN_STRETCH, TRAIN_VIEW_METRES.width, TRAIN_VIEW_METRES.height, TRAIN_PIXELS_PER_METRE]
      );
      const webp = await sharp(Buffer.from(image.split(',')[1], 'base64')).webp({ quality: 85 }).toBuffer();
      totalBytes += webp.length;
      fs.writeFileSync(path.join(OUT_DIR, `go-train-${car.kind}.webp`), webp);
      console.log(`Rendered go-train-${car.kind}`);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify({
      source: 'Barrie Simulator tools/blender/out',
      headings: HEADINGS,
      view_metres: VIEW_METRES,
      barrie_colors: BARRIE_COLORS,
      barrie_default_color: BARRIE_DEFAULT_COLOR,
      train: {
        cars: TRAIN_CARS.map((car) => car.kind),
        track_bearing: TRAIN_TRACK_BEARING,
        view_metres: TRAIN_VIEW_METRES,
      },
    }, null, 2)}\n`);
    console.log(`Wrote ${(totalBytes / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
