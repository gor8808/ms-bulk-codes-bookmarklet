const test = require('node:test');
const assert = require('node:assert/strict');
const { EmissionOrderService, buildOrderDescription, normalizeTrackingType } = require('../server/lib/emission-order-service');
const { MsApiError } = require('../server/lib/ms-api');

function buildRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    barcode: `barcode-${index + 1}`,
    qty: index + 1,
    rowIndex: index + 1,
  }));
}

function buildSettings() {
  return {
    apiToken: 'token',
    organizationHref: 'https://example.test/org/1',
    emissionType: 'REMAINS',
    trackingType: 'LP_CLOTHES',
  };
}

test('EmissionOrderService chunks successful lookups into batches of ten', async () => {
  const createPayloads = [];
  const service = new EmissionOrderService({
    async findAssortmentByBarcode(_, barcode) {
      return { href: `href-${barcode}`, type: 'product', name: `Name ${barcode}` };
    },
    async createEmissionOrder(_, payload) {
      createPayloads.push(payload);
      return { id: String(createPayloads.length), name: `EO-${createPayloads.length}`, href: 'doc-href' };
    },
  });

  const result = await service.run({
    rows: buildRows(21),
    fileName: 'заказ.xls',
    settings: buildSettings(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.documentsCreated, 3);
  assert.equal(result.result.successful.length, 21);
  assert.deepEqual(createPayloads.map((payload) => payload.positions.length), [10, 10, 1]);
  assert.deepEqual(createPayloads.map((payload) => payload.description), [
    'Имя файла: заказ.xls\nНомер файла: 1\nЗагружено скриптом от Gor',
    'Имя файла: заказ.xls\nНомер файла: 2\nЗагружено скриптом от Gor',
    'Имя файла: заказ.xls\nНомер файла: 3\nЗагружено скриптом от Gor',
  ]);
});

test('buildOrderDescription creates Russian document comment with file name', () => {
  assert.equal(
    buildOrderDescription('ЗАКАЗ.xls', 4),
    'Имя файла: ЗАКАЗ.xls\nНомер файла: 4\nЗагружено скриптом от Gor',
  );
});

test('normalizeTrackingType maps old UI aliases to MoySklad API values', () => {
  assert.equal(normalizeTrackingType('CLOTHES'), 'LP_CLOTHES');
  assert.equal(normalizeTrackingType('FUR'), 'FURSLP');
  assert.equal(normalizeTrackingType('BEER'), 'BEER_ALCOHOL');
  assert.equal(normalizeTrackingType('WHEELCHAIRS'), 'MEDICAL_DEVICES');
  assert.equal(normalizeTrackingType('SHOES'), 'SHOES');
});

test('EmissionOrderService records not found barcodes and failed create batch rows', async () => {
  const service = new EmissionOrderService({
    async findAssortmentByBarcode(_, barcode) {
      if (barcode === 'barcode-2') {
        return null;
      }
      return { href: `href-${barcode}`, type: 'product', name: `Name ${barcode}` };
    },
    async createEmissionOrder() {
      throw new MsApiError('wrong tracking type', 422, {});
    },
  });

  const result = await service.run({
    rows: buildRows(3),
    settings: buildSettings(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.result.failed.map((row) => row.reason), [
    'Штрихкод не найден',
    'wrong tracking type',
    'wrong tracking type',
  ]);
  assert.equal(result.result.successful.length, 0);
});

test('EmissionOrderService stops between lookups', async () => {
  const progress = [];
  const service = new EmissionOrderService({
    async findAssortmentByBarcode(_, barcode) {
      return { href: `href-${barcode}`, type: 'product', name: barcode };
    },
    async createEmissionOrder() {
      return { id: '1', name: 'EO-1', href: 'href' };
    },
  });

  const result = await service.run({
    rows: buildRows(4),
    settings: buildSettings(),
  }, {
    onProgress(payload) {
      progress.push(payload);
    },
    isStopped() {
      return progress.length >= 1;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.failed.filter((row) => row.reason === 'Остановлено пользователем').length, 4);
  assert.equal(result.result.successful.length, 0);
});

test('EmissionOrderService aborts remaining lookups after unauthorized token', async () => {
  const service = new EmissionOrderService({
    async findAssortmentByBarcode() {
      throw new MsApiError('Неверный токен', 401, {});
    },
    async createEmissionOrder() {
      throw new Error('should not create');
    },
  });

  const result = await service.run({
    rows: buildRows(3),
    settings: buildSettings(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.failed.length, 3);
  assert.deepEqual(result.result.failed.map((row) => row.reason), [
    'Неверный токен',
    'Неверный токен',
    'Неверный токен',
  ]);
});
