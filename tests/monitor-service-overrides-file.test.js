import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const overrideFile = path.join(process.cwd(), 'monitor', 'service-overrides.json');

describe('monitor service override calendar file', () => {
  test('includes a JSON-safe maintenance checklist', () => {
    const raw = JSON.parse(fs.readFileSync(overrideFile, 'utf8'));

    expect(raw._maintenance).toEqual(expect.objectContaining({
      checklist: expect.arrayContaining([
        expect.stringContaining('next year'),
        expect.stringContaining('run npm test'),
      ]),
    }));
  });

  test('contains the approved 2026 holiday service entries', () => {
    const raw = JSON.parse(fs.readFileSync(overrideFile, 'utf8'));

    expect(raw).toEqual(expect.objectContaining({
      '2026-01-01': expect.objectContaining({ mode: 'no_service' }),
      '2026-02-16': expect.objectContaining({ mode: 'sunday' }),
      '2026-04-03': expect.objectContaining({ mode: 'no_service' }),
      '2026-04-05': expect.objectContaining({ mode: 'no_service' }),
      '2026-05-18': expect.objectContaining({ mode: 'no_service' }),
      '2026-07-01': expect.objectContaining({ mode: 'sunday' }),
      '2026-08-03': expect.objectContaining({ mode: 'sunday' }),
      '2026-09-07': expect.objectContaining({ mode: 'sunday' }),
      '2026-10-12': expect.objectContaining({ mode: 'no_service' }),
      '2026-12-25': expect.objectContaining({ mode: 'no_service' }),
      '2026-12-26': expect.objectContaining({ mode: 'sunday' }),
    }));
  });
});
