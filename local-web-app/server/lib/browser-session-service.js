const path = require('node:path');

const LOGIN_URL = 'https://online.moysklad.ru/app/';
const LOGIN_WAIT_MS = 5 * 60 * 1000;

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (_) {
    throw new Error('Playwright не установлен. Выполните npm install playwright в папке ms-bulk-codes-bookmarklet.');
  }
}

class BrowserSessionService {
  constructor(options = {}) {
    this.profileDir = options.profileDir || path.join(__dirname, '..', '..', '.browser-profile');
    this.headless = Boolean(options.headless);
    this.context = null;
    this.page = null;
    this.operation = Promise.resolve();
  }

  async withLock(action) {
    const run = this.operation.catch(() => {}).then(action);
    this.operation = run.catch(() => {});
    return run;
  }

  async launch(options = {}) {
    return this.withLock(() => this.launchUnlocked(options));
  }

  async launchUnlocked(options = {}) {
    if (this.context) {
      return this.context;
    }

    const { chromium } = loadPlaywright();
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: options.headless !== undefined ? options.headless : this.headless,
      viewport: { width: 1360, height: 900 },
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    return this.context;
  }

  async ensureLoggedIn() {
    return this.withLock(() => this.ensureLoggedInUnlocked());
  }

  async ensureLoggedInUnlocked() {
    await this.closeUnlocked();
    await this.launchUnlocked({ headless: false });
    await this.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    try {
      await this.page.waitForURL((url) => url.href.startsWith(LOGIN_URL), { timeout: LOGIN_WAIT_MS });
    } catch (_) {
      // Status check below returns a clear login state.
    }

    const loggedIn = await this.isLoggedInUnlocked();
    if (loggedIn) {
      await this.closeUnlocked();
    }

    return loggedIn;
  }

  async isLoggedIn() {
    return this.withLock(() => this.isLoggedInUnlocked());
  }

  async isLoggedInUnlocked() {
    let launchedForCheck = false;
    if (!this.context) {
      await this.launchUnlocked({ headless: true });
      launchedForCheck = true;
    }

    const cookies = await this.context.cookies('https://online.moysklad.ru');
    const loggedIn = cookies.some((cookie) => /session|moysklad|uid|sid/i.test(cookie.name));
    if (launchedForCheck) {
      await this.closeUnlocked();
    }
    return loggedIn;
  }

  async getRequestContext() {
    return this.withLock(() => this.getRequestContextUnlocked());
  }

  async getRequestContextUnlocked() {
    await this.launchUnlocked({ headless: true });
    if (!await this.isLoggedInUnlocked()) {
      throw new Error('Войдите в МойСклад через кнопку "Войти в МойСклад".');
    }
    return this.context.request;
  }

  async close() {
    return this.withLock(() => this.closeUnlocked());
  }

  async closeUnlocked() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = {
  BrowserSessionService,
};
