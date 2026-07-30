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
    }))
    .filter((stop) => stop.stop_id && stop.stop_sequence !== null)
    .sort((a, b) => a.stop_sequence - b.stop_sequence);
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
  return {
    ...vehicle,
    terminal_stop_id: terminalStop
      ? terminalStop.stop_id
      : (vehicle && vehicle.terminal_stop_id || null),
    terminal_stop_sequence: terminalStop
      ? terminalStop.stop_sequence
      : (finiteSequence(vehicle && vehicle.terminal_stop_sequence)),
    terminal_progress_status: progress.status,
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
  loadTerminalMetadata,
};
