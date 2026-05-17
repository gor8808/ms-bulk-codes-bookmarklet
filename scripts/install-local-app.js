#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_LABEL = 'com.gor.moysklad-local-web-app';
const WINDOWS_TASK_NAME = 'MoySklad Local Web App';
const PORT = process.env.PORT || '5177';
const ROOT_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT_DIR, 'local-web-app');
const SERVER_PATH = path.join(APP_DIR, 'server.js');
const LOG_DIR = path.join(APP_DIR, '.logs');

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT_DIR,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
    shell: Boolean(options.shell),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

async function ensureDirs() {
  await fsp.mkdir(path.join(APP_DIR, '.downloads'), { recursive: true });
  await fsp.mkdir(path.join(APP_DIR, '.browser-profile'), { recursive: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });
}

function installDependencies() {
  run(commandName('npm'), ['install']);
  try {
    require.resolve('playwright', { paths: [ROOT_DIR] });
    console.log('\nPlaywright package already installed.');
  } catch (_) {
    run(commandName('npm'), ['install', 'playwright']);
  }
  run(commandName('npx'), ['playwright', 'install', 'chromium']);
}

async function installMacLaunchAgent() {
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);
  await fsp.mkdir(launchAgentsDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${APP_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${SERVER_PATH}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>${PORT}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(LOG_DIR, 'server.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(LOG_DIR, 'server.err.log')}</string>
</dict>
</plist>
`;

  await fsp.writeFile(plistPath, plist, 'utf8');
  spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  run('launchctl', ['load', '-w', plistPath]);

  console.log(`\nAutostart installed: ${plistPath}`);
}

function installWindowsTask() {
  const taskCommand = `${quote(process.execPath)} ${quote(SERVER_PATH)}`;
  spawnSync('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'], { stdio: 'ignore' });
  run('schtasks', [
    '/Create',
    '/TN',
    WINDOWS_TASK_NAME,
    '/SC',
    'ONLOGON',
    '/TR',
    taskCommand,
    '/F',
  ]);
  run('schtasks', ['/Run', '/TN', WINDOWS_TASK_NAME]);

  console.log(`\nAutostart installed: Windows scheduled task "${WINDOWS_TASK_NAME}"`);
}

async function installAutostart() {
  if (process.platform === 'darwin') {
    await installMacLaunchAgent();
    return;
  }

  if (process.platform === 'win32') {
    installWindowsTask();
    return;
  }

  throw new Error(`Unsupported OS for autostart: ${process.platform}. macOS and Windows are supported.`);
}

async function main() {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error(`Local app server not found: ${SERVER_PATH}`);
  }

  await ensureDirs();
  installDependencies();
  await installAutostart();

  console.log(`\nDone. Local app will start at login and is available at http://localhost:${PORT}`);
}

main().catch((error) => {
  console.error(`\nInstall failed: ${error.message}`);
  process.exitCode = 1;
});
