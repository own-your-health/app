import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the production build in vite preview, so they
// see the same Content-Security-Policy as GitHub Pages. They use demo mode
// only: no Google account and no Drive. The port is the app's own, strict,
// so a local run never reuses another project's preview on Vite's default.
const PORT = 4317;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/app/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
