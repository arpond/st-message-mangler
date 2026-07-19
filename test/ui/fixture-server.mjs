// Zero-dependency static file server for the Playwright `webServer` config — rebuilds the
// fixture (see build-fixture.mjs) then serves test/ui/.fixture/ over plain HTTP. No devDependency
// beyond Playwright/jQuery themselves is needed just to serve static files.
import './build-fixture.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testUiDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testUiDir, '.fixture');
const port = Number(process.env.PORT) || 4173;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = path.join(fixtureRoot, reqPath);

    // Guard against escaping fixtureRoot via '..' segments.
    if (!filePath.startsWith(fixtureRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(port, () => {
    console.log(`Fixture server listening on http://127.0.0.1:${port}`);
});
