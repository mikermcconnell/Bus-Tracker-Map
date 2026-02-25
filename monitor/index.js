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
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(next, null, 2));
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
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(next, null, 2));
  await pingHeartbeat();
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  return `${totalMin} min`;
}

(async function main() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour12: false });
  console.log(`[monitor] Starting check at ${timeStr}`);

  // Watchdog: check if previous runs have been failing
  const heartbeat = loadHeartbeat();
  if (heartbeat.lastSuccessAt) {
    const lastSuccessAge = now.getTime() - new Date(heartbeat.lastSuccessAt).getTime();
    const maxAgeMs = WATCHDOG_MAX_AGE_MIN * 60 * 1000;
    if (lastSuccessAge > maxAgeMs && !heartbeat.alertedDown) {
      console.warn('[monitor] Watchdog: last success was %d min ago (threshold: %d min). Sending DOWN alert.',
        Math.round(lastSuccessAge / 60000), WATCHDOG_MAX_AGE_MIN);
      heartbeat.alertedDown = true;
      fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(heartbeat, null, 2));
      try {
        const watchdogEmailConfig = {
          smtpHost: SMTP_HOST, smtpPort: SMTP_PORT, smtpUser: SMTP_USER, smtpPass: SMTP_PASS,
          recipient: ALERT_RECIPIENT, smtpForceIpv4: SMTP_FORCE_IPV4,
          resendApiKey: RESEND_API_KEY, resendFromEmail: RESEND_FROM_EMAIL,
        };
        await sendSystemAlert(watchdogEmailConfig, {
          kind: 'down',
          checkedAt: now,
          lastSuccessAt: new Date(heartbeat.lastSuccessAt),
          maxAgeMin: WATCHDOG_MAX_AGE_MIN,
          details: `No successful monitor run in ${Math.round(lastSuccessAge / 60000)} minutes.`,
        });
      } catch (err) {
        console.error('[monitor] Watchdog DOWN email failed:', err.message || err);
      }
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
    const newState = {};
    const nowMs = now.getTime();

    // 6. Compare expected vs actual per route
    const rows = [];
    let totalMissing = 0;

    const allRoutes = new Set([...expected.byRoute.keys(), ...trackingByRoute.keys()]);
    const sortedRoutes = [...allRoutes].sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        if (numA !== numB) return numA - numB;
        return a.localeCompare(b);
      }
      return a.localeCompare(b);
    });

    const alertThresholdMs = ALERT_AFTER_MIN * 60 * 1000;
    let anyOverThreshold = false;

    for (const routeId of sortedRoutes) {
      const exp = expected.byRoute.get(routeId) || 0;
      const trk = trackingByRoute.get(routeId) || 0;
      const mis = Math.max(0, exp - trk);
      totalMissing += mis;

      let duration = null;
      let durationMs = 0;
      if (mis > 0) {
        // Track when this route first went missing
        const firstSeen = prevState[routeId] || nowMs;
        newState[routeId] = firstSeen;
        durationMs = nowMs - firstSeen;
        duration = formatDuration(durationMs);
        if (durationMs >= alertThresholdMs) anyOverThreshold = true;
      }

      if (exp > 0) {
        rows.push({ routeId, expected: exp, tracking: trk, missing: mis, duration });
      }
    }

    // Save state (only routes currently missing are kept)
    saveState(newState);

    // 7. Decide whether to alert
    if (totalMissing === 0) {
      console.log('[monitor] All expected buses are tracking. No alert needed.');
      await saveSuccessHeartbeat(emailConfig);
      process.exit(0);
    }

    if (!anyOverThreshold) {
      console.log('[monitor] Missing: %d buses, but none over %d min threshold yet. No alert.', totalMissing, ALERT_AFTER_MIN);
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
})();
