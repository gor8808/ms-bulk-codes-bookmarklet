const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateOutcome,
  firstFreshError
} = require('../extension/lib/outcome-evaluator.js');

test('firstFreshError returns only new error text', () => {
  const fresh = firstFreshError(['Код уже добавлен'], ['Код уже добавлен', 'Поле невалидно']);
  assert.equal(fresh, 'Поле невалидно');
});

test('evaluateOutcome detects cleared field as success', () => {
  const result = evaluateOutcome(
    { rowCount: 10, value: 'ABC', errorTexts: [] },
    { exists: true, rowCount: 10, value: '', errorTexts: [] }
  );

  assert.equal(result.done, true);
  assert.equal(result.status, 'added');
  assert.equal(result.reason, 'cleared');
});

test('evaluateOutcome detects added row as success', () => {
  const result = evaluateOutcome(
    { rowCount: 10, value: 'ABC', errorTexts: [] },
    { exists: true, rowCount: 11, value: 'ABC', errorTexts: [] }
  );

  assert.equal(result.status, 'added');
  assert.equal(result.reason, 'row_added');
});

test('evaluateOutcome detects fresh error as failure', () => {
  const result = evaluateOutcome(
    { rowCount: 10, value: 'ABC', errorTexts: ['Old error'] },
    { exists: true, rowCount: 10, value: 'ABC', errorTexts: ['Old error', 'Код уже добавлен'] }
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'Код уже добавлен');
});
