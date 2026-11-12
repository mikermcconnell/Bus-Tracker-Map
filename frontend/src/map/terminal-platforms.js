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
    const exactMatch = pickAssignment(
      stopMatches.filter((assignment) => routesOverlap(assignment, vehicle)),
      vehicle
    );
    if (exactMatch) return exactMatch;
    if (stopMatches.length === 1) return stopMatches[0];
  }

  return pickAssignment(
    agencyAssignments.filter((assignment) => routesOverlap(assignment, vehicle)),
    vehicle
  );
}

// Several routes can share one route_id (all Ontario Northland routes are ONTC).
// Prefer the vehicle's own route number; otherwise any match will do when they
// all point at the same platform.
function pickAssignment(matches, vehicle) {
  if (matches.length <= 1) return matches[0] || null;
  const sourceRouteId = normalize(vehicle && vehicle.source_route_id);
  const sameRoute = sourceRouteId
    ? matches.filter((assignment) => normalize(assignment.source_route_id) === sourceRouteId)
    : [];
  if (sameRoute.length === 1) return sameRoute[0];
  const platforms = new Set(matches.map((assignment) => normalize(assignment.platform)));
  return platforms.size === 1 ? matches[0] : null;
}

export function formatPlatformLabel(assignment) {
  const platform = String(assignment && assignment.platform || '').trim();
  if (!platform) return 'CHECK BOARD';
  return platform === '14' ? 'STOP 14' : `PLATFORM ${platform}`;
}
