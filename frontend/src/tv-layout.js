/**
 * Opt-in TV redesign for the main live map (`/?layout=tv`).
 * The default layout is unchanged; everything here only runs when the flag is set.
 */

// Top-down Barrie Simulator render (scripts/capture-sim-basemap.js).
// A straight-down camera maps ground points linearly, so the image spans a
// simple lat/lon box around its centre. The image reaches past the focus area
// (RVH, Georgian Mall, Park Place, Barrie South GO) so any screen shape fills.
export const SIM_BASEMAP = Object.freeze({
  url: './assets/barrie-sim-city.webp',
  center: Object.freeze({ lat: 44.3778, lng: -79.67 }),
  metresPerPixel: 5.4,
  width: 3700,
  height: 2200,
  focusWidthMeters: 12485,
  focusHeightMeters: 9115,
  originLat: 44.3835, // simulator CITY_ORIGIN latitude, used for its east-west scale
  edgeColor: '#e7e9f5',
});

const EARTH_RADIUS_METERS = 6371008.8;
const DEG = Math.PI / 180;

// GTFS colours 8A and 8B both black, and 12A/12B a pale pink that fades on a light basemap.
export const TV_ROUTE_COLOR_OVERRIDES = Object.freeze({
  '8B': '#2563c9',
  '12A': '#e0569b',
  '12B': '#e0569b',
});

// Landmark label positions for the TV view's scale (about 11 m per pixel).
// The defaults were placed for the old tile zoom and collide here.
export const TV_STOP_HIGHLIGHT_OVERRIDES = Object.freeze({
  '330': { shortLabel: 'Georgian College', labelCoords: { lat: 44.4052, lng: -79.6748 } },
  '333': { labelCoords: { lat: 44.4150, lng: -79.6515 } },
  '76': { labelCoords: { lat: 44.4128, lng: -79.7250 } },
  '777': { labelCoords: { lat: 44.3442, lng: -79.6690 } },
  '488': { labelCoords: { lat: 44.3475, lng: -79.7230 } },
  '1': { labelCoords: { lat: 44.3905, lng: -79.6765 } },
});

export function isTvLayout(search) {
  const params = new URLSearchParams(String(search || ''));
  return String(params.get('layout') || '').toLowerCase() === 'tv';
}

function boundsAround(basemap, widthMeters, heightMeters) {
  const metresPerDegLat = EARTH_RADIUS_METERS * DEG;
  const metresPerDegLng = Math.cos(basemap.originLat * DEG) * metresPerDegLat;
  const dLat = heightMeters / 2 / metresPerDegLat;
  const dLng = widthMeters / 2 / metresPerDegLng;
  return [
    [basemap.center.lat - dLat, basemap.center.lng - dLng],
    [basemap.center.lat + dLat, basemap.center.lng + dLng],
  ];
}

/** Full extent of the basemap image. */
export function getSimBasemapBounds(basemap = SIM_BASEMAP) {
  return boundsAround(basemap, basemap.width * basemap.metresPerPixel, basemap.height * basemap.metresPerPixel);
}

/** The area the TV always shows in full; the rest of the image fills the edges. */
export function getSimFocusBounds(basemap = SIM_BASEMAP) {
  return boundsAround(basemap, basemap.focusWidthMeters, basemap.focusHeightMeters);
}

export function getTvRouteColorOverride(routeId) {
  const key = String(routeId || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(TV_ROUTE_COLOR_OVERRIDES, key)
    ? TV_ROUTE_COLOR_OVERRIDES[key]
    : null;
}

function segmentMeters(a, b) {
  const metresPerDegLat = EARTH_RADIUS_METERS * DEG;
  const dy = (b[0] - a[0]) * metresPerDegLat;
  const dx = (b[1] - a[1]) * metresPerDegLat * Math.cos(((a[0] + b[0]) / 2) * DEG);
  return Math.hypot(dx, dy);
}

/**
 * Joins road pieces whose ends meet (within `toleranceMeters`) into longer lines.
 * OpenStreetMap splits a street into many short ways.
 */
export function stitchLines(lines, toleranceMeters = 15) {
  const pending = (Array.isArray(lines) ? lines : []).filter((line) => Array.isArray(line) && line.length >= 2).map((line) => line.slice());
  const joined = [];
  while (pending.length) {
    let line = pending.shift();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < pending.length; i++) {
        const other = pending[i];
        const head = line[0];
        const tail = line[line.length - 1];
        if (segmentMeters(tail, other[0]) <= toleranceMeters) {
          line = line.concat(other.slice(1));
        } else if (segmentMeters(tail, other[other.length - 1]) <= toleranceMeters) {
          line = line.concat(other.slice(0, -1).reverse());
        } else if (segmentMeters(head, other[other.length - 1]) <= toleranceMeters) {
          line = other.slice(0, -1).concat(line);
        } else if (segmentMeters(head, other[0]) <= toleranceMeters) {
          line = other.slice(1).reverse().concat(line);
        } else {
          continue;
        }
        pending.splice(i, 1);
        extended = true;
        break;
      }
    }
    joined.push(line);
  }
  return joined;
}

/**
 * Picks street-name positions for one road on the TV map: the longest stretch of
 * the road inside the bounds (shrunk by `inset` so names stay off the edges),
 * then points along it in order of preference. The caller shows the first one
 * that does not collide with other labels.
 *
 * @param {Array<Array<[number, number]>>} lines road polylines as [lat, lng] points
 * @param {[[number, number], [number, number]]} bounds [[south, west], [north, east]]
 */
export function pickRoadLabelCandidates(lines, bounds, { fractions = [0.5, 0.3, 0.7, 0.15, 0.85], inset = 0.06, minMeters = 800 } = {}) {
  const [[south, west], [north, east]] = bounds;
  const padLat = (north - south) * inset;
  const padLng = (east - west) * inset;
  const inside = ([lat, lng]) => lat > south + padLat && lat < north - padLat && lng > west + padLng && lng < east - padLng;

  let best = [];
  let bestLength = 0;
  stitchLines(lines).forEach((line) => {
    let run = [];
    let runLength = 0;
    const close = () => {
      if (runLength > bestLength) {
        best = run;
        bestLength = runLength;
      }
      run = [];
      runLength = 0;
    };
    (Array.isArray(line) ? line : []).forEach((point) => {
      if (!inside(point)) {
        close();
        return;
      }
      if (run.length) runLength += segmentMeters(run[run.length - 1], point);
      run.push(point);
    });
    close();
  });
  if (best.length < 2 || bestLength < minMeters) return [];

  return fractions.map((fraction) => {
    let remaining = bestLength * fraction;
    for (let i = 1; i < best.length; i++) {
      const length = segmentMeters(best[i - 1], best[i]);
      if (remaining <= length || i === best.length - 1) {
        const t = length > 0 ? Math.min(1, remaining / length) : 0;
        return {
          lat: best[i - 1][0] + (best[i][0] - best[i - 1][0]) * t,
          lng: best[i - 1][1] + (best[i][1] - best[i - 1][1]) * t,
        };
      }
      remaining -= length;
    }
    return { lat: best[0][0], lng: best[0][1] };
  });
}

/**
 * Splits "Arrives in 15 min" / "Departs in 3 min" / "Arriving now" into the
 * parts the TV row shows: a large value, a unit, and a small caption.
 */
export function splitDepartureLabel(label) {
  const text = String(label || '').trim();
  if (!text) return null;
  const timed = text.match(/^(Arrives|Departs)\s+in\s+(\d+)\s*min$/i);
  if (timed) {
    return { caption: timed[1].toUpperCase(), value: timed[2], unit: 'min', now: false };
  }
  const now = text.match(/^(Arriving|Departs|Departing)\s+now$/i);
  if (now) {
    const verb = now[1].toLowerCase() === 'arriving' ? 'ARRIVING' : 'DEPARTING';
    return { caption: verb, value: 'Now', unit: '', now: true };
  }
  return { caption: '', value: text, unit: '', now: false };
}

/**
 * Groups visible routes into legend items: routes that share a colour and agency
 * (7A and 7B, 12A and 12B) become one "7A / 7B" item, in the order given.
 */
export function buildRouteLegendItems(routes) {
  const items = [];
  const byKey = Object.create(null);
  (Array.isArray(routes) ? routes : []).forEach((route) => {
    if (!route || route.visible === false || !route.meta) return;
    const color = String(route.meta.color || '').toLowerCase();
    const agencyId = String(route.meta.agencyId || '');
    const label = String(route.meta.displayName || route.routeId || '').trim();
    if (!color || !label) return;
    const key = `${agencyId}|${color}`;
    if (byKey[key]) {
      if (byKey[key].labels.indexOf(label) === -1) byKey[key].labels.push(label);
      return;
    }
    byKey[key] = { color: route.meta.color, agencyId, labels: [label] };
    items.push(byKey[key]);
  });
  return items.map((item) => ({ color: item.color, agencyId: item.agencyId, label: item.labels.join(' / ') }));
}

/**
 * Moves the whole page by a few pixels every few minutes so static parts of the
 * screen (header, banner, panel) do not burn in on panels that are prone to it.
 */
export function startPixelShift(element, { intervalMs = 3 * 60 * 1000, maxShiftPx = 3, random = Math.random } = {}) {
  if (!element || !element.style) return () => {};
  const shift = () => {
    const x = Math.round((random() * 2 - 1) * maxShiftPx);
    const y = Math.round((random() * 2 - 1) * maxShiftPx);
    element.style.transform = `translate(${x}px, ${y}px)`;
  };
  const timer = setInterval(shift, intervalMs);
  return () => {
    clearInterval(timer);
    element.style.transform = '';
  };
}
