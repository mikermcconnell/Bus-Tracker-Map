const { defineConfig } = require('@playwright/test');

const e2ePort = String(process.env.E2E_PORT || '3007');
const baseURL = `http://127.0.0.1:${e2ePort}`;

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:frontend && node server/server.js',
    url: `${baseURL}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      ...process.env,
      PORT: e2ePort,
      GTFS_RT_VEHICLES_URL: '',
      ONTARIO_NORTHLAND_ENABLED: 'false',
      GO_TRANSIT_ENABLED: 'false',
      SIMCOE_LINX_ENABLED: 'false',
    },
  },
});
