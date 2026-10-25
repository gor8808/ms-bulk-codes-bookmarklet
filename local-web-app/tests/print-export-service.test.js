const test = require('node:test');
const assert = require('node:assert/strict');
const { PrintExportService } = require('../server/lib/print-export-service');

const DOCUMENT_ID = '39732d8d-5124-11f1-0a80-1385001c4e14';

function buildService(overrides = {}) {
  const calls = {
    requested: [],
    entries: [],
  };

  const msClient = overrides.msClient || {
    async getEmissionOrder(_, id) {
      assert.equal(id, DOCUMENT_ID);
      return { id, name: '00468' };
    },
    async getEmissionOrderPositions() {
      return [
        {
          id: 'pos-1',
          quantity: 45,
          productName: 'Боди для малышей Bdm2-55d БЕЛЫЙ р.104(36-48) (МАТ)',
          article: 'Bdm2-55d',
        },
        {
          id: 'pos-2',
          quantity: 12,
          productName: 'Боди для малышей Bdm2-55d БЕЛЫЙ р.104(36-48) (МАТ)',
          article: 'Bdm2-55d',
        },
      ];
    },
  };

  const rpcClient = overrides.rpcClient || {
    async requestPositionPdf(input) {
      calls.requested.push(input);
      return `task-${input.positionId}`;
    },
    async pollPrintTask(taskId) {
      return `https://print-prod.moysklad.ru/temp/${taskId}.pdf`;
    },
    async downloadPdf(downloadUrl) {
      return Buffer.from(`PDF ${downloadUrl}`);
    },
  };

  const zipWriter = overrides.zipWriter || {
    async write(entries) {
      calls.entries.push(...entries);
      return { fileName: 'marking-labels.zip', filePath: '/tmp/marking-labels.zip' };
    },
  };

  return {
    calls,
    service: new PrintExportService({ msClient, rpcClient, zipWriter }),
  };
}

test('PrintExportService validate loads documents and builds printable file names', async () => {
  const { service } = buildService();
  const result = await service.validate({
    urls: [`https://online.moysklad.ru/app/#emissionorder/edit?id=${DOCUMENT_ID}`],
    settings: { apiToken: 'token' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.documents[0].name, '00468');
  assert.deepEqual(result.documents[0].positions.map((position) => position.fileName), [
    'Bdm2-55d БЕЛЫЙ р.104(36-48) - 45шт.pdf',
    'Bdm2-55d БЕЛЫЙ р.104(36-48) - 12шт.pdf',
  ]);
});

test('PrintExportService run prints every position, dedupes ZIP names, and reports progress', async () => {
  const { service, calls } = buildService();
  const progress = [];
  const result = await service.run({
    urls: [DOCUMENT_ID],
    settings: { apiToken: 'token' },
  }, {
    onProgress(payload) {
      progress.push(payload);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.pdfCreated, 2);
  assert.deepEqual(calls.requested, [
    { documentId: DOCUMENT_ID, positionId: 'pos-1', quantity: 45, accountId: '' },
    { documentId: DOCUMENT_ID, positionId: 'pos-2', quantity: 12, accountId: '' },
  ]);
  assert.deepEqual(calls.entries.map((entry) => entry.name), [
    'Bdm2-55d БЕЛЫЙ р.104(36-48) - 45шт.pdf',
    'Bdm2-55d БЕЛЫЙ р.104(36-48) - 12шт.pdf',
  ]);
  assert.deepEqual(progress.map((entry) => entry.phase), [
    'requesting',
    'waiting',
    'completed',
    'requesting',
    'waiting',
    'completed',
  ]);
  assert.equal(progress[5].positionsCurrent, 2);
});

test('PrintExportService run records failed positions and returns error when no PDFs were created', async () => {
  const { service } = buildService({
    rpcClient: {
      async requestPositionPdf() {
        throw new Error('RPC changed');
      },
    },
  });

  const result = await service.run({ urls: [DOCUMENT_ID], settings: { apiToken: 'token' } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Не создан ни один PDF. Первая ошибка: RPC changed');
  assert.equal(result.result.failed.length, 2);
  assert.equal(result.result.failed[0].reason, 'RPC changed');
});

test('PrintExportService passes the document account id to every print request', async () => {
  const { service, calls } = buildService({
    msClient: {
      async getEmissionOrder(_, id) {
        return { id, name: '00468', accountId: '22920a00-185d-11ec-0a80-04c00001a91c' };
      },
      async getEmissionOrderPositions() {
        return [
          { id: 'pos-1', quantity: 45, productName: 'A', article: 'a' },
          { id: 'pos-2', quantity: 12, productName: 'B', article: 'b' },
        ];
      },
    },
  });

  const result = await service.run({
    urls: [`https://online.moysklad.ru/app/#emissionorder/edit?id=${DOCUMENT_ID}`],
    settings: { apiToken: 'token' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.requested.map((call) => call.accountId), [
    '22920a00-185d-11ec-0a80-04c00001a91c',
    '22920a00-185d-11ec-0a80-04c00001a91c',
  ]);
});

test('PrintExportService reports rpc failures with their stage but not user stops', async () => {
  const sent = [];
  const reporter = { async send(payload) { sent.push(payload); } };
  const { service } = buildService({
    rpcClient: {
      async requestPositionPdf(input) {
        if (input.positionId === 'pos-2') {
          const error = new Error('HTTP 500');
          error.status = 500;
          throw error;
        }
        return `task-${input.positionId}`;
      },
      async pollPrintTask(taskId) {
        return `https://print-prod.moysklad.ru/temp/${taskId}.pdf`;
      },
      async downloadPdf() {
        return Buffer.from('PDF');
      },
      getReportContext() {
        return { rpcVersion: 'r1742' };
      },
    },
  });
  service.reporter = reporter;

  const result = await service.run({
    urls: [`https://online.moysklad.ru/app/#emissionorder/edit?id=${DOCUMENT_ID}`],
    settings: { apiToken: 'tok-1234', login: 'user@example.com' },
  });

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].totals, { positions: 2, created: 1 });
  assert.deepEqual(sent[0].context, { rpcVersion: 'r1742' });
  assert.deepEqual(sent[0].failures.map((row) => [row.stage, row.status]), [['request', 500]]);
  assert.deepEqual(sent[0].secrets, ['tok-1234', 'user@example.com', undefined]);
});

test('PrintExportService does not call the reporter when every position succeeds', async () => {
  let called = false;
  const { service } = buildService();
  service.reporter = { async send() { called = true; } };
  await service.run({
    urls: [`https://online.moysklad.ru/app/#emissionorder/edit?id=${DOCUMENT_ID}`],
    settings: { apiToken: 'token' },
  });
  assert.equal(called, false);
});

test('PrintExportService passes the position timeline and request bodies to the reporter', async () => {
  const sent = [];
  const { service } = buildService({
    rpcClient: {
      async requestPositionPdf(input) {
        if (input.positionId === 'pos-2') {
          const error = new Error('HTTP 500');
          error.status = 500;
          error.request = { path: '/app/services/print/r1742/PriceTypePrintService', body: '7|0|0|' };
          throw error;
        }
        return `task-${input.positionId}`;
      },
      async pollPrintTask(taskId) { return `https://print-prod.moysklad.ru/temp/${taskId}.pdf`; },
      async downloadPdf() { return Buffer.from('PDF'); },
    },
  });
  service.reporter = { async send(payload) { sent.push(payload); } };

  const result = await service.run({
    urls: [`https://online.moysklad.ru/app/#emissionorder/edit?id=${DOCUMENT_ID}`],
    settings: { apiToken: 'token' },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].outcomes.length, 2);
  assert.equal(sent[0].outcomes[0], null);
  assert.equal(sent[0].outcomes[1].stage, 'request');
  assert.deepEqual(sent[0].failures[0].request, { path: '/app/services/print/r1742/PriceTypePrintService', body: '7|0|0|' });
  assert.equal('request' in result.result.failed[0], false);
});

test('PrintExportService reports run level failures and rethrows them', async () => {
  const sent = [];
  const error = new Error('Сервер МойСклад недоступен');
  error.statusCode = 503;
  const { service } = buildService({
    msClient: {
      async getEmissionOrder() { throw error; },
      async getEmissionOrderPositions() { return []; },
    },
  });
  service.reporter = { async send(payload) { sent.push(payload); } };

  await assert.rejects(
    service.run({ urls: [DOCUMENT_ID], settings: { apiToken: 'token' } }),
    /Сервер МойСклад недоступен/,
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].failures[0].stage, 'validate');
  assert.equal(sent[0].failures[0].status, 503);
});
