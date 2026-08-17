const MIN_PLATFORM_NUMBER = 1;
const MAX_PLATFORM_NUMBER = 14;

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

function departureTime(row) {
  const expected = Number(row && row.expected_departure_time);
  if (Number.isFinite(expected) && expected > 0) return expected;
  const scheduled = Number(row && row.scheduled_departure_time);
  return Number.isFinite(scheduled) && scheduled > 0 ? scheduled : null;
}

function buildPlatformDeparturePayload({ stopCode, terminalPayload, now = Date.now() } = {}) {
  const parsedStop = parsePlatformStopCode(stopCode);
  if (!parsedStop) return null;
  const departures = (terminalPayload && Array.isArray(terminalPayload.departures)
    ? terminalPayload.departures
    : [])
    .filter((row) => String(row && row.platform || '') === parsedStop.platform)
    .map((row) => ({
      agency_id: String(row.agency_id || ''),
      agency_name: String(row.agency_name || ''),
      route_id: String(row.route_id || ''),
      route_label: String(row.route_label || row.route_id || ''),
      source_route_id: String(row.source_route_id || ''),
      destination: String(row.destination || ''),
      departure_time: departureTime(row),
      scheduled_departure_time: Number(row.scheduled_departure_time) || null,
      departure_source: String(row.departure_source || 'scheduled'),
      progress_status: String(row.terminal_progress_status || row.progress_status || 'scheduled'),
    }))
    .sort((left, right) => {
      const leftTime = Number(left.departure_time) || Number.POSITIVE_INFINITY;
      const rightTime = Number(right.departure_time) || Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.route_label.localeCompare(right.route_label);
    });

  return {
    stop_code: parsedStop.stop_code,
    platform: parsedStop.platform,
    platform_display: parsedStop.platform_display,
    generated_at: Number(terminalPayload && terminalPayload.generated_at) || Number(now),
    status: departures.length ? 'ok' : 'no_departures',
    departures,
  };
}

module.exports = {
  MAX_PLATFORM_NUMBER,
  MIN_PLATFORM_NUMBER,
  buildPlatformDeparturePayload,
  parsePlatformStopCode,
};
