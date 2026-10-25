const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/lib/kiz-import-core');

const GS = '\x1d';
const kiz = (gtin, serial) => `01${gtin}21${serial}${GS}91EE11${GS}92tail=`;

test('buildImport finds the exact КИЗ column and groups codes by GTIN from the code', () => {
  const result = core.buildImport([
    ['Поставка', 'GTIN', 'КИЗ нужен', 'КИЗ', 'Статус КИЗ'],
    ['WB-1', '04850000000001', 'да', kiz('04850000000001', '5AAAAAAAAAAAA'), 'В обороте'],
    ['WB-1', '04850000000001', 'да', kiz('04850000000001', '5BBBBBBBBBBBB'), 'В обороте'],
    ['WB-1', '04850000000099', 'да', kiz('04850000000002', '5CCCCCCCCCCCC'), 'В обороте'],
  ]);

  assert.equal(result.error, null);
  assert.equal(result.totalCodes, 3);
  assert.deepEqual(result.products, [
    { gtin: '04850000000001', ean13: '4850000000001', qty: 2 },
    { gtin: '04850000000002', ean13: '4850000000002', qty: 1 },
  ]);
  assert.deepEqual(result.skipped, []);
});

test('buildImport skips empty and malformed codes and counts duplicates once', () => {
  const result = core.buildImport([
    ['Поставка', 'КИЗ'],
    ['WB-1', kiz('04850000000001', '5AAAAAAAAAAAA')],
    ['WB-1', ''],
    ['WB-1', 'not-a-code'],
    ['WB-1', kiz('04850000000001', '5AAAAAAAAAAAA')],
    ['WB-1', '  ' + kiz('04850000000003', '5DDDDDDDDDDDD') + '  '],
    ['', ''],
  ]);

  assert.equal(result.error, null);
  assert.equal(result.totalCodes, 2);
  assert.deepEqual(result.products, [
    { gtin: '04850000000001', ean13: '4850000000001', qty: 1 },
    { gtin: '04850000000003', ean13: '4850000000003', qty: 1 },
  ]);
  assert.deepEqual(result.skipped, [
    { rowIndex: 3, reason: 'Пустой КИЗ' },
    { rowIndex: 4, reason: 'КИЗ не похож на код маркировки', value: 'not-a-code' },
    { rowIndex: 5, reason: 'Повтор КИЗ', value: '010485000000000121' + '5AAAAAAAAAAAA' },
  ]);
});

test('buildImport accepts codes without GS separators and with a ]C1 prefix', () => {
  const result = core.buildImport([
    ['КИЗ'],
    ['0104850000000001215AAAAAAAAAAAA91EE1192tail='],
    [']C10104850000000004215EEEEEEEEEEEE'],
  ]);

  assert.deepEqual(result.products.map((p) => p.gtin), ['04850000000001', '04850000000004']);
});

test('buildImport reports a missing КИЗ column', () => {
  const result = core.buildImport([
    ['Поставка', 'КИЗ нужен'],
    ['WB-1', 'да'],
  ]);

  assert.equal(result.error, 'В файле не найден столбец «КИЗ»');
  assert.deepEqual(result.products, []);
});

test('toCsv writes a UTF-8 BOM, semicolons and the MoySklad column names', () => {
  const csv = core.toCsv([
    { gtin: '04850000000001', ean13: '4850000000001', qty: 2 },
  ]);

  assert.equal(csv, '﻿Штрихкод GTIN;Штрихкод EAN13;Количество\r\n04850000000001;4850000000001;2\r\n');
});

test('csvFileName keeps the picked file name and swaps the extension', () => {
  assert.equal(core.csvFileName('rezultat-WB-GI-293273391.xlsx'), 'rezultat-WB-GI-293273391.csv');
  assert.equal(core.csvFileName('report.v2.XLS'), 'report.v2.csv');
  assert.equal(core.csvFileName(''), 'import.csv');
});
