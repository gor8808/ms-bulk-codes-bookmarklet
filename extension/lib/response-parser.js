(function (root) {
  'use strict';

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isUsefulReason(text) {
    const low = cleanText(text).toLowerCase();
    if (!low || low.length < 3 || low.length > 300) return false;
    const keys = [
      'не найден',
      'уже добав',
      'неверн',
      'ошиб',
      'формат',
      'не удалось',
      'нельзя',
      'невалид',
      'код',
      'маркиров',
      'товар',
      'колич',
      'превыш'
    ];
    return keys.some((key) => low.includes(key));
  }

  function tryParseBody(body) {
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch (_error) {
      return null;
    }
  }

  function collectStrings(value, out) {
    if (value == null) return;
    if (typeof value === 'string') {
      if (isUsefulReason(value)) out.push(cleanText(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectStrings(item, out));
      return;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach((key) => collectStrings(value[key], out));
    }
  }

  function extractServiceReason(responseBodies) {
    const reasons = [];
    const snippets = [];

    (responseBodies || []).forEach((entry) => {
      if (!entry || !entry.body) return;

      const parsed = tryParseBody(entry.body);
      if (parsed) {
        collectStrings(parsed, reasons);
        snippets.push(cleanText(JSON.stringify(parsed)).slice(0, 220));
        return;
      }

      bodyToLines(entry.body).forEach((line) => {
        if (isUsefulReason(line)) reasons.push(cleanText(line));
      });
      snippets.push(cleanText(entry.body).slice(0, 220));
    });

    return Array.from(new Set(reasons))[0] || Array.from(new Set(snippets)).find(Boolean) || '';
  }

  function isSuccessfulServiceResponse(responseBodies) {
    return (responseBodies || []).some((entry) => {
      const body = cleanText(entry && entry.body ? entry.body : '');
      return body.startsWith('//OK[') || body === '//OK';
    });
  }

  function bodyToLines(body) {
    return String(body || '')
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean);
  }

  const api = {
    extractServiceReason,
    isSuccessfulServiceResponse
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.MSBulkResponseParser = api;
})(typeof self !== 'undefined' ? self : globalThis);
