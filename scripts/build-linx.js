#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { buildServiceCalendarMetadata } = require('../shared/gtfs-service-calendar');
require('dotenv').config();

const DEFAULT_STATIC_URL = 'https://metrolinx.tmix.se/gtfs/gtfs-simcoe.zip';
const ALLANDALE_STOP_ID = 'SCSTOP210';
const LINX_ROUTE_ID = '2';

function readCsv(zip, name, options = {}) {
  const entry = zip.getEntry(name);
  if (!entry) {
    if (options.optional) return [];
    throw new Error(`${name} missing in Simcoe LINX GTFS zip`);
  }
  return parse(zip.readAsText(entry), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
}

function normalizeHexColor(value, fallback) {
  const cleaned = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(cleaned)
    ? `#${cleaned.toUpperCase()}`
    : fallback;
}

function buildArtifactsFromZip(zipBuffer, sourceUrl = DEFAULT_STATIC_URL) {
  const zip = new AdmZip(zipBuffer);
  const agencies = readCsv(zip, 'agency.txt');
  const routes = readCsv(zip, 'routes.txt');
  const stops = readCsv(zip, 'stops.txt');
  const stopTimes = readCsv(zip, 'stop_times.txt');
  const trips = readCsv(zip, 'trips.txt');
  const feedInfo = readCsv(zip, 'feed_info.txt', { optional: true })[0] || {};
  const serviceCalendarMetadata = buildServiceCalendarMetadata(
    readCsv(zip, 'calendar.txt', { optional: true }),
    readCsv(zip, 'calendar_dates.txt', { optional: true })
  );

  const allandaleStop = stops.find((stop) => String(stop.stop_id) === ALLANDALE_STOP_ID);
  if (!allandaleStop || !/Barrie Allandale/i.test(String(allandaleStop.stop_name || ''))) {
    throw new Error(`Simcoe LINX GTFS is missing verified Allandale stop ${ALLANDALE_STOP_ID}`);
  }

  const route = routes.find((entry) => String(entry.route_id) === LINX_ROUTE_ID);
  if (!route || !/Barrie.*Wasaga|Wasaga.*Barrie/i.test(String(route.route_long_name || ''))) {
    throw new Error('Simcoe LINX GTFS is missing verified Barrie-Wasaga Beach route 2');
  }

  const lastStopSequenceByTrip = {};
  const terminalStopsByTrip = {};
  stopTimes.forEach((stopTime) => {
    const tripId = String(stopTime.trip_id || '');
    const stopSequence = Number(stopTime.stop_sequence);
    if (!tripId || !Number.isFinite(stopSequence)) return;
    lastStopSequenceByTrip[tripId] = Math.max(lastStopSequenceByTrip[tripId] || 0, stopSequence);
  });
  stopTimes.forEach((stopTime) => {
    const tripId = String(stopTime.trip_id || '');
    const stopSequence = Number(stopTime.stop_sequence);
    if (
      String(stopTime.stop_id || '') !== ALLANDALE_STOP_ID ||
      !tripId ||
      !Number.isFinite(stopSequence)
    ) return;
    if (!terminalStopsByTrip[tripId]) terminalStopsByTrip[tripId] = [];
    terminalStopsByTrip[tripId].push({
      stop_id: ALLANDALE_STOP_ID,
      stop_sequence: stopSequence,
      arrival_time: stopTime.arrival_time || null,
      departure_time: stopTime.departure_time || stopTime.arrival_time || null,
      is_departure: stopSequence < Number(lastStopSequenceByTrip[tripId] || stopSequence),
    });
  });

  const relevantTrips = trips.filter((trip) => (
    String(trip.route_id) === LINX_ROUTE_ID && terminalStopsByTrip[String(trip.trip_id)]
  ));
  if (!relevantTrips.some((trip) => (
    terminalStopsByTrip[String(trip.trip_id)].some((stop) => stop.is_departure)
  ))) {
    throw new Error('Simcoe LINX GTFS has no route 2 departures from Allandale');
  }

  const primaryAgency = agencies[0] || {};
  const agency = {
    id: 'simcoe-linx',
    source_id: primaryAgency.agency_id || 'LINX',
    name: primaryAgency.agency_name || 'Simcoe County LINX',
    url: primaryAgency.agency_url || 'https://simcoe.ca/dpt/linx',
    color: '#006747',
    text_color: '#FFFFFF',
  };
  const tripMetadata = {};
  relevantTrips.forEach((trip) => {
    const tripId = String(trip.trip_id);
    tripMetadata[tripId] = {
      route_id: LINX_ROUTE_ID,
      service_id: String(trip.service_id || ''),
      headsign: trip.trip_headsign || null,
      terminal_stops: terminalStopsByTrip[tripId]
        .sort((a, b) => a.stop_sequence - b.stop_sequence),
    };
  });

  return {
    generated_at: new Date().toISOString(),
    source_url: sourceUrl,
    source_sha256: crypto.createHash('sha256').update(zipBuffer).digest('hex'),
    feed_version: feedInfo.feed_version || null,
    feed_start_date: feedInfo.feed_start_date || null,
    feed_end_date: feedInfo.feed_end_date || null,
    agency,
    terminal_stop_ids: [ALLANDALE_STOP_ID],
    terminal_stops: [{
      id: ALLANDALE_STOP_ID,
      name: allandaleStop.stop_name || 'Barrie Allandale Bus Station',
      platform_code: '2',
    }],
    routes: {
      [LINX_ROUTE_ID]: {
        id: LINX_ROUTE_ID,
        short_name: route.route_short_name || LINX_ROUTE_ID,
        long_name: route.route_long_name || 'Barrie-Wasaga Beach',
        color: normalizeHexColor(route.route_color, agency.color),
        text_color: normalizeHexColor(route.route_text_color, agency.text_color),
      },
    },
    ...serviceCalendarMetadata,
    trips: tripMetadata,
  };
}

async function buildLinxArtifacts(options = {}) {
  const outDir = path.resolve(options.cacheDir || process.env.CACHE_DIR || path.join(__dirname, '..', 'cache'));
  const staticUrl = options.staticUrl || process.env.LINX_GTFS_STATIC_URL || DEFAULT_STATIC_URL;
  const metadataPath = path.join(outDir, 'linx.json');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Downloading Simcoe LINX GTFS zip:', staticUrl);
  const response = await fetch(staticUrl, { timeout: 30_000 });
  if (!response.ok) throw new Error(`Simcoe LINX GTFS download failed: ${response.status}`);
  const zipBuffer = await response.buffer();
  const metadata = buildArtifactsFromZip(zipBuffer, staticUrl);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  console.log('Wrote Simcoe LINX Allandale data with', Object.keys(metadata.trips).length, 'route 2 trips');
  return metadata;
}

if (require.main === module) {
  buildLinxArtifacts().catch((err) => {
    console.error('Simcoe LINX build failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  ALLANDALE_STOP_ID,
  DEFAULT_STATIC_URL,
  LINX_ROUTE_ID,
  buildArtifactsFromZip,
  buildLinxArtifacts,
};
