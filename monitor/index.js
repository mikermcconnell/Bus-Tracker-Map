/* monitor/index.js — Bus tracking monitor entry point */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const { fetchVehicles } = require('../server/vehicles');
const { getExpectedBuses } = require('./schedule');
const { sendAlert, sendTestAlert, sendSystemAlert } = require('./notify');
const { normalizeRouteId } = require('./routes');

const GTFS_STATIC_URL = process.env.GTFS_STATIC_URL;
const GTFS_RT_VEHICLES_URL = process.env.GTFS_RT_VEHICLES_URL;
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
const GTFS_CACHE_MAX_AGE_HOURS = parseInt(process.env.GTFS_CACHE_MAX_AGE_HOURS || '24', 10);
const LAYOVER_GRACE_MIN = parseInt(process.env.LAYOVER_GRACE_MIN || '10', 10);
const WATCHDOG_MAX_AGE_MIN = parseInt(process.env.WATCHDOG_MAX_AGE_MIN || '90', 10);
const SMTP_FORCE_IPV4 = /^(1|true|yes|on)$/i.test(String(process.env.SMTP_FORCE_IPV4 || 'true').trim());
const TEST_ALERT_EVERY_RUN = /^(1|true|yes|on)$/i.test(String(process.env.TEST_ALERT_EVERY_RUN || '').trim());
const HEARTBEAT_URL = process.env.HEARTBEAT_URL;

const CACHE_DIR = path.join(__dirname, 'cache');
const STATE_FILE = path.join(CACHE_DIR, 'state.json');
const HEARTBEAT_FILE = path.join(CACHE_DIR, 'heartbeat.json');

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

async function main() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour12: false });
  console.log(`[monitor] Starting check at ${timeStr}`);

  // Watchdog: check if previous runs have been failing
  const heartbeat = loadHeartbeat();
  const watchdogAlert = getWatchdogAlertDetails(heartbeat, now, WATCHDOG_MAX_AGE_MIN);
  if (watchdogAlert) {
    console.warn('[monitor] Watchdog: last success was %d min ago (threshold: %d min). Sending DOWN alert.',
      watchdogAlert.ageMinutes, WATCHDOG_MAX_AGE_MIN);
    try {
      const watchdogEmailConfig = {
        smtpHost: SMTP_HOST, smtpPort: SMTP_PORT, smtpUser: SMTP_USER, smtpPass: SMTP_PASS,
        recipient: ALERT_RECIPIENT, smtpForceIpv4: SMTP_FORCE_IPV4,
        resendApiKey: RESEND_API_KEY, resendFromEmail: RESEND_FROM_EMAIL,
      };
      await sendSystemAlert(watchdogEmailConfig, {
        kind: 'down',
        checkedAt: now,
        lastSuccessAt: watchdogAlert.lastSuccessAt,
        maxAgeMin: WATCHDOG_MAX_AGE_MIN,
        details: `No successful monitor run in ${watchdogAlert.ageMinutes} minutes.`,
      });
      heartbeat.alertedDown = true;
      writeJsonFile(HEARTBEAT_FILE, heartbeat);
    } catch (err) {
      console.error('[monitor] Watchdog DOWN email failed:', err.message || err);
    }
  }

  saveHeartbeat(false);

  // Validate required env vars
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
    const emailConfig = {
      smtpHost: SMTP_HOST,
      smtpPort: SMTP_PORT,
      smtpUser: SMTP_USER,
      smtpPass: SMTP_PASS,
      recipient: ALERT_RECIPIENT,
      smtpForceIpv4: SMTP_FORCE_IPV4,
      resendApiKey: RESEND_API_KEY,
      resendFromEmail: RESEND_FROM_EMAIL,
    };

    if (TEST_ALERT_EVERY_RUN) {
      const testRecipient = TEST_ALERT_RECIPIENT || ALERT_RECIPIENT;
      console.log('[monitor] TEST_ALERT_EVERY_RUN enabled. Sending scheduled test email.');
      try {
        await sendTestAlert({ ...emailConfig, recipient: testRecipient }, {
          checkedAt: now,
          details: `TEST_ALERT_EVERY_RUN is enabled for this Railway monitor service (recipient: ${testRecipient}).`,
        });
      } catch (err) {
        console.warn('[monitor] Test email failed:', err.message || err);
      }
    }

    // 1. Get expected buses from GTFS static schedule
    const expected = await getExpectedBuses(
      GTFS_STATIC_URL,
      CACHE_DIR,
      GTFS_CACHE_MAX_AGE_HOURS,
      LAYOVER_GRACE_MIN
    );

    if (expected.totalExpected === 0) {
      console.log('[monitor] No buses expected at this time. Exiting.');
      saveState({}); // Clear stale durations so they don't carry into next day
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    console.log('[monitor] Expected: %d buses across %d routes', expected.totalExpected, expected.byRoute.size);

    // 2. Fetch GTFS-RT vehicle positions
    const { vehicles } = await fetchVehicles(GTFS_RT_VEHICLES_URL);

    // 3. Filter to vehicles reporting within threshold
    const thresholdSecs = SILENCE_THRESHOLD_MIN * 60;
    const nowEpoch = Math.floor(now.getTime() / 1000);

    const activeVehicles = vehicles.filter((v) => {
      if (!v.route_id) return false; // Between trips
      if (!v.last_reported) return false;
      return (nowEpoch - v.last_reported) <= thresholdSecs;
    });

    // 4. Group tracking vehicles by route
    const trackingByRoute = new Map();
    for (const v of activeVehicles) {
      const routeId = normalizeRouteId(v.route_id);
      if (!routeId) continue;
      const count = trackingByRoute.get(routeId) || 0;
      trackingByRoute.set(routeId, count + 1);
    }

    const totalTracking = activeVehicles.length;
    console.log('[monitor] Tracking: %d vehicles with recent GPS', totalTracking);

    // 5. Load persistent state for duration tracking
    const prevState = loadState();
    const nowMs = now.getTime();

    // 6. Compare expected vs actual per route
    const alertThresholdMs = ALERT_AFTER_MIN * 60 * 1000;
    const { rows, newState, totalMissing, totalMonitoring } = buildRouteReport(
      expected.byRoute,
      trackingByRoute,
      prevState,
      nowMs,
      alertThresholdMs
    );

    // Save state (only routes currently missing are kept)
    saveState(newState);

    // 7. Decide whether to alert
    if (totalMissing === 0 && totalMonitoring === 0) {
      console.log('[monitor] All expected buses are tracking. No alert needed.');
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    if (totalMissing === 0) {
      console.log('[monitor] %d buses monitoring (under %d min threshold). No alert.', totalMonitoring, ALERT_AFTER_MIN);
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    console.log('[monitor] Missing: %d buses (%d+ min). Sending alert...', totalMissing, ALERT_AFTER_MIN);

    // 8. Send email
    const report = {
      rows,
      totalExpected: expected.totalExpected,
      totalTracking,
      totalMissing,
      totalMonitoring,
      checkedAt: now,
    };

    await sendAlert(emailConfig, report);

    console.log('[monitor] Alert sent. Done.');
    await saveSuccessHeartbeat(emailConfig);
    process.exit(0);
  } catch (err) {
    const errorText = err && err.code ? `${err.code}: ${err.message || err}` : (err && err.message) || err;
    console.error('[monitor] Fatal error:', errorText);
    // Still ping heartbeat so healthchecks.io knows the cron ran.
    // Monitor email alerts handle actual failures separately.
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
  formatDuration,
  normalizeMissingSinceEntry,
  sortRouteIds,
  summarizeMissingDuration,
  buildRouteReport,
  getWatchdogAlertDetails,
};
