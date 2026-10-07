// Наскрізні тести в справжньому браузері. Локально можна взяти встановлений Chrome:
//   PW_CHANNEL=chrome npm run test:e2e
import { defineConfig } from '@playwright/test';

const PORT = 8173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1440, height: 900 },
    locale: 'uk-UA',
  },
  webServer: {
    command: `node scripts/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
  },
});
