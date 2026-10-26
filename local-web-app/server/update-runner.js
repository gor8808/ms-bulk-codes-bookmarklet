#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function normalizeError(error) {
  return error && error.message ? error.message : String(error);
}

async function fileHash(filePath) {
  try {
    const buffer = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readPackageJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeProgress(paths, phase) {
  await fsp.writeFile(paths.progress, phase, 'utf8');
  await fsp.appendFile(paths.log, `${new Date().toISOString()} ${phase}\n`, 'utf8');
}

async function writeLastUpdate(paths, payload) {
  await fsp.writeFile(paths.lastUpdate, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function command(cwd, file, args, options = {}) {
  await execFileAsync(file, args, { cwd, ...options });
}

// Node refuses to spawn .cmd files without a shell on Windows (spawn EINVAL,
// CVE-2024-27980), so run npm/npx as one shell string there. Args are fixed
// words, so joining them is safe and avoids the DEP0190 args-with-shell warning.
function packageManagerCommand(tool, args, platform = process.platform) {
  if (platform === 'win32') {
    return { file: [`${tool}.cmd`, ...args].join(' '), args: [], options: { shell: true } };
  }

  return { file: tool, args, options: {} };
}

async function currentRef(repoDir) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
  return stdout.trim();
}

async function checkout(repoDir, ref) {
  await command(repoDir, 'git', ['checkout', ref]);
}

async function installNpmDependencies(repoDir) {
  const npm = packageManagerCommand('npm', ['install']);
  await command(repoDir, npm.file, npm.args, npm.options);
}

async function installPlaywright(repoDir) {
  const npx = packageManagerCommand('npx', ['playwright', 'install', 'chromium']);
  await command(repoDir, npx.file, npx.args, npx.options);
}

async function restartServer({ appDir, serverPid }) {
  if (Number.isFinite(serverPid) && serverPid > 0) {
    try {
      process.kill(serverPid, 'SIGTERM');
    } catch (_) {
      // noop
    }
  }

  if (process.platform === 'win32') {
    const launcher = path.join(appDir, 'start-hidden.vbs');
    await execFileAsync('wscript.exe', ['//B', launcher], { windowsHide: true });
  }
}

async function runUpdate(input) {
  const paths = {
    lock: path.join(input.appDir, '.update-in-progress'),
    progress: path.join(input.appDir, '.update-progress'),
    lastUpdate: path.join(input.appDir, '.last-update'),
    log: path.join(input.appDir, '.update.log'),
  };
  const packageLockPath = path.join(input.repoDir, 'package-lock.json');
  const packageJsonPath = path.join(input.repoDir, 'package.json');

  const existingLock = await fsp.stat(paths.lock).catch(() => null);
  if (existingLock && ((Date.now() - existingLock.mtimeMs) < input.lockStaleMs)) {
    throw new Error('Update lock already exists');
  }

  await fsp.writeFile(paths.lock, `${process.pid}\n`, 'utf8');
  const previousRef = await currentRef(input.repoDir);
  const previousLockHash = await fileHash(packageLockPath);
  const previousPkg = await readPackageJson(packageJsonPath);

  try {
    await writeProgress(paths, 'pulling');
    await command(input.repoDir, 'git', ['fetch', '--tags']);
    await checkout(input.repoDir, input.targetTag);

    const currentLockHash = await fileHash(packageLockPath);
    const currentPkg = await readPackageJson(packageJsonPath);
    if (currentLockHash !== previousLockHash) {
      await writeProgress(paths, 'installing');
      await installNpmDependencies(input.repoDir);
    }

    const previousPlaywright = previousPkg.dependencies && previousPkg.dependencies.playwright;
    const currentPlaywright = currentPkg.dependencies && currentPkg.dependencies.playwright;
    if (previousPlaywright !== currentPlaywright && currentPlaywright) {
      await writeProgress(paths, 'installing');
      await installPlaywright(input.repoDir);
    }

    await writeLastUpdate(paths, {
      from: input.currentTag || previousRef,
      to: input.targetTag,
      ts: new Date().toISOString(),
    });
    await writeProgress(paths, 'restarting');
    await restartServer({ appDir: input.appDir, serverPid: input.serverPid });
  } catch (error) {
    try {
      await checkout(input.repoDir, previousRef);
    } catch (_) {
      // noop
    }

    await writeLastUpdate(paths, {
      from: input.currentTag || previousRef,
      to: input.targetTag,
      ts: new Date().toISOString(),
      error: normalizeError(error),
    });
    throw error;
  } finally {
    await fsp.unlink(paths.lock).catch(() => {});
  }
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error('Missing update-runner payload');
  }

  const input = JSON.parse(raw);
  await runUpdate(input);
}

if (require.main === module) {
  main().catch(async (error) => {
    process.stderr.write(`${normalizeError(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runUpdate,
  fileHash,
  packageManagerCommand,
};
