function buildTerminalApproachFallbacks(trips, stopTimes, terminalStopIds) {
  const terminalIds = terminalStopIds instanceof Set
    ? terminalStopIds
    : new Set(Array.from(terminalStopIds || []).map(String));
  const tripsById = new Map();
  const stopTimesByTrip = new Map();

  (Array.isArray(trips) ? trips : []).forEach((trip) => {
    const tripId = String(trip && trip.trip_id || '');
    if (tripId) tripsById.set(tripId, trip);
  });
  (Array.isArray(stopTimes) ? stopTimes : []).forEach((stopTime) => {
    const tripId = String(stopTime && stopTime.trip_id || '');
    const stopId = String(stopTime && stopTime.stop_id || '');
    const stopSequence = Number(stopTime && stopTime.stop_sequence);
    if (!tripId || !stopId || !Number.isFinite(stopSequence)) return;
    if (!stopTimesByTrip.has(tripId)) stopTimesByTrip.set(tripId, []);
    stopTimesByTrip.get(tripId).push({ stop_id: stopId, stop_sequence: stopSequence });
  });

  const fallbackStats = new Map();
  stopTimesByTrip.forEach((rows, tripId) => {
    const trip = tripsById.get(tripId);
    const routeId = String(trip && trip.route_id || '').trim();
    const directionId = trip && trip.direction_id !== undefined && trip.direction_id !== null
      ? String(trip.direction_id).trim()
      : '';
    if (!routeId || !directionId) return;

    const orderedRows = rows.slice().sort((a, b) => a.stop_sequence - b.stop_sequence);
    const terminalVisits = orderedRows.filter((row) => terminalIds.has(row.stop_id));
    const occurrencesByStop = new Map();
    orderedRows.forEach((row) => {
      if (terminalIds.has(row.stop_id)) return;
      if (!occurrencesByStop.has(row.stop_id)) occurrencesByStop.set(row.stop_id, []);
      occurrencesByStop.get(row.stop_id).push(row);
    });

    occurrencesByStop.forEach((occurrences, stopId) => {
      const key = `${routeId}|${directionId}|${stopId}`;
      if (!fallbackStats.has(key)) {
        fallbackStats.set(key, {
          route_id: routeId,
          direction_id: directionId,
          stop_id: stopId,
          candidate_trip_ids: new Set(),
          approaching_trip_ids: new Set(),
          terminal_stop_ids: new Set(),
        });
      }
      const stats = fallbackStats.get(key);
      stats.candidate_trip_ids.add(tripId);

      const nextTerminalVisits = occurrences.map((occurrence) => (
        terminalVisits.find((terminal) => terminal.stop_sequence > occurrence.stop_sequence) || null
      ));
      if (nextTerminalVisits.some((terminal) => !terminal)) return;

      stats.approaching_trip_ids.add(tripId);
      nextTerminalVisits.forEach((terminal) => stats.terminal_stop_ids.add(terminal.stop_id));
    });
  });

  return Object.fromEntries(
    Array.from(fallbackStats.entries())
      .filter(([, stats]) => (
        stats.approaching_trip_ids.size > 0 &&
        stats.approaching_trip_ids.size === stats.candidate_trip_ids.size
      ))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, stats]) => [key, {
        route_id: stats.route_id,
        direction_id: stats.direction_id,
        stop_id: stats.stop_id,
        terminal_stop_ids: Array.from(stats.terminal_stop_ids).sort(),
        candidate_trip_count: stats.candidate_trip_ids.size,
      }])
  );
}

module.exports = { buildTerminalApproachFallbacks };
