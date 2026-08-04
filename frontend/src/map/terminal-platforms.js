function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function assignmentRouteIds(assignment) {
  return [
    assignment && assignment.route_id,
    assignment && assignment.route_label,
    assignment && assignment.source_route_id,
  ].map(normalize).filter(Boolean);
}

function vehicleRouteIds(vehicle) {
  return [
    vehicle && vehicle.route_id,
    vehicle && vehicle.route_label,
    vehicle && vehicle.source_route_id,
  ].map(normalize).filter(Boolean);
}

function routesOverlap(assignment, vehicle) {
  const vehicleIds = new Set(vehicleRouteIds(vehicle));
  return assignmentRouteIds(assignment).some((routeId) => vehicleIds.has(routeId));
}

export function buildTerminalAssignmentIndex(layout) {
  return (Array.isArray(layout && layout.assignments) ? layout.assignments : [])
    .filter((assignment) => (
      assignment && assignment.platform && assignment.agency_id
    ));
}

export function resolveTerminalAssignment(vehicle, assignments) {
  if (!vehicle) return null;
  const agencyId = normalize(vehicle.agency_id || 'barrie-transit');
  const stopId = normalize(vehicle.terminal_stop_id);
  const agencyAssignments = (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => normalize(assignment.agency_id) === agencyId);

  if (stopId) {
    const stopMatches = agencyAssignments.filter((assignment) => (
      normalize(assignment.stop_id) === stopId
    ));
    const exactMatches = stopMatches.filter((assignment) => routesOverlap(assignment, vehicle));
    if (exactMatches.length === 1) return exactMatches[0];
    if (stopMatches.length === 1) return stopMatches[0];
  }

  const routeMatches = agencyAssignments.filter((assignment) => routesOverlap(assignment, vehicle));
  return routeMatches.length === 1 ? routeMatches[0] : null;
}

export function formatPlatformLabel(assignment) {
  const platform = String(assignment && assignment.platform || '').trim();
  if (!platform) return 'CHECK BOARD';
  return platform === '14' ? 'STOP 14' : `PLATFORM ${platform}`;
}
