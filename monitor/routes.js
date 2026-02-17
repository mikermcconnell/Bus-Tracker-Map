/* monitor/routes.js — Route normalization for monitor reporting */

const ROUTE_ALIASES = new Map([
  ['2A', '2'],
  ['2B', '2'],
  ['7A', '7'],
  ['7B', '7'],
  ['12A', '12'],
  ['12B', '12'],
]);

function normalizeRouteId(routeId) {
  if (!routeId && routeId !== 0) return null;

  const raw = String(routeId).trim().toUpperCase();
  if (!raw) return null;

  if (ROUTE_ALIASES.has(raw)) return ROUTE_ALIASES.get(raw);

  return raw;
}

module.exports = {
  normalizeRouteId,
};
