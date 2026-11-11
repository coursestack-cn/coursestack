import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Each run resets an isolated local state, so the suite never touches backend/.wrangler/state.
const stateDirectory = fileURLToPath(new URL("../.local/e2e-state", import.meta.url));
const apiPort = Number(process.env.E2E_API_PORT ?? 8787);
const webPort = Number(process.env.E2E_WEB_PORT ?? 6317);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const backend = `pnpm --dir ../backend`;

export default defineConfig({
    testDir: "./e2e",
    // The flow shares one reset database, so specs run one at a time.
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: Boolean(process.env.CI),
    timeout: 180_000,
    expect: { timeout: 15_000 },
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: webOrigin,
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        trace: "retain-on-failure",
        screenshot: "only-on-failure"
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: [
        {
            // demo resets D1 and R2 in the state directory before Wrangler opens it.
            command: `${backend} demo --local --persist-to "${stateDirectory}" && ${backend} exec wrangler dev --env local --local --persist-to "${stateDirectory}" --ip 127.0.0.1 --port ${apiPort}`,
            url: `${apiOrigin}/api/health`,
            env: { WRANGLER_SEND_METRICS: "false" },
            reuseExistingServer: false,
            timeout: 240_000,
            stdout: "ignore",
            stderr: "pipe"
        },
        {
            command: `pnpm exec vite --port ${webPort}`,
            url: webOrigin,
            env: { DEV_API_TARGET: apiOrigin },
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: "ignore",
            stderr: "pipe"
        }
    ]
});