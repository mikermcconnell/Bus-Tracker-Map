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

function buildTaggedSubject(code, summary) {
  const normalizedCode = code || 'GENERAL_ALERT';
  if (!summary) return `Barrie Transit GPS Alert | ${normalizedCode}`;
  return `Barrie Transit GPS Alert | ${normalizedCode} | ${summary}`;
}

function buildSystemSubject(payload) {
  switch (payload.kind) {
    case 'recovered':
      return buildTaggedSubject(payload.code || 'SYSTEM_RECOVERED', 'Monitoring restored');
    case 'vehicle_feed_stale':
      return buildTaggedSubject(payload.code || 'VEHICLE_FEED_STALE', 'Live vehicle location feed delayed');
    case 'vehicle_feed_unreachable':
      return buildTaggedSubject(payload.code || 'VEHICLE_FEED_UNREACHABLE', 'Live vehicle location feed unavailable');
    case 'vehicle_feed_out_of_sync':
      return buildTaggedSubject(
        payload.code || 'VEHICLE_FEED_OUT_OF_SYNC',
        'Trip updates current, live vehicle locations delayed'
      );
    case 'all_buses_not_tracking':
      return buildTaggedSubject(payload.code || 'ALL_BUSES_NOT_TRACKING', 'Fleet-wide GPS reporting gap');
    case 'runtime_failure':
      return buildTaggedSubject(payload.code || 'MONITOR_RUNTIME_FAILURE', 'Monitor check did not complete');
    case 'issue_recovered':
      return buildTaggedSubject(payload.code || 'SYSTEM_RECOVERED', 'Issue resolved');
    case 'down':
    default:
      return buildTaggedSubject(payload.code || 'MONITOR_WATCHDOG_DOWN', 'Monitoring check overdue');
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
          ['Summary', 'Live bus location data appears outdated and may no longer be updating.'],
          ['Live feed link', payload.feedUrl || 'unknown'],
          ['Live feed time', formatIsoTimestamp(payload.feedTimestamp)],
          ['How old it is', formatMinutes(payload.feedAgeMin)],
          ['Last changed', payload.lastModified || 'unknown'],
          ['Operational impact', 'Map views and alert emails may show outdated bus locations. Some GPS outage alerts may be incorrect.'],
          ['Recommended action', 'Review the GPS source, the export job for live bus locations, and the publishing process for that feed.'],
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
          ['Summary', 'The monitor could not reach the live bus location feed.'],
          ['Live feed link', payload.feedUrl || 'unknown'],
          ['Response code', payload.httpStatus || 'unknown'],
          ['Error message', payload.errorMessage || 'unknown'],
          ['Operational impact', 'The monitor cannot confirm current bus locations, so GPS alerts may be missing or incomplete.'],
          ['Recommended action', 'Review the feed, server status, network access, SSL, and the service that publishes live location data.'],
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
          ['Summary', 'Trip updates are current, but live bus location data is delayed.'],
          ['What is going wrong', 'The vehicle positions feed is stale even though the trip updates feed is still refreshing. This points to a failure in the live GPS publishing process, not a full GTFS outage.'],
          ['Live feed link', payload.feedUrl || 'unknown'],
          ['Live feed time', formatIsoTimestamp(payload.feedTimestamp)],
          ['How old it is', formatMinutes(payload.feedAgeMin)],
          ['Trip updates link', payload.tripUpdatesUrl || 'unknown'],
          ['Trip updates time', formatIsoTimestamp(payload.tripUpdatesTimestamp)],
          ['Trip updates age', formatMinutes(payload.tripUpdatesAgeMin)],
          ['Operational impact', 'Public maps and any GPS-based alerts may show incorrect bus locations. Staff may still see current trip activity, which can make the location issue easy to miss.'],
          ['Likely cause', 'The AVL or GPS source may not be reaching the vehicle position publisher, or the process that exports GTFS vehicle positions may be stalled, disconnected, or failed.'],
          ['Recommended action', 'Check whether fresh AVL or GPS data is reaching the publisher, review the logs or status of the process that creates GTFS_VehiclePositions.pb, restart that process if needed, and confirm the vehicle feed timestamp begins advancing again.'],
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
          ['Summary', 'No expected buses are currently reporting GPS data.'],
          ['Expected buses', String(payload.expectedCount ?? 'unknown')],
          ['Buses reporting', String(payload.trackingCount ?? 'unknown')],
          ['Buses missing', String(payload.missingCount ?? 'unknown')],
          ['Operational impact', 'This affects all expected buses and may indicate a fleet-wide GPS reporting issue.'],
          ['Recommended action', 'Confirm the live location feed is healthy. If it is, review bus GPS units, the data gateway, and vehicle communications.'],
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
          ['Summary', 'The monitor encountered an error and did not complete its check.'],
          ['Error message', payload.errorMessage || 'unknown'],
          ['Operational impact', 'This check did not complete, so some issues may not be identified until the next successful run.'],
          ['Recommended action', 'Review recent logs, configuration, feed processing, and email delivery.'],
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
          ['Summary', 'A previously reported issue has cleared.'],
          ['Previous issue', payload.previousCode || 'unknown'],
          ['Last good check', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Operational impact', 'Monitoring is working again and alerts should now reflect current conditions.'],
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
          ['Summary', 'The bus monitoring process is back to normal.'],
          ['Last good check', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Allowed delay', formatMinutes(payload.maxAgeMin)],
          ['Operational impact', 'The monitoring report is working again.'],
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
          ['Summary', 'The monitor has not completed a successful check within the expected time window.'],
          ['Last good check', formatAlertTimestamp(payload.lastSuccessAt)],
          ['Allowed delay', formatMinutes(payload.maxAgeMin)],
          ['Operational impact', 'The monitor may miss issues until it resumes successful runs.'],
          ['Recommended action', 'Confirm the scheduled job is still running and review any crashes or dependency failures.'],
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

  const subject = buildTaggedSubject('TEST', 'Scheduled check');
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
  return buildTaggedSubject('BUSES_NOT_REPORTING', missingSummary(report));
}

function missingSummary(report) {
  const verb = report.totalMissing === 1 ? 'is' : 'are';
  return `${report.totalMissing} of ${report.totalExpected} expected buses ${verb} not reporting live GPS`;
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
        ? `${row.missing} <span style="font-size:11px;font-weight:normal">(${confirmedMissing} confirmed, ${monitoringMissing} being monitored)</span>`
        : String(row.missing);
      let durationText = row.duration || '—';
      let durationStyle = 'color:#333333';
      if (row.duration && row.duration !== '0 min') {
        if (isMonitoring) {
          durationText = `${row.duration} <span style="font-size:11px;font-weight:normal">(being monitored)</span>`;
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
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Reporting GPS</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Not reporting</th>
            <th style="padding:8px 12px;border:1px solid #CCCCCC;color:#FFFFFF;text-align:center">Duration</th>
          </tr>
          ${tableRows}
          <tr style="background:#FFFFFF;font-weight:bold">
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">TOTAL</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${report.totalExpected}</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${report.totalTracking}</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center;color:#C00000">${report.totalMissing}</td>
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${report.totalMonitoring > 0 ? `<span style="font-size:11px;color:#B45309;font-weight:normal">+${report.totalMonitoring} being monitored</span>` : ''}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:20px">
        <hr style="border:none;border-top:1px solid #CCCCCC;margin:0 0 12px">
        <span style="font-size:12px;color:#666666">Note: Short gaps can occur between trips or during operator changes. Repeated gaps may indicate a GPS equipment issue.</span>
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
    'Route  | Expected | Reporting | Missing | Duration (min)',
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
      ? `${row.missing} (${confirmedMissing} confirmed, ${monitoringMissing} being monitored)`
      : String(row.missing);
    let dur = row.duration || '—';
    if (isMonitoring && row.duration) dur = `${row.duration} (being monitored)`;
    lines.push(
      `${String(row.routeId).padEnd(6)} | ${String(row.expected).padStart(8)} | ${String(row.tracking).padStart(8)} | ${missingText.padStart(7)} | ${dur}`
    );
  }

  lines.push('-------+----------+----------+---------+---------');
  const monitoringNote = report.totalMonitoring > 0 ? ` (+${report.totalMonitoring} being monitored)` : '';
  lines.push(
    `TOTAL  | ${String(report.totalExpected).padStart(8)} | ${String(report.totalTracking).padStart(8)} | ${String(report.totalMissing).padStart(7)} |${monitoringNote}`
  );
  lines.push('');
  lines.push('Note: Short gaps can occur between trips or during operator changes.');
  lines.push('Repeated gaps may indicate a GPS equipment issue.');

  return lines.join('\n');
}

module.exports = {
  sendAlert,
  sendSystemAlert,
  sendTestAlert,
  buildAlertSubject,
  buildSystemSubject,
  buildSystemMessage,
  buildTaggedSubject,
  formatAlertTimestamp,
  formatIsoTimestamp,
  escapeHtml,
  missingSummary,
  buildHtml,
  buildPlainText,
};
