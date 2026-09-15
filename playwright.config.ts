import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? '/Applications/Chromium.app/Contents/MacOS/Chromium';

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  retries: 0,
  maxFailures: 1,
  globalTimeout: 120_000,
  testDir: './tests/dashboard-browser',
  timeout: 30_000,
  outputDir: 'artifacts/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4174/tests/dashboard-browser/',
    browserName: 'chromium',
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : undefined,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4174 --config vite.dashboard-test.config.ts',
    url: 'http://127.0.0.1:4174/tests/dashboard-browser/',
    reuseExistingServer: false,
  },
});
