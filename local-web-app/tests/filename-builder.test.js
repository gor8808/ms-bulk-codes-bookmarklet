const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPdfFileName,
  dedupeFileName,
  sanitizeZipFolderName,
} = require('../server/lib/filename-builder');

test('buildPdfFileName keeps product name from article and removes trailing marker', () => {
  assert.equal(buildPdfFileName({
    productName: 'Боди для малышей МАЙКА с Лямками Bdm2-55d БЕЛЫЙ р.104(36-48) (МАТ)',
    article: 'Bdm2-55d',
  }), 'Bdm2-55d БЕЛЫЙ р.104(36-48).pdf');
});

test('buildPdfFileName removes leading barcode and invalid filename characters', () => {
  assert.equal(buildPdfFileName({
    productName: '4601234567890 Bdm2-55d БЕЛЫЙ/СИНИЙ р.62? (МАТ)',
    article: 'Bdm2-55d',
  }), 'Bdm2-55d БЕЛЫЙ СИНИЙ р.62.pdf');
});

test('buildPdfFileName falls back to article or generic position name', () => {
  assert.equal(buildPdfFileName({ productName: '', article: 'ABC-1' }), 'ABC-1.pdf');
  assert.equal(buildPdfFileName({ productName: '', article: '' }), 'position.pdf');
});

test('dedupeFileName appends numeric suffixes for repeated names', () => {
  const used = new Set();
  assert.equal(dedupeFileName('item.pdf', used), 'item.pdf');
  assert.equal(dedupeFileName('item.pdf', used), 'item (2).pdf');
  assert.equal(dedupeFileName('item.pdf', used), 'item (3).pdf');
});

test('sanitizeZipFolderName removes filesystem-invalid characters', () => {
  assert.equal(sanitizeZipFolderName('00468/May?'), '00468 May');
  assert.equal(sanitizeZipFolderName(''), 'document');
});
