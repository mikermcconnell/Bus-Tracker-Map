#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

const PARENT_STATION = {
  stop_id: "Barrie Allandale Transit Terminal",
  stop_code: "Barrie Allandale Transit Terminal",
  stop_name: "Barrie Allandale Transit Terminal",
  stop_desc: "",
  stop_lat: "44.374029",
  stop_lon: "-79.690216",
  location_type: "1",
  parent_station: "",
  platform_code: "",
  wheelchair_boarding: "",
};

const PLATFORM_CODES = new Map([
  ["9003", "3"],
  ["9004", "4"],
  ["9005", "5"],
  ["9006", "6"],
  ["9012", "12"],
  ["9013", "13"],
]);

const TIMED_TRANSFERS = [
  ["9003", "9004", "1", ""],
  ["9004", "9003", "1", ""],
  ["9005", "9012", "1", ""],
  ["9012", "9005", "1", ""],
];

function usage() {
  console.log(`Usage:
  node patch-allandale-google-feed.cjs --input <raw MVT ZIP> --output <Google ZIP> [options]

Options:
  --force   Replace an existing output file
  --json    Emit JSON
  --help    Show this help`);
}

function parseArgs(argv) {
  const args = { force: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value after ${token}`);
      return argv[index];
    };
    switch (token) {
      case "--input":
        args.input = next();
        break;
      case "--output":
        args.output = next();
        break;
      case "--force":
        args.force = true;
        break;
      case "--json":
        args.json = true;
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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function findRootEntry(zip, filename, required = true) {
  const matches = zip.getEntries().filter(
    (entry) =>
      !entry.isDirectory &&
      !entry.entryName.replaceAll("\\", "/").includes("/") &&
      entry.entryName.toLowerCase() === filename.toLowerCase(),
  );
  if (matches.length > 1) throw new Error(`Duplicate ZIP entry: ${filename}`);
  if (!matches.length && required) throw new Error(`Missing ${filename}`);
  return matches[0] || null;
}

function readTable(zip, filename, required = true) {
  const entry = findRootEntry(zip, filename, required);
  if (!entry) return { entry: null, headers: [], rows: [] };
  const buffer = entry.getData();
  const headerRows = parse(buffer, {
    bom: true,
    to_line: 1,
    relax_column_count: true,
  });
  const headers = headerRows[0] || [];
  const rows = parse(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false,
  });
  return { entry, headers, rows };
}

function insertHeader(headers, field, beforeField) {
  if (headers.includes(field)) return;
  const beforeIndex = headers.indexOf(beforeField);
  if (beforeIndex === -1) headers.push(field);
  else headers.splice(beforeIndex, 0, field);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeCsv(headers, rows) {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((field) => csvCell(row[field])).join(",")),
  ];
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8");
}

function patchStops(stopsTable) {
  const headers = [...stopsTable.headers];
  insertHeader(headers, "parent_station", "wheelchair_boarding");
  insertHeader(headers, "platform_code", "wheelchair_boarding");

  const rows = stopsTable.rows.map((row) => ({ ...row }));
  const byId = new Map(rows.map((row) => [row.stop_id, row]));
  for (const [stopId, platformCode] of PLATFORM_CODES) {
    const stop = byId.get(stopId);
    if (!stop) throw new Error(`Allandale platform ${stopId} is missing`);
    stop.location_type = "0";
    stop.parent_station = PARENT_STATION.stop_id;
    stop.platform_code = platformCode;
  }

  let parent = byId.get(PARENT_STATION.stop_id);
  if (!parent) {
    parent = Object.fromEntries(headers.map((field) => [field, ""]));
    rows.push(parent);
  }
  Object.assign(parent, PARENT_STATION);

  return { headers, rows };
}

function patchTransfers(transfersTable) {
  const headers = transfersTable.headers.length
    ? [...transfersTable.headers]
    : ["from_stop_id", "to_stop_id", "transfer_type", "min_transfer_time"];
  for (const field of [
    "from_stop_id",
    "to_stop_id",
    "transfer_type",
    "min_transfer_time",
  ]) {
    if (!headers.includes(field)) headers.push(field);
  }

  const approvedPairs = new Set(
    TIMED_TRANSFERS.map(([fromStopId, toStopId]) => `${fromStopId}|${toStopId}`),
  );
  const rows = transfersTable.rows
    .filter(
      (row) => !approvedPairs.has(`${row.from_stop_id}|${row.to_stop_id}`),
    )
    .map((row) => ({ ...row }));

  for (const [fromStopId, toStopId, transferType, minTransferTime] of TIMED_TRANSFERS) {
    const row = Object.fromEntries(headers.map((field) => [field, ""]));
    Object.assign(row, {
      from_stop_id: fromStopId,
      to_stop_id: toStopId,
      transfer_type: transferType,
      min_transfer_time: minTransferTime,
    });
    rows.push(row);
  }
  return { headers, rows };
}

function platformUsage(zip) {
  const trips = readTable(zip, "trips.txt").rows;
  const stopTimes = readTable(zip, "stop_times.txt").rows;
  const tripById = new Map(trips.map((row) => [row.trip_id, row]));
  const usage = {};

  for (const stopId of PLATFORM_CODES.keys()) {
    const routes = new Map();
    for (const stopTime of stopTimes) {
      if (stopTime.stop_id !== stopId) continue;
      const trip = tripById.get(stopTime.trip_id);
      if (!trip) continue;
      routes.set(trip.route_id, (routes.get(trip.route_id) || 0) + 1);
    }
    if (!routes.size) throw new Error(`Allandale platform ${stopId} has no stop_times`);
    usage[stopId] = [...routes]
      .map(([route_id, stop_time_rows]) => ({ route_id, stop_time_rows }))
      .sort((left, right) => left.route_id.localeCompare(right.route_id));
  }
  return usage;
}

function verifyDerivedZip(buffer) {
  const zip = new AdmZip(buffer);
  const stops = readTable(zip, "stops.txt").rows;
  const transfers = readTable(zip, "transfers.txt").rows;
  const stopById = new Map(stops.map((row) => [row.stop_id, row]));
  const parent = stopById.get(PARENT_STATION.stop_id);
  if (!parent || parent.location_type !== "1" || parent.parent_station) {
    throw new Error("Derived ZIP has an invalid Allandale parent station");
  }
  for (const [stopId, platformCode] of PLATFORM_CODES) {
    const stop = stopById.get(stopId);
    if (
      !stop ||
      stop.parent_station !== PARENT_STATION.stop_id ||
      stop.platform_code !== platformCode
    ) {
      throw new Error(`Derived ZIP has invalid hierarchy for platform ${stopId}`);
    }
  }
  for (const [fromStopId, toStopId] of TIMED_TRANSFERS) {
    const matches = transfers.filter(
      (row) =>
        row.from_stop_id === fromStopId &&
        row.to_stop_id === toStopId &&
        row.transfer_type === "1" &&
        (row.min_transfer_time || "") === "",
    );
    if (matches.length !== 1) {
      throw new Error(
        `Derived ZIP needs exactly one timed transfer ${fromStopId}->${toStopId}`,
      );
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.input || !args.output) {
    usage();
    process.exitCode = 2;
    return;
  }

  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  if (inputPath === outputPath) {
    throw new Error("Input and output must differ so the raw MVT export is preserved");
  }
  if (!fs.existsSync(inputPath)) throw new Error(`Input does not exist: ${inputPath}`);
  if (fs.existsSync(outputPath) && !args.force) {
    throw new Error(`Output already exists; use --force to replace it: ${outputPath}`);
  }

  const inputBuffer = fs.readFileSync(inputPath);
  const zip = new AdmZip(inputBuffer);
  const usageSummary = platformUsage(zip);
  const stopsTable = readTable(zip, "stops.txt");
  const transfersTable = readTable(zip, "transfers.txt", false);
  const feedInfo = readTable(zip, "feed_info.txt", false).rows[0] || {};

  const patchedStops = patchStops(stopsTable);
  const patchedTransfers = patchTransfers(transfersTable);
  zip.updateFile(
    stopsTable.entry.entryName,
    serializeCsv(patchedStops.headers, patchedStops.rows),
  );
  const transferBuffer = serializeCsv(
    patchedTransfers.headers,
    patchedTransfers.rows,
  );
  if (transfersTable.entry) {
    zip.updateFile(transfersTable.entry.entryName, transferBuffer);
  } else {
    zip.addFile("transfers.txt", transferBuffer);
  }

  const outputBuffer = zip.toBuffer();
  verifyDerivedZip(outputBuffer);

  const outputDirectory = path.dirname(outputPath);
  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }
  const tempPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, outputBuffer, { flag: "wx" });
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  fs.renameSync(tempPath, outputPath);

  const result = {
    input: inputPath,
    input_sha256: sha256(inputBuffer),
    output: outputPath,
    output_sha256: sha256(outputBuffer),
    feed_version: feedInfo.feed_version || null,
    feed_start_date: feedInfo.feed_start_date || null,
    feed_end_date: feedInfo.feed_end_date || null,
    parent_station: PARENT_STATION.stop_id,
    platform_usage: usageSummary,
    timed_transfers: TIMED_TRANSFERS.map(
      ([from_stop_id, to_stop_id, transfer_type, min_transfer_time]) => ({
        from_stop_id,
        to_stop_id,
        transfer_type,
        min_transfer_time,
      }),
    ),
  };

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Created ${outputPath}`);
    console.log(`SHA-256: ${result.output_sha256}`);
    console.log(`Feed version: ${result.feed_version || "(blank)"}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Allandale patch failed: ${error.message}`);
  process.exitCode = 1;
}
