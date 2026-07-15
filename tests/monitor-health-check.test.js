import { describe, expect, test } from 'vitest';
import healthCheckModule from '../monitor/health-check.js';

const {
  validateEmailConfig,
  getRecentVehicleCount,
  summarizeStatus,
  buildHealthRows,
} = healthCheckModule;

describe('monitor health check helpers', () => {
  test('requires either SMTP or Resend email settings', () => {
    expect(validateEmailConfig({ recipient: 'mike@example.com' })).toContain(
      'SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY/RESEND_FROM_EMAIL'
    );

    expect(validateEmailConfig({
      recipient: 'mike@example.com',
      smtpHost: 'smtp.example.com',
      smtpUser: 'user',
      smtpPass: 'pass',
    })).toEqual([]);
  });

  test('counts only vehicles with recent GPS and route ids', () => {
    const now = new Date('2026-06-23T14:15:00Z');
    const vehicles = [
      { route_id: '1', last_reported: Date.parse('2026-06-23T14:13:00Z') / 1000 },
      { route_id: '2', last_reported: Date.parse('2026-06-23T14:05:00Z') / 1000 },
      { route_id: '', last_reported: Date.parse('2026-06-23T14:14:00Z') / 1000 },
    ];

    expect(getRecentVehicleCount(vehicles, now, 5)).toBe(1);
  });

  test('summarizes a healthy GitHub backup workflow and feed as ok', () => {
    const result = summarizeStatus({
      state: 'active',
      lastRun: { conclusion: 'success' },
    }, {
      feedIssue: null,
    });

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('GitHub manual backup workflow is active');
  });

  test('summarizes a manually disabled GitHub backup workflow as attention', () => {
    const result = summarizeStatus({
      state: 'disabled_manually',
      lastRun: { conclusion: 'success' },
    }, {
      feedIssue: null,
    });

    expect(result.status).toBe('attention');
    expect(result.summary).toContain('disabled_manually');
  });

  test('adds an explanation row for a disabled workflow', () => {
    const rows = buildHealthRows({
      name: 'Bus Monitor',
      workflowFile: 'bus-monitor.yml',
      state: 'disabled_manually',
      updatedAt: '2026-06-23T13:52:16Z',
      lastRun: {
        conclusion: 'success',
        updatedAt: '2026-05-14T19:17:48Z',
        event: 'schedule',
        url: 'https://example.com/run',
      },
    }, null);

    expect(rows).toEqual(expect.arrayContaining([
      ['Workflow state', 'disabled_manually'],
      [
        'Disable reason visible here',
        'GitHub reports this workflow was manually disabled. GitHub does not expose the clicker or note to this job; check the GitHub audit log for that.',
      ],
    ]));
  });
});
