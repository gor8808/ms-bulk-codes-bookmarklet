const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmissionOrderId,
  parseEmissionOrderUrls,
} = require('../server/lib/print-url-parser');

const ID = '39732d8d-5124-11f1-0a80-1385001c4e14';

test('parseEmissionOrderId extracts id from MoySklad app URL', () => {
  assert.equal(parseEmissionOrderId(`https://online.moysklad.ru/app/#emissionorder/edit?id=${ID}`), ID);
});

test('parseEmissionOrderId accepts direct UUID and JSON API href', () => {
  assert.equal(parseEmissionOrderId(ID), ID);
  assert.equal(parseEmissionOrderId(`https://api.moysklad.ru/api/remap/1.2/entity/emissionorder/${ID}`), ID);
});

test('parseEmissionOrderUrls deduplicates valid ids and reports invalid input', () => {
  assert.deepEqual(parseEmissionOrderUrls([
    `https://online.moysklad.ru/app/#emissionorder/edit?id=${ID}`,
    ID,
    'not-a-url',
    '',
  ]), {
    ids: [ID],
    invalid: ['not-a-url'],
  });
});
