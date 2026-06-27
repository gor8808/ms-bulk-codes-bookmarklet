const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const GITHUB_REPO = 'gor8808/ms-bulk-codes-bookmarklet';
const POLL_INTERVAL_MS = 30 * 60 * 1000;
const STATUS_CACHE_TTL_MS = 60 * 1000;
const CHECK_RATE_LIMIT_MS = 10 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;

function createDefaultStatus() {
  return {
    current: 'unknown',
    latest: 'unknown',
    updateAvailable: false,
    busy: false,
    phase: 'idle',
    lastUpdate: null,
    releaseUrl: '',
    releaseNotes: '',
  };
}

function normalizeError(error) {
  return error && error.message ? error.message : String(error);
}

function parseVersionTag(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || '').trim());
  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number(part));
}

function compareTags(left, right) {
  const a = parseVersionTag(left);
  const b = parseVersionTag(right);
  if (!a || !b) {
    return String(left || '').localeCompare(String(right || ''));
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

function isUpdateAvailable(current, latest) {
  if (!current || !latest || current === 'unknown' || latest === 'unknown') {
    return false;
  }

  return compareTags(latest, current) > 0;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

class Updater {
  constructor(options) {
    this.repoDir = options.repoDir;
    this.appDir = options.appDir;
    this.serverPid = options.serverPid;
    this.runManagers = options.runManagers || [];
    this.githubRepo = options.githubRepo || GITHUB_REPO;
    this.pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
    this.statusCacheTtlMs = options.statusCacheTtlMs || STATUS_CACHE_TTL_MS;
    this.checkRateLimitMs = options.checkRateLimitMs || CHECK_RATE_LIMIT_MS;
    this.lockStaleMs = options.lockStaleMs || LOCK_STALE_MS;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.spawnImpl = options.spawnImpl || spawn;
    this.execFileImpl = options.execFileImpl || execFileAsync;
    this.now = options.now || (() => Date.now());
    this.status = createDefaultStatus();
    this.lastStatusRefreshAt = 0;
    this.lastCheckAt = 0;
    this.pollTimer = null;
    this.paths = {
      runner: path.join(this.appDir, 'server', 'update-runner.js'),
      lock: path.join(this.appDir, '.update-in-progress'),
      progress: path.join(this.appDir, '.update-progress'),
      lastUpdate: path.join(this.appDir, '.last-update'),
      log: path.join(this.appDir, '.update.log'),
    };
  }

  async start() {
    await this.ensureInitialStatus();
    this.schedulePoll(this.pollIntervalMs);
  }

  stop() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getStatus() {
    return { ...this.status };
  }

  async ensureInitialStatus() {
    await this.refreshStatus({ force: true }).catch(() => {});
  }

  async handleStatusRequest() {
    const isStale = (this.now() - this.lastStatusRefreshAt) > this.statusCacheTtlMs;
    if (isStale) {
      await this.refreshStatus({ force: false }).catch(() => {});
    } else {
      await this.refreshFileBackedState();
      this.status.busy = this.isBusy();
    }

    return this.getStatus();
  }

  async handleCheckRequest() {
    if ((this.now() - this.lastCheckAt) < this.checkRateLimitMs) {
      const error = new Error('Проверка уже выполнялась недавно. Повторите через несколько секунд.');
      error.statusCode = 429;
      throw error;
    }

    this.lastCheckAt = this.now();
    await this.refreshStatus({ force: true });
    return this.getStatus();
  }

  async handleInstallRequest(options = {}) {
    await this.refreshStatus({ force: true });
    if (this.isLocked()) {
      const error = new Error('Обновление уже выполняется.');
      error.statusCode = 409;
      throw error;
    }

    if (!this.status.updateAvailable) {
      const error = new Error('Новых обновлений нет.');
      error.statusCode = 409;
      throw error;
    }

    if (this.status.busy && !options.force) {
      const error = new Error('Сейчас выполняется задача. Подтвердите принудительный перезапуск.');
      error.statusCode = 409;
      throw error;
    }

    await this.spawnUpdateRunner(this.status.latest, this.status.current);
    await this.refreshFileBackedState();
    return this.getStatus();
  }

  async refreshStatus({ force }) {
    const status = createDefaultStatus();
    status.busy = this.isBusy();
    status.current = await this.getCurrentTag();
    await this.refreshFileBackedState(status);

    try {
      const release = await this.getLatestRelease(force);
      status.latest = release.tagName || status.current;
      status.releaseUrl = release.releaseUrl || '';
      status.releaseNotes = release.releaseNotes || '';
      status.updateAvailable = isUpdateAvailable(status.current, status.latest);
    } catch (error) {
      if (!status.lastUpdate || !status.lastUpdate.error) {
        status.lastUpdate = status.lastUpdate || null;
      }
      status.releaseNotes = status.releaseNotes || '';
    }

    status.busy = this.isBusy();
    this.status = status;
    this.lastStatusRefreshAt = this.now();
    return this.getStatus();
  }

  async refreshFileBackedState(targetStatus) {
    const status = targetStatus || this.status;
    const progress = await readTextIfExists(this.paths.progress);
    const lastUpdate = await readJsonIfExists(this.paths.lastUpdate);
    status.lastUpdate = lastUpdate;
    status.phase = this.resolvePhase(progress, lastUpdate);
    status.updateAvailable = status.updateAvailable || false;
    return status;
  }

  resolvePhase(progressText, lastUpdate) {
    if (this.isLocked()) {
      const phase = String(progressText || '').trim();
      if (phase === 'pulling' || phase === 'installing' || phase === 'restarting') {
        return phase;
      }
      return 'pulling';
    }

    if (lastUpdate && lastUpdate.error) {
      return 'failed';
    }

    return 'idle';
  }

  async getCurrentTag() {
    try {
      const { stdout } = await this.execFileImpl('git', ['describe', '--tags', '--abbrev=0'], {
        cwd: this.repoDir,
      });
      return stdout.trim() || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  async getLatestRelease() {
    const response = await this.fetchImpl(`https://api.github.com/repos/${this.githubRepo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ms-bulk-codes-updater',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const body = await response.json();
    return {
      tagName: body.tag_name || 'unknown',
      releaseUrl: body.html_url || '',
      releaseNotes: body.body || '',
    };
  }

  isBusy() {
    return this.runManagers.some((manager) => manager && typeof manager.hasActiveRuns === 'function' && manager.hasActiveRuns());
  }

  isLocked() {
    try {
      const stat = fs.statSync(this.paths.lock);
      return (this.now() - stat.mtimeMs) < this.lockStaleMs;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return false;
      }
      return true;
    }
  }

  async spawnUpdateRunner(targetTag, currentTag) {
    const child = this.spawnImpl(process.execPath, [
      this.paths.runner,
      JSON.stringify({
        appDir: this.appDir,
        repoDir: this.repoDir,
        targetTag,
        currentTag,
        serverPid: this.serverPid,
        lockStaleMs: this.lockStaleMs,
      }),
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  schedulePoll(delayMs) {
    this.stop();
    this.pollTimer = setTimeout(async () => {
      await this.refreshStatus({ force: true, allowInstall: true }).catch(() => {});
      this.schedulePoll(this.pollIntervalMs);
    }, delayMs);
  }
}

module.exports = {
  Updater,
  GITHUB_REPO,
  POLL_INTERVAL_MS,
  STATUS_CACHE_TTL_MS,
  LOCK_STALE_MS,
  CHECK_RATE_LIMIT_MS,
  compareTags,
  isUpdateAvailable,
};
