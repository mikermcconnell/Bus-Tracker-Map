const MIN_PLATFORM_NUMBER = 1;
const MAX_PLATFORM_NUMBER = 14;
const REALTIME_GRACE_SECONDS = 60;

function parsePlatformStopCode(value) {
  const stopCode = String(value || '').trim();
  const match = stopCode.match(/^90(\d{2})$/);
  if (!match) return null;
  const platformNumber = Number(match[1]);
  if (
    !Number.isInteger(platformNumber) ||
    platformNumber < MIN_PLATFORM_NUMBER ||
    platformNumber > MAX_PLATFORM_NUMBER
  ) {
    return null;
  }
  return {
    stop_code: stopCode,
    platform: String(platformNumber),
    platform_display: String(platformNumber).padStart(2, '0'),
  };
}

function normalizeRouteIdentity(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^(?:GO|ON|LINX)[\s-]+/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function platformForVehicle(vehicle) {
  const explicitPlatform = String(vehicle && vehicle.platform || '').trim();
  if (/^\d{1,2}$/.test(explicitPlatform)) {
    return String(Number(explicitPlatform));
  }
  const stopId = String(vehicle && vehicle.terminal_stop_id || '').trim();
  if (stopId === '14') return '14';
  const platformStop = parsePlatformStopCode(stopId);
  return platformStop ? platformStop.platform : '';
}

function routeIdentities(record) {
  return [
    record && record.route_id,
    record && record.route_label,
    record && record.source_route_id,
  ].map(normalizeRouteIdentity).filter(Boolean);
}

function assignmentMatchesVehicle(assignment, vehicle) {
  if (!assignment || !vehicle) return false;
  if (String(assignment.agency_id || '') !== String(vehicle.agency_id || '')) return false;
  if (String(assignment.platform || '') !== platformForVehicle(vehicle)) return false;
  const assignmentRoutes = routeIdentities(assignment);
  const vehicleRoutes = routeIdentities(vehicle);
  return assignmentRoutes.some((identity) => vehicleRoutes.includes(identity));
}

function liveSourceAvailable(vehiclePayload, agencyId) {
  const sources = vehiclePayload && vehiclePayload.sources;
  if (!sources || typeof sources !== 'object') return true;
  const sourceKey = String(agencyId || '').replace(/-/g, '_');
  const source = sources[sourceKey];
  return Boolean(source && String(source.feed_status || '').toLowerCase() === 'live');
}

function selectRealtimeDeparture(assignment, vehiclePayload, nowSeconds) {
  if (!liveSourceAvailable(vehiclePayload, assignment && assignment.agency_id)) return null;
  const candidates = (vehiclePayload && Array.isArray(vehiclePayload.vehicles)
    ? vehiclePayload.vehicles
    : [])
    .filter((vehicle) => {
      const progress = String(vehicle && vehicle.terminal_progress_status || '').toLowerCase();
      if (progress !== 'approaching' && progress !== 'at_terminal') return false;
      if (String(vehicle && vehicle.terminal_departure_source || '').toLowerCase() !== 'realtime') {
        return false;
      }
      const departureTime = Number(vehicle && vehicle.terminal_departure_time);
      return (
        assignmentMatchesVehicle(assignment, vehicle) &&
        Number.isFinite(departureTime) &&
        departureTime >= nowSeconds - REALTIME_GRACE_SECONDS
      );
    })
    .sort((a, b) => Number(a.terminal_departure_time) - Number(b.terminal_departure_time));
  return candidates[0] || null;
}

function buildPlatformDepartures({ stopCode, layout, vehiclePayload, now = Date.now() } = {}) {
  const parsedStop = parsePlatformStopCode(stopCode);
  if (!parsedStop) return null;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const resolvedNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowSeconds = resolvedNowMs / 1000;
  const assignments = (layout && Array.isArray(layout.assignments) ? layout.assignments : [])
    .filter((assignment) => String(assignment && assignment.platform || '') === parsedStop.platform);

  const departures = assignments.map((assignment) => {
    const vehicle = selectRealtimeDeparture(assignment, vehiclePayload, nowSeconds);
    const realtimeTime = Number(vehicle && vehicle.terminal_departure_time);
    const scheduledTime = Number(assignment && assignment.next_departure_time);
    const hasRealtime = Number.isFinite(realtimeTime) && realtimeTime > 0;
    const hasSchedule = Number.isFinite(scheduledTime) && scheduledTime > 0;
    return {
      agency_id: String(assignment.agency_id || ''),
      agency_name: String(assignment.agency_name || ''),
      route_id: String(assignment.route_id || ''),
      route_label: String(assignment.route_label || assignment.route_id || ''),
      source_route_id: String(assignment.source_route_id || ''),
      destination: String(assignment.destination || ''),
      departure_time: hasRealtime ? realtimeTime : (hasSchedule ? scheduledTime : null),
      scheduled_departure_time: hasSchedule ? scheduledTime : null,
      departure_source: hasRealtime ? 'realtime' : (hasSchedule ? 'static' : null),
      progress_status: vehicle
        ? String(vehicle.terminal_progress_status || '')
        : 'scheduled',
    };
  }).sort((a, b) => {
    const aTime = Number(a.departure_time);
    const bTime = Number(b.departure_time);
    const aSort = Number.isFinite(aTime) && aTime > 0 ? aTime : Number.POSITIVE_INFINITY;
    const bSort = Number.isFinite(bTime) && bTime > 0 ? bTime : Number.POSITIVE_INFINITY;
    return aSort - bSort || a.route_label.localeCompare(b.route_label);
  });

  return {
    stop_code: parsedStop.stop_code,
    platform: parsedStop.platform,
    platform_display: parsedStop.platform_display,
    generated_at: resolvedNowMs,
    status: departures.length ? 'ok' : 'no_departures',
    departures,
  };
}

function buildTerminalDepartures({ layout, vehiclePayload, now = Date.now() } = {}) {
  const platforms = Array.from(new Set(
    (layout && Array.isArray(layout.assignments) ? layout.assignments : [])
      .map((assignment) => String(assignment && assignment.platform || ''))
      .filter((platform) => /^\d{1,2}$/.test(platform))
  )).sort((left, right) => Number(left) - Number(right));

  return platforms.flatMap((platform) => {
    const payload = buildPlatformDepartures({
      stopCode: `90${String(Number(platform)).padStart(2, '0')}`,
      layout,
      vehiclePayload,
      now,
    });
    return (payload && payload.departures || []).map((departure) => ({
      platform,
      ...departure,
    }));
  });
}

module.exports = {
  MAX_PLATFORM_NUMBER,
  MIN_PLATFORM_NUMBER,
  assignmentMatchesVehicle,
  buildPlatformDepartures,
  buildTerminalDepartures,
  normalizeRouteIdentity,
  parsePlatformStopCode,
  platformForVehicle,
  selectRealtimeDeparture,
};
