import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';
import volumeModule from '../monitor/email-volume.js';

const {
  loadEmailVolumeState,
  recordEmailDelivery,
  markEmailVolumeAlertSent,
} = volumeModule;

function makeStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-email-volume-'));
  return path.join(dir, 'state.json');
}

describe('email volume guard', () => {
  test('alerts on the fourth operational email inside 60 minutes', () => {
    const stateFile = makeStateFile();
    const base = Date.parse('2026-08-04T14:00:00Z');
    let result;
    for (let index = 0; index < 4; index += 1) {
      result = recordEmailDelivery(stateFile, {
        sentAt: new Date(base + (index * 10 * 60 * 1000)),
        category: 'operational_alert',
        subject: `Alert ${index + 1}`,
      }, { threshold: 4, windowMinutes: 60, cooldownMinutes: 180 });
    }

    expect(result).toEqual(expect.objectContaining({
      shouldAlert: true,
      count: 4,
      threshold: 4,
    }));
  });

  test('does not count daily check-ins, tests, or the volume warning itself', () => {
    const stateFile = makeStateFile();
    for (const category of ['health_check', 'test', 'email_volume']) {
      recordEmailDelivery(stateFile, {
        sentAt: new Date('2026-08-04T14:00:00Z'),
        category,
        subject: category,
      });
    }

    expect(loadEmailVolumeState(stateFile).deliveries).toEqual([]);
  });

  test('suppresses another volume warning during cooldown', () => {
    const stateFile = makeStateFile();
    const base = Date.parse('2026-08-04T14:00:00Z');
    for (let index = 0; index < 4; index += 1) {
      recordEmailDelivery(stateFile, {
        sentAt: new Date(base + (index * 5 * 60 * 1000)),
        category: 'operational_alert',
        subject: `Alert ${index + 1}`,
      });
    }
    markEmailVolumeAlertSent(stateFile, new Date(base + (15 * 60 * 1000)));

    const result = recordEmailDelivery(stateFile, {
      sentAt: new Date(base + (20 * 60 * 1000)),
      category: 'gtfs_integrity',
      subject: 'GTFS alert',
    });

    expect(result.shouldAlert).toBe(false);
    expect(result.count).toBe(5);
  });
});
