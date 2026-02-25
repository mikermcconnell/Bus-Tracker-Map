/* monitor/schedule.js — GTFS static schedule parser */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { normalizeRouteId } = require('./routes');

const DEFAULT_MONITOR_TIMEZONE = 'America/Toronto';
const formatterCache = new Map();

/**
 * Download GTFS ZIP with disk cache. Falls back to stale cache on failure.
 */
async function loadGtfsZip(gtfsUrl, cachePath, maxAgeHours = 24) {
  const cacheFile = path.join(cachePath, 'google_transit.zip');

  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true });
  }

  // Check if cache is fresh enough
  if (fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < maxAgeHours * 60 * 60 * 1000) {
      console.log('[schedule] Using cached GTFS ZIP (age: %dh)', Math.round(ageMs / 3600000));
      return new AdmZip(cacheFile);
    }
  }

  // Download fresh copy
  try {
    console.log('[schedule] Downloading GTFS ZIP:', gtfsUrl);
    const res = await fetch(gtfsUrl, { timeout: 30_000 });
    if (!res.ok) throw new Error('GTFS download failed: ' + res.status);
    const buffer = await res.buffer();
    fs.writeFileSync(cacheFile, buffer);
    console.log('[schedule] Cached GTFS ZIP (%d KB)', Math.round(buffer.length / 1024));
    return new AdmZip(cacheFile);
  } catch (err) {
    // Fall back to stale cache
    if (fs.existsSync(cacheFile)) {
      console.warn('[schedule] Download failed, using stale cache:', err.message);
      return new AdmZip(cacheFile);
    }
    throw err;
  }
}

/**
 * Parse calendar.txt + calendar_dates.txt to find active service IDs for a date.
 */
function getActiveServiceIds(zip, date) {
  const getText = (name) => {
    const entry = zip.getEntry(name);
    return entry ? zip.readAsText(entry) : null;
  };

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = dayNames[date.getDay()];
  const dateStr = formatDate(date); // YYYYMMDD

  const activeIds = new Set();

  // 1. Check calendar.txt for regular service
  const calendarTxt = getText('calendar.txt');
  if (calendarTxt) {
    const rows = parse(calendarTxt, { columns: true, skip_empty_lines: true });
    for (const row of rows) {
      const start = row.start_date;
      const end = row.end_date;
      if (dateStr >= start && dateStr <= end && row[dayOfWeek] === '1') {
        activeIds.add(row.service_id);
      }
    }
  }

  // 2. Apply calendar_dates.txt overrides
  const datesTxt = getText('calendar_dates.txt');
  if (datesTxt) {
    const rows = parse(datesTxt, { columns: true, skip_empty_lines: true });
    for (const row of rows) {
      if (row.date !== dateStr) continue;
      if (row.exception_type === '1') {
        activeIds.add(row.service_id); // Service added
      } else if (row.exception_type === '2') {
        activeIds.delete(row.service_id); // Service removed
      }
    }
  }

  return activeIds;
}

/**
 * Parse trips.txt + stop_times.txt to get time spans per trip.
 * Returns array of { tripId, routeId, blockId, startSecs, endSecs }
 */
function getTripTimeSpans(zip, serviceIds) {
  const getText = (name) => {
    const entry = zip.getEntry(name);
    return entry ? zip.readAsText(entry) : null;
  };

  // Map trip_id -> metadata for active services
  const tripsTxt = getText('trips.txt');
  if (!tripsTxt) return [];

  const tripsRows = parse(tripsTxt, { columns: true, skip_empty_lines: true });
  const tripMetaMap = new Map();
  for (const row of tripsRows) {
    if (serviceIds.has(row.service_id)) {
      tripMetaMap.set(row.trip_id, {
        routeId: row.route_id,
        blockId: row.block_id || null,
      });
    }
  }

  if (tripMetaMap.size === 0) return [];

  // Get first and last stop_time per trip
  const stopTimesTxt = getText('stop_times.txt');
  if (!stopTimesTxt) return [];

  const stopRows = parse(stopTimesTxt, { columns: true, skip_empty_lines: true });

  const tripTimes = new Map(); // trip_id -> { minSecs, maxSecs }
  for (const row of stopRows) {
    if (!tripMetaMap.has(row.trip_id)) continue;

    const arrival = parseGtfsTime(row.arrival_time);
    const departure = parseGtfsTime(row.departure_time);
    if (arrival === null && departure === null) continue;

    const timeSecs = arrival !== null ? arrival : departure;
    const existing = tripTimes.get(row.trip_id);
    if (!existing) {
      tripTimes.set(row.trip_id, { minSecs: timeSecs, maxSecs: timeSecs });
    } else {
      existing.minSecs = Math.min(existing.minSecs, timeSecs);
      existing.maxSecs = Math.max(existing.maxSecs, timeSecs);
    }
  }

  const spans = [];
  for (const [tripId, times] of tripTimes) {
    const meta = tripMetaMap.get(tripId);
    const rawRouteId = meta && meta.routeId;
    const routeId = normalizeRouteId(rawRouteId);
    if (!routeId) continue;

    spans.push({
      tripId,
      routeId,
      blockId: (meta && meta.blockId) || null,
      startSecs: times.minSecs,
      endSecs: times.maxSecs,
    });
  }

  return spans;
}

/**
 * Merge short same-route layovers within the same block so expected counts
 * remain stable during scheduled handoffs (e.g., 11:58 -> 12:05).
 */
function applyLayoverGrace(tripSpans, graceSecs = 0) {
  const safeGraceSecs = Number.isFinite(Number(graceSecs))
    ? Math.max(0, Number(graceSecs))
    : 0;

  if (safeGraceSecs <= 0) return tripSpans;

  const grouped = new Map();
  for (const span of tripSpans) {
    const blockKey = span.blockId || `trip:${span.tripId}`;
    const key = `${span.routeId}::${blockKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(span);
  }

  const merged = [];
  for (const list of grouped.values()) {
    const sorted = list
      .slice()
      .sort((a, b) => a.startSecs - b.startSecs || a.endSecs - b.endSecs);

    let current = { ...sorted[0] };
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const gap = next.startSecs - current.endSecs;
      if (gap <= safeGraceSecs) {
        current.endSecs = Math.max(current.endSecs, next.endSecs);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }

  return merged;
}

/**
 * Filter trip spans to those overlapping the given time, group by route.
 * @param {number} nowSecs — seconds since midnight (can exceed 86400 for yesterday's late service)
 */
function getActiveTripsNow(tripSpans, nowSecs) {
  const byRoute = new Map();
  let totalExpected = 0;

  for (const span of tripSpans) {
    if (nowSecs >= span.startSecs && nowSecs <= span.endSecs) {
      const count = byRoute.get(span.routeId) || 0;
      byRoute.set(span.routeId, count + 1);
      totalExpected++;
    }
  }

  return { byRoute, totalExpected };
}

function getDateTimePartsInTimezone(date, timeZone) {
  const effectiveTimeZone = timeZone || DEFAULT_MONITOR_TIMEZONE;
  let formatter = formatterCache.get(effectiveTimeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(effectiveTimeZone, formatter);
  }

  const parts = formatter.formatToParts(date);
  const pick = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : NaN;
  };

  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

function getNowContext(now = new Date(), timeZone = DEFAULT_MONITOR_TIMEZONE) {
  let parts;

  try {
    parts = getDateTimePartsInTimezone(now, timeZone);
  } catch (err) {
    console.warn(
      '[schedule] Invalid MONITOR_TIMEZONE "%s". Falling back to %s.',
      timeZone,
      DEFAULT_MONITOR_TIMEZONE
    );
    if (timeZone !== DEFAULT_MONITOR_TIMEZONE) {
      parts = getDateTimePartsInTimezone(now, DEFAULT_MONITOR_TIMEZONE);
    } else {
      parts = {
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1,
        day: now.getUTCDate(),
        hour: now.getUTCHours(),
        minute: now.getUTCMinutes(),
        second: now.getUTCSeconds(),
      };
    }
  }

  const values = [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Could not resolve monitor timezone date parts');
  }

  // Local-timezone Date — safe because downstream only uses local getters
  // (getFullYear, getMonth, getDate, getDay) which return the values we set.
  const today = new Date(parts.year, parts.month - 1, parts.day);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const nowSecs = parts.hour * 3600 + parts.minute * 60 + parts.second;

  return { today, yesterday, nowSecs };
}

/**
 * Convenience wrapper: get expected buses right now.
 */
async function getExpectedBuses(gtfsUrl, cachePath, maxAgeHours = 24, layoverGraceMin = 0, options = {}) {
  const zip = await loadGtfsZip(gtfsUrl, cachePath, maxAgeHours);

  const now = options.now instanceof Date ? options.now : new Date();
  const monitorTimeZone = options.timeZone || process.env.MONITOR_TIMEZONE || DEFAULT_MONITOR_TIMEZONE;
  const { today, yesterday, nowSecs } = getNowContext(now, monitorTimeZone);

  const layoverGraceSecs = Math.max(0, Number(layoverGraceMin) || 0) * 60;

  // Today's service
  const todayServiceIds = getActiveServiceIds(zip, today);
  const todayTripSpans = getTripTimeSpans(zip, todayServiceIds);
  const todaySpans = applyLayoverGrace(todayTripSpans, layoverGraceSecs);
  const todayResult = getActiveTripsNow(todaySpans, nowSecs);

  // Yesterday's service for midnight rollover (trips with times >24:00:00)
  const yesterdayServiceIds = getActiveServiceIds(zip, yesterday);
  const yesterdayTripSpans = getTripTimeSpans(zip, yesterdayServiceIds);
  const yesterdaySpans = applyLayoverGrace(yesterdayTripSpans, layoverGraceSecs);
  // For yesterday's late-night trips, add 86400 to current time
  const rolloverSecs = nowSecs + 86400;
  const yesterdayResult = getActiveTripsNow(yesterdaySpans, rolloverSecs);

  // Merge results
  const byRoute = new Map(todayResult.byRoute);
  for (const [routeId, count] of yesterdayResult.byRoute) {
    byRoute.set(routeId, (byRoute.get(routeId) || 0) + count);
  }
  const totalExpected = todayResult.totalExpected + yesterdayResult.totalExpected;

  return { byRoute, totalExpected };
}

/* ── Helpers ── */

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Parse GTFS time "HH:MM:SS" (handles >24:00:00) to total seconds, or null. */
function parseGtfsTime(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(':');
  if (parts.length !== 3) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parseInt(parts[2], 10);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
  return h * 3600 + m * 60 + s;
}

module.exports = {
  loadGtfsZip,
  getActiveServiceIds,
  getTripTimeSpans,
  applyLayoverGrace,
  getActiveTripsNow,
  getNowContext,
  getExpectedBuses,
  // Exported for testing
  parseGtfsTime,
  formatDate,
};
