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
      return 'Barrie Transit GPS Alert: Monitoring is back to normal';
    case 'vehicle_feed_stale':
      return 'Barrie Transit GPS Alert: Live bus locations are out of date';
    case 'vehicle_feed_unreachable':
      return 'Barrie Transit GPS Alert: Live bus locations feed is unavailable';
    case 'vehicle_feed_out_of_sync':
      return 'Barrie Transit GPS Alert: Live bus locations and trip updates do not match';
    case 'all_buses_not_tracking':
      return 'Barrie Transit GPS Alert: No buses are reporting GPS';
    case 'runtime_failure':
      return 'Barrie Transit GPS Alert: Monitor could not finish its check';
    case 'issue_recovered':
      return 'Barrie Transit GPS Alert: Problem cleared';
    case 'down':
    default:
      return 'Barrie Transit GPS Alert: Monitoring is overdue';
  }
}

function buildSystemDescriptor(payload) {
  const checkedAt = formatAlertTimestamp(payload.checkedAt || new Date());

  switch (payload.kind) {
    case 'vehicle_feed_stale':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'VEHICLE_FEED_STALE'],
          ['Checked at', checkedAt],
          ['What happened', 'The live bus locations feed is old and does not look like it is updating.'],
          ['Live feed link', payload.feedUrl || 'unknown'],
          ['Live feed time', formatIsoTimestamp(payload.feedTimestamp)],
          ['How old it is', formatMinutes(payload.feedAgeMin)],
          ['Last changed', payload.lastModified || 'unknown'],
          ['What this affects', 'Map views and email alerts may show old bus locations. Some GPS outage alerts may be wrong.'],
          ['What to check', 'Check the GPS source, the job that exports live bus locations, and the process that publishes that feed.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'vehicle_feed_unreachable':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'VEHICLE_FEED_UNREACHABLE'],
          ['Checked at', checkedAt],
          ['What happened', 'The monitor could not reach the live bus locations feed.'],
          ['Live feed link', payload.feedUrl || 'unknown'],
          ['Response code', payload.httpStatus || 'unknown'],
          ['Error message', payload.errorMessage || 'unknown'],
          ['What this affects', 'The monitor cannot confirm where buses are, so GPS alerts may be missing or incomplete.'],
          ['What to check', 'Check the feed, the server, network access, SSL, and the service that publishes the live updates.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'vehicle_feed_out_of_sync':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'VEHICLE_FEED_OUT_OF_SYNC'],
          ['Checked at', checkedAt],
          ['What happened', 'Live bus locations are old, but trip updates are current.'],
          ['Live feed link', payload.feedUrl || 'unknown'],
          ['Live feed time', formatIsoTimestamp(payload.feedTimestamp)],
          ['How old it is', formatMinutes(payload.feedAgeMin)],
          ['Trip updates link', payload.tripUpdatesUrl || 'unknown'],
          ['Trip updates time', formatIsoTimestamp(payload.tripUpdatesTimestamp)],
          ['Trip updates age', formatMinutes(payload.tripUpdatesAgeMin)],
          ['What this affects', 'GPS outage emails may be wrong because trip updates are current but bus location data is old.'],
          ['What to check', 'Check the process that publishes live bus locations, not the full GTFS setup.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'all_buses_not_tracking':
      return {
        banner: '#92400E',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'ALL_BUSES_NOT_TRACKING'],
          ['Checked at', checkedAt],
          ['What happened', 'No expected buses are sending current GPS data.'],
          ['Expected buses', String(payload.expectedCount ?? 'unknown')],
          ['Buses reporting', String(payload.trackingCount ?? 'unknown')],
          ['Buses missing', String(payload.missingCount ?? 'unknown')],
          ['What this affects', 'This affects all expected buses and may point to a system-wide GPS problem.'],
          ['What to check', 'Check the live bus locations feed first. If that is working, check the bus GPS units, the data gateway, and bus communications.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'runtime_failure':
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'MONITOR_RUNTIME_FAILURE'],
          ['Checked at', checkedAt],
          ['What happened', 'The monitor hit an error and could not finish.'],
          ['Error message', payload.errorMessage || 'unknown'],
          ['What this affects', 'This check did not finish, so some problems may not be caught until the next run.'],
          ['What to check', 'Check recent logs, settings, feed reading, and email delivery.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'issue_recovered':
      return {
        banner: '#166534',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'SYSTEM_RECOVERED'],
          ['Checked at', checkedAt],
          ['What happened', 'A previously reported issue has cleared.'],
          ['Previous issue', payload.previousCode || 'unknown'],
          ['Last good check', formatAlertTimestamp(payload.lastSuccessAt)],
          ['What this affects', 'Monitoring is working again and alerts should now match current conditions.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'recovered':
      return {
        banner: '#166534',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'SYSTEM_RECOVERED'],
          ['Checked at', checkedAt],
          ['What happened', 'The bus monitoring report is back to normal.'],
          ['Last good check', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Allowed delay', formatMinutes(payload.maxAgeMin)],
          ['What this affects', 'The monitoring report is working again.'],
          ['More details', payload.details || '—'],
        ],
      };
    case 'down':
    default:
      return {
        banner: '#7F1D1D',
        title: 'BARRIE TRANSIT GPS ALERT',
        rows: [
          ['Alert ID', payload.code || 'MONITOR_WATCHDOG_DOWN'],
          ['Checked at', checkedAt],
          ['What happened', 'The monitor has not finished a successful check in the expected time.'],
          ['Last good check', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Allowed delay', formatMinutes(payload.maxAgeMin)],
          ['What this affects', 'The monitor may miss problems until it starts running successfully again.'],
          ['What to check', 'Check whether the scheduled job is still running, whether it is crashing, or whether another service is blocking it.'],
          ['More details', payload.details || '—'],
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
  const details = payload.details || 'The scheduled test check completed successfully.';
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
        This is a scheduled test message from the Barrie Transit monitor.
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 8px">Checked at: ${escapeHtml(timestamp)}</td>
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
    'This is a scheduled test message from the Barrie Transit monitor.',
    `Checked at: ${timestamp}`,
    `Details: ${details}`,
  ].join('\n');
  const info = await sendMail(config, { subject, html, text });

  console.log('[notify] Test email sent:', info.messageId);
  return info;
}

function buildAlertSubject(report) {
  const noun = report.totalMissing === 1 ? 'bus' : 'buses';
  const verb = report.totalMissing === 1 ? 'is' : 'are';
  return `Barrie Transit GPS Alert: ${report.totalMissing} ${noun} out of ${report.totalExpected} ${verb} not sending live updates`;
}

function missingSummary(report) {
  const noun = report.totalMissing === 1 ? 'bus' : 'buses';
  const verb = report.totalMissing === 1 ? 'is' : 'are';
  return `${report.totalMissing} ${noun} out of ${report.totalExpected} ${verb} not sending live updates`;
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
        <span style="font-size:12px;color:#888888">Checked at: ${escapeHtml(timestamp)}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr style="background:#1F4E79">
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Route</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Expected</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Sending updates</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Missing</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Missing for</th>
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
        <span style="font-size:12px;color:#666666">Note: Some change is normal when buses are between trips or drivers change. Repeated gaps may mean GPS equipment needs attention.</span>
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
    `Checked at: ${timestamp}`,
    '',
    'Route  | Expected | Sending   | Missing | Missing for (min)',
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
  lines.push('Note: Some change is normal when buses are between trips or drivers change.');
  lines.push('Repeated gaps may mean GPS equipment needs attention.');

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
