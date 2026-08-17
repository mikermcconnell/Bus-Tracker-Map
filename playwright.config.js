const { defineConfig } = require('@playwright/test');
const testPort = String(process.env.PLAYWRIGHT_PORT || '3007');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:frontend && node server/server.js',
    url: `http://127.0.0.1:${testPort}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      ...process.env,
      PORT: testPort,
      GTFS_RT_VEHICLES_URL: '',
      ONTARIO_NORTHLAND_ENABLED: 'false',
      GO_TRANSIT_ENABLED: 'false',
    },
  },
});
