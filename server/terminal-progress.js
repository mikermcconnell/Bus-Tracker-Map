const fs = require('fs');
const path = require('path');

const TERMINAL_PROGRESS = Object.freeze({
  APPROACHING: 'approaching',
  AT_TERMINAL: 'at_terminal',
  DEPARTED: 'departed',
  NOT_SERVING: 'not_serving',
  UNKNOWN: 'unknown',
});

function finiteSequence(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTerminalStops(stops) {
  return (Array.isArray(stops) ? stops : [])
    .map((stop) => ({
      stop_id: stop && stop.stop_id !== undefined && stop.stop_id !== null
        ? String(stop.stop_id)
        : '',
      stop_sequence: finiteSequence(stop && stop.stop_sequence),
      arrival_time: stop && stop.arrival_time ? String(stop.arrival_time) : null,
      departure_time: stop && (stop.departure_time || stop.arrival_time)
        ? String(stop.departure_time || stop.arrival_time)
        : null,
    }))
    .filter((stop) => stop.stop_id && stop.stop_sequence !== null)
    .sort((a, b) => a.stop_sequence - b.stop_sequence);
}

function getTimeZoneOffsetMs(timestampMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUtc - timestampMs;
}

function scheduledTimeToEpochSeconds(serviceDate, gtfsTime, timeZone = 'America/Toronto') {
  const dateMatch = String(serviceDate || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  const timeMatch = String(gtfsTime || '').match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const totalHours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3]);
  if (![totalHours, minutes, seconds].every(Number.isFinite) || minutes > 59 || seconds > 59) {
    return null;
  }

  const utcGuess = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]) + Math.floor(totalHours / 24),
    totalHours % 24,
    minutes,
    seconds
  );
  let resolved = utcGuess - getTimeZoneOffsetMs(utcGuess, timeZone);
  resolved = utcGuess - getTimeZoneOffsetMs(resolved, timeZone);
  return Math.floor(resolved / 1000);
}

function getLocalServiceDateCandidates(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDateAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );

  return [-1, 0, 1].map((dayOffset) => {
    const date = new Date(localDateAsUtc + dayOffset * 24 * 60 * 60 * 1000);
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('');
  });
}

function inferScheduledDepartureEpochSeconds(gtfsTime, options = {}) {
  const timeZone = options.timeZone || 'America/Toronto';
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const candidates = getLocalServiceDateCandidates(nowMs, timeZone)
    .map((serviceDate) => scheduledTimeToEpochSeconds(serviceDate, gtfsTime, timeZone))
    .filter((value) => Number.isFinite(value));
  if (!candidates.length) return null;
  const nowSeconds = nowMs / 1000;
  return candidates.reduce((nearest, candidate) => (
    Math.abs(candidate - nowSeconds) < Math.abs(nearest - nowSeconds)
      ? candidate
      : nearest
  ));
}

function resolveTerminalDepartureTime(vehicle, terminalStop, options = {}) {
  const realtimeDeparture = finiteSequence(vehicle && vehicle.terminal_departure_time);
  if (realtimeDeparture !== null && realtimeDeparture > 0) {
    return { time: realtimeDeparture, source: 'realtime' };
  }
  if (!terminalStop || !terminalStop.departure_time) return { time: null, source: null };
  const serviceDate = vehicle && vehicle.start_date;
  const scheduledDeparture = serviceDate
    ? scheduledTimeToEpochSeconds(
        serviceDate,
        terminalStop.departure_time,
        options.timeZone || 'America/Toronto'
      )
    : inferScheduledDepartureEpochSeconds(terminalStop.departure_time, options);
  return {
    time: scheduledDeparture,
    source: scheduledDeparture === null ? null : 'static',
  };
}

function classifyTerminalProgress(vehicle, options = {}) {
  const terminalStops = normalizeTerminalStops(options.terminalStops);
  const terminalStopIds = new Set(
    (Array.isArray(options.terminalStopIds) ? options.terminalStopIds : [])
      .map(String)
  );
  terminalStops.forEach((stop) => terminalStopIds.add(stop.stop_id));

  const currentStopId = vehicle && vehicle.stop_id !== undefined && vehicle.stop_id !== null
    ? String(vehicle.stop_id)
    : '';
  const currentSequence = finiteSequence(vehicle && vehicle.current_stop_sequence);
  const currentStatus = finiteSequence(vehicle && vehicle.current_status);
  const headsign = String(vehicle && vehicle.trip_headsign || '').trim();

  if (currentStopId && terminalStopIds.has(currentStopId)) {
    if (
      headsign &&
      options.inboundHeadsignPattern &&
      !options.inboundHeadsignPattern.test(headsign)
    ) {
      return {
        status: TERMINAL_PROGRESS.DEPARTED,
        terminalStop: terminalStops.find((stop) => stop.stop_id === currentStopId) || null,
      };
    }

    const exactStop = terminalStops.find((stop) => (
      stop.stop_id === currentStopId &&
      currentSequence !== null &&
      stop.stop_sequence === currentSequence
    )) || null;

    if (currentSequence !== null && terminalStops.length && !exactStop) {
      const nextStop = terminalStops.find((stop) => stop.stop_sequence > currentSequence);
      if (nextStop) {
        return {
          status: TERMINAL_PROGRESS.APPROACHING,
          terminalStop: nextStop,
        };
      }
      return {
        status: TERMINAL_PROGRESS.DEPARTED,
        terminalStop: terminalStops[terminalStops.length - 1],
      };
    }

    const matchingStop = exactStop ||
      terminalStops.find((stop) => stop.stop_id === currentStopId) ||
      null;
    return {
      status: currentStatus === 1
        ? TERMINAL_PROGRESS.AT_TERMINAL
        : TERMINAL_PROGRESS.APPROACHING,
      terminalStop: matchingStop,
    };
  }

  if (terminalStops.length) {
    if (currentSequence === null) {
      // Metrolinx GO vehicle positions can omit current_stop_sequence even
      // while supplying the trip, current stop, and inbound destination. The
      // Allandale headsign is sufficient to keep that known terminal-serving
      // trip in the approaching list; outbound headsigns still remain unknown.
      if (options.inboundHeadsignPattern && options.inboundHeadsignPattern.test(headsign)) {
        return {
          status: TERMINAL_PROGRESS.APPROACHING,
          terminalStop: terminalStops[0],
        };
      }
      return {
        status: TERMINAL_PROGRESS.UNKNOWN,
        terminalStop: terminalStops[0],
      };
    }

    const nextStop = terminalStops.find((stop) => stop.stop_sequence > currentSequence);
    if (nextStop) {
      return {
        status: TERMINAL_PROGRESS.APPROACHING,
        terminalStop: nextStop,
      };
    }

    const sameSequence = terminalStops.find((stop) => stop.stop_sequence === currentSequence);
    if (sameSequence && !currentStopId) {
      return {
        status: TERMINAL_PROGRESS.APPROACHING,
        terminalStop: sameSequence,
      };
    }

    return {
      status: TERMINAL_PROGRESS.DEPARTED,
      terminalStop: terminalStops[terminalStops.length - 1],
    };
  }

  if (options.inboundHeadsignPattern && options.inboundHeadsignPattern.test(headsign)) {
    return {
      status: TERMINAL_PROGRESS.APPROACHING,
      terminalStop: null,
    };
  }

  return {
    status: headsign ? TERMINAL_PROGRESS.DEPARTED : TERMINAL_PROGRESS.NOT_SERVING,
    terminalStop: null,
  };
}

function enrichTerminalProgress(vehicle, options = {}) {
  const progress = classifyTerminalProgress(vehicle, options);
  const terminalStop = progress.terminalStop;
  const departure = resolveTerminalDepartureTime(vehicle, terminalStop, options);
  return {
    ...vehicle,
    terminal_stop_id: terminalStop
      ? terminalStop.stop_id
      : (vehicle && vehicle.terminal_stop_id || null),
    terminal_stop_sequence: terminalStop
      ? terminalStop.stop_sequence
      : (finiteSequence(vehicle && vehicle.terminal_stop_sequence)),
    terminal_progress_status: progress.status,
    terminal_departure_time: departure.time,
    terminal_departure_source: departure.source,
  };
}

function getTerminalApproachFallback(vehicle, fallbacks) {
  if (!vehicle || !fallbacks || typeof fallbacks !== 'object') return null;
  const routeId = String(vehicle.source_route_id || vehicle.route_id || '').trim();
  const stopId = String(vehicle.stop_id || '').trim();
  const directionId = finiteSequence(vehicle.direction_id);
  if (!routeId || !stopId || directionId === null) return null;
  return fallbacks[`${routeId}|${directionId}|${stopId}`] || null;
}

function enrichTerminalProgressWithFallback(vehicle, options = {}) {
  const enriched = enrichTerminalProgress(vehicle, options);
  const fallbackStatuses = Array.isArray(options.terminalApproachFallbackStatuses)
    ? options.terminalApproachFallbackStatuses.map(String)
    : [TERMINAL_PROGRESS.NOT_SERVING, TERMINAL_PROGRESS.UNKNOWN];
  if (!fallbackStatuses.includes(enriched.terminal_progress_status)) {
    return enriched;
  }

  const fallback = getTerminalApproachFallback(
    vehicle,
    options.terminalApproachFallbacks
  );
  if (!fallback) return enriched;

  const fallbackTerminalStopIds = Array.isArray(fallback.terminal_stop_ids)
    ? fallback.terminal_stop_ids.map(String).filter(Boolean)
    : [];
  return {
    ...enriched,
    terminal_stop_id: fallbackTerminalStopIds.length === 1
      ? fallbackTerminalStopIds[0]
      : null,
    terminal_stop_sequence: null,
    terminal_progress_status: TERMINAL_PROGRESS.APPROACHING,
    terminal_departure_time: null,
    terminal_departure_source: null,
    terminal_progress_source: 'route_direction_stop_fallback',
  };
}

function loadTerminalMetadata(cacheDir, filename) {
  const filePath = path.join(cacheDir, filename);
  if (!fs.existsSync(filePath)) {
    return {
      terminal_stop_ids: [],
      trips: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[terminal-progress] ${filename} unavailable:`, err.message || err);
    return {
      terminal_stop_ids: [],
      trips: {},
    };
  }
}

module.exports = {
  TERMINAL_PROGRESS,
  classifyTerminalProgress,
  enrichTerminalProgress,
  enrichTerminalProgressWithFallback,
  getTerminalApproachFallback,
  inferScheduledDepartureEpochSeconds,
  scheduledTimeToEpochSeconds,
  resolveTerminalDepartureTime,
  loadTerminalMetadata,
};
