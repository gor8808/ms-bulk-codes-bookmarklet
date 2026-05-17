const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SettingsFileStore } = require('../server/lib/settings-file-store');

test('SettingsFileStore saves and loads credentials from an ignored local file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-settings-'));
  const store = new SettingsFileStore(path.join(dir, '.env', 'settings.json'));

  const saved = await store.save({
    authMode: 'basic',
    login: 'user@example.com',
    password: 'secret',
    organizationHref: 'org-href',
    organizationName: 'Org',
  });

  assert.equal(saved.authMode, 'basic');
  assert.equal(saved.login, 'user@example.com');
  assert.equal(saved.password, 'secret');
  assert.equal(saved.emissionType, 'REMAINS');

  const loaded = await store.load();
  assert.equal(loaded.login, 'user@example.com');
  assert.equal(loaded.password, 'secret');
  assert.equal(loaded.organizationHref, 'org-href');
});
