const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runUpdate } = require('../server/update-runner');
const { packageManagerCommand } = require('../server/post-update');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function writeFile(dir, relativePath, content) {
  const filePath = path.join(dir, relativePath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
}

// Two tagged releases; `nextFiles` are added in v0.2.0. HEAD is left on v0.1.0.
async function createRepo(nextFiles = {}) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ms-update-runner-'));
  const repoDir = path.join(tempDir, 'repo');
  const appDir = path.join(tempDir, 'local-web-app');
  await fsp.mkdir(repoDir, { recursive: true });
  await fsp.mkdir(appDir, { recursive: true });

  git(repoDir, 'init');
  git(repoDir, 'config', 'user.email', 'test@example.com');
  git(repoDir, 'config', 'user.name', 'Test User');
  git(repoDir, 'config', 'core.autocrlf', 'false');
  await writeFile(repoDir, 'package.json', JSON.stringify({ name: 'ms-test', version: '1.0.0' }, null, 2));
  await writeFile(repoDir, 'package-lock.json', JSON.stringify({ name: 'ms-test', lockfileVersion: 3 }, null, 2));
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-m', 'v0.1.0');
  git(repoDir, 'tag', 'v0.1.0');

  await writeFile(repoDir, 'README.md', 'v0.2.0\n');
  for (const [relativePath, content] of Object.entries(nextFiles)) {
    await writeFile(repoDir, relativePath, content);
  }
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-m', 'v0.2.0');
  git(repoDir, 'tag', 'v0.2.0');
  git(repoDir, 'checkout', '-q', 'v0.1.0');

  return { repoDir, appDir, v1: git(repoDir, 'rev-parse', 'v0.1.0') };
}

function updateInput({ repoDir, appDir }) {
  return {
    appDir,
    repoDir,
    targetTag: 'v0.2.0',
    currentTag: 'v0.1.0',
    serverPid: Number.NaN,
    lockStaleMs: 10 * 60 * 1000,
  };
}

async function readLastUpdate(appDir) {
  return JSON.parse(await fsp.readFile(path.join(appDir, '.last-update'), 'utf8'));
}

// A stand-in for a future release's stage 2 script: records each command it runs.
function fakePostUpdate({ failInstall = false } = {}) {
  return `
const fs = require('node:fs');
const path = require('node:path');
const [command, raw] = process.argv.slice(2);
const input = JSON.parse(raw);
fs.appendFileSync(path.join(input.appDir, 'post-update-calls.txt'), command + '\\n');
if (${failInstall} && command === 'install') {
  process.stderr.write('npm exploded\\n');
  process.exit(1);
}
`;
}

test('runUpdate checks out the requested tag and writes update markers', async () => {
  const repo = await createRepo();
  await runUpdate(updateInput(repo));

  assert.equal(git(repo.repoDir, 'describe', '--tags', '--exact-match', 'HEAD'), 'v0.2.0');
  const lastUpdate = await readLastUpdate(repo.appDir);
  assert.equal(lastUpdate.from, 'v0.1.0');
  assert.equal(lastUpdate.to, 'v0.2.0');
  assert.equal(lastUpdate.error, undefined);
  assert.equal(fs.existsSync(path.join(repo.appDir, '.update-in-progress')), false);
  assert.equal((await fsp.readFile(path.join(repo.appDir, '.update-progress'), 'utf8')).trim(), 'restarting');
});

test('runUpdate hands install and restart to the target release post-update script', async () => {
  const repo = await createRepo({ 'local-web-app/server/post-update.js': fakePostUpdate() });
  await runUpdate(updateInput(repo));

  const calls = await fsp.readFile(path.join(repo.appDir, 'post-update-calls.txt'), 'utf8');
  assert.deepEqual(calls.trim().split(/\r?\n/), ['install', 'restart']);
  assert.equal((await readLastUpdate(repo.appDir)).error, undefined);
});

test('runUpdate rolls back and records the stage 2 error and attempt count', async () => {
  const repo = await createRepo({ 'local-web-app/server/post-update.js': fakePostUpdate({ failInstall: true }) });

  await assert.rejects(runUpdate(updateInput(repo)), /npm exploded/);
  assert.equal(git(repo.repoDir, 'rev-parse', 'HEAD'), repo.v1);
  let lastUpdate = await readLastUpdate(repo.appDir);
  assert.equal(lastUpdate.to, 'v0.2.0');
  assert.equal(lastUpdate.error, 'npm exploded');
  assert.equal(lastUpdate.attempts, 1);
  assert.equal(fs.existsSync(path.join(repo.appDir, '.update-in-progress')), false);

  await assert.rejects(runUpdate(updateInput(repo)), /npm exploded/);
  lastUpdate = await readLastUpdate(repo.appDir);
  assert.equal(lastUpdate.attempts, 2);
});

test('runUpdate runs a real npm install when the lockfile changed', { timeout: 120000 }, async () => {
  const repo = await createRepo({
    'package-lock.json': JSON.stringify({
      name: 'ms-test',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'ms-test', version: '1.0.0' } },
    }, null, 2),
  });

  await runUpdate(updateInput(repo));

  assert.equal((await readLastUpdate(repo.appDir)).error, undefined);
  const log = await fsp.readFile(path.join(repo.appDir, '.update.log'), 'utf8');
  assert.match(log, /install: npm install/);
});

test('packageManagerCommand runs npm through a shell on Windows to avoid spawn EINVAL', () => {
  assert.deepEqual(packageManagerCommand('npm', ['install'], 'win32'), {
    file: 'npm.cmd install',
    args: [],
    options: { shell: true },
  });
  assert.deepEqual(packageManagerCommand('npx', ['playwright', 'install', 'chromium'], 'win32'), {
    file: 'npx.cmd playwright install chromium',
    args: [],
    options: { shell: true },
  });
});

test('packageManagerCommand calls the binary directly elsewhere', () => {
  assert.deepEqual(packageManagerCommand('npm', ['install'], 'darwin'), {
    file: 'npm',
    args: ['install'],
    options: {},
  });
});
