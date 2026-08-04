const DEFAULT_DELAYED_AFTER_MS = 2 * 60 * 1000;
const DEFAULT_OFFLINE_AFTER_MS = 15 * 60 * 1000;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function normalizeTimestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function getLatestVehicleTimestampMs(vehicles) {
  let latest = null;
  (Array.isArray(vehicles) ? vehicles : []).forEach((vehicle) => {
    const timestamp = normalizeTimestampMs(vehicle && vehicle.last_reported);
    if (timestamp !== null && (latest === null || timestamp > latest)) {
      latest = timestamp;
    }
  });
  return latest;
}

function assessVehicleFeedFreshness(payload, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const delayedAfterMs = Number.isFinite(Number(options.delayedAfterMs))
    ? Number(options.delayedAfterMs)
    : DEFAULT_DELAYED_AFTER_MS;
  const offlineAfterMs = Number.isFinite(Number(options.offlineAfterMs))
    ? Number(options.offlineAfterMs)
    : DEFAULT_OFFLINE_AFTER_MS;
  const configured = options.configured !== false;
  const vehicles = payload && Array.isArray(payload.vehicles) ? payload.vehicles : [];
  const latestVehicleTimestampMs = getLatestVehicleTimestampMs(vehicles);
  const feedTimestampMs = normalizeTimestampMs(payload && payload.feed_timestamp);
  // When vehicles exist, their GPS timestamps are the most honest signal. A feed
  // header can advance even when every bus position inside it is frozen.
  const preferFeedTimestamp = options.preferFeedTimestamp === true;
  const latestDataTimestampMs = preferFeedTimestamp && feedTimestampMs !== null
    ? feedTimestampMs
    : (latestVehicleTimestampMs !== null ? latestVehicleTimestampMs : feedTimestampMs);

  if (!configured) {
    return {
      feed_status: 'offline',
      status_reason: 'feed_not_configured',
      latest_data_timestamp: latestDataTimestampMs === null ? null : Math.floor(latestDataTimestampMs / 1000),
      data_age_seconds: null,
    };
  }

  if (!payload || !Array.isArray(payload.vehicles)) {
    return {
      feed_status: 'offline',
      status_reason: 'invalid_payload',
      latest_data_timestamp: null,
      data_age_seconds: null,
    };
  }

  if (payload.fetch_error) {
    return {
      feed_status: 'offline',
      status_reason: 'fetch_failed',
      latest_data_timestamp: latestDataTimestampMs === null ? null : Math.floor(latestDataTimestampMs / 1000),
      data_age_seconds: latestDataTimestampMs === null ? null : Math.max(0, Math.floor((nowMs - latestDataTimestampMs) / 1000)),
    };
  }

  if (latestDataTimestampMs === null) {
    return {
      feed_status: 'offline',
      status_reason: 'missing_timestamp',
      latest_data_timestamp: null,
      data_age_seconds: null,
    };
  }

  const ageMs = Math.max(0, nowMs - latestDataTimestampMs);
  let feedStatus = 'live';
  let statusReason = 'fresh';
  if (ageMs > offlineAfterMs) {
    feedStatus = 'offline';
    statusReason = 'stale';
  } else if (ageMs > delayedAfterMs) {
    feedStatus = 'delayed';
    statusReason = 'delayed';
  } else if (vehicles.length === 0) {
    feedStatus = 'empty';
    statusReason = 'no_vehicles';
  }

  return {
    feed_status: feedStatus,
    status_reason: statusReason,
    latest_data_timestamp: Math.floor(latestDataTimestampMs / 1000),
    data_age_seconds: Math.floor(ageMs / 1000),
  };
}

function selectVehiclesForDisplay(payload, freshness, options = {}) {
  const status = freshness && freshness.feed_status;
  if (status === 'offline' || status === 'empty') return [];

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Number(options.maxAgeMs)
    : DEFAULT_OFFLINE_AFTER_MS;

  return (payload && Array.isArray(payload.vehicles) ? payload.vehicles : []).filter((vehicle) => {
    const timestampMs = normalizeTimestampMs(vehicle && vehicle.last_reported);
    if (timestampMs === null) return false;
    const ageMs = nowMs - timestampMs;
    return ageMs >= -FUTURE_TIMESTAMP_TOLERANCE_MS && ageMs <= maxAgeMs;
  });
}

module.exports = {
  DEFAULT_DELAYED_AFTER_MS,
  DEFAULT_OFFLINE_AFTER_MS,
  FUTURE_TIMESTAMP_TOLERANCE_MS,
  normalizeTimestampMs,
  getLatestVehicleTimestampMs,
  assessVehicleFeedFreshness,
  selectVehiclesForDisplay,
};
