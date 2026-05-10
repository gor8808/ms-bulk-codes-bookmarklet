const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCodes,
  createSession,
  classifyWorkerResult,
  registerResult,
  finalizeSession,
  formatFailedDetails,
  formatFailedCodes
} = require('../extension-poc/lib/bulk-session.js');

test('parseCodes trims values and counts blank lines as skipped', () => {
  const parsed = parseCodes('CODE-1\n\n CODE-2 \r\n');
  assert.deepEqual(parsed, { codes: ['CODE-1', 'CODE-2'], skipped: 2 });
});

test('session aggregates added and failed items', () => {
  const session = createSession({ codes: ['A', 'B', 'C'], skipped: 1 });

  registerResult(session, 'A', { status: 'added' });
  registerResult(session, 'B', { status: 'failed', reason: 'Код уже добавлен' });

  const summary = finalizeSession(session);
  assert.equal(summary.added, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.failedItems[0].reason, 'Код уже добавлен');
});

test('formatters return Russian fallback and copy text', () => {
  const summary = {
    failedItems: [
      { code: 'X', reason: 'Ошибка 1' },
      { code: 'Y', reason: 'Ошибка 2' }
    ]
  };

  assert.match(formatFailedDetails(summary), /X -> Ошибка 1/);
  assert.equal(formatFailedCodes(summary), 'X\nY');
  assert.equal(formatFailedDetails({ failedItems: [] }), 'Ошибок нет');
});

test('classifyWorkerResult treats row-changed transition as added', () => {
  const classified = classifyWorkerResult({
    status: 'transition',
    reason: 'field_disappeared_row_changed'
  });

  assert.deepEqual(classified, {
    status: 'added',
    reason: 'Поле обновилось, строка изменилась'
  });
});

test('classifyWorkerResult keeps no-visible-change transition as failed', () => {
  const classified = classifyWorkerResult({
    status: 'transition',
    reason: 'field_disappeared_no_visible_change'
  });

  assert.deepEqual(classified, {
    status: 'failed',
    reason: 'Поле обновилось, но видимого изменения нет'
  });
});

test('classifyWorkerResult treats no-visible-change with service OK as added', () => {
  const classified = classifyWorkerResult({
    status: 'transition',
    reason: 'field_disappeared_no_visible_change',
    serviceOk: true
  });

  assert.deepEqual(classified, {
    status: 'added',
    reason: 'Сервис вернул OK'
  });
});

test('input parsing preserves one code per line without concatenation assumptions', () => {
  const parsed = parseCodes([
    '0104850035694646215eYf!davipnkT',
    '0104850035694646215h:U2%\'iYKKYW',
    '0104850035694646215q:Dthef(cUJr'
  ].join('\n'));

  assert.equal(parsed.codes.length, 3);
  assert.equal(parsed.codes[0], '0104850035694646215eYf!davipnkT');
  assert.equal(parsed.codes[1], '0104850035694646215h:U2%\'iYKKYW');
  assert.equal(parsed.codes[2], '0104850035694646215q:Dthef(cUJr');
});
