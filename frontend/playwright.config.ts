import { defineConfig } from "@playwright/test";

// Mobile layout regression tests. The backend is fully mocked in the tests (page.route), so only the Next.js app runs.
//   npx playwright install chromium     (once)
//   npm run test:e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    env: { NEXT_PUBLIC_API_URL: "same-origin" }, // calls go to /api/... on the same origin, which the tests intercept (no CORS)
    timeout: 300_000,
  },
});
