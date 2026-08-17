import { describe, expect, test } from 'vitest';
import platformDeparturesModule from '../server/platform-departures.js';

const { buildPlatformDeparturePayload, parsePlatformStopCode } = platformDeparturesModule;

describe('per-platform departure sign payload', () => {
  test('maps terminal stop codes to platform numbers', () => {
    expect(parsePlatformStopCode('9002')).toEqual({
      stop_code: '9002',
      platform: '2',
      platform_display: '02',
    });
    expect(parsePlatformStopCode('9014').platform).toBe('14');
    expect(parsePlatformStopCode('9000')).toBeNull();
    expect(parsePlatformStopCode('9999')).toBeNull();
  });

  test('filters the terminal-wide payload to the requested platform', () => {
    const payload = buildPlatformDeparturePayload({
      stopCode: '9014',
      terminalPayload: {
        generated_at: 1_000_000,
        departures: [
          {
            agency_id: 'barrie-transit',
            agency_name: 'Barrie Transit',
            route_id: '12B',
            route_label: '12B',
            destination: 'Barrie South GO',
            platform: '14',
            expected_departure_time: 1_200,
            scheduled_departure_time: 1_180,
            departure_source: 'realtime',
          },
          {
            agency_id: 'simcoe-linx',
            route_id: '2',
            route_label: '2',
            destination: 'Wasaga Beach',
            platform: '2',
            expected_departure_time: 1_100,
            scheduled_departure_time: 1_100,
            departure_source: 'scheduled',
          },
        ],
      },
    });

    expect(payload).toMatchObject({
      stop_code: '9014',
      platform: '14',
      platform_display: '14',
      status: 'ok',
    });
    expect(payload.departures).toHaveLength(1);
    expect(payload.departures[0]).toMatchObject({
      route_label: '12B',
      destination: 'Barrie South GO',
      departure_time: 1_200,
      departure_source: 'realtime',
    });
  });

  test('returns a valid empty state for a platform without departures', () => {
    expect(buildPlatformDeparturePayload({
      stopCode: '9009',
      terminalPayload: { generated_at: 1_000_000, departures: [] },
    })).toMatchObject({
      platform: '9',
      platform_display: '09',
      status: 'no_departures',
      departures: [],
    });
  });
});
