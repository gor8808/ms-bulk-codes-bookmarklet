(function () {
  const POLL_INTERVAL_MS = 5000;
  const RESTART_POLL_INTERVAL_MS = 2000;
  const SUCCESS_TOAST_WINDOW_MS = 8000;

  const els = {
    banner: document.getElementById('updateBanner'),
    toast: document.getElementById('updateToast'),
    versionText: document.getElementById('updateVersionText'),
    checkBtn: document.getElementById('checkUpdatesBtn'),
  };

  if (!els.banner || !els.toast || !els.versionText || !els.checkBtn || !window.ApiClient) {
    return;
  }

  const state = {
    supported: true,
    pollTimer: null,
    toastTimer: null,
    latestStatus: null,
    checking: false,
    installing: false,
    reconnectAfterRestart: false,
    lastSuccessToastKey: '',
  };

  function setCheckButtonState(busy) {
    els.checkBtn.disabled = busy || !state.supported;
    els.checkBtn.textContent = busy ? 'Проверка...' : 'Проверить обновления';
  }

  function showToast(message, tone) {
    if (!message) {
      els.toast.className = 'update-toast hidden';
      els.toast.textContent = '';
      return;
    }

    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.className = `update-toast update-toast--${tone || 'info'}`;
    state.toastTimer = setTimeout(() => {
      showToast('');
    }, SUCCESS_TOAST_WINDOW_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePoll(delayMs) {
    stopPolling();
    state.pollTimer = setTimeout(() => {
      pollStatus().catch(() => {});
    }, delayMs);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function describePhase(phase) {
    switch (phase) {
      case 'pulling':
        return 'Получение релиза';
      case 'installing':
        return 'Установка зависимостей';
      case 'restarting':
        return 'Перезапуск приложения';
      case 'failed':
        return 'Обновление не удалось';
      default:
        return 'Подготовка обновления';
    }
  }

  function formatVersionText(status) {
    if (!status) {
      return 'Недоступно';
    }

    const current = status.current || 'неизвестно';
    if (status.latest && status.latest !== current) {
      return `${current} -> ${status.latest}`;
    }

    return current;
  }

  function renderFooter(status) {
    els.versionText.textContent = formatVersionText(status);
    if (!state.supported) {
      els.versionText.textContent = 'Недоступно';
      els.checkBtn.disabled = true;
      els.checkBtn.textContent = 'Обновления недоступны';
      return;
    }

    setCheckButtonState(state.checking);
  }

  function renderBanner(status) {
    if (!status) {
      els.banner.className = 'update-banner hidden';
      els.banner.innerHTML = '';
      return;
    }

    const latest = escapeHtml(status.latest || status.current || '');
    const releaseUrl = status.releaseUrl ? ` <a href="${escapeHtml(status.releaseUrl)}" target="_blank" rel="noreferrer">Что нового</a>` : '';
    const hasFailure = status.phase === 'failed' || (status.lastUpdate && status.lastUpdate.error);
    const isWorking = status.phase === 'pulling' || status.phase === 'installing';
    const isRestarting = status.phase === 'restarting' || state.reconnectAfterRestart;
    const shouldPromptInstall = Boolean(status.updateAvailable) && Boolean(status.busy);

    if (hasFailure) {
      const errorText = escapeHtml((status.lastUpdate && status.lastUpdate.error) || '');
      els.banner.className = 'update-banner update-banner--error';
      els.banner.innerHTML = `
        <div class="update-banner__content">
          <strong>Обновление до ${latest || 'новой версии'} не установилось.</strong>
          <span>${errorText ? `Текущая версия сохранена. ${errorText}` : 'Текущая версия сохранена.'}</span>
        </div>
      `;
      return;
    }

    if (isRestarting) {
      els.banner.className = 'update-banner update-banner--info';
      els.banner.innerHTML = `
        <div class="update-banner__content">
          <strong>Приложение перезапускается.</strong>
          <span>Страница обновится автоматически, когда локальный сервер снова ответит.</span>
        </div>
      `;
      return;
    }

    if (isWorking) {
      els.banner.className = 'update-banner update-banner--info';
      els.banner.innerHTML = `
        <div class="update-banner__content">
          <strong>Обновление до ${latest || 'новой версии'} выполняется.</strong>
          <span>${escapeHtml(describePhase(status.phase))}...</span>
        </div>
      `;
      return;
    }

    if (shouldPromptInstall) {
      els.banner.className = 'update-banner update-banner--warning';
      els.banner.innerHTML = `
        <div class="update-banner__content">
          <strong>Доступно обновление ${latest}.</strong>
          <span>Текущий запуск не будет остановлен автоматически. Перезапустите приложение, когда будет удобно.${releaseUrl}</span>
        </div>
        <div class="update-banner__actions">
          <button id="installUpdateBtn" type="button" class="update-banner__button">Перезапустить и обновить</button>
        </div>
      `;
      const installBtn = document.getElementById('installUpdateBtn');
      installBtn.disabled = state.installing;
      installBtn.addEventListener('click', installUpdate);
      return;
    }

    els.banner.className = 'update-banner hidden';
    els.banner.innerHTML = '';
  }

  function maybeShowSuccessToast(status) {
    if (!status || !status.lastUpdate || status.lastUpdate.error) {
      return;
    }

    const ts = Date.parse(status.lastUpdate.ts || '');
    if (!Number.isFinite(ts) || (Date.now() - ts) > 60000) {
      return;
    }

    const toastKey = `${status.lastUpdate.from || ''}:${status.lastUpdate.to || ''}:${status.lastUpdate.ts || ''}`;
    if (state.lastSuccessToastKey === toastKey) {
      return;
    }

    state.lastSuccessToastKey = toastKey;
    showToast(`Обновлено до ${status.lastUpdate.to || status.latest || status.current || 'новой версии'}.`, 'success');
  }

  async function installUpdate() {
    if (state.installing || !state.supported) {
      return;
    }

    const status = state.latestStatus || {};
    const isBusy = Boolean(status.busy);
    if (isBusy) {
      const confirmed = window.confirm('Сейчас выполняется задача. Остановить её и перезапустить приложение для обновления?');
      if (!confirmed) {
        return;
      }
    }

    state.installing = true;
    renderBanner(status);
    try {
      await window.ApiClient.installUpdate(isBusy);
      state.reconnectAfterRestart = true;
      await pollStatus();
    } catch (error) {
      showToast(error.message || 'Не удалось запустить обновление.', 'error');
    } finally {
      state.installing = false;
      renderBanner(state.latestStatus);
    }
  }

  async function checkForUpdates() {
    if (state.checking || !state.supported) {
      return;
    }

    state.checking = true;
    renderFooter(state.latestStatus);
    try {
      const status = await window.ApiClient.checkForUpdates();
      applyStatus(status);
      if (!status.updateAvailable) {
        showToast(`Уже установлена последняя версия${status.current ? ` (${status.current})` : ''}.`, 'info');
      }
    } catch (error) {
      showToast(error.message || 'Не удалось проверить обновления.', 'error');
    } finally {
      state.checking = false;
      renderFooter(state.latestStatus);
    }
  }

  function applyStatus(status) {
    state.latestStatus = status;
    renderFooter(status);
    renderBanner(status);
    maybeShowSuccessToast(status);
  }

  function handleUnsupportedUpdater() {
    state.supported = false;
    stopPolling();
    renderFooter(null);
    renderBanner(null);
  }

  async function pollStatus() {
    if (!state.supported) {
      return;
    }

    try {
      const status = await window.ApiClient.getUpdateStatus();
      const wasRestarting = state.reconnectAfterRestart;
      state.reconnectAfterRestart = status.phase === 'restarting';
      applyStatus(status);
      if (wasRestarting && status.phase !== 'restarting') {
        window.location.reload();
        return;
      }
      schedulePoll(status.phase === 'restarting' ? RESTART_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    } catch (error) {
      if (/404/.test(error.message || '') || error.message === 'Not found') {
        handleUnsupportedUpdater();
        return;
      }

      if (state.reconnectAfterRestart) {
        schedulePoll(RESTART_POLL_INTERVAL_MS);
        return;
      }

      schedulePoll(POLL_INTERVAL_MS);
    }
  }

  els.checkBtn.addEventListener('click', checkForUpdates);
  renderFooter(null);
  pollStatus().catch(() => {});
}());
