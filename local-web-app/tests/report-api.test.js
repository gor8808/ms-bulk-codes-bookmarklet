const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { ReportConfigStore } = require('../server/lib/error-report');

const DOCUMENT_ID = '39732d8d-5124-11f1-0a80-1385001c4e14';
const ACCOUNT = '22920a00-185d-11ec-0a80-04c00001a91c';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function startReceiver() {
  const received = [];
  let notify;
  const first = new Promise((resolve) => { notify = resolve; });
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200);
      res.end('{}');
      notify();
    });
  });
  return { server, received, first };
}

async function waitForDone(baseUrl, runId) {
  const response = await fetch(`${baseUrl}/api/print/runs/${runId}/events`);
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of response.body) {
    text += decoder.decode(chunk, { stream: true });
    if (text.includes('"type":"done"')) {
      break;
    }
  }
  return text;
}

test('report-config endpoints store the url without echoing the key back', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-api-'));
  const app = createApp({
    updater: { getStatus: () => ({ current: 'v0.1.8' }), start() {}, stop() {} },
    reportConfigStore: new ReportConfigStore(path.join(dir, 'report-url.txt'), {}),
  });
  const baseUrl = await listen(app.server);
  t.after(async () => {
    app.server.close();
    app.server.closeAllConnections();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const post = (url) => fetch(`${baseUrl}/api/report-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  assert.deepEqual(await (await fetch(`${baseUrl}/api/report-config`)).json(), { ok: true, configured: false, host: '' });
  const saved = await (await post('https://topsecretkey@o1.ingest.sentry.io/4507')).json();
  assert.deepEqual(saved, { ok: true, configured: true, host: 'o1.ingest.sentry.io' });
  assert.equal(JSON.stringify(saved).includes('topsecretkey'), false);
  const rejected = await post('http://example.com/x');
  assert.equal(rejected.status, 400);
  assert.deepEqual(await (await post('')).json(), { ok: true, configured: false, host: '' });
});

test('a failing print run automatically sends a redacted report to the configured url', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-api-'));
  const receiver = startReceiver();
  const receiverUrl = await listen(receiver.server);
  const configStore = new ReportConfigStore(path.join(dir, 'report-url.txt'), {});
  await configStore.save(`${receiverUrl}/report`);

  const app = createApp({
    updater: { getStatus: () => ({ current: 'v0.1.8' }), start() {}, stop() {} },
    reportConfigStore: configStore,
    msClient: {
      async getEmissionOrder(_, id) { return { id, name: '00468', accountId: ACCOUNT }; },
      async getEmissionOrderPositions() {
        return [{ id: 'pos-1', quantity: 5, productName: 'Секретный товар', article: 'a' }];
      },
    },
    printRpcClient: {
      async requestPositionPdf() {
        const error = new Error(`Протокол печати МойСклад изменился. Invalid type signature for ${ACCOUNT} by user@example.com`);
        error.status = undefined;
        error.gwtException = true;
        throw error;
      },
      getReportContext() { return { rpcVersion: 'r1742', signatureDrift: ['Type: 1 -> 2'] }; },
    },
  });
  const baseUrl = await listen(app.server);
  t.after(async () => {
    app.server.close();
    app.server.closeAllConnections();
    receiver.server.close();
    receiver.server.closeAllConnections();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const start = await fetch(`${baseUrl}/api/print/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: `https://online.moysklad.ru/app/#emissionorder/edit?id=${DOCUMENT_ID}`,
      settings: { apiToken: 'tok-secret-1234' },
    }),
  });
  const { runId } = await start.json();
  const events = await waitForDone(baseUrl, runId);
  assert.match(events, /Не создан ни один PDF/);

  await Promise.race([receiver.first, new Promise((_, reject) => setTimeout(() => reject(new Error('no report received')), 3000))]);
  assert.equal(receiver.received.length, 1);
  assert.equal(receiver.received[0].url, '/report');
  const body = receiver.received[0].body;
  const report = JSON.parse(body);
  assert.equal(report.app.version, 'v0.1.8');
  assert.equal(report.runtime.rpcVersion, 'r1742');
  assert.deepEqual(report.totals, { positions: 1, created: 0, failed: 1 });
  assert.equal(report.groups[0].stage, 'request');
  assert.equal(report.groups[0].kind, 'signature-mismatch');
  for (const secret of ['tok-secret-1234', 'user@example.com', ACCOUNT, 'Секретный товар', '00468']) {
    assert.equal(body.includes(secret), false, `report leaked ${secret}`);
  }
});

test('a failing print run still completes when no report url is configured', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-api-'));
  const app = createApp({
    updater: { getStatus: () => ({ current: 'v0.1.8' }), start() {}, stop() {} },
    reportConfigStore: new ReportConfigStore(path.join(dir, 'report-url.txt'), {}),
    msClient: {
      async getEmissionOrder(_, id) { return { id, name: '00468', accountId: ACCOUNT }; },
      async getEmissionOrderPositions() { return [{ id: 'pos-1', quantity: 5, productName: 'A', article: 'a' }]; },
    },
    printRpcClient: {
      async requestPositionPdf() { throw new Error('boom'); },
    },
  });
  const baseUrl = await listen(app.server);
  t.after(async () => {
    app.server.close();
    app.server.closeAllConnections();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const start = await fetch(`${baseUrl}/api/print/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: DOCUMENT_ID, settings: { apiToken: 'token' } }),
  });
  const { runId } = await start.json();
  assert.match(await waitForDone(baseUrl, runId), /Не создан ни один PDF.*boom/);
});
