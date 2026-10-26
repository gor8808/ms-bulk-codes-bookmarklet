#!/usr/bin/env node

// Stage 2 of an update. The stage 1 runner (update-runner.js) is the code of the
// version being replaced, so it only fetches and checks out the target tag and then
// runs THIS file from the freshly checked-out release. Everything that can break on a
// user's machine (npm, Playwright, restarting the app) lives here, so a bug in it can
// be fixed by publishing a new release instead of asking users to repair the app.
//
// Contract with update-runner.js — keep it stable across releases:
//   node post-update.js install '<json>'  json: { repoDir, appDir, previousLockHash, previousPlaywright }
//   node post-update.js restart '<json>'  json: { repoDir, appDir, serverPid }
// Exit code 0 means success; on failure the last stderr line is shown to the user.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

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

function playwrightVersion(pkg) {
  return (pkg.dependencies && pkg.dependencies.playwright) || '';
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

async function runPackageManager(repoDir, tool, args) {
  const command = packageManagerCommand(tool, args);
  await execFileAsync(command.file, command.args, { cwd: repoDir, windowsHide: true, ...command.options });
}

async function readSnapshot(repoDir) {
  return {
    lockHash: await fileHash(path.join(repoDir, 'package-lock.json')),
    playwright: playwrightVersion(await readPackageJson(path.join(repoDir, 'package.json'))),
  };
}

async function install(input) {
  const current = await readSnapshot(input.repoDir);
  const steps = [];
  if (current.lockHash !== input.previousLockHash) {
    await runPackageManager(input.repoDir, 'npm', ['install']);
    steps.push('npm install');
  }

  if (current.playwright && current.playwright !== input.previousPlaywright) {
    await runPackageManager(input.repoDir, 'npx', ['playwright', 'install', 'chromium']);
    steps.push('playwright install');
  }

  return { steps };
}

async function restart(input) {
  if (Number.isFinite(input.serverPid) && input.serverPid > 0) {
    try {
      process.kill(input.serverPid, 'SIGTERM');
    } catch (_) {
      // already stopped
    }
  }

  // macOS LaunchAgent restarts the server by itself; Windows needs the hidden launcher.
  if (process.platform === 'win32') {
    const launcher = path.join(input.appDir, 'start-hidden.vbs');
    if (fs.existsSync(launcher)) {
      await execFileAsync('wscript.exe', ['//B', launcher], { windowsHide: true });
    }
  }

  return { steps: ['restart'] };
}

const COMMANDS = { install, restart };

async function main() {
  const [command, raw] = process.argv.slice(2);
  if (!COMMANDS[command]) {
    throw new Error(`Unknown post-update command: ${command}`);
  }

  const result = await COMMANDS[command](JSON.parse(raw || '{}'));
  process.stdout.write(`${command}: ${result.steps.join(', ') || 'nothing to do'}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  fileHash,
  install,
  packageManagerCommand,
  readSnapshot,
  restart,
};
