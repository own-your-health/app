import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the production build in vite preview, so they
// see the same Content-Security-Policy as GitHub Pages. They use demo mode
// only: no Google account and no Drive.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/app/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview',
    url: 'http://localhost:4173/app/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
