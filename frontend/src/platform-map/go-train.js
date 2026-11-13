// GO train placed along the GO track: 3D drawings of each car from the Barrie Simulator models,
// or a flat view from above in GO livery (design B1) when the drawings cannot load.
import MANIFEST from './bus-sprites/manifest.json';
import { DEPARTURE_NOW_GRACE_MS, formatScheduledDeparture, isAtPlatformDepartureEligible } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAP_TILT_DEGREES = 40;

// Real car lengths in metres, from the west (Union-bound) end: cab car, bi-level
// coaches, then the MP40 locomotive.
export const GO_TRAIN_CONSIST = Object.freeze([
  { kind: 'cab', metres: 26 },
  ...Array.from({ length: 10 }, () => ({ kind: 'coach', metres: 26 })),
  { kind: 'loco', metres: 21 },
]);
export const GO_TRAIN_CAR_GAP_METRES = 1;
// Drawn about 2.3 times the real 3 m width so the train reads on the TV.
export const GO_TRAIN_WIDTH_PX = 19;

export function isGoTrain(vehicle) {
  return String(vehicle && vehicle.agency_id || '') === 'go-transit' &&
    String(vehicle && vehicle.route_mode || '').toLowerCase() === 'train';
}

// Status for the label beside the train. Returns null when no label should show.
export function describeGoTrain(vehicle, nowMs = Date.now()) {
  const status = String(vehicle && vehicle.terminal_progress_status || '').toLowerCase();
  if (status === 'at_terminal') {
    const departureSeconds = Number(vehicle.terminal_departure_time);
    const departsLater = Number.isFinite(departureSeconds) &&
      departureSeconds * 1000 >= nowMs - DEPARTURE_NOW_GRACE_MS;
    // Same rule as the board's "Boarding" state: an outbound trip leaving within 20 minutes.
    if (departsLater && isAtPlatformDepartureEligible(vehicle, nowMs)) {
      const headsign = String(vehicle.trip_headsign || '').trim();
      const time = formatScheduledDeparture(departureSeconds);
      return {
        state: 'boarding',
        title: 'GO Train · Boarding',
        detail: headsign ? `to ${headsign} · departs ${time}` : `departs ${time}`,
      };
    }
    return { state: 'platform', title: 'GO Train · At the platform', detail: '' };
  }
  if (status === 'approaching') {
    return { state: 'arriving', title: 'GO Train · Arriving', detail: 'at the GO platform' };
  }
  return null;
}

function svgElement(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
  if (parent) parent.appendChild(node);
  return node;
}

// Each car is drawn in local units: x along the train from its west end, y across the track.
function drawCoach(g, len, w) {
  const h = w / 2;
  svgElement('rect', { x: 0, y: -h, width: len, height: w, rx: 2.5, fill: '#00853f' }, g);
  svgElement('rect', { x: 1, y: -h + 3, width: len - 2, height: w - 6, rx: 1.5, fill: '#e9edef' }, g);
  svgElement('rect', { x: 1, y: -1.1, width: len - 2, height: 2.2, fill: '#d2d9dc' }, g);
  [0.22, 0.5, 0.78].forEach((f) => {
    svgElement('rect', { x: len * f - 4, y: -2.5, width: 8, height: 5, rx: 1, fill: '#b8c2c7' }, g);
  });
  svgElement('path', { d: `M 1 ${-h + 3} L 9 ${-h + 3} L 4 ${-h + 7} L 1 ${-h + 7} Z`, fill: '#3fae49' }, g);
  svgElement('path', { d: `M ${len - 1} ${h - 3} L ${len - 9} ${h - 3} L ${len - 4} ${h - 7} L ${len - 1} ${h - 7} Z`, fill: '#3fae49' }, g);
}

function drawCab(g, len, w) {
  const h = w / 2;
  svgElement('path', { d: `M 9 ${-h} H ${len} V ${h} H 9 Q 0 ${h} 0 0 Q 0 ${-h} 9 ${-h} Z`, fill: '#00853f' }, g);
  svgElement('path', {
    d: `M 10 ${-h + 3} H ${len - 1} V ${h - 3} H 10 Q 3.5 ${h - 3} 3.5 0 Q 3.5 ${-h + 3} 10 ${-h + 3} Z`,
    fill: '#e9edef',
  }, g);
  svgElement('path', { d: 'M 3.6 -3 L 13 -6.5 L 13 6.5 L 3.6 3 Z', fill: '#00853f' }, g);
  svgElement('rect', { x: 14, y: -1.1, width: len - 15, height: 2.2, fill: '#d2d9dc' }, g);
  [0.45, 0.78].forEach((f) => {
    svgElement('rect', { x: len * f - 4, y: -2.5, width: 8, height: 5, rx: 1, fill: '#b8c2c7' }, g);
  });
}

function drawLoco(g, len, w) {
  const h = w / 2;
  svgElement('rect', { x: 0, y: -h, width: len, height: w, rx: 3, fill: '#00853f' }, g);
  svgElement('path', { d: `M ${len * 0.18} ${-h} L ${len * 0.42} ${-h} L ${len * 0.66} ${h} L ${len * 0.42} ${h} Z`, fill: '#ffffff' }, g);
  svgElement('rect', { x: len - 12, y: -h + 2, width: 10, height: w - 4, rx: 2, fill: '#e9edef' }, g);
  svgElement('rect', { x: len * 0.7, y: -2.4, width: 7, height: 4.8, rx: 1, fill: '#00632f' }, g);
  svgElement('rect', { x: len * 0.06, y: -2.4, width: 7, height: 4.8, rx: 1, fill: '#00632f' }, g);
}

const DRAW = { cab: drawCab, coach: drawCoach, loco: drawLoco };

export function goTrainSpriteUrl(kind) {
  return `./assets/bus-sprites/go-train-${kind}.webp`;
}

// Where a car's drawing goes in base-map pixels. The drawing is centred on the car, sized so the
// car fills its stretch of track, and turned by the small difference between the angle it was
// rendered at and the angle of the track on the map.
export function goTrainSpritePlacement(car) {
  const dx = car.end.x - car.start.x;
  const dy = car.end.y - car.start.y;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const view = MANIFEST.train.view_metres;
  const width = length * view.width / car.metres;
  const height = width * view.height / view.width;
  const bearing = MANIFEST.train.track_bearing * Math.PI / 180;
  const renderedAngle = Math.atan2(-Math.cos(bearing) * Math.cos(MAP_TILT_DEGREES * Math.PI / 180), Math.sin(bearing));
  return {
    x: (car.start.x + car.end.x) / 2 - width / 2,
    y: (car.start.y + car.end.y) / 2 - height / 2,
    width,
    height,
    rotation: (Math.atan2(dy, dx) - renderedAngle) * 180 / Math.PI,
  };
}

function drawCarSprite(group, car) {
  const place = goTrainSpritePlacement(car);
  if (!place) return;
  const url = goTrainSpriteUrl(car.kind);
  const centreX = place.x + place.width / 2;
  const centreY = place.y + place.height / 2;
  const image = svgElement('image', {
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    preserveAspectRatio: 'none',
    transform: `rotate(${place.rotation} ${centreX} ${centreY})`,
    href: url,
  }, group);
  image.setAttributeNS(XLINK_NS, 'xlink:href', url); // older TV browsers read only this one
}

// Loads every car drawing once. Calls back only when all of them are ready, so a train never
// shows a mix of drawn and flat cars.
export function preloadGoTrainSprites(onReady) {
  const kinds = MANIFEST.train.cars;
  let loaded = 0;
  kinds.forEach((kind) => {
    const image = new Image();
    image.onload = () => {
      loaded += 1;
      if (loaded === kinds.length) onReady();
    };
    image.src = goTrainSpriteUrl(kind);
  });
}

// cars: [{ kind, metres, start: {x, y}, end: {x, y} }] in base-map pixels.
export function drawGoTrain(svg, cars, useSprites = false) {
  const group = svgElement('g', { class: 'map-go-train' }, svg);
  cars.forEach((car) => {
    if (useSprites) {
      drawCarSprite(group, car);
      return;
    }
    const dx = car.end.x - car.start.x;
    const dy = car.end.y - car.start.y;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const shadow = svgElement('g', { transform: `translate(${car.start.x} ${car.start.y + 3}) rotate(${angle})` }, group);
    svgElement('rect', { x: 0, y: -GO_TRAIN_WIDTH_PX / 2, width: length, height: GO_TRAIN_WIDTH_PX, rx: 3, fill: 'rgba(30, 40, 50, 0.2)' }, shadow);
    const carGroup = svgElement('g', { transform: `translate(${car.start.x} ${car.start.y}) rotate(${angle})` }, group);
    DRAW[car.kind](carGroup, length, GO_TRAIN_WIDTH_PX);
  });
  return group;
}
