import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 1
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: {
    command: "python3 -m http.server 4174 --directory dist --bind 127.0.0.1",
    port: 4174,
    reuseExistingServer: true,
    cwd: "."
  }
});
