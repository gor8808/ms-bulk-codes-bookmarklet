(function (root) {
  'use strict';

  function unique(list) {
    return Array.from(new Set((list || []).filter(Boolean)));
  }

  function firstFreshError(baselineErrors, currentErrors) {
    const seen = new Set(unique(baselineErrors));
    return unique(currentErrors).find((msg) => !seen.has(msg)) || null;
  }

  function evaluateOutcome(baseline, current) {
    if (!current || current.exists === false) {
      return { done: true, status: 'failed', reason: 'Field disappeared' };
    }

    if (current.rowCount > baseline.rowCount) {
      return { done: true, status: 'added', reason: 'row_added' };
    }

    if (baseline.value && current.value === '') {
      return { done: true, status: 'added', reason: 'cleared' };
    }

    const freshError = firstFreshError(baseline.errorTexts, current.errorTexts);
    if (freshError) {
      return { done: true, status: 'failed', reason: freshError };
    }

    return { done: false, status: 'pending', reason: '' };
  }

  const api = {
    evaluateOutcome,
    firstFreshError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.MSBulkOutcome = api;
})(typeof self !== 'undefined' ? self : globalThis);
