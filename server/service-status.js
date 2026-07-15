const fs = require('fs');
const path = require('path');
const { normalizeServiceOverrideEntry } = require('../monitor/schedule');

const DEFAULT_TIMEZONE = 'America/Toronto';
const SERVICE_OVERRIDE_FILENAME = 'service-overrides.json';

function datePartsInTimezone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : '';
  };
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  return {
    iso: `${year}-${month}-${day}`,
    compact: `${year}${month}${day}`,
  };
}

function normalizeDateKey(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) return null;
  return {
    iso: `${match[1]}-${match[2]}-${match[3]}`,
    compact: `${match[1]}${match[2]}${match[3]}`,
  };
}

function loadRawServiceOverrides(cacheDir) {
  const files = [];
  if (cacheDir) {
    files.push(path.join(cacheDir, SERVICE_OVERRIDE_FILENAME));
  }
  files.push(path.join(__dirname, '..', 'monitor', SERVICE_OVERRIDE_FILENAME));

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn('[service-status] Could not read service override file:', err.message);
      return {};
    }
  }

  return {};
}

function formatServiceMode(mode) {
  if (mode === 'no_service') return 'No service';
  if (mode === 'service_day') return 'Holiday service';
  return 'Special service';
}

function getServiceDisplay(entry) {
  const label = entry && entry.label ? String(entry.label).trim() : '';

  if (entry && entry.mode === 'no_service') {
    return label ? `${label} Service: No Service` : 'Holiday Service: No Service';
  }

  if (entry && entry.mode === 'service_day' && entry.service_day === 'sunday') {
    return label ? `${label} Service: Sunday Schedules` : 'Holiday Service: Sunday Schedules';
  }

  const serviceLabel = entry && entry.service_label
    ? String(entry.service_label).trim()
    : 'Special Service';
  return label ? `${label} Service: ${serviceLabel}` : serviceLabel;
}

function dateFromIso(isoDate) {
  const normalized = normalizeDateKey(isoDate);
  if (!normalized) return null;
  const [year, month, day] = normalized.iso.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day);
}

function daysBetween(startIso, endIso) {
  const start = dateFromIso(startIso);
  const end = dateFromIso(endIso);
  if (!start || !end) return null;
  const diff = end.getTime() - start.getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

function formatDisplayDate(isoDate) {
  const dateObj = dateFromIso(isoDate);
  if (!dateObj) return isoDate;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(dateObj);
}

function normalizeRawOverrides(rawOverrides) {
  const entries = [];
  if (!rawOverrides || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) {
    return entries;
  }

  for (const [dateKey, rawEntry] of Object.entries(rawOverrides)) {
    if (dateKey.startsWith('_')) continue;
    const normalizedDate = normalizeDateKey(dateKey);
    const normalizedEntry = normalizeServiceOverrideEntry(rawEntry);
    if (!normalizedDate || !normalizedEntry) continue;

    const label = rawEntry && typeof rawEntry === 'object' && typeof rawEntry.label === 'string'
      ? rawEntry.label.trim()
      : '';
    const serviceLabel = normalizedEntry.mode === 'service_day' && normalizedEntry.serviceDay
      ? `${normalizedEntry.serviceDay.charAt(0).toUpperCase()}${normalizedEntry.serviceDay.slice(1)} service`
      : formatServiceMode(normalizedEntry.mode);

    const entry = {
      date: normalizedDate.iso,
      date_key: normalizedDate.compact,
      label,
      mode: normalizedEntry.mode,
      service_day: normalizedEntry.serviceDay || null,
      service_label: serviceLabel,
    };
    entry.display_label = getServiceDisplay(entry);
    entries.push(entry);
  }

  return entries.sort((a, b) => a.date_key.localeCompare(b.date_key));
}

function buildServiceStatus({ cacheDir, date, now = new Date(), timeZone = DEFAULT_TIMEZONE } = {}) {
  const requestedDate = date ? normalizeDateKey(date) : null;
  const resolvedDate = requestedDate || datePartsInTimezone(now, timeZone);
  const entries = normalizeRawOverrides(loadRawServiceOverrides(cacheDir));
  const today = entries.find((entry) => entry.date_key === resolvedDate.compact) || null;
  const upcoming = entries.find((entry) => entry.date_key > resolvedDate.compact) || null;
  const daysUntilUpcoming = upcoming ? daysBetween(resolvedDate.iso, upcoming.date) : null;
  const upcomingWarning = !today && upcoming && daysUntilUpcoming >= 1 && daysUntilUpcoming <= 7
    ? {
        ...upcoming,
        days_until: daysUntilUpcoming,
        display_date: formatDisplayDate(upcoming.date),
        message: `Upcoming Holiday Service: ${upcoming.display_label} on ${formatDisplayDate(upcoming.date)}.`,
      }
    : null;

  let message = '';
  let headline = 'Regular service today';

  if (today) {
    headline = today.service_label;
    message = today.display_label;
  }

  return {
    date: resolvedDate.iso,
    timezone: timeZone,
    is_special_service: Boolean(today),
    headline,
    message,
    today,
    upcoming,
    upcoming_warning: upcomingWarning,
  };
}

module.exports = {
  buildServiceStatus,
  normalizeRawOverrides,
  normalizeDateKey,
  datePartsInTimezone,
  daysBetween,
};
