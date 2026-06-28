const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Updater, compareTags, isUpdateAvailable } = require('../server/updater');

function createTempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ms-updater-'));
}

test('compareTags sorts semantic release tags numerically', () => {
  assert.equal(compareTags('v0.10.0', 'v0.2.0') > 0, true);
  assert.equal(compareTags('v1.0.0', 'v1.0.0'), 0);
  assert.equal(isUpdateAvailable('v0.1.0', 'v0.2.0'), true);
  assert.equal(isUpdateAvailable('v0.2.0', 'v0.1.0'), false);
});

test('Updater handleStatusRequest returns cached state from GitHub + git tag without auto-installing', async () => {
  const rootDir = await createTempDir();
  const appDir = path.join(rootDir, 'local-web-app');
  await fsp.mkdir(appDir, { recursive: true });
  const spawnCalls = [];

  const updater = new Updater({
    repoDir: rootDir,
    appDir,
    runManagers: [],
    fetchImpl: async () => new Response(JSON.stringify({
      tag_name: 'v0.2.0',
      html_url: 'https://example.com/v0.2.0',
      body: 'release notes',
    }), { status: 200 }),
    execFileImpl: async (file, args) => {
      assert.equal(file, 'git');
      if (args[0] === 'tag') {
        return { stdout: '' };
      }
      assert.deepEqual(args, ['describe', '--tags', '--abbrev=0']);
      return { stdout: 'v0.1.0\n' };
    },
    spawnImpl(...args) {
      spawnCalls.push(args);
      return { unref() {} };
    },
  });

  const status = await updater.handleStatusRequest();
  assert.equal(status.current, 'v0.1.0');
  assert.equal(status.latest, 'v0.2.0');
  assert.equal(status.updateAvailable, true);
  assert.equal(status.releaseUrl, 'https://example.com/v0.2.0');
  assert.equal(spawnCalls.length, 0);
});

test('Updater prefers the highest semver tag when multiple tags point at HEAD', async () => {
  const rootDir = await createTempDir();
  const appDir = path.join(rootDir, 'local-web-app');
  await fsp.mkdir(appDir, { recursive: true });

  const updater = new Updater({
    repoDir: rootDir,
    appDir,
    runManagers: [],
    fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'v0.1.3' }), { status: 200 }),
    execFileImpl: async (_, args) => {
      if (args[0] === 'tag') {
        return { stdout: 'v0.1.2\nv0.1.3\n' };
      }
      throw new Error(`Unexpected git call: ${args.join(' ')}`);
    },
    spawnImpl() {
      return { unref() {} };
    },
  });

  const status = await updater.handleStatusRequest();
  assert.equal(status.current, 'v0.1.3');
  assert.equal(status.updateAvailable, false);
});

test('Updater install request respects busy state unless forced', async () => {
  const rootDir = await createTempDir();
  const appDir = path.join(rootDir, 'local-web-app');
  await fsp.mkdir(appDir, { recursive: true });
  const spawnCalls = [];

  const updater = new Updater({
    repoDir: rootDir,
    appDir,
    runManagers: [{ hasActiveRuns: () => true }],
    fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'v0.2.0' }), { status: 200 }),
    execFileImpl: async () => ({ stdout: 'v0.1.0\n' }),
    spawnImpl(...args) {
      spawnCalls.push(args);
      return { unref() {} };
    },
  });

  await assert.rejects(
    () => updater.handleInstallRequest({ force: false }),
    /Подтвердите принудительный перезапуск/,
  );

  await updater.handleInstallRequest({ force: true });
  assert.equal(spawnCalls.length, 1);
});

test('Updater exposes failed phase from last update file', async () => {
  const rootDir = await createTempDir();
  const appDir = path.join(rootDir, 'local-web-app');
  await fsp.mkdir(appDir, { recursive: true });
  await fsp.writeFile(path.join(appDir, '.last-update'), JSON.stringify({
    from: 'v0.1.0',
    to: 'v0.2.0',
    ts: new Date().toISOString(),
    error: 'npm install failed',
  }), 'utf8');

  const updater = new Updater({
    repoDir: rootDir,
    appDir,
    runManagers: [],
    fetchImpl: async () => new Response(JSON.stringify({ tag_name: 'v0.2.0' }), { status: 200 }),
    execFileImpl: async () => ({ stdout: 'v0.1.0\n' }),
    spawnImpl() {
      return { unref() {} };
    },
  });

  const status = await updater.handleStatusRequest();
  assert.equal(status.phase, 'failed');
  assert.equal(status.lastUpdate.error, 'npm install failed');
  assert.equal(fs.existsSync(path.join(appDir, '.last-update')), true);
});
