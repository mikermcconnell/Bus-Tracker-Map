import { distanceBetweenMeters } from './vehicle-groups.js';

export const BATT_COORDS = Object.freeze({
  lat: 44.3740170437343,
  lon: -79.6899831810679
});

export const TERMINAL_DISPLAY_RADIUS_METERS = 150;

export function getTerminalDisplayStatus(
  terminalProgressStatus,
  distanceMeters,
  terminalRadiusMeters = TERMINAL_DISPLAY_RADIUS_METERS
) {
  const status = String(terminalProgressStatus || '').toLowerCase();
  const distance = Number(distanceMeters);
  const radius = Math.max(0, Number(terminalRadiusMeters) || 0);

  if (status === 'at_terminal' && Number.isFinite(distance) && distance > radius) {
    return 'approaching';
  }
  return status;
}

export function isVehicleApproachingBatt(vehicle) {
  if (!vehicle) return false;
  const status = String(vehicle.terminal_progress_status || '').toLowerCase();
  return status === 'approaching' || status === 'at_terminal';
}

export function selectNearestVehicles(list, options = {}) {
  const terminal = options.terminal || BATT_COORDS;
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : 5;

  return (Array.isArray(list) ? list : [])
    .filter((vehicle) => (
      vehicle &&
      isVehicleApproachingBatt(vehicle) &&
      Number.isFinite(Number(vehicle.lat)) &&
      Number.isFinite(Number(vehicle.lon))
    ))
    .map((vehicle) => ({
      vehicle,
      distanceMeters: distanceBetweenMeters(
        Number(vehicle.lat),
        Number(vehicle.lon),
        Number(terminal.lat),
        Number(terminal.lon)
      )
    }))
    .filter((entry) => Number.isFinite(entry.distanceMeters))
    .sort((a, b) => {
      if (a.distanceMeters !== b.distanceMeters) {
        return a.distanceMeters - b.distanceMeters;
      }
      return String(a.vehicle.route_label || a.vehicle.route_id || '')
        .localeCompare(String(b.vehicle.route_label || b.vehicle.route_id || ''));
    })
    .slice(0, limit);
}

export function formatTerminalDistance(distanceMeters, terminalProgressStatus) {
  const distance = Math.max(0, Number(distanceMeters) || 0);
  if (getTerminalDisplayStatus(terminalProgressStatus, distance) === 'at_terminal') {
    return 'At the terminal';
  }
  if (distance < 1000) return `${Math.max(50, Math.round(distance / 50) * 50)} m away`;
  return `${(distance / 1000).toFixed(distance < 10000 ? 1 : 0)} km away`;
}
