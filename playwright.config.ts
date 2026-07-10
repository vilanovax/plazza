import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    locale: "fa-IR",
  },
  projects: [
    { name: "chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "echo 'Expecting app at PLAYWRIGHT_BASE_URL (docker compose up)'",
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 5_000,
      },
});
