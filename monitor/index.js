/* monitor/index.js — Bus tracking monitor entry point */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const { fetchVehicles, fetchGtfsRtFeedMeta } = require('../server/vehicles');
const { getExpectedBuses } = require('./schedule');
const { sendAlert, sendTestAlert, sendSystemAlert } = require('./notify');
const { normalizeRouteId } = require('./routes');

const GTFS_STATIC_URL = process.env.GTFS_STATIC_URL;
const GTFS_RT_VEHICLES_URL = process.env.GTFS_RT_VEHICLES_URL;
const GTFS_RT_TRIP_UPDATES_URL = process.env.GTFS_RT_TRIP_UPDATES_URL || deriveTripUpdatesUrl(GTFS_RT_VEHICLES_URL);
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const ALERT_RECIPIENT = process.env.ALERT_RECIPIENT;
const TEST_ALERT_RECIPIENT = process.env.TEST_ALERT_RECIPIENT;
const SILENCE_THRESHOLD_MIN = parseInt(process.env.SILENCE_THRESHOLD_MIN || '5', 10);
const ALERT_AFTER_MIN = parseInt(process.env.ALERT_AFTER_MIN || '20', 10);
const FEED_STALE_AFTER_MIN = parseInt(process.env.FEED_STALE_AFTER_MIN || String(Math.max(SILENCE_THRESHOLD_MIN + 5, 15)), 10);
const ISSUE_RESEND_MIN = parseInt(process.env.ISSUE_RESEND_MIN || '30', 10);
const GTFS_CACHE_MAX_AGE_HOURS = parseInt(process.env.GTFS_CACHE_MAX_AGE_HOURS || '24', 10);
const LAYOVER_GRACE_MIN = parseInt(process.env.LAYOVER_GRACE_MIN || '10', 10);
const WATCHDOG_MAX_AGE_MIN = parseInt(process.env.WATCHDOG_MAX_AGE_MIN || '90', 10);
const SMTP_FORCE_IPV4 = /^(1|true|yes|on)$/i.test(String(process.env.SMTP_FORCE_IPV4 || 'true').trim());
const TEST_ALERT_EVERY_RUN = /^(1|true|yes|on)$/i.test(String(process.env.TEST_ALERT_EVERY_RUN || '').trim());
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;

const CACHE_DIR = path.join(__dirname, 'cache');
const STATE_FILE = path.join(CACHE_DIR, 'state.json');
const HEARTBEAT_FILE = path.join(CACHE_DIR, 'heartbeat.json');
const ISSUE_STATE_FILE = path.join(CACHE_DIR, 'issue-state.json');

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[monitor] Could not read state file:', err.message);
  }
  return {};
}

function saveState(state) {
  writeJsonFile(STATE_FILE, state);
}

function loadHeartbeat() {
  try {
    if (fs.existsSync(HEARTBEAT_FILE)) {
      return JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[monitor] Could not read heartbeat file:', err.message);
  }
  return {};
}

function saveHeartbeat(success) {
  const prev = loadHeartbeat();
  const nowIso = new Date().toISOString();
  const next = {
    lastRunAt: nowIso,
    lastSuccessAt: prev.lastSuccessAt || null,
    alertedDown: prev.alertedDown || false,
  };
  if (success) next.lastSuccessAt = nowIso;
  writeJsonFile(HEARTBEAT_FILE, next);
}

function normalizeIssueState(raw) {
  const active = raw && raw.active && typeof raw.active === 'object' ? raw.active : {};
  return { active };
}

function loadIssueState() {
  try {
    if (fs.existsSync(ISSUE_STATE_FILE)) {
      return normalizeIssueState(JSON.parse(fs.readFileSync(ISSUE_STATE_FILE, 'utf8')));
    }
  } catch (err) {
    console.warn('[monitor] Could not read issue state file:', err.message);
  }
  return { active: {} };
}

function saveIssueState(state) {
  writeJsonFile(ISSUE_STATE_FILE, normalizeIssueState(state));
}

function buildEmailConfig() {
  return {
    smtpHost: SMTP_HOST,
    smtpPort: SMTP_PORT,
    smtpUser: SMTP_USER,
    smtpPass: SMTP_PASS,
    recipient: ALERT_RECIPIENT,
    smtpForceIpv4: SMTP_FORCE_IPV4,
    resendApiKey: RESEND_API_KEY,
    resendFromEmail: RESEND_FROM_EMAIL,
  };
}

function deriveTripUpdatesUrl(vehicleUrl) {
  if (!vehicleUrl) return null;
  const [baseUrl, queryString] = String(vehicleUrl).split('?');
  if (!/VehiclePositions\.pb$/i.test(baseUrl)) return null;
  const nextBase = baseUrl.replace(/VehiclePositions\.pb$/i, 'TripUpdates.pb');
  return queryString ? `${nextBase}?${queryString}` : nextBase;
}

function getFeedAgeMinutes(timestampSeconds, nowMs) {
  const numeric = Number(timestampSeconds);
  if (!Number.isFinite(numeric)) return null;
  const ageMs = nowMs - (numeric * 1000);
  return Math.max(0, Math.round(ageMs / 60000));
}

function formatErrorText(err) {
  if (!err) return 'Unknown error';
  if (err.code && err.message) return `${err.code}: ${err.message}`;
  return err.message || String(err);
}

async function pingHeartbeat() {
  if (!HEARTBEAT_URL) return;
  try {
    const res = await fetch(HEARTBEAT_URL, { timeout: 10000 });
    console.log('[monitor] Heartbeat ping: %d', res.status);
  } catch (err) {
    console.warn('[monitor] Heartbeat ping failed:', err.message);
  }
}

async function saveSuccessHeartbeat(emailConfig) {
  const prev = loadHeartbeat();
  if (prev.alertedDown) {
    console.log('[monitor] Watchdog: previous run was alerting DOWN. Sending RECOVERED email.');
    try {
      await sendSystemAlert(emailConfig, {
        kind: 'recovered',
        code: 'SYSTEM_RECOVERED',
        severity: 'Info',
        checkedAt: new Date(),
        lastSuccessAt: prev.lastSuccessAt ? new Date(prev.lastSuccessAt) : null,
        maxAgeMin: WATCHDOG_MAX_AGE_MIN,
        details: 'Monitor completed a successful run.',
      });
    } catch (err) {
      console.error('[monitor] Watchdog RECOVERED email failed:', err.message || err);
    }
  }
  const nowIso = new Date().toISOString();
  const next = { lastRunAt: nowIso, lastSuccessAt: nowIso, alertedDown: false };
  writeJsonFile(HEARTBEAT_FILE, next);
  await pingHeartbeat();
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  return `${totalMin} min`;
}

function normalizeMissingSinceEntry(entry) {
  if (Array.isArray(entry)) {
    return entry
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
  }

  if (Number.isFinite(Number(entry))) {
    return [Number(entry)];
  }

  if (entry && typeof entry === 'object' && Array.isArray(entry.missingSince)) {
    return entry.missingSince
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
  }

  return [];
}

function sortRouteIds(routeIds) {
  return [...routeIds].sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    }
    return a.localeCompare(b);
  });
}

function summarizeMissingDuration(durationsMs, confirmedMissing, monitoringMissing) {
  if (!durationsMs.length) return null;

  const oldest = formatDuration(Math.max(...durationsMs));
  if (confirmedMissing === 0) return oldest;
  if (monitoringMissing === 0) return oldest;
  return `${oldest} oldest (+${monitoringMissing} monitoring)`;
}

function buildRouteReport(expectedByRoute, trackingByRoute, prevState, nowMs, alertThresholdMs) {
  const rows = [];
  const newState = {};
  let totalMissing = 0;
  let totalMonitoring = 0;

  const allRoutes = new Set([...expectedByRoute.keys(), ...trackingByRoute.keys()]);
  const sortedRoutes = sortRouteIds(allRoutes);

  for (const routeId of sortedRoutes) {
    const exp = expectedByRoute.get(routeId) || 0;
    const trk = trackingByRoute.get(routeId) || 0;
    const mis = Math.max(0, exp - trk);

    let duration = null;
    let confirmed = false;
    let confirmedMissing = 0;
    let monitoringMissing = 0;

    if (mis > 0) {
      const priorMissingSince = normalizeMissingSinceEntry(prevState[routeId]);
      const currentMissingSince = [];
      for (let i = 0; i < mis; i++) {
        currentMissingSince.push(priorMissingSince[i] || nowMs);
      }

      const durationsMs = currentMissingSince.map((startedAt) => nowMs - startedAt);
      confirmedMissing = durationsMs.filter((value) => value >= alertThresholdMs).length;
      monitoringMissing = mis - confirmedMissing;
      confirmed = confirmedMissing > 0;
      duration = summarizeMissingDuration(durationsMs, confirmedMissing, monitoringMissing);

      newState[routeId] = currentMissingSince;
      totalMissing += confirmedMissing;
      totalMonitoring += monitoringMissing;
    }

    if (exp > 0) {
      rows.push({
        routeId,
        expected: exp,
        tracking: trk,
        missing: mis,
        duration,
        confirmed,
        confirmedMissing,
        monitoringMissing,
      });
    }
  }

  return { rows, newState, totalMissing, totalMonitoring };
}

function getWatchdogAlertDetails(heartbeat, now, maxAgeMin) {
  if (!heartbeat || !heartbeat.lastSuccessAt || heartbeat.alertedDown) return null;

  const lastSuccessAt = new Date(heartbeat.lastSuccessAt);
  if (Number.isNaN(lastSuccessAt.getTime())) return null;

  const lastSuccessAgeMs = now.getTime() - lastSuccessAt.getTime();
  const maxAgeMs = maxAgeMin * 60 * 1000;
  if (lastSuccessAgeMs <= maxAgeMs) return null;

  return {
    lastSuccessAt,
    lastSuccessAgeMs,
    ageMinutes: Math.round(lastSuccessAgeMs / 60000),
  };
}

function summarizeRouteIssues(rows, limit = 8) {
  const routeDetails = rows
    .filter((row) => row.missing > 0)
    .slice(0, limit)
    .map((row) => {
      const noun = row.missing === 1 ? 'bus' : 'buses';
      return `Route ${row.routeId}: ${row.missing} ${noun} missing, ${row.tracking} reporting out of ${row.expected} expected`;
    });

  return routeDetails.length ? routeDetails.join('; ') : 'No route details available.';
}

function getFeedAlertContext(vehicleFeed, tripUpdatesMeta, now, staleAfterMin) {
  const nowMs = now.getTime();
  const feedAgeMin = getFeedAgeMinutes(vehicleFeed && vehicleFeed.feed_timestamp, nowMs);
  if (feedAgeMin !== null && feedAgeMin <= staleAfterMin) return null;

  const shared = {
    severity: 'Critical',
    checkedAt: now,
    feedUrl: GTFS_RT_VEHICLES_URL,
    feedTimestamp: vehicleFeed && vehicleFeed.feed_timestamp,
    feedAgeMin,
    lastModified: vehicleFeed && vehicleFeed.feed_last_modified,
  };

  const tripUpdatesAgeMin = getFeedAgeMinutes(tripUpdatesMeta && tripUpdatesMeta.header_timestamp, nowMs);
  if (tripUpdatesMeta && tripUpdatesAgeMin !== null && tripUpdatesAgeMin <= staleAfterMin) {
    return {
      kind: 'vehicle_feed_out_of_sync',
      code: 'VEHICLE_FEED_OUT_OF_SYNC',
      ...shared,
      tripUpdatesUrl: GTFS_RT_TRIP_UPDATES_URL,
      tripUpdatesTimestamp: tripUpdatesMeta.header_timestamp,
      tripUpdatesAgeMin,
      details: 'The vehicle positions feed is stale while the trip updates feed remains current.',
    };
  }

  return {
    kind: 'vehicle_feed_stale',
    code: 'VEHICLE_FEED_STALE',
    ...shared,
    details: 'The live bus locations feed is older than the allowed freshness limit.',
  };
}

function recordIssueState(issueState, payload) {
  const active = issueState.active || {};
  const existing = active[payload.code] || null;
  const checkedIso = payload.checkedAt.toISOString();

  active[payload.code] = {
    code: payload.code,
    kind: payload.kind,
    summary: payload.details || '',
    firstDetectedAt: existing && existing.firstDetectedAt ? existing.firstDetectedAt : checkedIso,
    lastDetectedAt: checkedIso,
    lastSentAt: existing && existing.lastSentAt ? existing.lastSentAt : null,
  };

  issueState.active = active;
  return existing;
}

function shouldSendIssueAlert(previous, checkedAt, resendMinutes) {
  if (!previous || !previous.lastSentAt) return true;
  const lastSentAt = new Date(previous.lastSentAt);
  if (Number.isNaN(lastSentAt.getTime())) return true;
  const resendMs = Math.max(0, Number(resendMinutes) || 0) * 60 * 1000;
  if (resendMs === 0) return true;
  return (checkedAt.getTime() - lastSentAt.getTime()) >= resendMs;
}

async function triggerIssueAlert(emailConfig, issueState, activeIssueCodes, payload) {
  activeIssueCodes.add(payload.code);
  const previous = recordIssueState(issueState, payload);
  if (!shouldSendIssueAlert(previous, payload.checkedAt, ISSUE_RESEND_MIN)) return false;
  await sendSystemAlert(emailConfig, payload);
  issueState.active[payload.code].lastSentAt = payload.checkedAt.toISOString();
  return true;
}

async function sendRecoveryAlerts(emailConfig, issueState, activeIssueCodes, checkedAt) {
  const active = issueState.active || {};
  const codes = Object.keys(active);

  for (const code of codes) {
    if (activeIssueCodes.has(code)) continue;
    if (code === 'MONITOR_WATCHDOG_DOWN') continue;

    const previous = active[code];
    await sendSystemAlert(emailConfig, {
      kind: 'issue_recovered',
      code: 'SYSTEM_RECOVERED',
      severity: 'Info',
      checkedAt,
      lastSuccessAt: checkedAt,
      previousCode: code,
      details: previous && previous.summary
        ? `A previously reported issue has cleared. ${previous.summary}`
        : 'A previously reported issue has cleared.',
    });
    delete active[code];
  }

  issueState.active = active;
}

async function main() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour12: false });
  const emailConfig = buildEmailConfig();
  const issueState = loadIssueState();
  const activeIssueCodes = new Set();

  console.log(`[monitor] Starting check at ${timeStr}`);

  const heartbeat = loadHeartbeat();
  const watchdogAlert = getWatchdogAlertDetails(heartbeat, now, WATCHDOG_MAX_AGE_MIN);
  if (watchdogAlert) {
    console.warn('[monitor] Watchdog: last success was %d min ago (threshold: %d min). Sending DOWN alert.',
      watchdogAlert.ageMinutes, WATCHDOG_MAX_AGE_MIN);
    try {
      await sendSystemAlert(emailConfig, {
        kind: 'down',
        code: 'MONITOR_WATCHDOG_DOWN',
        severity: 'Critical',
        checkedAt: now,
        lastSuccessAt: watchdogAlert.lastSuccessAt,
        maxAgeMin: WATCHDOG_MAX_AGE_MIN,
        details: `No successful monitor check in ${watchdogAlert.ageMinutes} minutes.`,
      });
      heartbeat.alertedDown = true;
      writeJsonFile(HEARTBEAT_FILE, heartbeat);
    } catch (err) {
      console.error('[monitor] Watchdog DOWN email failed:', err.message || err);
    }
  }

  saveHeartbeat(false);

  const required = { GTFS_STATIC_URL, GTFS_RT_VEHICLES_URL, ALERT_RECIPIENT };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  const hasSmtp = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
  const hasResend = Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL);
  if (!hasSmtp && !hasResend) {
    missing.push('SMTP_HOST/SMTP_USER/SMTP_PASS (or RESEND_API_KEY/RESEND_FROM_EMAIL)');
  }
  if (missing.length > 0) {
    console.error('[monitor] Missing required env vars:', missing.join(', '));
    await pingHeartbeat();
    process.exit(1);
  }

  try {
    if (TEST_ALERT_EVERY_RUN) {
      const testRecipient = TEST_ALERT_RECIPIENT || ALERT_RECIPIENT;
      console.log('[monitor] TEST_ALERT_EVERY_RUN enabled. Sending scheduled test email.');
      try {
        await sendTestAlert({ ...emailConfig, recipient: testRecipient }, {
          checkedAt: now,
          details: `Scheduled test mode is on for this monitor service (recipient: ${testRecipient}).`,
        });
      } catch (err) {
        console.warn('[monitor] Test email failed:', err.message || err);
      }
    }

    const expected = await getExpectedBuses(
      GTFS_STATIC_URL,
      CACHE_DIR,
      GTFS_CACHE_MAX_AGE_HOURS,
      LAYOVER_GRACE_MIN
    );

    if (expected.totalExpected === 0) {
      console.log('[monitor] No buses expected at this time. Exiting.');
      saveState({});
      saveIssueState(issueState);
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    console.log('[monitor] Expected: %d buses across %d routes', expected.totalExpected, expected.byRoute.size);

    let vehicleData;
    try {
      vehicleData = await fetchVehicles(GTFS_RT_VEHICLES_URL);
    } catch (err) {
      const errorText = formatErrorText(err);
      console.error('[monitor] Vehicle positions fetch failed:', errorText);
      await triggerIssueAlert(emailConfig, issueState, activeIssueCodes, {
        kind: 'vehicle_feed_unreachable',
        code: 'VEHICLE_FEED_UNREACHABLE',
        severity: 'Critical',
        checkedAt: now,
        feedUrl: GTFS_RT_VEHICLES_URL,
        httpStatus: err && err.status ? err.status : 'unknown',
        errorMessage: errorText,
        details: 'The live bus locations feed could not be loaded before the monitor checked the buses.',
      });
      saveIssueState(issueState);
      await pingHeartbeat();
      process.exit(1);
    }

    const candidateFeedIssue = getFeedAlertContext(vehicleData, null, now, FEED_STALE_AFTER_MIN);
    if (candidateFeedIssue) {
      let tripUpdatesMeta = null;
      if (GTFS_RT_TRIP_UPDATES_URL) {
        try {
          tripUpdatesMeta = await fetchGtfsRtFeedMeta(GTFS_RT_TRIP_UPDATES_URL);
        } catch (err) {
          console.warn('[monitor] Trip updates metadata check failed:', formatErrorText(err));
        }
      }

      const feedIssue = getFeedAlertContext(vehicleData, tripUpdatesMeta, now, FEED_STALE_AFTER_MIN) || candidateFeedIssue;
      await triggerIssueAlert(emailConfig, issueState, activeIssueCodes, feedIssue);
      saveState({});
      saveIssueState(issueState);
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    const vehicles = vehicleData.vehicles || [];
    const thresholdSecs = SILENCE_THRESHOLD_MIN * 60;
    const nowEpoch = Math.floor(now.getTime() / 1000);

    const activeVehicles = vehicles.filter((v) => {
      if (!v.route_id) return false;
      if (!v.last_reported) return false;
      return (nowEpoch - v.last_reported) <= thresholdSecs;
    });

    const trackingByRoute = new Map();
    for (const v of activeVehicles) {
      const routeId = normalizeRouteId(v.route_id);
      if (!routeId) continue;
      const count = trackingByRoute.get(routeId) || 0;
      trackingByRoute.set(routeId, count + 1);
    }

    const totalTracking = activeVehicles.length;
    console.log('[monitor] Tracking: %d vehicles with recent GPS', totalTracking);

    const prevState = loadState();
    const nowMs = now.getTime();
    const alertThresholdMs = ALERT_AFTER_MIN * 60 * 1000;
    const { rows, newState, totalMissing, totalMonitoring } = buildRouteReport(
      expected.byRoute,
      trackingByRoute,
      prevState,
      nowMs,
      alertThresholdMs
    );

    saveState(newState);

    if (totalMissing === 0 && totalMonitoring === 0) {
      console.log('[monitor] All expected buses are tracking. No alert needed.');
      await sendRecoveryAlerts(emailConfig, issueState, activeIssueCodes, now);
      saveIssueState(issueState);
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    if (totalMissing === 0) {
      console.log('[monitor] %d buses monitoring (under %d min threshold). No alert.', totalMonitoring, ALERT_AFTER_MIN);
      await sendRecoveryAlerts(emailConfig, issueState, activeIssueCodes, now);
      saveIssueState(issueState);
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    if (expected.totalExpected > 0 && totalMissing === expected.totalExpected) {
      console.log('[monitor] All expected buses are not tracking. Sending system alert.');
      await triggerIssueAlert(emailConfig, issueState, activeIssueCodes, {
        kind: 'all_buses_not_tracking',
        code: 'ALL_BUSES_NOT_TRACKING',
        severity: 'Critical',
        checkedAt: now,
        expectedCount: expected.totalExpected,
        trackingCount: totalTracking,
        missingCount: totalMissing,
        details: summarizeRouteIssues(rows),
      });
      saveIssueState(issueState);
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    console.log('[monitor] Missing: %d buses (%d+ min). Sending alert...', totalMissing, ALERT_AFTER_MIN);

    const report = {
      rows,
      totalExpected: expected.totalExpected,
      totalTracking,
      totalMissing,
      totalMonitoring,
      checkedAt: now,
    };

    await sendRecoveryAlerts(emailConfig, issueState, activeIssueCodes, now);
    saveIssueState(issueState);
    await sendAlert(emailConfig, report);

    console.log('[monitor] Alert sent. Done.');
    await saveSuccessHeartbeat(emailConfig);
    process.exit(0);
  } catch (err) {
    const errorText = formatErrorText(err);
    console.error('[monitor] Fatal error:', errorText);
    try {
      await triggerIssueAlert(emailConfig, issueState, activeIssueCodes, {
        kind: 'runtime_failure',
        code: 'MONITOR_RUNTIME_FAILURE',
        severity: 'Critical',
        checkedAt: now,
        errorMessage: errorText,
        details: 'The monitor stopped before it finished.',
      });
      saveIssueState(issueState);
    } catch (alertErr) {
      console.error('[monitor] Runtime failure email failed:', formatErrorText(alertErr));
    }
    await pingHeartbeat();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  loadState,
  saveState,
  loadHeartbeat,
  saveHeartbeat,
  loadIssueState,
  saveIssueState,
  buildEmailConfig,
  deriveTripUpdatesUrl,
  getFeedAgeMinutes,
  getFeedAlertContext,
  shouldSendIssueAlert,
  formatErrorText,
  formatDuration,
  normalizeMissingSinceEntry,
  sortRouteIds,
  summarizeMissingDuration,
  summarizeRouteIssues,
  buildRouteReport,
  getWatchdogAlertDetails,
};
