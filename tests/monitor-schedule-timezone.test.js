import { describe, expect, test } from 'vitest';
import scheduleModule from '../monitor/schedule.js';

const { getNowContext } = scheduleModule;

describe('monitor schedule timezone context', () => {
  test('derives seconds-since-midnight for Toronto time', () => {
    const now = new Date('2026-02-13T18:30:08Z'); // 13:30:08 in Toronto (EST)
    const ctx = getNowContext(now, 'America/Toronto');

    expect(ctx.nowSecs).toBe(13 * 3600 + 30 * 60 + 8);
    expect(ctx.today.getFullYear()).toBe(2026);
    expect(ctx.today.getMonth()).toBe(1);
    expect(ctx.today.getDate()).toBe(13);
  });

  test('changes service day when timezone crosses midnight', () => {
    const now = new Date('2026-02-13T01:15:00Z'); // 20:15:00 previous day in Toronto
    const toronto = getNowContext(now, 'America/Toronto');
    const utc = getNowContext(now, 'UTC');

    expect(toronto.today.getDate()).toBe(12);
    expect(toronto.nowSecs).toBe(20 * 3600 + 15 * 60);

    expect(utc.today.getDate()).toBe(13);
    expect(utc.nowSecs).toBe(1 * 3600 + 15 * 60);
  });
});
