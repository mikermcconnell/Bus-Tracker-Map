// Draws key coordinates onto the captured base map using basemap-calibration.json.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(path.resolve(__dirname, '../../node_modules/playwright'));
const root = path.resolve(__dirname, '../..');
const cal = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/platform-map/basemap-calibration.json'), 'utf8'));
const project = ([lat, lon]) => {
  const u = (lon - cal.center.lon) * cal.input_scale;
  const v = (lat - cal.center.lat) * cal.input_scale;
  const h = cal.homography;
  const w = h[6] * u + h[7] * v + 1;
  return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
};
const points = {
  P1: [44.373611, -79.688611], P2: [44.373833, -79.689111], P3: [44.373861, -79.689333], P4: [44.373889, -79.689583],
  P5: [44.373917, -79.689806], P6: [44.374250, -79.689722], P7: [44.374250, -79.689472], P8: [44.374194, -79.689194],
  P9: [44.374306, -79.688944], P12: [44.374167, -79.690444], P13: [44.374028, -79.690528], S14: [44.373583, -79.691111],
  PICKUP: [44.373639, -79.687411],
};
const building = [[44.374292, -79.690245], [44.374213, -79.690261], [44.374215, -79.690301], [44.37413, -79.690318], [44.374138, -79.690352],
  [44.373951, -79.690395], [44.373914, -79.690081], [44.374092, -79.690042], [44.374104, -79.690076], [44.374266, -79.690033]];
const trackEnd = [44.373386, -79.686421];
const dir = [0.000133 / 1.723, -1]; // lat per lon-degree west
const track = [-79.6835, -79.6865, -79.6895, -79.6925].map((lon) => [trackEnd[0] + (lon - trackEnd[1]) * -0.000133 / 0.001723, lon]);
const svg = [
  `<polyline points="${track.map(project).map((p) => p.join(',')).join(' ')}" fill="none" stroke="#00853f" stroke-width="4" stroke-dasharray="10 6"/>`,
  `<polygon points="${building.map(project).map((p) => p.join(',')).join(' ')}" fill="rgba(212,38,44,.2)" stroke="#d4262c" stroke-width="3"/>`,
  ...Object.entries(points).map(([k, p]) => { const [x, y] = project(p); return `<circle cx="${x}" cy="${y}" r="6" fill="#075f86" stroke="#fff" stroke-width="2"/><text x="${x + 9}" y="${y - 6}" font: font-size="16" font-weight="900" fill="#062235">${k}</text>`; }),
].join('');
const html = `<body style="margin:0"><div style="position:relative;width:${cal.width}px;height:${cal.height}px">
<img src="../../frontend/src/platform-map/allandale-sim-basemap.webp" style="position:absolute;inset:0">
<svg width="${cal.width}" height="${cal.height}" style="position:absolute;inset:0">${svg}</svg></div></body>`;
const file = path.join(__dirname, '_check.html');
fs.writeFileSync(file, html);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: cal.width, height: cal.height } });
  await p.goto(pathToFileURL(file).href);
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(__dirname, 'calibration-check.png') });
  await b.close();
  fs.unlinkSync(file);
  console.log('track', JSON.stringify(track));
})();
