/* monitor/allandale-live.js - Allandale departure-board live-data health */
const fs = require('fs');
const path = require('path');

const BARRIE_AGENCY_ID = 'barrie-transit';

function normalizeState(value) {
  const status = ['idle', 'pending', 'active'].includes(value && value.status)
    ? value.status
    : 'idle';
  return {
    status,
    firstDetectedAt: value && value.firstDetectedAt ? value.firstDetectedAt : null,
    lastObservedAt: value && value.lastObservedAt ? value.lastObservedAt : null,
    alertedAt: value && value.alertedAt ? value.alertedAt : null,
    recoveryChecks: Math.max(0, Number(value && value.recoveryChecks) || 0),
    lastEvaluation: value && value.lastEvaluation ? value.lastEvaluation : null,
  };
}

function loadState(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }
  } catch (err) {
    console.warn('[allandale-live] Could not read state:', err.message);
  }
  return normalizeState(null);
}

function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeState(state), null, 2));
}

function normalizeEpochSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function summarizeTripPairs(rows, limit = 3) {
  return rows
    .filter((row) => row && row.prediction_match_type === 'fallback')
    .slice(0, limit)
    .map((row) => `${row.trip_id || 'unknown'} -> ${row.prediction_trip_id || 'unknown'}`);
}

function evaluatePayload(payload, options = {}) {
  const minDepartures = Math.max(1, Number(options.minDepartures) || 2);
  const departures = Array.isArray(payload && payload.departures) ? payload.departures : [];
  const rows = departures.filter((row) => String(row && row.agency_id || '') === BARRIE_AGENCY_ID);
  const source = payload && payload.sources && payload.sources.barrie_transit || {};
  const counts = {
    departures: rows.length,
    live: rows.filter((row) => row.departure_source === 'realtime').length,
    exact: rows.filter((row) => (
      row.departure_source === 'realtime' || row.prediction_match_type === 'exact'
    )).length,
    fallback: rows.filter((row) => row.prediction_match_type === 'fallback').length,
    estimated: rows.filter((row) => row.departure_source === 'estimated').length,
    scheduled: rows.filter((row) => row.departure_source === 'scheduled').length,
  };
  const common = {
    sourceStatus: String(source.realtime_status || 'unknown'),
    sourceReason: String(source.status_reason || 'unknown'),
    sourceTimestamp: normalizeEpochSeconds(source.latest_data_timestamp),
    counts,
    tripPairs: summarizeTripPairs(rows),
  };

  if (rows.length < minDepartures) {
    return {
      status: 'neutral',
      reason: 'insufficient_departures',
      details: `Only ${rows.length} Barrie departure${rows.length === 1 ? '' : 's'} are available for evaluation.`,
      ...common,
    };
  }

  if (source.realtime_status !== 'live') {
    return {
      status: 'degraded',
      reason: 'realtime_source_unavailable',
      details: `The Barrie departure source is ${common.sourceStatus} (${common.sourceReason}).`,
      ...common,
    };
  }

  const fallbackOrScheduled = counts.fallback + counts.scheduled;
  if (counts.exact === 0 && fallbackOrScheduled >= minDepartures) {
    return {
      status: 'degraded',
      reason: counts.fallback >= minDepartures ? 'static_realtime_trip_mismatch' : 'no_exact_live_matches',
      details: `${rows.length} Barrie departures are shown, but none have an exact live trip match.`,
      ...common,
    };
  }

  return {
    status: 'healthy',
    reason: 'exact_live_matches_available',
    details: `${counts.exact} of ${rows.length} Barrie departures have an exact live trip match.`,
    ...common,
  };
}

function endpointFailure(error) {
  return {
    status: 'degraded',
    reason: 'departures_endpoint_unreachable',
    details: error && error.message ? error.message : 'The Allandale departures endpoint could not be loaded.',
    sourceStatus: 'unreachable',
    sourceReason: 'request_failed',
    sourceTimestamp: null,
    counts: { departures: 0, live: 0, exact: 0, fallback: 0, estimated: 0, scheduled: 0 },
    tripPairs: [],
  };
}

function compactEvaluation(evaluation) {
  return {
    status: evaluation.status,
    reason: evaluation.reason,
    details: evaluation.details,
    sourceStatus: evaluation.sourceStatus,
    sourceReason: evaluation.sourceReason,
    sourceTimestamp: evaluation.sourceTimestamp,
    counts: evaluation.counts,
    tripPairs: evaluation.tripPairs,
  };
}

function advanceState(currentValue, evaluation, checkedAt, options = {}) {
  const current = normalizeState(currentValue);
  const now = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('checkedAt must be a valid date');
  const nowIso = now.toISOString();
  const alertAfterMs = Math.max(1, Number(options.alertAfterMinutes) || 60) * 60 * 1000;
  const recoveryChecksRequired = Math.max(1, Number(options.recoveryChecks) || 2);
  const maxObservationGapMs = Math.max(1, Number(options.maxObservationGapMinutes) || 20) * 60 * 1000;
  const summary = compactEvaluation(evaluation);

  if (evaluation.status === 'degraded') {
    const lastObservedMs = current.lastObservedAt ? new Date(current.lastObservedAt).getTime() : null;
    const observationIsConsecutive = Number.isFinite(lastObservedMs) &&
      nowMs >= lastObservedMs &&
      (nowMs - lastObservedMs) <= maxObservationGapMs;
    const continuing = current.status === 'active' ||
      (current.status === 'pending' && observationIsConsecutive);
    const firstDetectedAt = continuing && current.firstDetectedAt
      ? current.firstDetectedAt
      : nowIso;
    const firstDetectedMs = new Date(firstDetectedAt).getTime();
    const durationMs = Number.isFinite(firstDetectedMs) ? Math.max(0, nowMs - firstDetectedMs) : 0;

    if (current.status === 'active') {
      return {
        action: null,
        state: {
          ...current,
          lastObservedAt: nowIso,
          recoveryChecks: 0,
          lastEvaluation: summary,
        },
      };
    }

    const shouldAlert = durationMs >= alertAfterMs;
    const state = {
      status: shouldAlert ? 'active' : 'pending',
      firstDetectedAt,
      lastObservedAt: nowIso,
      alertedAt: shouldAlert ? nowIso : null,
      recoveryChecks: 0,
      lastEvaluation: summary,
    };
    return {
      action: shouldAlert ? {
        kind: 'alert',
        firstDetectedAt,
        durationMinutes: Math.floor(durationMs / 60000),
        evaluation: summary,
      } : null,
      state,
    };
  }

  if (evaluation.status === 'healthy') {
    if (current.status === 'active') {
      const lastObservedMs = current.lastObservedAt ? new Date(current.lastObservedAt).getTime() : null;
      const priorCheckWasConsecutiveAndHealthy = current.lastEvaluation &&
        current.lastEvaluation.status === 'healthy' &&
        Number.isFinite(lastObservedMs) &&
        nowMs >= lastObservedMs &&
        (nowMs - lastObservedMs) <= maxObservationGapMs;
      const recoveryChecks = priorCheckWasConsecutiveAndHealthy ? current.recoveryChecks + 1 : 1;
      if (recoveryChecks >= recoveryChecksRequired) {
        return {
          action: {
            kind: 'recovery',
            firstDetectedAt: current.firstDetectedAt,
            alertedAt: current.alertedAt,
            evaluation: summary,
          },
          state: normalizeState(null),
        };
      }
      return {
        action: null,
        state: {
          ...current,
          lastObservedAt: nowIso,
          recoveryChecks,
          lastEvaluation: summary,
        },
      };
    }
    return { action: null, state: normalizeState(null) };
  }

  if (current.status === 'active') {
    return {
      action: null,
      state: {
        ...current,
        lastObservedAt: nowIso,
        recoveryChecks: 0,
        lastEvaluation: summary,
      },
    };
  }
  return { action: null, state: normalizeState(null) };
}

async function fetchPayload(url, fetchImpl) {
  const response = await fetchImpl(url, {
    timeout: 12000,
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) {
    const error = new Error(`Allandale departures request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

module.exports = {
  advanceState,
  endpointFailure,
  evaluatePayload,
  fetchPayload,
  loadState,
  normalizeState,
  saveState,
};
