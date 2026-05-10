(function () {
  'use strict';

  const T = {
    noCodes: 'Список пуст. Добавьте хотя бы один код.',
    running: 'Добавляется код',
    stopping: 'Остановка...',
    copy: 'Скопировать ошибки',
    copied: 'Скопировано',
    noFailed: 'Ошибок нет',
    progressIdle: 'Подготовка...',
    summaryPrefix: 'Добавлено: '
  };

  const els = {
    inputView: document.getElementById('inputView'),
    progressView: document.getElementById('progressView'),
    summaryView: document.getElementById('summaryView'),
    codes: document.getElementById('codes'),
    diagnosticsToggle: document.getElementById('diagnosticsToggle'),
    diagnosticsPanel: document.getElementById('diagnosticsPanel'),
    clearFirst: document.getElementById('clearFirst'),
    delayMs: document.getElementById('delayMs'),
    timeoutMs: document.getElementById('timeoutMs'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    copyBtn: document.getElementById('copyBtn'),
    resetBtn: document.getElementById('resetBtn'),
    progressLine: document.getElementById('progressLine'),
    progressCounts: document.getElementById('progressCounts'),
    summaryCounts: document.getElementById('summaryCounts'),
    summaryDetails: document.getElementById('summaryDetails'),
    status: document.getElementById('status')
  };

  let currentSession = null;
  let diagnosticsOpen = false;

  function showView(name) {
    const views = {
      input: els.inputView,
      progress: els.progressView,
      summary: els.summaryView
    };

    Object.entries(views).forEach(([key, node]) => {
      node.classList.toggle('hidden', key !== name);
    });
  }

  function setStatus(text) {
    const value = String(text || '').trim();
    els.status.textContent = value;
    els.status.classList.toggle('hidden', !value);
  }

  function clearStatus() {
    setStatus('');
  }

  function renderDiagnostics() {
    els.diagnosticsPanel.classList.toggle('hidden', !diagnosticsOpen);
    els.diagnosticsToggle.textContent = diagnosticsOpen ? 'Скрыть диагностику' : 'Диагностика';
  }

  function progressText(session) {
    return '✓ ' + session.added + ' | ✗ ' + session.failed + ' | последний: ' + session.lastStatus;
  }

  function updateProgress(session, index) {
    els.progressLine.textContent = T.running + ' ' + index + ' из ' + session.codes.length;
    els.progressCounts.textContent = progressText(session);
  }

  function summaryText(summary) {
    return T.summaryPrefix + summary.added + ' | Ошибки: ' + summary.failed + ' | Пропущено: ' + summary.skipped;
  }

  async function copyFailed(summary) {
    if (!summary.failedItems.length) {
      els.copyBtn.textContent = T.noFailed;
      setTimeout(() => {
        els.copyBtn.textContent = T.copy;
      }, 1200);
      return;
    }

    const text = self.MSBulkSession.formatFailedCodes(summary);
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      els.summaryDetails.focus();
      els.summaryDetails.select();
      document.execCommand('copy');
    }

    els.copyBtn.textContent = T.copied;
    setTimeout(() => {
      els.copyBtn.textContent = T.copy;
    }, 1200);
  }

  function renderSummary(summary) {
    els.summaryCounts.textContent = summaryText(summary);
    els.summaryDetails.value = self.MSBulkSession.formatFailedDetails(summary);
    els.copyBtn.textContent = T.copy;
    currentSession = summary;
    showView('summary');
  }

  function resetUI() {
    currentSession = null;
    clearStatus();
    els.stopBtn.disabled = false;
    els.stopBtn.textContent = 'Стоп';
    showView('input');
    els.codes.focus();
  }

  async function sendSingleCode(payload) {
    const response = await chrome.runtime.sendMessage({
      type: 'RUN_SINGLE_CODE',
      payload
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : 'Неизвестная ошибка');
    }

    return response.result;
  }

  async function startRun() {
    const parsed = self.MSBulkSession.parseCodes(els.codes.value);
    if (!parsed.codes.length) {
      setStatus(T.noCodes);
      return;
    }

    clearStatus();

    const session = self.MSBulkSession.createSession(parsed);
    currentSession = session;
    const delayMs = Number(els.delayMs.value || 0);
    const timeoutMs = Number(els.timeoutMs.value || 0);

    showView('progress');
    els.progressLine.textContent = T.progressIdle;
    els.progressCounts.textContent = progressText(session);

    for (let i = 0; i < session.codes.length; i += 1) {
      if (session.stopRequested) break;

      const code = session.codes[i];
      updateProgress(session, i + 1);

      try {
        const result = await sendSingleCode({
          code,
          clearFirst: !!els.clearFirst.checked,
          timeoutMs: Number.isFinite(timeoutMs) ? Math.max(500, timeoutMs) : 5000
        });
        const classified = self.MSBulkSession.classifyWorkerResult(result);

        self.MSBulkSession.registerResult(session, code, classified);

        if (classified.status !== 'added') {
          setStatus([
            'Код: ' + code,
            'Статус: ' + result.status,
            'Причина: ' + classified.reason,
            result.network && result.network.length
              ? 'Запросы: ' + result.network.map((item) => item.url).join(' | ')
              : ''
          ].filter(Boolean).join('\n'));
        } else {
          clearStatus();
        }
      } catch (error) {
        self.MSBulkSession.registerResult(session, code, {
          status: 'failed',
          reason: error && error.message ? error.message : String(error)
        });
        setStatus('Ошибка: ' + (error && error.message ? error.message : String(error)));
      }

      els.progressCounts.textContent = progressText(session);

      if (!session.stopRequested && i < session.codes.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
      }
    }

    renderSummary(self.MSBulkSession.finalizeSession(session));
  }

  els.sendBtn.addEventListener('click', startRun);

  els.stopBtn.addEventListener('click', () => {
    if (!currentSession) return;
    currentSession.stopRequested = true;
    els.stopBtn.disabled = true;
    els.stopBtn.textContent = T.stopping;
  });

  els.copyBtn.addEventListener('click', () => {
    if (currentSession) {
      copyFailed(currentSession);
    }
  });

  els.diagnosticsToggle.addEventListener('click', () => {
    diagnosticsOpen = !diagnosticsOpen;
    renderDiagnostics();
  });

  els.resetBtn.addEventListener('click', resetUI);

  renderDiagnostics();
  resetUI();
})();
