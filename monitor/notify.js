/* monitor/notify.js — Email alert via nodemailer + Gmail SMTP */
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createTransport(config) {
  const port = parseInt(config.smtpPort || '587', 10);
  const secure = port === 465;
  const forceIpv4 = Boolean(config.smtpForceIpv4);
  return nodemailer.createTransport({
    host: config.smtpHost,
    port,
    secure,
    family: forceIpv4 ? 4 : undefined,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 60000,
  });
}

async function sendViaResend(config, message) {
  const payload = {
    from: config.resendFromEmail,
    to: [config.recipient],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend API ${response.status}: ${body}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    parsed = null;
  }

  const messageId = parsed && parsed.id ? parsed.id : 'unknown';
  console.log('[notify] Resend email sent:', messageId);
  return { messageId };
}

async function sendMail(config, message) {
  if (config.resendApiKey && config.resendFromEmail) {
    return sendViaResend(config, message);
  }

  const transport = createTransport(config);
  const info = await transport.sendMail({
    from: `"Barrie Transit Monitor" <${config.smtpUser}>`,
    to: config.recipient,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  return info;
}

function formatAlertTimestamp(value) {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function formatIsoTimestamp(value) {
  if (!value && value !== 0) return 'unknown';
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function formatMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'unknown';
  return `${numeric} minute${numeric === 1 ? '' : 's'}`;
}

function buildSystemSubject(payload) {
  switch (payload.kind) {
    case 'recovered':
      return 'Barrie Transit GPS Alert: Monitor reporting recovered';
    case 'vehicle_feed_stale':
      return 'Barrie Transit GPS Alert: Vehicle positions feed stale';
    case 'vehicle_feed_unreachable':
      return 'Barrie Transit GPS Alert: Vehicle positions feed unreachable';
    case 'vehicle_feed_out_of_sync':
      return 'Barrie Transit GPS Alert: GTFS feeds out of sync';
    case 'all_buses_not_tracking':
      return 'Barrie Transit GPS Alert: All expected buses not tracking';
    case 'runtime_failure':
      return 'Barrie Transit GPS Alert: Monitor run failed';
    case 'issue_recovered':
      return 'Barrie Transit GPS Alert: Service restored';
    case 'down':
    default:
      return 'Barrie Transit GPS Alert: Reporting pipeline stale';
  }
}

function buildSystemDescriptor(payload) {
  const severity = payload.severity || (payload.kind === 'issue_recovered' || payload.kind === 'recovered' ? 'Info' : 'Critical');
  const checkedAt = formatAlertTimestamp(payload.checkedAt || new Date());

  switch (payload.kind) {
    case 'vehicle_feed_stale':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'VEHICLE_FEED_STALE'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue', 'The GTFS vehicle positions feed is stale and appears to have stopped updating.'],
          ['Feed URL', payload.feedUrl || 'unknown'],
          ['Feed timestamp', formatIsoTimestamp(payload.feedTimestamp)],
          ['Feed age', formatMinutes(payload.feedAgeMin)],
          ['Last-Modified', payload.lastModified || 'unknown'],
          ['Impact', 'Bus not-tracking alerts may be false positives because live vehicle timestamps are outdated.'],
          ['Suggested focus', 'Check the AVL/GPS source, the vehicle positions export job, and the publishing process for the vehicle positions feed.'],
          ['Details', payload.details || '—'],
        ],
      };
    case 'vehicle_feed_unreachable':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'VEHICLE_FEED_UNREACHABLE'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue', 'The monitor could not reach the GTFS vehicle positions feed.'],
          ['Feed URL', payload.feedUrl || 'unknown'],
          ['HTTP status', payload.httpStatus || 'unknown'],
          ['Error', payload.errorMessage || 'unknown'],
          ['Impact', 'The monitor cannot verify current bus locations, so tracking alerts may be incomplete or unavailable.'],
          ['Suggested focus', 'Check feed availability, IIS or server status, DNS or network access, SSL, and upstream publishing services.'],
          ['Details', payload.details || '—'],
        ],
      };
    case 'vehicle_feed_out_of_sync':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'VEHICLE_FEED_OUT_OF_SYNC'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue', 'GTFS trip updates appear current, but GTFS vehicle positions appear stale.'],
          ['Vehicle feed URL', payload.feedUrl || 'unknown'],
          ['Vehicle feed timestamp', formatIsoTimestamp(payload.feedTimestamp)],
          ['Vehicle feed age', formatMinutes(payload.feedAgeMin)],
          ['Trip updates URL', payload.tripUpdatesUrl || 'unknown'],
          ['Trip updates timestamp', formatIsoTimestamp(payload.tripUpdatesTimestamp)],
          ['Trip updates age', formatMinutes(payload.tripUpdatesAgeMin)],
          ['Impact', 'Bus alert emails may report false GPS outages even though other GTFS real-time services are active.'],
          ['Suggested focus', 'Check the vehicle positions publishing pipeline specifically rather than the full GTFS environment.'],
          ['Details', payload.details || '—'],
        ],
      };
    case 'all_buses_not_tracking':
      return {
        banner: '#92400E',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'ALL_BUSES_NOT_TRACKING'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue', 'No expected buses are reporting current GPS data.'],
          ['Expected buses', String(payload.expectedCount ?? 'unknown')],
          ['Tracking buses', String(payload.trackingCount ?? 'unknown')],
          ['Missing buses', String(payload.missingCount ?? 'unknown')],
          ['Impact', 'This may indicate a major fleet-wide GPS reporting issue.'],
          ['Suggested focus', 'Confirm the vehicle positions feed is healthy first. If the feed is healthy, check onboard GPS reporting, AVL gateway services, and fleet communications.'],
          ['Details', payload.details || '—'],
        ],
      };
    case 'runtime_failure':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'MONITOR_RUNTIME_FAILURE'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue', 'The monitor encountered a fatal error and could not complete its run.'],
          ['Error', payload.errorMessage || 'unknown'],
          ['Impact', 'Monitoring may be incomplete or unreliable until the next successful run.'],
          ['Suggested focus', 'Check recent application logs, environment configuration, feed parsing, and email delivery dependencies.'],
          ['Details', payload.details || '—'],
        ],
      };
    case 'issue_recovered':
      return {
        banner: '#166534',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'SYSTEM_RECOVERED'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue resolved', 'A previously reported monitoring issue has cleared.'],
          ['Previous issue code', payload.previousCode || 'unknown'],
          ['Last successful run', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Impact', 'Monitoring has resumed and alerts should now reflect current conditions.'],
          ['Details', payload.details || '—'],
        ],
      };
    case 'recovered':
      return {
        banner: '#166534',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'SYSTEM_RECOVERED'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue resolved', 'The bus monitoring report pipeline has recovered.'],
          ['Last successful monitor run', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Watchdog max age', formatMinutes(payload.maxAgeMin)],
          ['Details', payload.details || '—'],
        ],
      };
    case 'down':
    default:
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert code', payload.code || 'MONITOR_WATCHDOG_DOWN'],
          ['Severity', severity],
          ['Checked', checkedAt],
          ['Issue', 'The monitor has not completed a successful run within the expected time window.'],
          ['Last successful monitor run', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Threshold', formatMinutes(payload.maxAgeMin)],
          ['Impact', 'The monitoring pipeline may be down or repeatedly failing.'],
          ['Suggested focus', 'Check whether the scheduled job is still running, whether the process is crashing, and whether dependencies are blocking successful completion.'],
          ['Details', payload.details || '—'],
        ],
      };
  }
}

function buildSystemMessage(payload) {
  const subject = buildSystemSubject(payload);
  const descriptor = buildSystemDescriptor(payload);

  const htmlRows = descriptor.rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #D1D5DB;background:#F9FAFB;font-weight:bold;vertical-align:top;width:32%">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;border:1px solid #D1D5DB;vertical-align:top">${escapeHtml(String(value))}</td>
      </tr>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto">
    <tr>
      <td style="background:${descriptor.banner};padding:16px 20px">
        <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px">${descriptor.title}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:20px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${htmlRows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [subject, '', ...descriptor.rows.map(([label, value]) => `${label}: ${value}`)].join('\n');
  return { subject, html, text };
}

/**
 * Send an HTML email alert showing missing buses per route.
 *
 * @param {object} config — { smtpHost, smtpPort, smtpUser, smtpPass, recipient }
 * @param {object} report — { rows: [{ routeId, expected, tracking, missing }], totalExpected, totalTracking, totalMissing, checkedAt }
 */
async function sendAlert(config, report) {
  const html = buildHtml(report);
  const text = buildPlainText(report);
  const subject = buildAlertSubject(report);
  const info = await sendMail(config, { subject, html, text });
  return info;
}

/**
 * Send a monitor-health or monitor-system email.
 */
async function sendSystemAlert(config, payload) {
  const message = buildSystemMessage(payload);
  const info = await sendMail(config, message);
  console.log('[notify] System email sent:', info.messageId);
  return info;
}

/**
 * Send a lightweight test email to confirm scheduled monitor execution.
 *
 * @param {object} config — { smtpHost, smtpPort, smtpUser, smtpPass, recipient }
 * @param {object} payload — { checkedAt, details }
 */
async function sendTestAlert(config, payload) {
  const checkedAt = payload.checkedAt || new Date();
  const details = payload.details || 'Scheduled monitor test run completed successfully.';
  const timestamp = formatAlertTimestamp(checkedAt);

  const subject = 'Barrie Transit GPS Alert Test: Scheduled check';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr>
      <td style="background:#1F4E79;padding:16px 20px">
        <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px">BARRIE TRANSIT GPS ALERT TEST</span>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 20px 8px">
        This is a scheduled test email from the bus monitor.
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 8px">Checked: ${escapeHtml(timestamp)}</td>
    </tr>
    <tr>
      <td style="padding:0 20px 20px">Details: ${escapeHtml(details)}</td>
    </tr>
  </table>
</body>
</html>`;
  const text = [
    'BARRIE TRANSIT GPS ALERT TEST',
    '',
    'This is a scheduled test email from the bus monitor.',
    `Checked: ${timestamp}`,
    `Details: ${details}`,
  ].join('\n');
  const info = await sendMail(config, { subject, html, text });

  console.log('[notify] Test email sent:', info.messageId);
  return info;
}

function buildAlertSubject(report) {
  const noun = report.totalMissing === 1 ? 'bus' : 'buses';
  return `Barrie Transit GPS Alert: ${report.totalMissing}/${report.totalExpected} ${noun} not tracking`;
}

function missingSummary(report) {
  const noun = report.totalMissing === 1 ? 'bus is' : 'buses are';
  return `${report.totalMissing} of ${report.totalExpected} expected ${noun} not reporting GPS data`;
}

function buildHtml(report) {
  const timestamp = formatAlertTimestamp(report.checkedAt);

  const tableRows = report.rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : '#F2F2F2';
      const confirmedMissing = Number.isFinite(Number(row.confirmedMissing))
        ? Number(row.confirmedMissing)
        : (row.confirmed ? row.missing : 0);
      const monitoringMissing = Number.isFinite(Number(row.monitoringMissing))
        ? Number(row.monitoringMissing)
        : Math.max(0, row.missing - confirmedMissing);
      const isMonitoring = row.missing > 0 && confirmedMissing === 0;
      const missingStyle = row.missing > 0
        ? (isMonitoring ? 'color:#B45309;font-weight:bold' : 'color:#C00000;font-weight:bold')
        : 'color:#333333';
      const missingText = monitoringMissing > 0 && confirmedMissing > 0
        ? `${row.missing} <span style="font-size:11px;font-weight:normal">(${confirmedMissing} confirmed, ${monitoringMissing} monitoring)</span>`
        : String(row.missing);
      let durationText = row.duration || '—';
      let durationStyle = 'color:#333333';
      if (row.duration && row.duration !== '0 min') {
        if (isMonitoring) {
          durationText = `${row.duration} <span style="font-size:11px;font-weight:normal">(monitoring)</span>`;
          durationStyle = 'color:#B45309;font-weight:bold';
        } else {
          durationStyle = 'color:#C00000;font-weight:bold';
        }
      }
      return `
      <tr style="background:${bg}">
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${row.routeId}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${row.expected}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${row.tracking}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center;${missingStyle}">${missingText}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center;${durationStyle}">${durationText}</td>
      </tr>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr>
      <td style="background:#1F4E79;padding:16px 20px">
        <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px">BARRIE TRANSIT GPS ALERT</span>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 20px 4px">
        <span style="font-size:16px;color:#333333">&#9888; <strong>${missingSummary(report)}</strong></span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 20px">
        <span style="font-size:12px;color:#888888">Checked: ${escapeHtml(timestamp)}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr style="background:#1F4E79">
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Route</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Expected</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Tracking</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Missing</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Duration Not Reporting</th>
          </tr>
          ${tableRows}
          <tr style="background:#FFFFFF;font-weight:bold">
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">TOTAL</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${report.totalExpected}</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${report.totalTracking}</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center;color:#C00000">${report.totalMissing}</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${report.totalMonitoring > 0 ? `<span style="font-size:11px;color:#B45309;font-weight:normal">+${report.totalMonitoring} monitoring</span>` : ''}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:20px">
        <hr style="border:none;border-top:1px solid #CCCCCC;margin:0 0 12px">
        <span style="font-size:12px;color:#666666">Note: Some variance is normal (vehicles between trips, operator changes). Persistent gaps may indicate GPS equipment issues.</span>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPlainText(report) {
  const timestamp = formatAlertTimestamp(report.checkedAt);

  const lines = [
    'BARRIE TRANSIT GPS ALERT',
    '='.repeat(40),
    '',
    missingSummary(report),
    `Checked: ${timestamp}`,
    '',
    'Route  | Expected | Tracking | Missing | Duration Not Reporting (min)',
    '-------+----------+----------+---------+---------',
  ];

  for (const row of report.rows) {
    const confirmedMissing = Number.isFinite(Number(row.confirmedMissing))
      ? Number(row.confirmedMissing)
      : (row.confirmed ? row.missing : 0);
    const monitoringMissing = Number.isFinite(Number(row.monitoringMissing))
      ? Number(row.monitoringMissing)
      : Math.max(0, row.missing - confirmedMissing);
    const isMonitoring = row.missing > 0 && confirmedMissing === 0;
    const missingText = monitoringMissing > 0 && confirmedMissing > 0
      ? `${row.missing} (${confirmedMissing} confirmed, ${monitoringMissing} monitoring)`
      : String(row.missing);
    let dur = row.duration || '—';
    if (isMonitoring && row.duration) dur = `${row.duration} (monitoring)`;
    lines.push(
      `${String(row.routeId).padEnd(6)} | ${String(row.expected).padStart(8)} | ${String(row.tracking).padStart(8)} | ${missingText.padStart(7)} | ${dur}`
    );
  }

  lines.push('-------+----------+----------+---------+---------');
  const monitoringNote = report.totalMonitoring > 0 ? ` (+${report.totalMonitoring} monitoring)` : '';
  lines.push(
    `TOTAL  | ${String(report.totalExpected).padStart(8)} | ${String(report.totalTracking).padStart(8)} | ${String(report.totalMissing).padStart(7)} |${monitoringNote}`
  );
  lines.push('');
  lines.push('Note: Some variance is normal (vehicles between trips, operator changes).');
  lines.push('Persistent gaps may indicate GPS equipment issues.');

  return lines.join('\n');
}

module.exports = {
  sendAlert,
  sendSystemAlert,
  sendTestAlert,
  buildAlertSubject,
  buildSystemSubject,
  buildSystemMessage,
  formatAlertTimestamp,
  formatIsoTimestamp,
  escapeHtml,
  missingSummary,
  buildHtml,
  buildPlainText,
};
