import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the production build in vite preview, so they
// see the same Content-Security-Policy as GitHub Pages. They use demo mode,
// or a stand-in for Google and Drive (e2e/fake-google.ts): no Google account.
// The port is the app's own, strict, so a local run never reuses another
// project's preview on Vite's default. E2E_PORT moves it when another
// project's preview already holds it.
const PORT = Number(process.env.E2E_PORT ?? 4317);

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
