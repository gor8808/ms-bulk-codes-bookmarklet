const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractServiceReason,
  isSuccessfulServiceResponse
} = require('../extension-poc/lib/response-parser.js');

test('extractServiceReason pulls useful message from json body', () => {
  const reason = extractServiceReason([
    {
      body: JSON.stringify({
        error: {
          message: 'Код уже добавлен в документ'
        }
      })
    }
  ]);

  assert.equal(reason, 'Код уже добавлен в документ');
});

test('extractServiceReason returns empty string when nothing useful found', () => {
  const reason = extractServiceReason([
    {
      body: JSON.stringify({ ok: true, result: [] })
    }
  ]);

  assert.match(reason, /"ok":true/);
});

test('extractServiceReason falls back to raw body snippet', () => {
  const reason = extractServiceReason([
    {
      body: 'SIMPLE RAW RESPONSE WITHOUT JSON'
    }
  ]);

  assert.equal(reason, 'SIMPLE RAW RESPONSE WITHOUT JSON');
});

test('isSuccessfulServiceResponse detects GWT ok payload', () => {
  assert.equal(isSuccessfulServiceResponse([{ body: '//OK[1,"A"]' }]), true);
  assert.equal(isSuccessfulServiceResponse([{ body: '//EX[1,"A"]' }]), false);
});
