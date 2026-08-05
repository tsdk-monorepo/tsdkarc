import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:5173", // Changed from localhost
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "bun run server/main.ts",
      url: "http://localhost:3050/api/paw/health", // Changed from localhost
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
    {
      command: "bun install --force && bun run dev", // Removed the cd command
      cwd: "./react-client", // Added the working directory property
      url: "http://localhost:5173", // Changed from localhost
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
