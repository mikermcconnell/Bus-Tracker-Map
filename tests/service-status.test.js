import { describe, expect, test } from 'vitest';
import serviceStatusModule from '../server/service-status.js';

const { buildServiceStatus, normalizeRawOverrides } = serviceStatusModule;

describe('service status helpers', () => {
  test('identifies a no-service holiday', () => {
    const status = buildServiceStatus({
      date: '2026-12-25',
    });

    expect(status).toEqual(expect.objectContaining({
      date: '2026-12-25',
      is_special_service: true,
      headline: 'No service',
    }));
    expect(status.today).toEqual(expect.objectContaining({
      label: 'Christmas Day',
      mode: 'no_service',
      service_label: 'No service',
      display_label: 'Christmas Day Service: No Service',
    }));
    expect(status.message).toBe('Christmas Day Service: No Service');
  });

  test('identifies sunday-style holiday service', () => {
    const status = buildServiceStatus({
      date: '2026-07-01',
    });

    expect(status.is_special_service).toBe(true);
    expect(status.today).toEqual(expect.objectContaining({
      label: 'Canada Day',
      mode: 'service_day',
      service_day: 'sunday',
      service_label: 'Sunday service',
      display_label: 'Canada Day Service: Sunday Schedules',
    }));
    expect(status.message).toBe('Canada Day Service: Sunday Schedules');
  });

  test('returns regular service when no override applies', () => {
    const status = buildServiceStatus({
      date: '2026-05-19',
    });

    expect(status).toEqual(expect.objectContaining({
      date: '2026-05-19',
      is_special_service: false,
      headline: 'Regular service today',
      today: null,
    }));
    expect(status.upcoming).toEqual(expect.objectContaining({
      date: '2026-07-01',
      label: 'Canada Day',
    }));
    expect(status.upcoming_warning).toBeNull();
  });

  test('starts warning one week before a holiday service day', () => {
    const status = buildServiceStatus({
      date: '2026-06-24',
    });

    expect(status.is_special_service).toBe(false);
    expect(status.upcoming_warning).toEqual(expect.objectContaining({
      date: '2026-07-01',
      label: 'Canada Day',
      days_until: 7,
      display_label: 'Canada Day Service: Sunday Schedules',
      display_date: 'Wednesday, July 1',
      message: 'Upcoming Holiday Service: Canada Day Service: Sunday Schedules on Wednesday, July 1.',
    }));
  });

  test('does not show an advance warning more than one week before', () => {
    const status = buildServiceStatus({
      date: '2026-06-23',
    });

    expect(status.upcoming_warning).toBeNull();
  });

  test('normalizes override labels for UI display', () => {
    const entries = normalizeRawOverrides({
      '2026-02-16': { label: 'Family Day', mode: 'sunday' },
    });

    expect(entries).toEqual([
      expect.objectContaining({
        date: '2026-02-16',
        label: 'Family Day',
        service_label: 'Sunday service',
        display_label: 'Family Day Service: Sunday Schedules',
      }),
    ]);
  });
});
