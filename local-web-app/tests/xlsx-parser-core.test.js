const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../public/lib/xlsx-parser-core');

test('parseRows detects named columns case-insensitively and skips invalid quantities', () => {
  const result = parser.parseRows([
    [' Barcode ', 'ignored', ' Кол-во '],
    ['4850032652953', 'x', '20'],
    ['', 'x', '5'],
    ['4850032652954', 'x', '0'],
    ['4850032652955', 'x', '1001'],
  ]);

  assert.equal(result.error, null);
  assert.deepEqual(result.rows, [
    { barcode: '4850032652953', qty: 20, rowIndex: 2 },
  ]);
  assert.deepEqual(result.skipped, [
    { rowIndex: 3, reason: 'Пустой штрихкод' },
    { rowIndex: 4, barcode: '4850032652954', reason: 'Некорректное количество' },
    { rowIndex: 5, barcode: '4850032652955', reason: 'Количество превышает 1000' },
  ]);
});

test('parseRows falls back to first and second columns when headers are absent', () => {
  const result = parser.parseRows([
    ['4850032652953', 3],
    ['4850032652954', '4,5'],
  ]);

  assert.deepEqual(result.rows, [
    { barcode: '4850032652953', qty: 3, rowIndex: 1 },
    { barcode: '4850032652954', qty: 4.5, rowIndex: 2 },
  ]);
  assert.deepEqual(result.skipped, []);
});

test('parseRows treats label-looking first row as header', () => {
  const result = parser.parseRows([
    ['Item code', 'Count'],
    ['abc-1', '9'],
  ]);

  assert.deepEqual(result.rows, [
    { barcode: 'abc-1', qty: 9, rowIndex: 2 },
  ]);
});
