const { defineConfig } = require('@playwright/test');
const path = require('path');
const port = String(process.env.PLATFORM_SIGN_TEST_PORT || '3017');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/platform-departures.e2e.js',
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/test-platform-sign-server.js',
    cwd: path.join(__dirname, '..'),
    url: `http://127.0.0.1:${port}/review-health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: port, GTFS_RT_VEHICLES_URL: '', GTFS_RT_TRIP_UPDATES_URL: '',
      ONTARIO_NORTHLAND_ENABLED: 'false', SIMCOE_LINX_ENABLED: 'false',
      GO_TRANSIT_ENABLED: 'false', LINX_ENABLED: 'false', METROLINX_API_KEY: '',
    },
  },
});
