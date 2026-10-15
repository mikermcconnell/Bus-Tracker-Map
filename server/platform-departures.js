const MIN_PLATFORM_NUMBER = 1;
const MAX_PLATFORM_NUMBER = 14;
const PLATFORM_HORIZON_HOURS = 72;
const PLATFORM_AGENCIES = Object.freeze({
  '1': 'go_transit', '2': 'simcoe_linx',
  '3': 'barrie_transit', '4': 'barrie_transit',
  '5': 'barrie_transit', '6': 'barrie_transit',
  '7': 'go_transit', '8': 'ontario_northland',
  '12': 'barrie_transit', '13': 'barrie_transit',
});

function agencyForPlatform(platform) {
  return PLATFORM_AGENCIES[String(platform)] || null;
}

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
  const agency = agencyForPlatform(parsedStop.platform);
  const source = agency && terminalPayload && terminalPayload.sources && terminalPayload.sources[agency];
  const scheduleUnavailable = Boolean(agency && terminalPayload && terminalPayload.sources &&
    (!source || source.schedule_status !== 'available'));
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
      trip_id: String(row.trip_id || ''),
      service_date: String(row.service_date || ''),
      destination: String(row.destination || ''),
      departure_time: departureTime(row),
      scheduled_departure_time: Number(row.scheduled_departure_time) || null,
      departure_source: String(row.departure_source || 'scheduled'),
      prediction_timestamp: Number(row.prediction_timestamp) || null,
      live_valid_until: Number(row.live_valid_until) || null,
      live_evidence: row.live_evidence || null,
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
    horizon_hours: Number(terminalPayload && terminalPayload.horizon_hours) || PLATFORM_HORIZON_HOURS,
    source: source || null,
    status: scheduleUnavailable ? 'schedule_unavailable' : departures.length ? 'ok' : 'no_departures',
    departures: scheduleUnavailable ? [] : departures,
  };
}

module.exports = {
  MAX_PLATFORM_NUMBER,
  MIN_PLATFORM_NUMBER,
  PLATFORM_HORIZON_HOURS,
  agencyForPlatform,
  buildPlatformDeparturePayload,
  parsePlatformStopCode,
};
