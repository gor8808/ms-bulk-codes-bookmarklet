const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateOutcome
} = require('../extension-poc/lib/outcome-evaluator.js');

test('disappeared field remains a transition candidate for follow-up observation', () => {
  const result = evaluateOutcome(
    { rowCount: 5, value: 'ABC', errorTexts: [], rowTexts: ['row1'] },
    { exists: false, rowCount: 5, value: '', errorTexts: [], rowTexts: ['row1'] }
  );

  assert.equal(result.done, true);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'Field disappeared');
});
