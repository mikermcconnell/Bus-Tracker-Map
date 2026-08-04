/* monitor/email-volume.js - Rolling alert-email volume guard */
const fs = require('fs');
const path = require('path');

const COUNTED_CATEGORIES = new Set([
  'operational_alert',
  'gtfs_static_change',
  'gtfs_integrity',
]);

function normalizeState(value) {
  const deliveries = value && Array.isArray(value.deliveries)
    ? value.deliveries.filter((entry) => entry && entry.sentAt)
    : [];
  return {
    deliveries,
    lastVolumeAlertAt: value && value.lastVolumeAlertAt ? value.lastVolumeAlertAt : null,
  };
}

function loadEmailVolumeState(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }
  } catch (err) {
    console.warn('[email-volume] Could not read state:', err.message);
  }
  return normalizeState(null);
}

function saveEmailVolumeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeState(state), null, 2));
}

function pruneDeliveries(deliveries, nowMs, windowMs) {
  return deliveries.filter((entry) => {
    const sentAt = new Date(entry.sentAt).getTime();
    return Number.isFinite(sentAt) && sentAt <= nowMs && (nowMs - sentAt) <= windowMs;
  });
}

function recordEmailDelivery(filePath, delivery, options = {}) {
  const now = delivery.sentAt instanceof Date ? delivery.sentAt : new Date(delivery.sentAt || Date.now());
  const nowMs = now.getTime();
  const windowMinutes = Math.max(1, Number(options.windowMinutes) || 60);
  const threshold = Math.max(2, Number(options.threshold) || 4);
  const cooldownMinutes = Math.max(windowMinutes, Number(options.cooldownMinutes) || 180);
  const windowMs = windowMinutes * 60 * 1000;
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const state = loadEmailVolumeState(filePath);
  state.deliveries = pruneDeliveries(state.deliveries, nowMs, windowMs);

  if (COUNTED_CATEGORIES.has(delivery.category)) {
    state.deliveries.push({
      sentAt: now.toISOString(),
      category: delivery.category,
      subject: String(delivery.subject || 'unknown subject'),
    });
  }

  const lastAlertMs = state.lastVolumeAlertAt
    ? new Date(state.lastVolumeAlertAt).getTime()
    : null;
  const cooldownActive = Number.isFinite(lastAlertMs) && (nowMs - lastAlertMs) < cooldownMs;
  const shouldAlert = state.deliveries.length >= threshold && !cooldownActive;
  saveEmailVolumeState(filePath, state);

  return {
    shouldAlert,
    count: state.deliveries.length,
    threshold,
    windowMinutes,
    cooldownMinutes,
    recentSubjects: state.deliveries.slice(-8).map((entry) => entry.subject),
  };
}

function markEmailVolumeAlertSent(filePath, sentAt = new Date()) {
  const state = loadEmailVolumeState(filePath);
  state.lastVolumeAlertAt = (sentAt instanceof Date ? sentAt : new Date(sentAt)).toISOString();
  saveEmailVolumeState(filePath, state);
}

module.exports = {
  COUNTED_CATEGORIES,
  normalizeState,
  loadEmailVolumeState,
  saveEmailVolumeState,
  recordEmailDelivery,
  markEmailVolumeAlertSent,
};
