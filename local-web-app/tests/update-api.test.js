const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('update api routes proxy updater responses and errors', async () => {
  const calls = [];
  const app = createApp({
    updater: {
      async handleStatusRequest() {
        calls.push('status');
        return { current: 'v0.1.0', latest: 'v0.2.0', updateAvailable: true, busy: false, phase: 'idle', lastUpdate: null, releaseUrl: '', releaseNotes: '' };
      },
      async handleCheckRequest() {
        calls.push('check');
        return { current: 'v0.1.0', latest: 'v0.2.0', updateAvailable: true, busy: false, phase: 'idle', lastUpdate: null, releaseUrl: '', releaseNotes: '' };
      },
      async handleInstallRequest(input) {
        calls.push(['install', input.force]);
        const error = new Error('busy');
        error.statusCode = 409;
        throw error;
      },
      start() {
        calls.push('start');
        return Promise.resolve();
      },
    },
  });

  const baseUrl = await listen(app.server);

  const statusResponse = await fetch(`${baseUrl}/api/update/status`);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).current, 'v0.1.0');

  const checkResponse = await fetch(`${baseUrl}/api/update/check`, { method: 'POST' });
  assert.equal(checkResponse.status, 200);

  const installResponse = await fetch(`${baseUrl}/api/update/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  });
  assert.equal(installResponse.status, 409);
  assert.equal((await installResponse.json()).error, 'busy');
  assert.deepEqual(calls, ['status', 'check', ['install', true]]);

  await new Promise((resolve) => app.server.close(resolve));
});
