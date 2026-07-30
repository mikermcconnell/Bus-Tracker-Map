/* monitor/gtfs-static-change.js — Detect meaningful GTFS Schedule feed changes */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

const ALLANDALE_TRANSFERS = [
  ['9003', '9004', '1', ''],
  ['9004', '9003', '1', ''],
  ['9005', '9012', '1', ''],
  ['9012', '9005', '1', ''],
];

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadState(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn('[gtfs-static-change] Could not read state:', err.message);
  }
  return null;
}

function csvRows(zip, fileName) {
  const entry = zip.getEntries().find((candidate) => (
    !candidate.isDirectory
    && path.posix.basename(candidate.entryName).toLowerCase() === fileName.toLowerCase()
  ));
  if (!entry) return [];
  return parse(entry.getData(), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function inspectGtfsBuffer(buffer) {
  const zip = new AdmZip(buffer);
  const textEntries = zip.getEntries()
    .filter((entry) => !entry.isDirectory && /\.txt$/i.test(entry.entryName))
    .map((entry) => ({
      name: path.posix.basename(entry.entryName).toLowerCase(),
      data: entry.getData(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (textEntries.length === 0) {
    throw new Error('Downloaded ZIP contains no GTFS text files');
  }

  const fingerprint = crypto.createHash('sha256');
  for (const entry of textEntries) {
    fingerprint.update(entry.name);
    fingerprint.update('\0');
    fingerprint.update(crypto.createHash('sha256').update(entry.data).digest('hex'));
    fingerprint.update('\n');
  }

  const feedInfo = csvRows(zip, 'feed_info.txt')[0] || {};
  const transferRows = csvRows(zip, 'transfers.txt');
  const transferKeys = new Set(transferRows.map((row) => [
    row.from_stop_id,
    row.to_stop_id,
    row.transfer_type,
    row.min_transfer_time,
  ].map((value) => String(value ?? '')).join('|')));
  const matchingAllandaleTransfers = ALLANDALE_TRANSFERS.filter((row) => (
    transferKeys.has(row.join('|'))
  )).length;

  return {
    fingerprint: fingerprint.digest('hex'),
    feedVersion: feedInfo.feed_version || null,
    feedStartDate: feedInfo.feed_start_date || null,
    feedEndDate: feedInfo.feed_end_date || null,
    textFileCount: textEntries.length,
    hasTransfersFile: textEntries.some((entry) => entry.name === 'transfers.txt'),
    matchingAllandaleTransfers,
    expectedAllandaleTransfers: ALLANDALE_TRANSFERS.length,
  };
}

function stateFromInspection(inspection, response, checkedAt) {
  return {
    ...inspection,
    etag: response.headers.get('etag') || null,
    lastModified: response.headers.get('last-modified') || null,
    checkedAt: checkedAt.toISOString(),
  };
}

async function checkGtfsStaticChange(options) {
  const {
    url,
    stateFile,
    fetchImpl,
    now = new Date(),
  } = options;
  const previous = loadState(stateFile);
  const headers = {};
  if (previous && previous.etag) headers['If-None-Match'] = previous.etag;
  if (previous && previous.lastModified) headers['If-Modified-Since'] = previous.lastModified;

  const response = await fetchImpl(url, { headers, timeout: 30000 });
  if (response.status === 304) {
    return { status: 'unchanged', previous, current: previous };
  }
  if (!response.ok) {
    throw new Error(`GTFS static request failed with HTTP ${response.status}`);
  }

  const inspection = inspectGtfsBuffer(await response.buffer());
  const current = stateFromInspection(inspection, response, now);

  if (!previous || !previous.fingerprint) {
    writeJsonFile(stateFile, current);
    return { status: 'baseline', previous: null, current };
  }

  if (previous.fingerprint === current.fingerprint) {
    writeJsonFile(stateFile, current);
    return { status: 'unchanged', previous, current };
  }

  return { status: 'changed', previous, current };
}

function saveGtfsStaticState(stateFile, state) {
  writeJsonFile(stateFile, state);
}

module.exports = {
  ALLANDALE_TRANSFERS,
  inspectGtfsBuffer,
  checkGtfsStaticChange,
  saveGtfsStaticState,
};
