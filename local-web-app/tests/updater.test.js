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

async function createUpdater({ latest = 'v0.2.0', current = 'v0.1.0', busy = false, lastUpdate, reporter, now } = {}) {
  const rootDir = await createTempDir();
  const appDir = path.join(rootDir, 'local-web-app');
  await fsp.mkdir(appDir, { recursive: true });
  if (lastUpdate) {
    await fsp.writeFile(path.join(appDir, '.last-update'), JSON.stringify(lastUpdate), 'utf8');
  }
  const spawnCalls = [];
  const updater = new Updater({
    repoDir: rootDir,
    appDir,
    runManagers: [{ hasActiveRuns: () => busy }],
    reporter,
    now,
    fetchImpl: async () => new Response(JSON.stringify({ tag_name: latest }), { status: 200 }),
    execFileImpl: async (_, args) => ({ stdout: args[0] === 'tag' ? `${current}\n` : `${current}\n` }),
    spawnImpl(...args) {
      spawnCalls.push(args);
      return { unref() {} };
    },
  });
  return { updater, appDir, spawnCalls };
}

const HOUR = 60 * 60 * 1000;

test('a failure for an older release does not block a newer one', async () => {
  const { updater } = await createUpdater({
    latest: 'v0.3.0',
    lastUpdate: { from: 'v0.1.0', to: 'v0.2.0', ts: new Date().toISOString(), error: 'spawn EINVAL' },
  });

  const status = await updater.handleStatusRequest();
  assert.equal(status.phase, 'idle');
  assert.equal(status.updateAvailable, true);
});

test('scheduled check installs a new release automatically when the app is idle', async () => {
  const { updater, spawnCalls } = await createUpdater();
  await updater.runScheduledCheck();
  assert.equal(spawnCalls.length, 1);
  assert.equal(JSON.parse(spawnCalls[0][1][1]).targetTag, 'v0.2.0');
});

test('scheduled check waits while a task is running', async () => {
  const { updater, spawnCalls } = await createUpdater({ busy: true });
  await updater.runScheduledCheck();
  assert.equal(spawnCalls.length, 0);
});

test('scheduled check retries a failed release only after a pause and a limited number of times', async () => {
  const failedAt = Date.parse('2026-10-26T08:00:00Z');
  const failure = (attempts) => ({ from: 'v0.1.0', to: 'v0.2.0', ts: new Date(failedAt).toISOString(), error: 'x', attempts });

  const soon = await createUpdater({ lastUpdate: failure(1), now: () => failedAt + HOUR });
  await soon.updater.runScheduledCheck();
  assert.equal(soon.spawnCalls.length, 0);

  const later = await createUpdater({ lastUpdate: failure(1), now: () => failedAt + 7 * HOUR });
  await later.updater.runScheduledCheck();
  assert.equal(later.spawnCalls.length, 1);

  const exhausted = await createUpdater({ lastUpdate: failure(3), now: () => failedAt + 7 * HOUR });
  await exhausted.updater.runScheduledCheck();
  assert.equal(exhausted.spawnCalls.length, 0);
});

test('a manual retry is allowed for the release that failed', async () => {
  const { updater, spawnCalls } = await createUpdater({
    lastUpdate: { from: 'v0.1.0', to: 'v0.2.0', ts: new Date().toISOString(), error: 'x', attempts: 3 },
  });
  const status = await updater.handleStatusRequest();
  assert.equal(status.phase, 'failed');
  await updater.handleInstallRequest();
  assert.equal(spawnCalls.length, 1);
});

test('update outcomes are reported once and then marked as reported', async () => {
  const sent = [];
  const reporter = { sendUpdate: async (payload) => { sent.push(payload); return { sent: true }; } };
  const { updater, appDir } = await createUpdater({
    current: 'v0.2.0',
    latest: 'v0.2.0',
    reporter,
    lastUpdate: { from: 'v0.1.0', to: 'v0.2.0', ts: new Date().toISOString(), attempts: 1 },
  });
  await fsp.writeFile(path.join(appDir, '.update.log'), 'line 1\nline 2\n', 'utf8');

  await updater.runScheduledCheck();
  await updater.runScheduledCheck();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].outcome.to, 'v0.2.0');
  assert.match(sent[0].logTail, /line 2/);
  const stored = JSON.parse(await fsp.readFile(path.join(appDir, '.last-update'), 'utf8'));
  assert.equal(stored.reported, true);
});
