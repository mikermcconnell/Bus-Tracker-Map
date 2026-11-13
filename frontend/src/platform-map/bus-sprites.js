// Picks the rendered bus drawing for a live vehicle on the terminal map. The drawings come
// from scripts/render-platform-bus-sprites.js.
import MANIFEST from './bus-sprites/manifest.json';

// Drawn larger than life: a true-scale bus is smaller than the platform pins on the TV.
export const BUS_SPRITE_SCALE = 2.2;
// The side view, for a vehicle that has not reported a direction yet.
const DEFAULT_BEARING = 90;
const AGENCY_SPRITES = Object.freeze(['go-transit', 'simcoe-linx', 'ontario-northland']);

// A bus at a bay parks parallel to the platform, facing forward: the north row faces west,
// the south row east, the Essa Rd bays north and Stop 14 south.
const BAY_BEARINGS = Object.freeze({
  '2': 90, '3': 90, '4': 90, '5': 90,
  '6': 270, '7': 270, '8': 270, '9': 270,
  '12': 0, '13': 0,
  '14': 180,
});

// The parked direction for a bay, or null for a bay with no set direction.
export function bayBearing(platform) {
  const bearing = BAY_BEARINGS[String(platform)];
  return bearing === undefined ? null : bearing;
}

export function spriteHeadingIndex(bearing) {
  const degrees = Number(bearing);
  const safe = Number.isFinite(degrees) ? degrees : DEFAULT_BEARING;
  const step = 360 / MANIFEST.headings;
  return Math.round((((safe % 360) + 360) % 360) / step) % MANIFEST.headings;
}

function spriteName(vehicle, routeColor) {
  const agency = String(vehicle && vehicle.agency_id || '');
  if (AGENCY_SPRITES.indexOf(agency) !== -1) return agency;
  const color = String(routeColor || '').replace(/^#/, '').toUpperCase();
  const known = MANIFEST.barrie_colors.indexOf(color) !== -1;
  return `barrie-${known ? color : MANIFEST.barrie_default_color}`;
}

// Returns '' for a train, which keeps its own symbol.
export function busSpriteUrl(vehicle, routeColor, bearing) {
  if (String(vehicle && vehicle.route_mode || '').toLowerCase() === 'train') return '';
  const heading = String(spriteHeadingIndex(bearing)).padStart(2, '0');
  return `./assets/bus-sprites/${spriteName(vehicle, routeColor)}-${heading}.webp`;
}

// Width in screen pixels of a sprite on a map plane of the given width.
export function busSpriteWidth(planeWidth, calibration) {
  const pixelsPerMetre = planeWidth / calibration.width / calibration.metres_per_pixel;
  return MANIFEST.view_metres * pixelsPerMetre * BUS_SPRITE_SCALE;
}
