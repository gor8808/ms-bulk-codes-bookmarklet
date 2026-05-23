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
    { documentId: DOCUMENT_ID, positionId: 'pos-1', quantity: 45 },
    { documentId: DOCUMENT_ID, positionId: 'pos-2', quantity: 12 },
  ]);
  assert.deepEqual(calls.entries.map((entry) => entry.name), [
    'Bdm2-55d БЕЛЫЙ р.104(36-48) - 45шт.pdf',
    'Bdm2-55d БЕЛЫЙ р.104(36-48) - 12шт.pdf',
  ]);
  assert.equal(progress.length, 2);
  assert.equal(progress[1].positionsCurrent, 2);
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
