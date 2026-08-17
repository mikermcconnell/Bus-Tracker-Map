import { distanceBetweenMeters } from './vehicle-groups.js';

export const BATT_COORDS = Object.freeze({
  lat: 44.3740170437343,
  lon: -79.6899831810679
});

export const TERMINAL_DISPLAY_RADIUS_METERS = 150;
export const TERMINAL_ARRIVING_NOW_RADIUS_METERS = 250;
export const TERMINAL_NEARBY_PRIORITY_RADIUS_METERS = 500;

const SOURCE_KEY_BY_AGENCY = Object.freeze({
  'barrie-transit': 'barrie_transit',
  'ontario-northland': 'ontario_northland',
  'go-transit': 'go_transit',
  'simcoe-linx': 'simcoe_linx'
});

export function isVehicleSourceLive(vehicle, sources) {
  if (!vehicle || !sources || typeof sources !== 'object') return true;
  const agencyId = String(vehicle.agency_id || 'barrie-transit').trim().toLowerCase();
  const sourceKey = SOURCE_KEY_BY_AGENCY[agencyId];
  if (!sourceKey || !sources[sourceKey]) return true;
  return String(sources[sourceKey].feed_status || '').trim().toLowerCase() === 'live';
}

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

export function getTerminalListStatus(
  vehicle,
  distanceMeters,
  terminalRadiusMeters = TERMINAL_DISPLAY_RADIUS_METERS
) {
  if (!vehicle) return '';
  const status = getTerminalDisplayStatus(
    vehicle.terminal_progress_status,
    distanceMeters,
    terminalRadiusMeters
  );
  const distance = Number(distanceMeters);
  const radius = Math.max(0, Number(terminalRadiusMeters) || 0);
  const currentStopId = String(vehicle.stop_id || '');
  const terminalStopId = String(vehicle.terminal_stop_id || '');

  // Some Barrie vehicle-position records report the terminal stop ID and a
  // stopped status while their stop_sequence still points to an earlier stop.
  // Physical presence plus STOPPED_AT is stronger display evidence in this
  // narrow terminal geofence, without changing the schedule-progress value.
  if (
    Number(vehicle.current_status) === 1 &&
    currentStopId &&
    currentStopId === terminalStopId &&
    Number.isFinite(distance) &&
    distance <= radius
  ) {
    return 'at_terminal';
  }

  // GO buses can already be physically at Allandale while their outbound
  // trip reports the terminal as passed. Keep them listed until they leave.
  if (
    String(vehicle.agency_id || '').toLowerCase() === 'go-transit' &&
    Number.isFinite(distance) &&
    distance <= radius
  ) {
    return 'at_terminal';
  }

  return status;
}

export function getRouteEightDirectionLabel(routeId, directionId) {
  const route = String(routeId || '').trim().toUpperCase();
  if (route !== '8' && route !== '8A' && route !== '8B') return '';
  const direction = Number(directionId);
  if (direction === 0) return 'North';
  if (direction === 1) return 'South';
  return '';
}

export function getTerminalEventTime(
  vehicle,
  terminalStatus,
  nowMs = Date.now(),
  distanceMeters = null
) {
  if (!vehicle) return null;
  const nowSeconds = Number(nowMs) / 1000;
  const distance = Number(distanceMeters);
  if (
    terminalStatus !== 'at_terminal' &&
    distanceMeters !== null && distanceMeters !== undefined &&
    Number.isFinite(distance) && distance <= TERMINAL_ARRIVING_NOW_RADIUS_METERS &&
    Number.isFinite(nowSeconds)
  ) {
    return nowSeconds;
  }
  const rawTime = terminalStatus === 'at_terminal'
    ? vehicle.terminal_departure_time
    : vehicle.terminal_arrival_time;
  if (rawTime === null || rawTime === undefined || rawTime === '') return null;
  const eventTime = Number(rawTime);
  if (
    !Number.isFinite(eventTime) || eventTime <= 0 ||
    !Number.isFinite(nowSeconds) || eventTime < nowSeconds - 5 * 60
  ) {
    return null;
  }
  // A due arrival prediction cannot outweigh GPS evidence that the vehicle is
  // still outside the arriving-now radius. Treat it as unknown until either a
  // future prediction arrives or the vehicle gets physically close.
  if (
    terminalStatus !== 'at_terminal' &&
    distanceMeters !== null && distanceMeters !== undefined &&
    Number.isFinite(distance) && distance > TERMINAL_ARRIVING_NOW_RADIUS_METERS &&
    eventTime <= nowSeconds
  ) {
    return null;
  }
  return eventTime;
}

export function selectNearestVehicles(list, options = {}) {
  const terminal = options.terminal || BATT_COORDS;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : 5;

  return (Array.isArray(list) ? list : [])
    .filter((vehicle) => (
      vehicle &&
      isVehicleSourceLive(vehicle, options.sources) &&
      Number.isFinite(Number(vehicle.lat)) &&
      Number.isFinite(Number(vehicle.lon))
    ))
    .map((vehicle) => {
      const distanceMeters = distanceBetweenMeters(
        Number(vehicle.lat),
        Number(vehicle.lon),
        Number(terminal.lat),
        Number(terminal.lon)
      );
      const terminalStatus = getTerminalListStatus(vehicle, distanceMeters);
      return {
        vehicle,
        distanceMeters,
        terminalStatus,
        terminalEventTime: getTerminalEventTime(
          vehicle,
          terminalStatus,
          nowMs,
          distanceMeters
        )
      };
    })
    .filter((entry) => (
      Number.isFinite(entry.distanceMeters) &&
      (
        isVehicleApproachingBatt(entry.vehicle) ||
        getTerminalListStatus(entry.vehicle, entry.distanceMeters) === 'at_terminal'
      )
    ))
    .sort((a, b) => {
      const aAtTerminal = a.terminalStatus === 'at_terminal';
      const bAtTerminal = b.terminalStatus === 'at_terminal';
      if (aAtTerminal !== bAtTerminal) return aAtTerminal ? -1 : 1;
      const aNearby = a.terminalStatus === 'approaching' &&
        a.distanceMeters <= TERMINAL_NEARBY_PRIORITY_RADIUS_METERS;
      const bNearby = b.terminalStatus === 'approaching' &&
        b.distanceMeters <= TERMINAL_NEARBY_PRIORITY_RADIUS_METERS;
      if (aNearby !== bNearby) return aNearby ? -1 : 1;
      if (aNearby && a.distanceMeters !== b.distanceMeters) {
        return a.distanceMeters - b.distanceMeters;
      }
      const aHasTime = Number.isFinite(a.terminalEventTime);
      const bHasTime = Number.isFinite(b.terminalEventTime);
      if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
      if (aHasTime && a.terminalEventTime !== b.terminalEventTime) {
        return a.terminalEventTime - b.terminalEventTime;
      }
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

export function formatTerminalDeparture(departureEpochSeconds, nowMs = Date.now()) {
  const departureMs = Number(departureEpochSeconds) * 1000;
  const currentMs = Number(nowMs);
  if (!Number.isFinite(departureMs) || departureMs <= 0 || !Number.isFinite(currentMs)) return '';
  const remainingMs = departureMs - currentMs;
  if (remainingMs < -5 * 60 * 1000) return '';
  if (remainingMs <= 0) return 'Departs now';
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `Departs in ${minutes} min`;
}

export function formatTerminalArrival(
  arrivalEpochSeconds,
  nowMs = Date.now(),
  distanceMeters = null
) {
  const distance = Number(distanceMeters);
  if (
    distanceMeters !== null && distanceMeters !== undefined &&
    Number.isFinite(distance) && distance <= TERMINAL_ARRIVING_NOW_RADIUS_METERS
  ) {
    return 'Arriving now';
  }
  const arrivalMs = Number(arrivalEpochSeconds) * 1000;
  const currentMs = Number(nowMs);
  if (!Number.isFinite(arrivalMs) || arrivalMs <= 0 || !Number.isFinite(currentMs)) return '';
  const remainingMs = arrivalMs - currentMs;
  if (remainingMs < -5 * 60 * 1000) return '';
  if (remainingMs <= 0) {
    const hasDistance = distanceMeters !== null && distanceMeters !== undefined &&
      Number.isFinite(distance);
    return hasDistance ? '' : 'Arriving now';
  }
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return `Arrives in ${minutes} min`;
}
