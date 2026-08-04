#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

const REQUIRED_FILES = [
  "agency.txt",
  "routes.txt",
  "stops.txt",
  "stop_times.txt",
  "trips.txt",
];

function usage() {
  console.log(`Usage:
  node audit-static-feed.cjs --feed <zip path-or-url> [options]

Options:
  --baseline <zip path-or-url>          Compare candidate with production
  --station <stop id-or-name>           Show station children and route usage
  --routes <route ids-or-short-names>   Comma-separated route filter
  --expect-transfer <from,to,type,min>  Require a transfer row; repeatable
  --google                              Enforce Google Transit compatibility
  --json                                Emit JSON
  --help                                Show this help`);
}

function parseArgs(argv) {
  const args = {
    expectedTransfers: [],
    google: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value after ${token}`);
      return argv[index];
    };

    switch (token) {
      case "--feed":
        args.feed = next();
        break;
      case "--baseline":
        args.baseline = next();
        break;
      case "--station":
        args.station = next();
        break;
      case "--routes":
        args.routes = new Set(
          next()
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        );
        break;
      case "--expect-transfer": {
        const parts = next().split(",").map((value) => value.trim());
        const [fromStopId, toStopId, transferType, minTransferTime] = parts;
        if (!fromStopId || !toStopId || transferType === undefined) {
          throw new Error(
            "--expect-transfer requires from,to,type and optionally min",
          );
        }
        args.expectedTransfers.push({
          fromStopId,
          toStopId,
          transferType,
          minTransferTime:
            parts.length < 4
              ? undefined
              : minTransferTime,
        });
        break;
      }
      case "--json":
        args.json = true;
        break;
      case "--google":
        args.google = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { "user-agent": "gtfs-expert-audit/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return fs.readFileSync(path.resolve(source));
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseCsv(buffer, filename, errors) {
  try {
    return parse(buffer, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: false,
    });
  } catch (error) {
    errors.push(`${filename} could not be parsed: ${error.message}`);
    return [];
  }
}

function gtfsSeconds(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value || "");
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function sortGtfsTimes(values) {
  return [...values].sort((left, right) => {
    const leftSeconds = gtfsSeconds(left);
    const rightSeconds = gtfsSeconds(right);
    if (leftSeconds === null) return 1;
    if (rightSeconds === null) return -1;
    return leftSeconds - rightSeconds;
  });
}

function getEntryMap(zip, errors) {
  const entries = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const normalized = entry.entryName.replaceAll("\\", "/");
    if (normalized.includes("/")) {
      errors.push(`GTFS file is not at ZIP root: ${normalized}`);
      continue;
    }
    const key = normalized.toLowerCase();
    if (entries.has(key)) errors.push(`Duplicate ZIP entry: ${normalized}`);
    entries.set(key, {
      name: normalized,
      buffer: entry.getData(),
    });
  }
  return entries;
}

function fileHashes(entries) {
  return Object.fromEntries(
    [...entries.entries()]
      .map(([key, entry]) => [key, hash(entry.buffer)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function table(entries, filename, errors) {
  const entry = entries.get(filename.toLowerCase());
  return entry ? parseCsv(entry.buffer, filename, errors) : [];
}

function duplicateValues(rows, field) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = row[field];
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function analyzeFeed(source, buffer, options) {
  const errors = [];
  const warnings = [];
  const zip = new AdmZip(buffer);
  const entries = getEntryMap(zip, errors);

  for (const filename of REQUIRED_FILES) {
    if (!entries.has(filename)) errors.push(`Missing required file: ${filename}`);
  }
  if (!entries.has("calendar.txt") && !entries.has("calendar_dates.txt")) {
    errors.push("Feed needs calendar.txt, calendar_dates.txt, or both");
  }

  const stops = table(entries, "stops.txt", errors);
  const stopTimes = table(entries, "stop_times.txt", errors);
  const trips = table(entries, "trips.txt", errors);
  const routes = table(entries, "routes.txt", errors);
  const transfers = table(entries, "transfers.txt", errors);
  const feedInfo = table(entries, "feed_info.txt", errors);

  for (const duplicate of duplicateValues(stops, "stop_id")) {
    errors.push(`Duplicate stop_id: ${duplicate}`);
  }
  for (const duplicate of duplicateValues(trips, "trip_id")) {
    errors.push(`Duplicate trip_id: ${duplicate}`);
  }
  for (const duplicate of duplicateValues(routes, "route_id")) {
    errors.push(`Duplicate route_id: ${duplicate}`);
  }

  const stopById = new Map(stops.map((row) => [row.stop_id, row]));
  const tripById = new Map(trips.map((row) => [row.trip_id, row]));
  const routeById = new Map(routes.map((row) => [row.route_id, row]));

  for (const stop of stops) {
    const locationType = stop.location_type || "0";
    if (locationType === "1" && stop.parent_station) {
      errors.push(`Station ${stop.stop_id} must not have parent_station`);
    }
    if (["2", "3", "4"].includes(locationType) && !stop.parent_station) {
      errors.push(
        `Stop ${stop.stop_id} with location_type=${locationType} needs parent_station`,
      );
    }
    if (stop.parent_station) {
      const parent = stopById.get(stop.parent_station);
      if (!parent) {
        errors.push(
          `Stop ${stop.stop_id} references missing parent ${stop.parent_station}`,
        );
      } else if (
        locationType === "4" &&
        (parent.location_type || "0") !== "0"
      ) {
        errors.push(
          `Boarding area ${stop.stop_id} parent ${stop.parent_station} is not a platform`,
        );
      } else if (
        locationType !== "4" &&
        (parent.location_type || "0") !== "1"
      ) {
        errors.push(
          `Stop ${stop.stop_id} parent ${stop.parent_station} is not location_type=1`,
        );
      }
    }
  }

  const usedStopIds = new Set();
  for (const stopTime of stopTimes) {
    usedStopIds.add(stopTime.stop_id);
    if (!stopById.has(stopTime.stop_id)) {
      errors.push(
        `stop_times.txt trip ${stopTime.trip_id} references missing stop ${stopTime.stop_id}`,
      );
    }
    if (!tripById.has(stopTime.trip_id)) {
      errors.push(`stop_times.txt references missing trip ${stopTime.trip_id}`);
    }
    const stop = stopById.get(stopTime.stop_id);
    if (stop && (stop.location_type || "0") === "1") {
      warnings.push(
        `stop_times.txt references station ${stopTime.stop_id}; prefer a child platform when known`,
      );
    }
  }

  for (const trip of trips) {
    if (!routeById.has(trip.route_id)) {
      errors.push(`Trip ${trip.trip_id} references missing route ${trip.route_id}`);
    }
  }

  for (const transfer of transfers) {
    const transferType = transfer.transfer_type ?? "";
    const minTransferTime = transfer.min_transfer_time ?? "";
    if (!stopById.has(transfer.from_stop_id)) {
      errors.push(
        `Transfer references missing from_stop_id ${transfer.from_stop_id}`,
      );
    }
    if (!stopById.has(transfer.to_stop_id)) {
      errors.push(`Transfer references missing to_stop_id ${transfer.to_stop_id}`);
    }
    if (!["", "0", "1", "2", "3", "4", "5"].includes(transferType)) {
      errors.push(
        `Transfer ${transfer.from_stop_id}->${transfer.to_stop_id} has invalid type ${transferType}`,
      );
    }
    if (transferType === "2" && minTransferTime === "") {
      errors.push(
        `Type 2 transfer ${transfer.from_stop_id}->${transfer.to_stop_id} needs min_transfer_time`,
      );
    }
    if (
      minTransferTime !== "" &&
      (!/^\d+$/.test(minTransferTime) || Number(minTransferTime) < 0)
    ) {
      errors.push(
        `Transfer ${transfer.from_stop_id}->${transfer.to_stop_id} has invalid min_transfer_time`,
      );
    }
    if (options.google && transferType === "1" && minTransferTime !== "") {
      errors.push(
        `Google Transit requires blank min_transfer_time for timed transfer ${transfer.from_stop_id}->${transfer.to_stop_id}`,
      );
    }
  }

  for (const expected of options.expectedTransfers || []) {
    const match = transfers.find(
      (row) =>
        row.from_stop_id === expected.fromStopId &&
        row.to_stop_id === expected.toStopId &&
        row.transfer_type === expected.transferType &&
        (expected.minTransferTime === undefined ||
          row.min_transfer_time === expected.minTransferTime),
    );
    if (!match) {
      errors.push(
        `Missing expected transfer ${expected.fromStopId}->${expected.toStopId} type=${expected.transferType}` +
          (expected.minTransferTime === undefined
            ? ""
            : ` min=${expected.minTransferTime}`),
      );
    }
  }

  const selectedRouteIds = new Set();
  if (options.routes) {
    for (const route of routes) {
      if (
        options.routes.has(route.route_id) ||
        options.routes.has(route.route_short_name)
      ) {
        selectedRouteIds.add(route.route_id);
      }
    }
    for (const requested of options.routes) {
      const matched = routes.some(
        (route) =>
          route.route_id === requested || route.route_short_name === requested,
      );
      if (!matched) warnings.push(`Requested route not found: ${requested}`);
    }
  }

  let station = null;
  let stationChildren = [];
  let platformUsage = [];
  let stationTransfers = [];

  if (options.station) {
    const query = options.station.toLowerCase();
    const matches = stops.filter(
      (stop) =>
        stop.stop_id.toLowerCase() === query ||
        (stop.stop_name || "").toLowerCase().includes(query),
    );
    station =
      matches.find((stop) => (stop.location_type || "0") === "1") ||
      (() => {
        const child = matches.find((stop) => stop.parent_station);
        return child ? stopById.get(child.parent_station) : null;
      })();

    if (!station) {
      warnings.push(`Station not found: ${options.station}`);
    } else {
      stationChildren = stops.filter(
        (stop) => stop.parent_station === station.stop_id,
      );
      const childIds = new Set(stationChildren.map((stop) => stop.stop_id));
      const usage = new Map();

      for (const stopTime of stopTimes) {
        if (!childIds.has(stopTime.stop_id)) continue;
        const trip = tripById.get(stopTime.trip_id);
        if (!trip) continue;
        if (options.routes && !selectedRouteIds.has(trip.route_id)) {
          continue;
        }
        const route = routeById.get(trip.route_id) || {};
        const key = [
          stopTime.stop_id,
          trip.route_id,
          trip.direction_id || "",
          trip.trip_headsign || "",
        ].join("|");
        if (!usage.has(key)) {
          usage.set(key, {
            stop_id: stopTime.stop_id,
            platform_code: stopById.get(stopTime.stop_id)?.platform_code || "",
            route_id: trip.route_id,
            route_short_name: route.route_short_name || "",
            direction_id: trip.direction_id || "",
            trip_headsign: trip.trip_headsign || "",
            calls: 0,
            times: [],
          });
        }
        const item = usage.get(key);
        item.calls += 1;
        if (stopTime.arrival_time) item.times.push(stopTime.arrival_time);
      }

      platformUsage = [...usage.values()]
        .map((item) => {
          const times = sortGtfsTimes(item.times);
          const { times: ignored, ...rest } = item;
          return {
            ...rest,
            first_arrival: times[0] || "",
            last_arrival: times.at(-1) || "",
          };
        })
        .sort(
          (left, right) =>
            left.stop_id.localeCompare(right.stop_id) ||
            left.route_id.localeCompare(right.route_id) ||
            left.direction_id.localeCompare(right.direction_id),
        );

      stationTransfers = transfers.filter(
        (row) =>
          childIds.has(row.from_stop_id) ||
          childIds.has(row.to_stop_id) ||
          row.from_stop_id === station.stop_id ||
          row.to_stop_id === station.stop_id,
      );
    }
  }

  return {
    source,
    sha256: hash(buffer),
    files: [...entries.values()].map((entry) => entry.name).sort(),
    fileHashes: fileHashes(entries),
    feedInfo: feedInfo[0] || null,
    counts: {
      routes: routes.length,
      stops: stops.length,
      trips: trips.length,
      stopTimes: stopTimes.length,
      transfers: transfers.length,
      usedStops: usedStopIds.size,
    },
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    station: station
      ? {
          stop_id: station.stop_id,
          stop_name: station.stop_name,
          location_type: station.location_type || "0",
        }
      : null,
    stationChildren: stationChildren.map((stop) => ({
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      location_type: stop.location_type || "0",
      platform_code: stop.platform_code || "",
    })),
    platformUsage,
    stationTransfers,
  };
}

function compareFeeds(baseline, candidate) {
  const names = new Set([
    ...Object.keys(baseline.fileHashes),
    ...Object.keys(candidate.fileHashes),
  ]);
  return [...names]
    .sort()
    .map((filename) => {
      const baselineHash = baseline.fileHashes[filename];
      const candidateHash = candidate.fileHashes[filename];
      let status = "unchanged";
      if (!baselineHash) status = "added";
      else if (!candidateHash) status = "removed";
      else if (baselineHash !== candidateHash) status = "modified";
      return { filename, status };
    });
}

function printText(result) {
  console.log(`GTFS audit: ${result.source}`);
  console.log(`SHA-256: ${result.sha256}`);
  console.log(
    `Counts: ${result.counts.routes} routes, ${result.counts.stops} stops, ` +
      `${result.counts.trips} trips, ${result.counts.stopTimes} stop times, ` +
      `${result.counts.transfers} transfers`,
  );

  if (result.feedInfo) {
    console.log(
      `Feed: version=${result.feedInfo.feed_version || "(blank)"} ` +
        `start=${result.feedInfo.feed_start_date || "(blank)"} ` +
        `end=${result.feedInfo.feed_end_date || "(blank)"}`,
    );
  }

  if (result.comparison) {
    console.log("\nFile comparison:");
    for (const item of result.comparison) {
      console.log(`  ${item.status.padEnd(9)} ${item.filename}`);
    }
  }

  if (result.station) {
    console.log(`\nStation: ${result.station.stop_name} (${result.station.stop_id})`);
    for (const child of result.stationChildren) {
      console.log(
        `  platform ${child.stop_id} code=${child.platform_code || "(blank)"} ` +
          `name=${child.stop_name}`,
      );
    }
    if (result.platformUsage.length) {
      console.log("Route/platform usage:");
      for (const item of result.platformUsage) {
        console.log(
          `  stop=${item.stop_id} route=${item.route_short_name || item.route_id} ` +
            `direction=${item.direction_id || "(blank)"} calls=${item.calls} ` +
            `${item.first_arrival}-${item.last_arrival} ${item.trip_headsign}`,
        );
      }
    }
    console.log(`Station transfer rows: ${result.stationTransfers.length}`);
  }

  console.log(`\nErrors (${result.errors.length}):`);
  for (const error of result.errors) console.log(`  - ${error}`);
  console.log(`Warnings (${result.warnings.length}):`);
  for (const warning of result.warnings) console.log(`  - ${warning}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.feed) {
    usage();
    process.exitCode = 2;
    return;
  }

  const candidateBuffer = await readSource(args.feed);
  const result = analyzeFeed(args.feed, candidateBuffer, args);

  if (args.baseline) {
    const baselineBuffer = await readSource(args.baseline);
    const baseline = analyzeFeed(args.baseline, baselineBuffer, {
      expectedTransfers: [],
    });
    result.baseline = {
      source: baseline.source,
      sha256: baseline.sha256,
      feedInfo: baseline.feedInfo,
      counts: baseline.counts,
      errors: baseline.errors,
      warnings: baseline.warnings,
    };
    result.comparison = compareFeeds(baseline, result);
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printText(result);

  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`GTFS audit failed: ${error.message}`);
  process.exitCode = 2;
});
