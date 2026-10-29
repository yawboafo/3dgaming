import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke test runs its own server and client on separate ports and never reuses a running dev
 * session: state left in a long-lived room (moved vehicles, idle players at the spawn) would make
 * the tests depend on whatever happened before.
 */
const SERVER_PORT = 2600;
const CLIENT_PORT = 5180;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: `http://localhost:${CLIENT_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @town/server exec tsx src/index.ts',
      port: SERVER_PORT,
      env: { PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @town/client exec vite --port ${CLIENT_PORT} --strictPort`,
      port: CLIENT_PORT,
      env: { VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
