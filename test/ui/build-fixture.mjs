// Regenerates test/ui/.fixture/ — a directory tree shaped like a real SillyTavern install
// (public/script.js, public/scripts/popup.js, public/scripts/extensions/third-party/
// st-message-mangler/...) so the extension's real relative imports (`../../../popup.js`, etc.)
// resolve unchanged, without pulling in actual SillyTavern. Real source files are copied in
// as-is; only SillyTavern's own core modules are replaced with the stubs in test/ui/stubs/.
// .fixture/ is generated and gitignored — never edit it directly, edit the real source or the
// stubs and re-run this script (done automatically by fixture-server.mjs before each test run).
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testUiDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testUiDir, '..', '..');
const fixtureRoot = path.join(testUiDir, '.fixture');
const extensionDir = path.join(fixtureRoot, 'scripts', 'extensions', 'third-party', 'st-message-mangler');

rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(extensionDir, { recursive: true });

// Real extension source, copied verbatim.
for (const name of ['index.js', 'pipeline.js', 'render.js', 'settingsUI.js', 'statusPanel.js', 'style.css', 'lib']) {
    cpSync(path.join(repoRoot, name), path.join(extensionDir, name), { recursive: true });
}

// Test-only harness page + the classic script that stubs `window.SillyTavern`.
cpSync(path.join(testUiDir, 'harness.html'), path.join(extensionDir, 'harness.html'));
cpSync(path.join(testUiDir, 'stubs', 'sillytavern-context.js'), path.join(extensionDir, 'sillytavern-context.js'));

// Stand-ins for the real SillyTavern core modules the extension imports by relative path.
// Note: `script.js` sits at the fixture root (matches `public/script.js`), but `reasoning.js` is
// imported from one directory deeper (`lib/llmClient.js`, not `index.js`/`settingsUI.js`), so its
// same-looking `../../../../reasoning.js` actually resolves one level shallower — `scripts/`, not
// the fixture root. Verified against the real install per DEVELOPMENT.md's module-map notes.
cpSync(path.join(testUiDir, 'stubs', 'script.js'), path.join(fixtureRoot, 'script.js'));
cpSync(path.join(testUiDir, 'stubs', 'reasoning.js'), path.join(fixtureRoot, 'scripts', 'reasoning.js'));
cpSync(path.join(testUiDir, 'stubs', 'popup.js'), path.join(fixtureRoot, 'scripts', 'popup.js'));
cpSync(path.join(testUiDir, 'stubs', 'power-user.js'), path.join(fixtureRoot, 'scripts', 'power-user.js'));
cpSync(path.join(testUiDir, 'stubs', 'RossAscends-mods.js'), path.join(fixtureRoot, 'scripts', 'RossAscends-mods.js'));
cpSync(path.join(testUiDir, 'stubs', 'st-core.css'), path.join(extensionDir, 'st-core.css'));

// Real jQuery — served to the harness page as-is (this project doesn't ship jQuery itself; a real
// SillyTavern install provides it globally, this fixture stands in for that).
const jqueryDist = path.join(repoRoot, 'node_modules', 'jquery', 'dist', 'jquery.min.js');
if (!existsSync(jqueryDist)) {
    throw new Error('node_modules/jquery not found — run `npm install` first.');
}
cpSync(jqueryDist, path.join(fixtureRoot, 'jquery.min.js'));

console.log(`Fixture rebuilt at ${fixtureRoot}`);
