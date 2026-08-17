import { describe, expect, test } from 'vitest';
import AdmZip from 'adm-zip';
import linxModule from '../scripts/build-linx.js';

const { buildArtifactsFromZip } = linxModule;

function fixtureZip() {
  const zip = new AdmZip();
  zip.addFile('agency.txt', Buffer.from('agency_id,agency_name,agency_url\nLINX,Simcoe County LINX,https://simcoe.ca\n'));
  zip.addFile('routes.txt', Buffer.from('route_id,route_short_name,route_long_name,route_color,route_text_color\n2,2,Barrie - Wasaga Beach,006747,FFFFFF\n'));
  zip.addFile('stops.txt', Buffer.from('stop_id,stop_name\nSCSTOP210,Barrie Allandale Bus Station\nOTHER,Wasaga Beach\n'));
  zip.addFile('trips.txt', Buffer.from('route_id,service_id,trip_id,trip_headsign\n2,WK,T1,Wasaga Beach\n2,WK,T2,Barrie Allandale\n'));
  zip.addFile('stop_times.txt', Buffer.from('trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,12:00:00,12:00:00,SCSTOP210,1\nT1,13:00:00,13:00:00,OTHER,2\nT2,11:00:00,11:00:00,OTHER,1\nT2,12:00:00,12:00:00,SCSTOP210,2\n'));
  zip.addFile('calendar.txt', Buffer.from('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,1,1,20260801,20260831\n'));
  return zip.toBuffer();
}

describe('Simcoe LINX builder', () => {
  test('keeps route 2 at Allandale and identifies outbound trips', () => {
    const data = buildArtifactsFromZip(fixtureZip(), 'https://example.test/linx.zip');
    expect(data.terminal_stop_ids).toEqual(['SCSTOP210']);
    expect(data.routes['2'].long_name).toContain('Wasaga');
    expect(data.trips.T1.terminal_stops[0].is_departure).toBe(true);
    expect(data.trips.T2.terminal_stops[0].is_departure).toBe(false);
  });
});
