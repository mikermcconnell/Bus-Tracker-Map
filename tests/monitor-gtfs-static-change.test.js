import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { describe, expect, test } from 'vitest';
import changeModule from '../monitor/gtfs-static-change.js';

const {
  inspectGtfsBuffer,
  checkGtfsStaticChange,
  saveGtfsStaticState,
} = changeModule;

function buildZip(feedVersion, options = {}) {
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from('agency_id,agency_name,agency_url,agency_timezone\nBT,Barrie Transit,https://example.test,America/Toronto\n'));
  zip.addFile('feed_info.txt', Buffer.from(
    `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nBarrie Transit,https://example.test,en,20260701,20261231,${feedVersion}\n`
  ));
  if (options.transfers) {
    zip.addFile('transfers.txt', Buffer.from([
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time',
      '9003,9004,1,',
      '9004,9003,1,',
      '9005,9012,1,',
      '9012,9005,1,',
      '',
    ].join('\n')));
  }
  return zip.toBuffer();
}

function response(buffer, headers = {}) {
  return {
    ok: true,
    status: 200,
    buffer: async () => buffer,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
  };
}

describe('GTFS static change monitor', () => {
  test('inspects feed version and expected Allandale transfers', () => {
    const result = inspectGtfsBuffer(buildZip('20260730', { transfers: true }));
    expect(result.feedVersion).toBe('20260730');
    expect(result.hasTransfersFile).toBe(true);
    expect(result.matchingAllandaleTransfers).toBe(4);
  });

  test('records a baseline without reporting a change', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtfs-change-'));
    const stateFile = path.join(dir, 'state.json');
    const result = await checkGtfsStaticChange({
      url: 'https://example.test/gtfs.zip',
      stateFile,
      fetchImpl: async () => response(buildZip('v1'), { etag: '"v1"' }),
    });
    expect(result.status).toBe('baseline');
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).feedVersion).toBe('v1');
  });

  test('reports one meaningful content change and waits to persist it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtfs-change-'));
    const stateFile = path.join(dir, 'state.json');
    await checkGtfsStaticChange({
      url: 'https://example.test/gtfs.zip',
      stateFile,
      fetchImpl: async () => response(buildZip('v1'), { etag: '"v1"' }),
    });
    const result = await checkGtfsStaticChange({
      url: 'https://example.test/gtfs.zip',
      stateFile,
      fetchImpl: async () => response(buildZip('v2'), { etag: '"v2"' }),
    });
    expect(result.status).toBe('changed');
    expect(result.previous.feedVersion).toBe('v1');
    expect(result.current.feedVersion).toBe('v2');
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).feedVersion).toBe('v1');

    saveGtfsStaticState(stateFile, result.current);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).feedVersion).toBe('v2');
  });

  test('ignores ZIP metadata changes when GTFS file contents are identical', () => {
    const first = buildZip('v1');
    const secondZip = new AdmZip(first);
    secondZip.getEntry('agency.txt').header.time = new Date('2030-01-01T00:00:00Z');
    const second = secondZip.toBuffer();
    expect(inspectGtfsBuffer(first).fingerprint).toBe(inspectGtfsBuffer(second).fingerprint);
  });
});
