const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCodeSequence,
  buildClearSequence,
  buildEnterSequence
} = require('../extension-poc/lib/cdp-sequence.js');

test('buildClearSequence emits select-all then backspace', () => {
  const seq = buildClearSequence();

  assert.equal(seq.length, 6);
  assert.equal(seq[0].method, 'Input.dispatchKeyEvent');
  assert.equal(seq[0].params.key, 'Control');
  assert.equal(seq[1].params.key, 'a');
  assert.equal(seq[1].params.modifiers, 2);
  assert.equal(seq[4].params.key, 'Backspace');
});

test('buildEnterSequence emits enter keydown and keyup', () => {
  const seq = buildEnterSequence();

  assert.deepEqual(seq.map((item) => item.params.key), ['Enter', 'Enter']);
  assert.deepEqual(seq.map((item) => item.params.type), ['rawKeyDown', 'keyUp']);
});

test('buildCodeSequence includes text insertion and optional clear', () => {
  const seq = buildCodeSequence('010ABC', { clearFirst: true });
  const insert = seq.find((item) => item.method === 'Input.insertText');

  assert.ok(insert);
  assert.equal(insert.params.text, '010ABC');
  assert.deepEqual(seq.slice(-2).map((item) => item.params.key), ['Enter', 'Enter']);
  assert.equal(seq[0].params.key, 'Control');
});
