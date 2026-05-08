import { afterEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import scheduleModule from '../monitor/schedule.js';

const { loadGtfsZip } = scheduleModule;

const tempDirs = [];
const servers = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-monitor-gtfs-cache-'));
  tempDirs.push(dir);
  return dir;
}

function makeGtfsZipBuffer(marker = 'valid') {
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from(`agency_id,agency_name\n${marker},Barrie Transit\n`));
  return zip.toBuffer();
}

function corruptFirstLocalHeader(buffer) {
  const zip = new AdmZip(buffer);
  const [entry] = zip.getEntries();
  const corrupted = Buffer.from(buffer);
  corrupted[entry.header.offset] = 0x00;
  return corrupted;
}

function makeCacheStale(filePath) {
  const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(filePath, staleDate, staleDate);
}

async function startServer(body, headers = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      ...headers,
    });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}/google_transit.zip`;
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    await new Promise((resolve) => server.close(resolve));
  }

  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('monitor GTFS ZIP cache', () => {
  test('keeps a valid stale cache when the replacement download is not a readable ZIP', async () => {
    const cacheDir = makeTempDir();
    const cacheFile = path.join(cacheDir, 'google_transit.zip');
    const validCache = makeGtfsZipBuffer('stale-cache');
    fs.writeFileSync(cacheFile, validCache);
    makeCacheStale(cacheFile);

    const url = await startServer(Buffer.from('this is not a zip file'));

    const zip = await loadGtfsZip(url, cacheDir, 1);

    expect(zip.getEntry('agency.txt')).toBeTruthy();
    expect(fs.readFileSync(cacheFile)).toEqual(validCache);
  });

  test('keeps a valid stale cache when the replacement ZIP has an unreadable entry', async () => {
    const cacheDir = makeTempDir();
    const cacheFile = path.join(cacheDir, 'google_transit.zip');
    const validCache = makeGtfsZipBuffer('stale-cache');
    fs.writeFileSync(cacheFile, validCache);
    makeCacheStale(cacheFile);

    const url = await startServer(corruptFirstLocalHeader(makeGtfsZipBuffer('corrupt-download')));

    const zip = await loadGtfsZip(url, cacheDir, 1);

    expect(zip.readAsText('agency.txt')).toContain('stale-cache');
    expect(fs.readFileSync(cacheFile)).toEqual(validCache);
  });

  test('discards a fresh cache ZIP with an unreadable entry and downloads a valid replacement', async () => {
    const cacheDir = makeTempDir();
    const cacheFile = path.join(cacheDir, 'google_transit.zip');
    fs.writeFileSync(cacheFile, corruptFirstLocalHeader(makeGtfsZipBuffer('corrupt-cache')));

    const validDownload = makeGtfsZipBuffer('fresh-download');
    const url = await startServer(validDownload);

    const zip = await loadGtfsZip(url, cacheDir, 24);

    expect(zip.readAsText('agency.txt')).toContain('fresh-download');
    expect(fs.readFileSync(cacheFile)).toEqual(validDownload);
  });
});
