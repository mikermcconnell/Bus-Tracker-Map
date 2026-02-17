/* monitor/notify.js — Email alert via nodemailer + Gmail SMTP */
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

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

  console.log('[notify] Email sent:', info.messageId);
  return info;
}

/**
 * Send a monitor-health email (watchdog) when the reporting pipeline is stale or recovers.
 *
 * @param {object} config — { smtpHost, smtpPort, smtpUser, smtpPass, recipient }
 * @param {object} payload — { kind: 'down'|'recovered', checkedAt, details, lastSuccessAt, maxAgeMin }
 */
async function sendSystemAlert(config, payload) {
  const timestamp = payload.checkedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const lastSuccessText = payload.lastSuccessAt
    ? payload.lastSuccessAt.toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })
    : 'unknown';

  const isDown = payload.kind === 'down';
  const statusLabel = isDown ? 'DOWN' : 'RECOVERED';
  const subject = buildSystemSubject(payload);
  const intro = isDown
    ? 'The bus monitoring report pipeline appears stale.'
    : 'The bus monitoring report pipeline has recovered.';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr>
      <td style="background:${isDown ? '#7F1D1D' : '#166534'};padding:16px 20px">
        <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px">BARRIE TRANSIT MONITOR HEALTH: ${statusLabel}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 20px 4px">
        <span style="font-size:15px"><strong>${intro}</strong></span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 8px">Checked: ${timestamp}</td>
    </tr>
    <tr>
      <td style="padding:0 20px 8px">Last successful monitor run: ${lastSuccessText}</td>
    </tr>
    <tr>
      <td style="padding:0 20px 8px">Watchdog max age: ${payload.maxAgeMin} minutes</td>
    </tr>
    <tr>
      <td style="padding:0 20px 20px">Details: ${payload.details}</td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `BARRIE TRANSIT MONITOR HEALTH: ${statusLabel}`,
    '',
    intro,
    `Checked: ${timestamp}`,
    `Last successful monitor run: ${lastSuccessText}`,
    `Watchdog max age: ${payload.maxAgeMin} minutes`,
    `Details: ${payload.details}`,
  ].join('\n');
  const info = await sendMail(config, { subject, html, text });

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
  const timestamp = checkedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const subject = 'Barrie Transit Monitor Test: Scheduled check';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333333">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr>
      <td style="background:#1F4E79;padding:16px 20px">
        <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px">BARRIE TRANSIT MONITOR TEST EMAIL</span>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 20px 8px">
        This is a scheduled test email from Railway.
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 8px">Checked: ${timestamp}</td>
    </tr>
    <tr>
      <td style="padding:0 20px 20px">Details: ${details}</td>
    </tr>
  </table>
</body>
</html>`;
  const text = [
    'BARRIE TRANSIT MONITOR TEST EMAIL',
    '',
    'This is a scheduled test email from Railway.',
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

function buildSystemSubject(payload) {
  if (payload.kind === 'recovered') {
    return 'Barrie Transit Monitor Health: Reporting recovered';
  }
  return 'Barrie Transit Monitor Health: Reporting pipeline stale';
}

function missingSummary(report) {
  const noun = report.totalMissing === 1 ? 'bus is' : 'buses are';
  return `${report.totalMissing} of ${report.totalExpected} expected ${noun} not reporting GPS data`;
}

function buildHtml(report) {
  const timestamp = report.checkedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const tableRows = report.rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : '#F2F2F2';
      const missingStyle = row.missing > 0
        ? 'color:#C00000;font-weight:bold'
        : 'color:#333333';
      const durationText = row.duration || '—';
      const durationStyle = row.duration && row.duration !== '0 min'
        ? 'color:#C00000;font-weight:bold'
        : 'color:#333333';
      return `
      <tr style="background:${bg}">
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${row.routeId}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${row.expected}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center">${row.tracking}</td>
        <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center;${missingStyle}">${row.missing}</td>
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
    <!-- Header banner -->
    <tr>
      <td style="background:#1F4E79;padding:16px 20px">
        <span style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:0.5px">BARRIE TRANSIT TRACKING ALERT</span>
      </td>
    </tr>

    <!-- Summary -->
    <tr>
      <td style="padding:20px 20px 4px">
        <span style="font-size:16px;color:#333333">&#9888; <strong>${missingSummary(report)}</strong></span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 20px">
        <span style="font-size:12px;color:#888888">Checked: ${timestamp}</span>
      </td>
    </tr>

    <!-- Data table -->
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
            <td style="padding:8px 12px;border:1px solid #CCCCCC;text-align:center"></td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
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
  const timestamp = report.checkedAt.toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const lines = [
    'BARRIE TRANSIT TRACKING ALERT',
    '='.repeat(40),
    '',
    missingSummary(report),
    `Checked: ${timestamp}`,
    '',
    'Route  | Expected | Tracking | Missing | Duration Not Reporting (min)',
    '-------+----------+----------+---------+---------',
  ];

  for (const row of report.rows) {
    const dur = row.duration || '—';
    lines.push(
      `${String(row.routeId).padEnd(6)} | ${String(row.expected).padStart(8)} | ${String(row.tracking).padStart(8)} | ${String(row.missing).padStart(7)} | ${dur}`
    );
  }

  lines.push('-------+----------+----------+---------+---------');
  lines.push(
    `TOTAL  | ${String(report.totalExpected).padStart(8)} | ${String(report.totalTracking).padStart(8)} | ${String(report.totalMissing).padStart(7)} |`
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
};
