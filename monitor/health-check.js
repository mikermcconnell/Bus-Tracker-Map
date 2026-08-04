/* monitor/health-check.js — Daily monitor status email and backup workflow diagnostics */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const { fetchVehicles, fetchGtfsRtFeedMeta } = require('../server/vehicles');
const { getExpectedBuses } = require('./schedule');
const {
  buildEmailConfig,
  deriveTripUpdatesUrl,
  getFeedAlertContext,
  getFeedAgeMinutes,
} = require('./index');
const { sendHealthCheck, formatIsoTimestamp } = require('./notify');

const DEFAULT_STATIC_URL = 'https://www.myridebarrie.ca/gtfs/google_transit.zip';
const DEFAULT_VEHICLE_URL = 'https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb';
const DEFAULT_WORKFLOW_FILE = 'bus-monitor.yml';

const GTFS_STATIC_URL = process.env.GTFS_STATIC_URL || DEFAULT_STATIC_URL;
const GTFS_RT_VEHICLES_URL = process.env.GTFS_RT_VEHICLES_URL || DEFAULT_VEHICLE_URL;
const GTFS_RT_TRIP_UPDATES_URL = process.env.GTFS_RT_TRIP_UPDATES_URL || deriveTripUpdatesUrl(GTFS_RT_VEHICLES_URL);
const SILENCE_THRESHOLD_MIN = parseInt(process.env.SILENCE_THRESHOLD_MIN || '5', 10);
const FEED_STALE_AFTER_MIN = parseInt(process.env.FEED_STALE_AFTER_MIN || '15', 10);
const GTFS_CACHE_MAX_AGE_HOURS = parseInt(process.env.GTFS_CACHE_MAX_AGE_HOURS || '6', 10);
const LAYOVER_GRACE_MIN = parseInt(process.env.LAYOVER_GRACE_MIN || '10', 10);
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'mikermcconnell/Bus-Tracker-Map';
const MONITOR_WORKFLOW_FILE = process.env.MONITOR_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE;

function logEvent(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    checkedAt: new Date().toISOString(),
    ...fields,
  }));
}

function buildHealthEmailConfig() {
  const config = buildEmailConfig();
  config.recipient = process.env.HEALTH_CHECK_RECIPIENT || config.recipient;
  return config;
}

function validateEmailConfig(config) {
  const missing = [];
  if (!config.recipient) missing.push('ALERT_RECIPIENT or HEALTH_CHECK_RECIPIENT');
  const hasSmtp = Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
  const hasResend = Boolean(config.resendApiKey && config.resendFromEmail);
  if (!hasSmtp && !hasResend) {
    missing.push('SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY/RESEND_FROM_EMAIL');
  }
  return missing;
}

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'barrie-transit-monitor-health-check',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchGithubJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: githubHeaders(token), timeout: 15000 });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
  return JSON.parse(body);
}

async function getWorkflowStatus(options = {}) {
  const repo = options.repo || GITHUB_REPOSITORY;
  const workflowFile = options.workflowFile || MONITOR_WORKFLOW_FILE;
  const token = options.token || process.env.GITHUB_TOKEN;
  const fetchImpl = options.fetchImpl || fetch;
  const encodedWorkflow = encodeURIComponent(workflowFile);
  const baseUrl = `https://api.github.com/repos/${repo}/actions/workflows/${encodedWorkflow}`;

  const workflow = await fetchGithubJson(baseUrl, token, fetchImpl);
  const runs = await fetchGithubJson(`${baseUrl}/runs?per_page=1`, token, fetchImpl);
  const lastRun = Array.isArray(runs.workflow_runs) && runs.workflow_runs.length
    ? runs.workflow_runs[0]
    : null;

  return {
    repo,
    workflowFile,
    name: workflow.name,
    state: workflow.state,
    updatedAt: workflow.updated_at,
    lastRun: lastRun ? {
      status: lastRun.status,
      conclusion: lastRun.conclusion,
      event: lastRun.event,
      createdAt: lastRun.created_at,
      updatedAt: lastRun.updated_at,
      url: lastRun.html_url,
      headSha: lastRun.head_sha,
    } : null,
  };
}

function getRecentVehicleCount(vehicles, now, thresholdMinutes) {
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const thresholdSecs = Math.max(1, Number(thresholdMinutes) || 5) * 60;
  return (Array.isArray(vehicles) ? vehicles : []).filter((vehicle) => {
    if (!vehicle.route_id || !vehicle.last_reported) return false;
    return (nowEpoch - Number(vehicle.last_reported)) <= thresholdSecs;
  }).length;
}

async function getTransitFeedStatus(now) {
  const expected = await getExpectedBuses(
    GTFS_STATIC_URL,
    path.join(__dirname, 'cache'),
    GTFS_CACHE_MAX_AGE_HOURS,
    LAYOVER_GRACE_MIN
  );
  const vehicleData = await fetchVehicles(GTFS_RT_VEHICLES_URL);
  const vehicles = vehicleData.vehicles || [];
  const recentVehicles = getRecentVehicleCount(vehicles, now, SILENCE_THRESHOLD_MIN);
  let tripUpdatesMeta = null;

  if (GTFS_RT_TRIP_UPDATES_URL) {
    try {
      tripUpdatesMeta = await fetchGtfsRtFeedMeta(GTFS_RT_TRIP_UPDATES_URL);
    } catch (err) {
      tripUpdatesMeta = { error: err.message || String(err) };
    }
  }

  const feedIssue = getFeedAlertContext(
    vehicleData,
    tripUpdatesMeta && !tripUpdatesMeta.error ? tripUpdatesMeta : null,
    now,
    FEED_STALE_AFTER_MIN
  );

  return {
    expectedBuses: expected.totalExpected,
    expectedRoutes: expected.byRoute.size,
    scheduleSource: expected.scheduleSources && expected.scheduleSources.today
      ? expected.scheduleSources.today.source
      : null,
    totalVehicles: vehicles.length,
    recentVehicles,
    vehicleFeedTimestamp: vehicleData.feed_timestamp,
    vehicleFeedAgeMin: getFeedAgeMinutes(vehicleData.feed_timestamp, now.getTime()),
    tripUpdatesTimestamp: tripUpdatesMeta && tripUpdatesMeta.header_timestamp,
    tripUpdatesAgeMin: tripUpdatesMeta && tripUpdatesMeta.header_timestamp
      ? getFeedAgeMinutes(tripUpdatesMeta.header_timestamp, now.getTime())
      : null,
    tripUpdatesError: tripUpdatesMeta && tripUpdatesMeta.error,
    feedIssue,
  };
}

function summarizeStatus(workflowStatus, transitStatus, errors = []) {
  const problems = [...errors];

  if (!workflowStatus) {
    problems.push('Could not check the GitHub manual backup workflow.');
  } else if (workflowStatus.state !== 'active') {
    problems.push(`The GitHub manual backup workflow is ${workflowStatus.state}.`);
  }

  if (!workflowStatus || !workflowStatus.lastRun) {
    problems.push('No previous GitHub manual backup workflow run was found.');
  } else if (workflowStatus.lastRun.conclusion && workflowStatus.lastRun.conclusion !== 'success') {
    problems.push(`The last GitHub manual backup workflow run finished with ${workflowStatus.lastRun.conclusion}.`);
  }

  if (!transitStatus) {
    problems.push('Could not check the transit data feeds.');
  } else if (transitStatus.feedIssue) {
    problems.push(`Transit feed issue detected: ${transitStatus.feedIssue.code}.`);
  }

  return {
    status: problems.length ? 'attention' : 'ok',
    summary: problems.length
      ? problems.join(' ')
      : 'The GitHub manual backup workflow is active and the live transit feeds look current.',
  };
}

function buildHealthRows(workflowStatus, transitStatus, errors = []) {
  const rows = [];

  if (workflowStatus) {
    rows.push(['GitHub backup workflow', `${workflowStatus.name || 'Bus Monitor'} (${workflowStatus.workflowFile})`]);
    rows.push(['Workflow state', workflowStatus.state || 'unknown']);
    rows.push(['Workflow last updated', workflowStatus.updatedAt || 'unknown']);
    if (workflowStatus.lastRun) {
      rows.push(['Last workflow run', `${workflowStatus.lastRun.conclusion || workflowStatus.lastRun.status || 'unknown'} at ${workflowStatus.lastRun.updatedAt || workflowStatus.lastRun.createdAt || 'unknown'}`]);
      rows.push(['Last run trigger', workflowStatus.lastRun.event || 'unknown']);
      rows.push(['Last run link', workflowStatus.lastRun.url || 'unknown']);
    } else {
      rows.push(['Last workflow run', 'none found']);
    }
    if (workflowStatus.state && workflowStatus.state !== 'active') {
      rows.push([
        'Disable reason visible here',
        workflowStatus.state === 'disabled_manually'
          ? 'GitHub reports this workflow was manually disabled. GitHub does not expose the clicker or note to this job; check the GitHub audit log for that.'
          : `GitHub reports state: ${workflowStatus.state}`,
      ]);
    }
  }

  if (transitStatus) {
    rows.push(['Expected buses now', transitStatus.expectedBuses]);
    rows.push(['Expected routes now', transitStatus.expectedRoutes]);
    rows.push(['Schedule source', transitStatus.scheduleSource || 'unknown']);
    rows.push(['Vehicles in feed', transitStatus.totalVehicles]);
    rows.push(['Vehicles with recent GPS', transitStatus.recentVehicles]);
    rows.push(['Vehicle feed time', formatIsoTimestamp(transitStatus.vehicleFeedTimestamp)]);
    rows.push(['Vehicle feed age', transitStatus.vehicleFeedAgeMin === null ? 'unknown' : `${transitStatus.vehicleFeedAgeMin} minutes`]);
    rows.push(['Trip updates time', formatIsoTimestamp(transitStatus.tripUpdatesTimestamp)]);
    if (transitStatus.tripUpdatesError) rows.push(['Trip updates check', transitStatus.tripUpdatesError]);
  }

  if (errors.length) rows.push(['Health-check errors', errors.join(' | ')]);
  rows.push(['Check-in subject note', 'This email intentionally does not use “Barrie Transit GPS Alert”.']);
  return rows;
}

async function main() {
  const checkedAt = new Date();
  const errors = [];
  const emailConfig = buildHealthEmailConfig();
  const missingEmailConfig = validateEmailConfig(emailConfig);

  logEvent('monitor_daily_check_started', {
    repository: GITHUB_REPOSITORY,
    workflowFile: MONITOR_WORKFLOW_FILE,
  });

  if (missingEmailConfig.length) {
    console.error('[health-check] Missing required email env vars:', missingEmailConfig.join(', '));
    process.exit(1);
  }

  let workflowStatus = null;
  try {
    workflowStatus = await getWorkflowStatus();
    logEvent('monitor_backup_workflow_status', {
      state: workflowStatus.state,
      workflowUpdatedAt: workflowStatus.updatedAt,
      lastRunConclusion: workflowStatus.lastRun && workflowStatus.lastRun.conclusion,
      lastRunUpdatedAt: workflowStatus.lastRun && workflowStatus.lastRun.updatedAt,
    });
  } catch (err) {
    const message = err.message || String(err);
    errors.push(`GitHub backup workflow check failed: ${message}`);
    logEvent('monitor_backup_workflow_status_failed', { error: message });
  }

  let transitStatus = null;
  try {
    transitStatus = await getTransitFeedStatus(checkedAt);
    logEvent('monitor_transit_feed_status', {
      expectedBuses: transitStatus.expectedBuses,
      scheduleSource: transitStatus.scheduleSource,
      totalVehicles: transitStatus.totalVehicles,
      recentVehicles: transitStatus.recentVehicles,
      vehicleFeedAgeMin: transitStatus.vehicleFeedAgeMin,
      feedIssueCode: transitStatus.feedIssue && transitStatus.feedIssue.code,
    });
  } catch (err) {
    const message = err.message || String(err);
    errors.push(`Transit feed check failed: ${message}`);
    logEvent('monitor_transit_feed_status_failed', { error: message });
  }

  const summary = summarizeStatus(workflowStatus, transitStatus, errors);
  const rows = buildHealthRows(workflowStatus, transitStatus, errors);
  await sendHealthCheck(emailConfig, {
    checkedAt,
    status: summary.status,
    summary: summary.summary,
    rows,
  });

  logEvent('monitor_daily_check_completed', {
    status: summary.status,
    recipientConfigured: Boolean(emailConfig.recipient),
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[health-check] Fatal error:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  buildHealthEmailConfig,
  validateEmailConfig,
  getWorkflowStatus,
  getRecentVehicleCount,
  summarizeStatus,
  buildHealthRows,
};
