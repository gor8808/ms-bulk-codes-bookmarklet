const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runUpdate } = require('../server/update-runner');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('runUpdate checks out the requested tag and writes update markers', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ms-update-runner-'));
  const repoDir = path.join(tempDir, 'repo');
  const appDir = path.join(tempDir, 'local-web-app');
  await fsp.mkdir(repoDir, { recursive: true });
  await fsp.mkdir(appDir, { recursive: true });

  git(repoDir, 'init');
  git(repoDir, 'config', 'user.email', 'test@example.com');
  git(repoDir, 'config', 'user.name', 'Test User');
  await fsp.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({
    name: 'ms-test',
    version: '1.0.0',
  }, null, 2));
  await fsp.writeFile(path.join(repoDir, 'package-lock.json'), JSON.stringify({ name: 'ms-test', lockfileVersion: 3 }, null, 2));
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-m', 'v0.1.0');
  git(repoDir, 'tag', 'v0.1.0');

  await fsp.writeFile(path.join(repoDir, 'README.md'), 'v0.2.0\n');
  git(repoDir, 'add', '.');
  git(repoDir, 'commit', '-m', 'v0.2.0');
  git(repoDir, 'tag', 'v0.2.0');
  git(repoDir, 'checkout', 'v0.1.0');

  await runUpdate({
    appDir,
    repoDir,
    targetTag: 'v0.2.0',
    currentTag: 'v0.1.0',
    serverPid: Number.NaN,
    lockStaleMs: 10 * 60 * 1000,
  });

  assert.equal(git(repoDir, 'describe', '--tags', '--exact-match', 'HEAD'), 'v0.2.0');
  const lastUpdate = JSON.parse(await fsp.readFile(path.join(appDir, '.last-update'), 'utf8'));
  assert.equal(lastUpdate.from, 'v0.1.0');
  assert.equal(lastUpdate.to, 'v0.2.0');
  assert.equal(fs.existsSync(path.join(appDir, '.update-in-progress')), false);
  assert.equal((await fsp.readFile(path.join(appDir, '.update-progress'), 'utf8')).trim(), 'restarting');
});
