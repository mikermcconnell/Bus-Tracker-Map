import { describe, expect, test } from 'vitest';
import {
  buildNearbyRenderSignature,
  buildTrackedAgencySummaries,
  buildTrackedServiceSummaries,
  getAgencyBranding
} from '../frontend/src/map/tracked-services.js';

describe('tracked service summaries', () => {
  test('keeps supported services visible and separates tracked from on-map counts', () => {
    const vehicles = [
      { id: 'bt-1', agency_id: 'barrie-transit', lat: 44.38, lon: -79.69 },
      { id: 'go-bus-1', agency_id: 'go-transit', route_mode: 'bus', lat: 44.37, lon: -79.69 },
      { id: 'on-1', agency_id: 'ontario-northland', lat: 45.62, lon: -79.41 },
      { id: 'linx-2', agency_id: 'simcoe-linx', lat: 44.37, lon: -79.69 }
    ];
    const summaries = buildTrackedServiceSummaries({
      vehicles,
      sources: {
        barrie_transit: { feed_status: 'live' },
        go_transit: { feed_status: 'live' },
        ontario_northland: { feed_status: 'live' },
        simcoe_linx: { feed_status: 'live' }
      },
      isOnMap: (vehicle) => vehicle.id !== 'on-1'
    });

    expect(summaries.map((entry) => entry.id)).toEqual([
      'barrie-transit',
      'go-bus',
      'go-train',
      'ontario-northland',
      'simcoe-linx'
    ]);
    expect(summaries.map((entry) => entry.serviceType)).toEqual([
      'Local Buses',
      'Regional Buses',
      'Barrie Line Train',
      'Regional Buses',
      'Regional Buses'
    ]);
    expect(summaries[0].statusLabel).toBe('1 live on map');
    expect(summaries[1].statusLabel).toBe('1 live on map');
    expect(summaries[2].statusLabel).toBe('0 live on map');
    expect(summaries[3].statusLabel).toBe('1 tracked · 0 on map');
    expect(summaries[4].statusLabel).toBe('1 live on map');
  });

  test('groups modes under one agency logo while preserving per-mode counts', () => {
    const agencies = buildTrackedAgencySummaries({
      vehicles: [
        { id: 'go-bus-1', agency_id: 'go-transit', route_mode: 'bus' },
        { id: 'go-train-1', agency_id: 'go-transit', route_mode: 'train' }
      ],
      sources: {
        go_transit: { feed_status: 'live' },
        simcoe_linx: { feed_status: 'empty' }
      },
      isOnMap: (vehicle) => vehicle.id === 'go-bus-1'
    });

    expect(agencies.map((agency) => agency.id)).toEqual([
      'barrie-transit',
      'go-transit',
      'ontario-northland',
      'simcoe-linx'
    ]);
    expect(agencies[1].logoSrc).toBe('./assets/agency-go-transit.svg');
    expect(agencies[1].services.map((service) => service.id)).toEqual(['go-bus', 'go-train']);
    expect(agencies[1].services.map((service) => service.statusLabel)).toEqual([
      '1 live on map',
      '1 tracked · 0 on map'
    ]);
    expect(agencies[3].logoSrc).toBe('./assets/agency-simcoe-linx.png');
    expect(agencies[3].services[0].statusLabel).toBe('0 live on map');
  });

  test('shares Live Services agency branding with terminal rows', () => {
    expect(getAgencyBranding('barrie-transit').logoSrc)
      .toBe('./assets/agency-barrie-transit.png');
    expect(getAgencyBranding('go-transit').logoSrc)
      .toBe('./assets/agency-go-transit.svg');
    expect(getAgencyBranding('ontario-northland').logoSrc)
      .toBe('./assets/agency-ontario-northland.png');
    expect(getAgencyBranding('simcoe-linx').logoSrc)
      .toBe('./assets/agency-simcoe-linx.png');
  });

  test('uses feed-health wording instead of claiming delayed or offline vehicles are live', () => {
    const summaries = buildTrackedServiceSummaries({
      vehicles: [
        { id: 'go-train-1', agency_id: 'go-transit', route_mode: 'train' },
        { id: 'on-1', agency_id: 'ontario-northland' }
      ],
      sources: {
        barrie_transit: { feed_status: 'empty' },
        go_transit: { feed_status: 'delayed' },
        ontario_northland: { feed_status: 'offline' }
      },
      isOnMap: () => true
    });

    expect(summaries[0].statusLabel).toBe('0 live on map');
    expect(summaries[1].statusLabel).toBe('Delayed · 0 last known on map');
    expect(summaries[2].statusLabel).toBe('Delayed · 1 last known on map');
    expect(summaries[3].statusLabel).toBe('Offline');
  });
});

describe('nearby vehicle render signatures', () => {
  test('is stable for identical rows and changes for visible content or ordering', () => {
    const rows = [
      {
        id: 'bus-1',
        routeLabel: '8A',
        agencyLabel: 'Barrie Transit',
        serviceLabel: 'Barrie Transit · Local bus',
        destination: 'RVH/Yonge',
        terminalStatus: 'approaching',
        distanceMeters: 900,
        distanceLabel: '900 m away',
        color: '#000000',
        textColor: '#ffffff'
      }
    ];

    const first = buildNearbyRenderSignature(rows);
    const cloned = rows.map((entry) => ({ ...entry }));
    expect(buildNearbyRenderSignature(cloned)).toBe(first);
    expect(buildNearbyRenderSignature([
      { ...rows[0], distanceLabel: '1 km away' }
    ])).not.toBe(first);
    expect(buildNearbyRenderSignature([
      { ...rows[0], terminalStatus: 'at_terminal' }
    ])).not.toBe(first);
    expect(buildNearbyRenderSignature([
      { ...rows[0], departureLabel: 'Departs in 4 min' }
    ])).not.toBe(first);
    expect(buildNearbyRenderSignature([
      { ...rows[0], directionLabel: 'North' }
    ])).not.toBe(first);
    expect(buildNearbyRenderSignature([
      { ...rows[0], platformLabel: 'PLATFORM 5' }
    ])).not.toBe(first);
    expect(buildNearbyRenderSignature([
      { ...rows[0], agencyLogoSrc: './assets/agency-barrie-transit.png' }
    ])).not.toBe(first);
  });
});
