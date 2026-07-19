// @ts-check
import { defineConfig } from 'playwright/test';

const PORT = 4173;

export default defineConfig({
    testDir: '.',
    fullyParallel: true,
    reporter: 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
    },
    webServer: {
        command: `node fixture-server.mjs`,
        cwd: import.meta.dirname,
        port: PORT,
        // Always rebuild the fixture from current source before each run — this is a manual,
        // pre-commit smoke test, not a long-lived dev server, so staleness would defeat the point.
        reuseExistingServer: false,
        timeout: 20_000,
    },
});
