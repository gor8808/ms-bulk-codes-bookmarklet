const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_SETTINGS = {
  authMode: 'token',
  apiToken: '',
  login: '',
  password: '',
  organizationHref: '',
  organizationName: '',
  emissionType: 'REMAINS',
  trackingType: 'LP_CLOTHES',
};

class SettingsFileStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { ...DEFAULT_SETTINGS };
      }

      throw error;
    }
  }

  async save(settings) {
    const next = { ...DEFAULT_SETTINGS, ...settings };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return next;
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  SettingsFileStore,
};
