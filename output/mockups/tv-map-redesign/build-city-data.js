// Projects the real GTFS route shapes and landmark stops into the pixel space of
// the Barrie Simulator render (assets/city-*.png) and writes assets/city-data.js.
// The render is a straight-down camera, so ground points map linearly.
//
// Usage: node build-city-data.js
const path = require('path');
const fs = require('fs');

const cacheDir = path.resolve(__dirname, '../../../cache');
const views = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/city-views.json'), 'utf8'));
const mpp = Number(Object.keys(views.views)[0]);
const { center, width, height } = views;

const R = 6371008.8;
const DEG = Math.PI / 180;
const KX = Math.cos(44.3835 * DEG) * R * DEG; // simulator CITY_ORIGIN latitude
const KY = R * DEG;
const project = ([lon, lat]) => [
  width / 2 + ((lon - center[1]) * KX) / mpp,
  height / 2 - ((lat - center[0]) * KY) / mpp,
];

// Douglas-Peucker in pixel space keeps the paths small without visible change.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / len;
    if (dist > maxDist) { maxDist = dist; index = i; }
  }
  if (maxDist <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
const toD = (coords) => 'M ' + simplify(coords.map(project), 1.2).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ');

const read = (file) => JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8')).features;
const TERMINAL = [-79.6895, 44.3745];
const servesTerminal = (coords) => coords.some(([lon, lat]) => Math.hypot((lon - TERMINAL[0]) * KX, (lat - TERMINAL[1]) * KY) < 250);

// Route families shown on the TV (only routes that serve Allandale).
const families = {
  '7': { match: (p) => /^7[AB]$/.test(p.route_short_name) },
  '8A': { match: (p) => p.route_short_name === '8A' },
  '8B': { match: (p) => p.route_short_name === '8B' },
  '12': { match: (p) => /^12[AB]$/.test(p.route_short_name) },
  'LINX2': { file: 'simcoe-linx-routes.geojson', match: (p) => p.route_short_name === 'LINX 2' },
  'GO68': { file: 'go-transit-routes.geojson', match: (p) => p.route_short_name === 'GO BUS' },
  'TRAIN': { file: 'go-transit-routes.geojson', match: (p) => p.route_short_name === 'GO TRAIN', any: true },
};

const routes = {};
for (const [id, family] of Object.entries(families)) {
  const shapes = read(family.file || 'routes.geojson')
    .filter((f) => f.geometry.type === 'LineString' && family.match(f.properties))
    .filter((f) => family.any || servesTerminal(f.geometry.coordinates));
  // Longest shape first: the mockup animates buses along it.
  shapes.sort((a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length);
  routes[id] = { gtfsColor: shapes[0] && shapes[0].properties.route_color, paths: shapes.map((f) => toD(f.geometry.coordinates)) };
  console.log(`${id}: ${shapes.length} shapes`);
}

// Landmarks from real stop locations (cache/stops.geojson).
const LANDMARKS = [
  ['Georgian Mall', -79.7065, 44.4107],
  ['Georgian College', -79.6689, 44.4105],
  ['RVH', -79.6635, 44.4144],
  ['Downtown', -79.6880, 44.3895],
  ['Park Place', -79.6803, 44.3404],
  ['Barrie South GO', -79.6284, 44.3519],
].map(([name, lon, lat]) => ({ name, xy: project([lon, lat]).map((v) => Math.round(v)) }));

const data = {
  image: views.views[mpp],
  mpp,
  width,
  height,
  terminal: project(TERMINAL).map((v) => Math.round(v * 10) / 10),
  landmarks: LANDMARKS,
  routes,
};
fs.writeFileSync(path.join(__dirname, 'assets/city-data.js'), `window.CITY = ${JSON.stringify(data)};\n`);
console.log('terminal at', data.terminal, '· wrote assets/city-data.js');
