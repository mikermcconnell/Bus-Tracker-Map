/* monitor/gtfs-integrity.js - Validate Barrie GTFS structure and realtime linkage */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');

const REQUIRED_FILES = [
  'agency.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'stops.txt',
  'feed_info.txt',
];

const ALLANDALE_PARENT_ID = 'Barrie Allandale Transit Terminal';
const ALLANDALE_PARENT_LAT = 44.374029;
const ALLANDALE_PARENT_LON = -79.690216;
const ALLANDALE_PLATFORMS = new Map([
  ['9003', '3'],
  ['9004', '4'],
  ['9005', '5'],
  ['9006', '6'],
  ['9012', '12'],
  ['9013', '13'],
]);
const ALLANDALE_TRANSFERS = [
  ['9003', '9004', '1', ''],
  ['9004', '9003', '1', ''],
  ['9005', '9012', '1', ''],
  ['9012', '9005', '1', ''],
];

function findEntry(zip, fileName) {
  const matches = zip.getEntries().filter((entry) => (
    !entry.isDirectory
    && path.posix.basename(entry.entryName.replaceAll('\\', '/')).toLowerCase() === fileName.toLowerCase()
  ));
  return matches.length === 1 ? matches[0] : null;
}

function csvRows(zip, fileName) {
  const entry = findEntry(zip, fileName);
  if (!entry) return [];
  return parse(entry.getData(), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

function issue(code, summary, details = null) {
  return { code, summary, details: details || summary };
}

function torontoDateKey(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function uniqueNonEmpty(rows, field) {
  return new Set(rows.map((row) => String(row[field] || '').trim()).filter(Boolean));
}

function duplicateValues(rows, field) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = String(row[field] || '').trim();
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function missingReferences(rows, field, validValues) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(row[field] || '').trim();
    if (!value || validValues.has(value)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, references]) => ({ id, references }))
    .sort((left, right) => right.references - left.references || left.id.localeCompare(right.id));
}

function inspectStaticGtfsBuffer(buffer, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const zip = new AdmZip(buffer);
  const fileNames = new Set(zip.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => path.posix.basename(entry.entryName.replaceAll('\\', '/')).toLowerCase()));
  const issues = [];

  const missingFiles = REQUIRED_FILES.filter((fileName) => !fileNames.has(fileName));
  if (!fileNames.has('calendar.txt') && !fileNames.has('calendar_dates.txt')) {
    missingFiles.push('calendar.txt or calendar_dates.txt');
  }
  if (missingFiles.length) {
    issues.push(issue(
      'GTFS_REQUIRED_FILE_MISSING',
      `Required GTFS files are missing: ${missingFiles.join(', ')}`
    ));
  }

  const routes = csvRows(zip, 'routes.txt');
  const trips = csvRows(zip, 'trips.txt');
  const stops = csvRows(zip, 'stops.txt');
  const stopTimes = csvRows(zip, 'stop_times.txt');
  const feedInfo = csvRows(zip, 'feed_info.txt')[0] || {};
  const transfers = csvRows(zip, 'transfers.txt');
  const calendar = csvRows(zip, 'calendar.txt');
  const calendarDates = csvRows(zip, 'calendar_dates.txt');

  const routeIds = uniqueNonEmpty(routes, 'route_id');
  const tripIds = uniqueNonEmpty(trips, 'trip_id');
  const stopIds = uniqueNonEmpty(stops, 'stop_id');
  const serviceIds = new Set([
    ...uniqueNonEmpty(calendar, 'service_id'),
    ...uniqueNonEmpty(calendarDates, 'service_id'),
  ]);

  for (const [rows, field, label] of [
    [routes, 'route_id', 'route_id'],
    [trips, 'trip_id', 'trip_id'],
    [stops, 'stop_id', 'stop_id'],
  ]) {
    const duplicates = duplicateValues(rows, field);
    if (duplicates.length) {
      issues.push(issue(
        'GTFS_DUPLICATE_ID',
        `Duplicate ${label} values found`,
        `${duplicates.length} duplicate ${label} value(s): ${duplicates.slice(0, 8).join(', ')}`
      ));
    }
  }

  const badTripRoutes = missingReferences(trips, 'route_id', routeIds);
  const badTripServices = missingReferences(trips, 'service_id', serviceIds);
  const badStopTimeTrips = missingReferences(stopTimes, 'trip_id', tripIds);
  const badStopTimeStops = missingReferences(stopTimes, 'stop_id', stopIds);
  for (const [code, label, values] of [
    ['GTFS_TRIP_ROUTE_REFERENCE_INVALID', 'trips reference unknown route IDs', badTripRoutes],
    ['GTFS_TRIP_SERVICE_REFERENCE_INVALID', 'trips reference unknown service IDs', badTripServices],
    ['GTFS_STOP_TIME_TRIP_REFERENCE_INVALID', 'stop_times reference unknown trip IDs', badStopTimeTrips],
    ['GTFS_STOP_TIME_STOP_REFERENCE_INVALID', 'stop_times reference unknown stop IDs', badStopTimeStops],
  ]) {
    if (!values.length) continue;
    issues.push(issue(
      code,
      `${values.length} ${label}`,
      values.slice(0, 8).map((value) => `${value.id} (${value.references})`).join(', ')
    ));
  }

  const today = torontoDateKey(now);
  const feedStartDate = String(feedInfo.feed_start_date || '').trim();
  const feedEndDate = String(feedInfo.feed_end_date || '').trim();
  if (/^\d{8}$/.test(feedStartDate) && today < feedStartDate) {
    issues.push(issue('GTFS_SERVICE_WINDOW_NOT_CURRENT', `Feed service does not begin until ${feedStartDate}`));
  }
  if (/^\d{8}$/.test(feedEndDate) && today > feedEndDate) {
    issues.push(issue('GTFS_SERVICE_WINDOW_EXPIRED', `Feed service ended on ${feedEndDate}`));
  }

  const stopById = new Map(stops.map((row) => [String(row.stop_id || '').trim(), row]));
  const parent = stopById.get(ALLANDALE_PARENT_ID);
  const parentLat = Number(parent && parent.stop_lat);
  const parentLon = Number(parent && parent.stop_lon);
  if (
    !parent
    || String(parent.stop_name || '').trim() !== ALLANDALE_PARENT_ID
    || String(parent.location_type || '').trim() !== '1'
    || String(parent.parent_station || '').trim() !== ''
    || !Number.isFinite(parentLat)
    || !Number.isFinite(parentLon)
    || Math.abs(parentLat - ALLANDALE_PARENT_LAT) > 0.00001
    || Math.abs(parentLon - ALLANDALE_PARENT_LON) > 0.00001
  ) {
    issues.push(issue(
      'GTFS_ALLANDALE_PARENT_INVALID',
      'Allandale parent station is missing or does not match the approved station record'
    ));
  }

  const invalidPlatforms = [];
  for (const [stopId, platformCode] of ALLANDALE_PLATFORMS) {
    const platform = stopById.get(stopId);
    if (
      !platform
      || String(platform.parent_station || '').trim() !== ALLANDALE_PARENT_ID
      || String(platform.platform_code || '').trim() !== platformCode
      || !['', '0'].includes(String(platform.location_type || '').trim())
    ) {
      invalidPlatforms.push(stopId);
    }
  }
  if (invalidPlatforms.length) {
    issues.push(issue(
      'GTFS_ALLANDALE_PLATFORM_HIERARCHY_INVALID',
      `Allandale platform hierarchy is incorrect for: ${invalidPlatforms.join(', ')}`
    ));
  }

  const transferKeys = new Set(transfers.map((row) => [
    row.from_stop_id,
    row.to_stop_id,
    row.transfer_type,
    row.min_transfer_time,
  ].map((value) => String(value ?? '').trim()).join('|')));
  const missingTransfers = ALLANDALE_TRANSFERS.filter((row) => !transferKeys.has(row.join('|')));
  if (missingTransfers.length) {
    issues.push(issue(
      'GTFS_ALLANDALE_TIMED_TRANSFERS_MISSING',
      `${missingTransfers.length} of ${ALLANDALE_TRANSFERS.length} required Allandale timed transfers are missing`,
      missingTransfers.map((row) => `${row[0]} -> ${row[1]}`).join(', ')
    ));
  }

  return {
    issues,
    identifiers: { routeIds, tripIds, stopIds },
    feedVersion: feedInfo.feed_version || null,
    feedStartDate: feedStartDate || null,
    feedEndDate: feedEndDate || null,
    counts: {
      routes: routeIds.size,
      trips: tripIds.size,
      stops: stopIds.size,
      stopTimes: stopTimes.length,
      transfers: transfers.length,
    },
  };
}

function inspectStaticGtfsFile(filePath, options = {}) {
  return inspectStaticGtfsBuffer(fs.readFileSync(filePath), options);
}

function readTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value.toNumber ? value.toNumber() : value);
  return Number.isFinite(numeric) ? numeric : null;
}

function collectTripUpdateReferences(feed) {
  const tripIds = [];
  const routeIds = [];
  const stopIds = [];
  let entityCount = 0;

  for (const entity of feed && Array.isArray(feed.entity) ? feed.entity : []) {
    const update = entity && entity.tripUpdate;
    const trip = update && update.trip;
    if (!trip) continue;
    const relationship = Number(trip.scheduleRelationship || 0);
    if (![0, 3].includes(relationship)) continue;
    entityCount += 1;
    if (trip.tripId) tripIds.push(String(trip.tripId));
    if (trip.routeId) routeIds.push(String(trip.routeId));
    for (const stopUpdate of update.stopTimeUpdate || []) {
      if (stopUpdate && stopUpdate.stopId) stopIds.push(String(stopUpdate.stopId));
    }
  }

  return {
    headerTimestamp: readTimestamp(feed && feed.header && feed.header.timestamp),
    entityCount,
    tripIds,
    routeIds,
    stopIds,
  };
}

function collectVehicleReferences(vehicles) {
  const rows = Array.isArray(vehicles) ? vehicles : [];
  return {
    entityCount: rows.length,
    tripIds: rows.map((vehicle) => vehicle && vehicle.trip_id).filter(Boolean).map(String),
    routeIds: rows.map((vehicle) => vehicle && vehicle.route_id).filter(Boolean).map(String),
    stopIds: rows.map((vehicle) => vehicle && vehicle.stop_id).filter(Boolean).map(String),
  };
}

function missingRealtimeIds(values, validValues) {
  const missing = new Map();
  for (const value of values || []) {
    const id = String(value || '').trim();
    if (!id || validValues.has(id)) continue;
    missing.set(id, (missing.get(id) || 0) + 1);
  }
  return [...missing.entries()]
    .map(([id, references]) => ({ id, references }))
    .sort((left, right) => right.references - left.references || left.id.localeCompare(right.id));
}

function inspectRealtimeLinkage(staticIdentifiers, sources = {}) {
  const issues = [];
  const metrics = {};
  const definitions = [
    ['tripIds', 'trip', staticIdentifiers.tripIds, 'GTFS_RT_TRIP_ID_MISMATCH'],
    ['routeIds', 'route', staticIdentifiers.routeIds, 'GTFS_RT_ROUTE_ID_MISMATCH'],
    ['stopIds', 'stop', staticIdentifiers.stopIds, 'GTFS_RT_STOP_ID_MISMATCH'],
  ];

  for (const [sourceName, source] of Object.entries(sources)) {
    if (!source) continue;
    metrics[sourceName] = { entityCount: source.entityCount || 0 };
    for (const [field, label, validValues, code] of definitions) {
      const values = source[field] || [];
      const missing = missingRealtimeIds(values, validValues);
      metrics[sourceName][field] = {
        references: values.length,
        matched: values.length - missing.reduce((sum, value) => sum + value.references, 0),
        missingUnique: missing.length,
      };
      if (!missing.length) continue;
      issues.push(issue(
        code,
        `${sourceName} contains ${missing.length} unknown ${label} ID${missing.length === 1 ? '' : 's'}`,
        missing.slice(0, 8).map((value) => `${value.id} (${value.references})`).join(', ')
      ));
    }
  }

  return { issues, metrics };
}

function decodeTripUpdatesBuffer(buffer) {
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
  return collectTripUpdateReferences(feed);
}

module.exports = {
  REQUIRED_FILES,
  ALLANDALE_PARENT_ID,
  ALLANDALE_PARENT_LAT,
  ALLANDALE_PARENT_LON,
  ALLANDALE_PLATFORMS,
  ALLANDALE_TRANSFERS,
  inspectStaticGtfsBuffer,
  inspectStaticGtfsFile,
  collectTripUpdateReferences,
  collectVehicleReferences,
  inspectRealtimeLinkage,
  decodeTripUpdatesBuffer,
};
