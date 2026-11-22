const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { build, OUT } = require('../scripts/build-wb-userscript.js');

const meta = (text) => ({
  version: text.match(/^\/\/ @version\s+(\S+)/m)?.[1],
  hash: text.match(/^\/\/ source-hash: (\S+)/m)?.[1],
});
const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

test('committed userscript is up to date with sources', () => {
  const committed = fs.readFileSync(OUT, 'utf8');
  assert.equal(committed, build().text, 'Run: npm run build:wb-userscript');
});

test('code changes since main come with a version bump', (t) => {
  let onMain;
  try {
    onMain = execFileSync('git', ['show', 'origin/main:wb-extension/wb-price-fit.user.js'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    t.skip('userscript not on origin/main yet');
    return;
  }
  const main = meta(onMain);
  const current = build();
  if (main.hash === current.sourceHash) return;
  assert.ok(
    cmp(current.version, main.version) > 0,
    `Code changed but version is still ${current.version} (main: ${main.version}). Bump "version" in wb-extension/manifest.json, then npm run build:wb-userscript`,
  );
});

test('userscript header has auto-update fields', () => {
  const text = build().text;
  assert.match(text, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/.+\.user\.js/);
  assert.match(text, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/.+\.user\.js/);
  assert.match(text, /@match\s+https:\/\/seller\.wildberries\.ru\/\*/);
});
