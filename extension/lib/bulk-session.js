(function (root) {
  'use strict';

  function parseCodes(raw) {
    const lines = String(raw || '')
      .split('\n')
      .map((line) => line.replace(/\r/g, ''));

    const codes = [];
    let skipped = 0;

    lines.forEach((line) => {
      const code = line.trim();
      if (!code) {
        skipped += 1;
      } else {
        codes.push(code);
      }
    });

    return { codes, skipped };
  }

  function createSession(parsed) {
    return {
      codes: parsed.codes.slice(),
      skippedBlank: parsed.skipped,
      processed: 0,
      added: 0,
      failed: 0,
      stopRequested: false,
      failedItems: [],
      lastStatus: '—'
    };
  }

  function classifyWorkerResult(result) {
    if (!result) {
      return {
        status: 'failed',
        reason: 'Не удалось добавить'
      };
    }

    if (result.status === 'added') {
      return {
        status: 'added',
        reason: 'Добавлено'
      };
    }

    if (result.status === 'transition') {
      if (result.reason === 'field_disappeared_row_changed') {
        return {
          status: 'added',
          reason: 'Поле обновилось, строка изменилась'
        };
      }

      if (result.reason === 'field_disappeared_no_visible_change') {
        if (result.serviceOk) {
          return {
            status: 'added',
            reason: 'Сервис вернул OK'
          };
        }
        return {
          status: 'failed',
          reason: result.serviceReason || 'Поле обновилось, но видимого изменения нет'
        };
      }
    }

    if (result.serviceOk) {
      return {
        status: 'added',
        reason: 'Сервис вернул OK'
      };
    }

    if (result.serviceReason) {
      return {
        status: 'failed',
        reason: result.serviceReason
      };
    }

    if (result.reason) {
      return {
        status: 'failed',
        reason: result.reason
      };
    }

    if (result.status === 'timeout') {
      return {
        status: 'failed',
        reason: 'Таймаут'
      };
    }

    return {
      status: 'failed',
      reason: 'Не удалось добавить'
    };
  }

  function registerResult(session, code, result) {
    session.processed += 1;

    if (result.status === 'added') {
      session.added += 1;
      session.lastStatus = '✓ ' + code;
      return;
    }

    session.failed += 1;
    session.failedItems.push({
      code,
      reason: result.reason || 'Не удалось добавить',
      status: result.status || 'failed'
    });
    session.lastStatus = '✗ ' + code;
  }

  function finalizeSession(session) {
    return {
      added: session.added,
      failed: session.failed,
      skipped: session.skippedBlank + Math.max(0, session.codes.length - session.processed),
      failedItems: session.failedItems.slice()
    };
  }

  function formatFailedDetails(summary) {
    if (!summary.failedItems.length) {
      return 'Ошибок нет';
    }

    return summary.failedItems
      .map((item) => item.code + ' -> ' + item.reason)
      .join('\n');
  }

  function formatFailedCodes(summary) {
    return summary.failedItems.map((item) => item.code).join('\n');
  }

  const api = {
    parseCodes,
    createSession,
    classifyWorkerResult,
    registerResult,
    finalizeSession,
    formatFailedDetails,
    formatFailedCodes
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.MSBulkSession = api;
})(typeof self !== 'undefined' ? self : globalThis);
