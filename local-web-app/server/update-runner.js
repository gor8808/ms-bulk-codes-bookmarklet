#!/usr/bin/env node

// Stage 1 of an update. This file runs from the version being replaced, so a bug here
// can only be fixed by users updating past it — keep it small and boring. It locks,
// fetches and checks out the target tag, then hands installing and restarting to the
// target release's own post-update.js (stage 2). If stage 2 fails, it checks out the
// previous version again and records the error for the app to show and report.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
// Loaded before checkout, so this is the current release's copy: used only when the
// target release has no post-update.js (a downgrade to a release older than v0.1.13).
const builtInPostUpdate = require('./post-update');

const execFileAsync = promisify(execFile);
const POST_UPDATE_PATH = path.join('local-web-app', 'server', 'post-update.js');

function normalizeError(error) {
  return error && error.message ? error.message : String(error);
}

async function log(paths, line) {
  await fsp.appendFile(paths.log, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

async function writeProgress(paths, phase) {
  await fsp.writeFile(paths.progress, phase, 'utf8');
  await log(paths, phase);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function writeLastUpdate(paths, payload) {
  await fsp.writeFile(paths.lastUpdate, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function git(repoDir, args) {
  const { stdout } = await execFileAsync('git', args, { cwd: repoDir, windowsHide: true });
  return stdout.trim();
}

function lastLine(text) {
  return String(text || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
}

async function runStage(input, paths, command, payload) {
  const script = path.join(input.repoDir, POST_UPDATE_PATH);
  if (!fs.existsSync(script)) {
    const result = await builtInPostUpdate[command](payload);
    await log(paths, `${command}: ${result.steps.join(', ') || 'nothing to do'} (built-in)`);
    return;
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, [script, command, JSON.stringify(payload)], {
      cwd: input.repoDir,
      windowsHide: true,
    });
    await log(paths, lastLine(stdout) || `${command}: done`);
  } catch (error) {
    const reason = lastLine(error.stderr) || normalizeError(error);
    await log(paths, `${command} failed: ${reason}`);
    throw new Error(reason);
  }
}

async function runUpdate(input) {
  const paths = {
    lock: path.join(input.appDir, '.update-in-progress'),
    progress: path.join(input.appDir, '.update-progress'),
    lastUpdate: path.join(input.appDir, '.last-update'),
    log: path.join(input.appDir, '.update.log'),
  };

  const existingLock = await fsp.stat(paths.lock).catch(() => null);
  if (existingLock && ((Date.now() - existingLock.mtimeMs) < input.lockStaleMs)) {
    throw new Error('Update lock already exists');
  }

  await fsp.writeFile(paths.lock, `${process.pid}\n`, 'utf8');
  const previousRef = await git(input.repoDir, ['rev-parse', 'HEAD']);
  const previous = await builtInPostUpdate.readSnapshot(input.repoDir);
  const lastUpdate = await readJsonIfExists(paths.lastUpdate);
  const attempts = lastUpdate && lastUpdate.error && lastUpdate.to === input.targetTag
    ? (Number(lastUpdate.attempts) || 1) + 1
    : 1;
  const outcome = { from: input.currentTag || previousRef, to: input.targetTag, attempts };

  try {
    await log(paths, `update ${outcome.from} -> ${outcome.to} (attempt ${attempts})`);
    await writeProgress(paths, 'pulling');
    await git(input.repoDir, ['fetch', '--tags', '--force']);
    await git(input.repoDir, ['checkout', '--force', input.targetTag]);

    await writeProgress(paths, 'installing');
    await runStage(input, paths, 'install', {
      repoDir: input.repoDir,
      appDir: input.appDir,
      previousLockHash: previous.lockHash,
      previousPlaywright: previous.playwright,
    });
  } catch (error) {
    const target = await builtInPostUpdate.readSnapshot(input.repoDir).catch(() => previous);
    try {
      await git(input.repoDir, ['checkout', '--force', previousRef]);
      await runStage(input, paths, 'install', {
        repoDir: input.repoDir,
        appDir: input.appDir,
        previousLockHash: target.lockHash,
        previousPlaywright: target.playwright,
      });
    } catch (rollbackError) {
      await log(paths, `rollback problem: ${normalizeError(rollbackError)}`);
    }

    await writeLastUpdate(paths, { ...outcome, ts: new Date().toISOString(), error: normalizeError(error) });
    await fsp.unlink(paths.lock).catch(() => {});
    throw error;
  }

  // The new version is in place; a restart problem must not roll it back.
  await writeLastUpdate(paths, { ...outcome, ts: new Date().toISOString() });
  await writeProgress(paths, 'restarting');
  await fsp.unlink(paths.lock).catch(() => {});
  await runStage(input, paths, 'restart', {
    repoDir: input.repoDir,
    appDir: input.appDir,
    serverPid: input.serverPid,
  }).catch(() => {});
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error('Missing update-runner payload');
  }

  await runUpdate(JSON.parse(raw));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${normalizeError(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runUpdate,
};
