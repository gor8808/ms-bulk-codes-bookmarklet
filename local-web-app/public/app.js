(function () {
  const TRACKING_TYPES = [
    { value: 'LP_CLOTHES', label: 'Одежда' },
    { value: 'SHOES', label: 'Обувь' },
    { value: 'TOBACCO', label: 'Табачная продукция' },
    { value: 'PERFUMERY', label: 'Духи и туалетная вода' },
    { value: 'TIRES', label: 'Шины и покрышки' },
    { value: 'ELECTRONICS', label: 'Фотокамеры и лампы-вспышки' },
    { value: 'VETPHARMA', label: 'Ветеринарные препараты' },
    { value: 'MILK', label: 'Молочная продукция' },
    { value: 'BICYCLE', label: 'Велосипеды' },
    { value: 'MEDICAL_DEVICES', label: 'Медизделия и кресла-коляски' },
    { value: 'OTP', label: 'Альтернативная табачная продукция' },
    { value: 'WATER', label: 'Упакованная вода' },
    { value: 'FURSLP', label: 'Натуральный мех' },
    { value: 'BEER_ALCOHOL', label: 'Пиво и слабоалкогольные напитки' },
    { value: 'NABEER', label: 'Безалкогольное пиво' },
    { value: 'LP_LINENS', label: 'Постельное белье' },
    { value: 'SOFT_DRINKS', label: 'Безалкогольные напитки' },
    { value: 'AUTO_FLUIDS', label: 'Моторные масла' },
    { value: 'CHEMISTRY', label: 'Косметика и бытовая химия' },
    { value: 'FOOD_SUPPLEMENT', label: 'БАД и специализированная пищевая продукция' },
    { value: 'GROCERY', label: 'Бакалея' },
    { value: 'PET_FOOD', label: 'Корма для животных' },
    { value: 'SANITIZER', label: 'Антисептики' },
    { value: 'SEAFOOD', label: 'Икра и морепродукты' },
    { value: 'VEGETABLE_OIL', label: 'Растительные масла' },
  ];
  const EMISSION_TYPES = [
    { value: 'LOCAL', label: 'Произведен в РФ' },
    { value: 'FOREIGN', label: 'Ввезен в РФ' },
    { value: 'REMAINS', label: 'Маркировка остатков' },
    { value: 'COMMISSION', label: 'Принят на комиссию от физического лица' },
    { value: 'CROSSBORDER', label: 'Трансграничная торговля' },
  ];

  const state = {
    settings: window.SettingsStore.load(),
    rows: [],
    skipped: [],
    fileName: '',
    runId: null,
    eventSource: null,
    printRunId: null,
    printEventSource: null,
    printValidated: null,
  };

  const els = {
    createTabBtn: document.getElementById('createTabBtn'),
    printTabBtn: document.getElementById('printTabBtn'),
    inputView: document.getElementById('inputView'),
    printInputView: document.getElementById('printInputView'),
    printProgressView: document.getElementById('printProgressView'),
    printSummaryView: document.getElementById('printSummaryView'),
    progressView: document.getElementById('progressView'),
    summaryView: document.getElementById('summaryView'),
    settingsPill: document.getElementById('settingsPill'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsPanel: document.getElementById('settingsPanel'),
    authMode: document.getElementById('authMode'),
    apiToken: document.getElementById('apiToken'),
    apiTokenError: document.getElementById('apiTokenError'),
    basicAuthFields: document.getElementById('basicAuthFields'),
    login: document.getElementById('login'),
    loginError: document.getElementById('loginError'),
    password: document.getElementById('password'),
    passwordError: document.getElementById('passwordError'),
    organizationSelect: document.getElementById('organizationSelect'),
    organizationError: document.getElementById('organizationError'),
    loadOrgsBtn: document.getElementById('loadOrgsBtn'),
    trackingType: document.getElementById('trackingType'),
    emissionType: document.getElementById('emissionType'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    settingsStatus: document.getElementById('settingsStatus'),
    chooseFileBtn: document.getElementById('chooseFileBtn'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    fileName: document.getElementById('fileName'),
    parseSummary: document.getElementById('parseSummary'),
    fileError: document.getElementById('fileError'),
    startBtn: document.getElementById('startBtn'),
    startHint: document.getElementById('startHint'),
    progressLine: document.getElementById('progressLine'),
    progressCounts: document.getElementById('progressCounts'),
    progressBar: document.getElementById('progressBar'),
    stopBtn: document.getElementById('stopBtn'),
    summaryCounts: document.getElementById('summaryCounts'),
    summaryDetails: document.getElementById('summaryDetails'),
    copyBtn: document.getElementById('copyBtn'),
    resetBtn: document.getElementById('resetBtn'),
    browserStatusPill: document.getElementById('browserStatusPill'),
    browserLoginBtn: document.getElementById('browserLoginBtn'),
    browserLoginStatus: document.getElementById('browserLoginStatus'),
    printUrls: document.getElementById('printUrls'),
    printUrlsError: document.getElementById('printUrlsError'),
    printValidation: document.getElementById('printValidation'),
    validatePrintBtn: document.getElementById('validatePrintBtn'),
    startPrintBtn: document.getElementById('startPrintBtn'),
    printProgressDocs: document.getElementById('printProgressDocs'),
    printProgressPositions: document.getElementById('printProgressPositions'),
    printProgressLast: document.getElementById('printProgressLast'),
    printProgressBar: document.getElementById('printProgressBar'),
    printSummaryCounts: document.getElementById('printSummaryCounts'),
    printSummaryDetails: document.getElementById('printSummaryDetails'),
    downloadZipLink: document.getElementById('downloadZipLink'),
    printResetBtn: document.getElementById('printResetBtn'),
  };

  function fillSelect(select, values) {
    select.innerHTML = '';
    for (const item of values) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
  }

  function showView(name) {
    els.inputView.classList.toggle('hidden', name !== 'input');
    els.printInputView.classList.toggle('hidden', name !== 'printInput');
    els.printProgressView.classList.toggle('hidden', name !== 'printProgress');
    els.printSummaryView.classList.toggle('hidden', name !== 'printSummary');
    els.progressView.classList.toggle('hidden', name !== 'progress');
    els.summaryView.classList.toggle('hidden', name !== 'summary');
    const isPrint = name.startsWith('print');
    els.createTabBtn.classList.toggle('active', !isPrint);
    els.printTabBtn.classList.toggle('active', isPrint);
  }

  function collectSettings() {
    const selectedOrg = els.organizationSelect.selectedOptions[0];
    return {
      authMode: els.authMode.value,
      apiToken: els.apiToken.value.trim(),
      login: els.login.value.trim(),
      password: els.password.value,
      organizationHref: els.organizationSelect.value,
      organizationName: selectedOrg ? selectedOrg.textContent : state.settings.organizationName,
      trackingType: els.trackingType.value,
      emissionType: els.emissionType.value,
    };
  }

  function validateSettings(settings) {
    els.apiTokenError.textContent = '';
    els.loginError.textContent = '';
    els.passwordError.textContent = '';
    els.organizationError.textContent = '';

    if (settings.authMode === 'basic') {
      if (!settings.login) {
        els.loginError.textContent = 'Введите логин';
        return false;
      }

      if (!settings.password) {
        els.passwordError.textContent = 'Введите пароль';
        return false;
      }
    } else if (!settings.apiToken) {
      els.apiTokenError.textContent = 'Введите API токен';
      return false;
    }

    if (!settings.organizationHref) {
      els.organizationError.textContent = 'Нажмите Загрузить для выбора организации';
      return false;
    }

    return true;
  }

  function refreshStartState() {
    const settings = collectSettings();
    const hasAuth = settings.authMode === 'basic'
      ? Boolean(settings.login) && Boolean(settings.password)
      : Boolean(settings.apiToken);
    const canStart = state.rows.length > 0 && hasAuth && Boolean(settings.organizationHref);
    els.startBtn.disabled = !canStart;
    if (canStart) {
      els.startHint.textContent = '';
    } else if (state.rows.length === 0) {
      els.startHint.textContent = 'Загрузите XLSX с валидными строками.';
    } else if (settings.authMode !== 'basic' && !settings.apiToken) {
      els.startHint.textContent = 'Введите API токен в настройках.';
    } else if (settings.authMode === 'basic' && (!settings.login || !settings.password)) {
      els.startHint.textContent = 'Введите логин и пароль в настройках.';
    } else if (!settings.organizationHref) {
      els.startHint.textContent = 'Нажмите "Загрузить" в настройках и выберите организацию.';
    }
    els.settingsPill.textContent = hasAuth && settings.organizationHref
      ? `Организация: ${settings.organizationName || 'выбрана'}`
      : 'Настройки не сохранены';
    els.settingsPill.classList.toggle('ok', hasAuth && settings.organizationHref);
  }

  function renderAuthMode() {
    const isBasic = els.authMode.value === 'basic';
    els.apiToken.closest('.field').classList.toggle('hidden', isBasic);
    els.basicAuthFields.classList.toggle('hidden', !isBasic);
  }

  function renderSettings() {
    const trackingTypeAliases = {
      CLOTHES: 'LP_CLOTHES',
      FUR: 'FURSLP',
      BEER: 'BEER_ALCOHOL',
      WHEELCHAIRS: 'MEDICAL_DEVICES',
    };
    els.authMode.value = state.settings.authMode || 'token';
    els.apiToken.value = state.settings.apiToken || '';
    els.login.value = state.settings.login || '';
    els.password.value = state.settings.password || '';
    els.trackingType.value = trackingTypeAliases[state.settings.trackingType] || state.settings.trackingType || 'LP_CLOTHES';
    els.emissionType.value = state.settings.emissionType || 'REMAINS';
    els.organizationSelect.innerHTML = '';

    if (state.settings.organizationHref) {
      const option = document.createElement('option');
      option.value = state.settings.organizationHref;
      option.textContent = state.settings.organizationName || state.settings.organizationHref;
      els.organizationSelect.appendChild(option);
    }

    renderAuthMode();
    refreshStartState();
  }

  function setBusy(button, busy, text) {
    button.disabled = busy;
    if (busy) {
      button.dataset.idleText = button.textContent;
      button.textContent = text;
    } else if (button.dataset.idleText) {
      button.textContent = button.dataset.idleText;
      delete button.dataset.idleText;
    }
  }

  function renderParseSummary() {
    els.parseSummary.classList.remove('hidden');
    els.parseSummary.classList.toggle('has-skipped', state.skipped.length > 0);
    const skippedText = state.skipped.length
      ? `, пропущено ${state.skipped.length}: ${state.skipped.slice(0, 3).map((row) => `${row.rowIndex} - ${row.reason}`).join('; ')}`
      : ', пропущено 0';
    els.parseSummary.textContent = `${state.rows.length} строк${skippedText}`;
  }

  async function loadOrganizations() {
    const settings = collectSettings();
    els.apiTokenError.textContent = '';
    els.loginError.textContent = '';
    els.passwordError.textContent = '';
    els.organizationError.textContent = '';
    if (!validateSettings({ ...settings, organizationHref: 'temporary' })) {
      return;
    }

    setBusy(els.loadOrgsBtn, true, 'Загрузка...');
    try {
      const response = await window.ApiClient.fetchOrganizations(settings);
      els.organizationSelect.innerHTML = '';
      for (const org of response.orgs) {
        const option = document.createElement('option');
        option.value = org.href;
        option.textContent = org.name;
        els.organizationSelect.appendChild(option);
      }

      if (response.orgs.length === 0) {
        els.organizationError.textContent = 'Организации не найдены';
      }

      if (response.orgs.length > 0) {
        await persistSettings(collectSettings());
      }

      refreshStartState();
    } catch (error) {
      els.organizationError.textContent = error.message;
    } finally {
      setBusy(els.loadOrgsBtn, false);
    }
  }

  async function persistSettings(settings) {
    const localSettings = window.SettingsStore.save(settings);
    const response = await window.ApiClient.saveSettings(localSettings);
    state.settings = response.settings;
    renderSettings();
    return response.settings;
  }

  async function saveSettings() {
    const settings = collectSettings();
    if (!validateSettings(settings)) {
      refreshStartState();
      return;
    }

    try {
      await persistSettings(settings);
      els.settingsStatus.textContent = 'Сохранено в .env/settings.json';
      refreshStartState();
      setTimeout(() => {
        els.settingsStatus.textContent = '';
      }, 1500);
    } catch (error) {
      els.settingsStatus.textContent = error.message;
    }
  }

  async function parseSelectedFile(file) {
    state.rows = [];
    state.skipped = [];
    els.fileError.textContent = '';
    els.parseSummary.classList.add('hidden');
    els.fileName.textContent = file ? file.name : 'Файл не выбран';
    state.fileName = file ? file.name : '';

    if (!file) {
      refreshStartState();
      return;
    }

    const result = await window.MSXlsxParser.parseFile(file);
    if (result.error) {
      els.fileError.textContent = result.error;
      refreshStartState();
      return;
    }

    state.rows = result.rows;
    state.skipped = result.skipped;
    renderParseSummary();
    refreshStartState();
  }

  function getDroppedFile(event) {
    const files = Array.from(event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : []);
    return files.find((file) => /\.(xlsx|xls)$/i.test(file.name)) || files[0] || null;
  }

  function updateProgress(event) {
    const label = event.step === 'lookup' ? 'Поиск штрихкодов' : 'Создание документов';
    const total = event.total || 1;
    els.progressLine.textContent = `${label}: ${event.current} из ${event.total}`;
    els.progressCounts.textContent = `✓ ${event.found || 0} | ✗ ${event.failed || 0} | последний: ${event.detail || ''}`;
    els.progressBar.style.width = `${Math.round((event.current / total) * 100)}%`;
  }

  function collectPrintUrls() {
    return els.printUrls.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function updateBrowserStatus(loggedIn) {
    els.browserStatusPill.textContent = loggedIn ? 'Вход выполнен' : 'Нужно войти';
    els.browserStatusPill.classList.toggle('ok', Boolean(loggedIn));
  }

  async function checkBrowserStatus() {
    try {
      const response = await window.ApiClient.browserStatus();
      updateBrowserStatus(response.loggedIn);
    } catch (error) {
      els.browserLoginStatus.textContent = error.message;
    }
  }

  async function loginBrowser() {
    els.browserLoginStatus.textContent = '';
    setBusy(els.browserLoginBtn, true, 'Ожидание входа...');
    try {
      const response = await window.ApiClient.browserLogin();
      updateBrowserStatus(response.loggedIn);
      els.browserLoginStatus.textContent = response.loggedIn ? 'Сессия готова' : 'Вход не обнаружен';
    } catch (error) {
      els.browserLoginStatus.textContent = error.message;
      updateBrowserStatus(false);
    } finally {
      setBusy(els.browserLoginBtn, false);
    }
  }

  function invalidatePrintValidation() {
    state.printValidated = null;
    els.startPrintBtn.disabled = true;
    els.printValidation.classList.add('hidden');
    els.printUrlsError.textContent = '';
  }

  async function validatePrintDocuments() {
    const urls = collectPrintUrls();
    els.printUrlsError.textContent = '';
    els.printValidation.classList.add('hidden');
    state.printValidated = null;
    els.startPrintBtn.disabled = true;

    if (urls.length === 0) {
      els.printUrlsError.textContent = 'Добавьте хотя бы одну ссылку';
      return;
    }

    const settings = collectSettings();
    if (!validateSettings(settings)) {
      els.printUrlsError.textContent = 'Заполните настройки API для проверки документов';
      return;
    }

    setBusy(els.validatePrintBtn, true, 'Проверка...');
    try {
      await persistSettings(settings);
      const response = await window.ApiClient.validatePrint({ urls, settings: state.settings });
      const positionCount = response.documents.reduce((sum, doc) => sum + doc.positions.length, 0);
      state.printValidated = response;
      els.printValidation.textContent = `Документы: ${response.documents.length}. Позиции: ${positionCount}.`;
      els.printValidation.classList.remove('hidden');
      els.startPrintBtn.disabled = positionCount === 0;
    } catch (error) {
      els.printUrlsError.textContent = error.message;
    } finally {
      setBusy(els.validatePrintBtn, false);
    }
  }

  function updatePrintProgress(event) {
    const total = event.positionsTotal || 1;
    els.printProgressDocs.textContent = `Документы: ${event.documentsCurrent || 0} из ${event.documentsTotal || 0}`;
    els.printProgressPositions.textContent = `Позиции: ${event.positionsCurrent || 0} из ${event.positionsTotal || 0}`;
    els.printProgressLast.textContent = `Последний файл: ${event.lastFile || ''}`;
    els.printProgressBar.style.width = `${Math.round(((event.positionsCurrent || 0) / total) * 100)}%`;
  }

  function renderPrintSummary(response) {
    showView('printSummary');
    els.downloadZipLink.classList.add('hidden');
    if (!response.ok) {
      els.printSummaryCounts.textContent = response.error;
      const failed = response.result && Array.isArray(response.result.failed) ? response.result.failed : [];
      els.printSummaryDetails.value = failed.length
        ? failed.map((row) => `${row.documentName || ''} ${row.fileName || row.positionId || ''}: ${row.reason}`).join('\n')
        : response.error;
      return;
    }

    const result = response.result;
    els.printSummaryCounts.textContent = `PDF создано: ${result.pdfCreated}. Ошибки: ${result.failed.length}. ZIP: ${result.zipFileName}`;
    els.printSummaryDetails.value = result.failed.length
      ? result.failed.map((row) => `${row.documentName || ''} ${row.fileName || row.positionId}: ${row.reason}`).join('\n')
      : 'Ошибок нет';
    els.downloadZipLink.href = window.ApiClient.getPrintDownloadUrl(state.printRunId);
    els.downloadZipLink.classList.remove('hidden');
  }

  async function startPrintRun() {
    const urls = collectPrintUrls();
    const settings = collectSettings();
    if (!validateSettings(settings)) {
      els.printUrlsError.textContent = 'Заполните настройки API для проверки документов';
      return;
    }

    await persistSettings(settings);
    showView('printProgress');
    updatePrintProgress({ documentsCurrent: 0, documentsTotal: 0, positionsCurrent: 0, positionsTotal: 0, lastFile: '' });

    try {
      const response = await window.ApiClient.startPrintRun({ urls, settings: state.settings });
      state.printRunId = response.runId;
      state.printEventSource = window.ApiClient.createPrintRunEventSource(response.runId, {
        onProgress: updatePrintProgress,
        onDone: renderPrintSummary,
        onError: (error) => renderPrintSummary({ ok: false, error: error.message }),
      });
    } catch (error) {
      renderPrintSummary({ ok: false, error: error.message });
    }
  }

  function renderSummary(response) {
    showView('summary');
    if (!response.ok) {
      els.summaryCounts.textContent = response.error;
      els.summaryDetails.value = response.error;
      return;
    }

    const result = response.result;
    els.summaryCounts.textContent = `Создано документов: ${result.documentsCreated}. Добавлено позиций: ${result.successful.length} | Ошибки: ${result.failed.length} | Пропущено: ${result.skipped.length}`;
    const failedLines = result.failed.map((row) => `Строка ${row.rowIndex}: ${row.barcode} (${row.qty}) - ${row.reason}`);
    const skippedLines = result.skipped.map((row) => `Строка ${row.rowIndex}: ${row.barcode || ''} - ${row.reason}`);
    els.summaryDetails.value = failedLines.concat(skippedLines).join('\n') || 'Ошибок нет';
  }

  async function startRun() {
    const settings = collectSettings();
    if (!validateSettings(settings)) {
      refreshStartState();
      return;
    }

    await persistSettings(settings);
    showView('progress');
    updateProgress({ step: 'lookup', current: 0, total: state.rows.length, detail: '', found: 0, failed: 0 });

    try {
      const response = await window.ApiClient.startRun({
        rows: state.rows,
        skipped: state.skipped,
        fileName: state.fileName,
        settings: state.settings,
      });
      state.runId = response.runId;
      state.eventSource = window.ApiClient.createRunEventSource(response.runId, {
        onProgress: updateProgress,
        onDone: renderSummary,
        onError: (error) => renderSummary({ ok: false, error: error.message }),
      });
    } catch (error) {
      renderSummary({ ok: false, error: error.message });
    }
  }

  async function stopRun() {
    if (!state.runId) {
      return;
    }

    els.stopBtn.disabled = true;
    await window.ApiClient.stopRun(state.runId).catch(() => {});
  }

  function reset() {
    if (state.eventSource) {
      state.eventSource.close();
    }
    state.runId = null;
    state.eventSource = null;
    els.stopBtn.disabled = false;
    els.progressBar.style.width = '0%';
    showView('input');
  }

  function resetPrint() {
    if (state.printEventSource) {
      state.printEventSource.close();
    }
    state.printRunId = null;
    state.printEventSource = null;
    state.printValidated = null;
    els.printProgressBar.style.width = '0%';
    els.startPrintBtn.disabled = true;
    els.downloadZipLink.classList.add('hidden');
    showView('printInput');
  }

  async function init() {
    fillSelect(els.trackingType, TRACKING_TYPES);
    fillSelect(els.emissionType, EMISSION_TYPES);
    renderSettings();
    try {
      const response = await window.ApiClient.loadSettings();
      state.settings = { ...state.settings, ...response.settings };
      window.SettingsStore.save(state.settings);
      renderSettings();
    } catch (_) {
      renderSettings();
    }

    els.settingsToggle.addEventListener('click', () => {
      els.settingsPanel.classList.toggle('hidden');
    });
    els.authMode.addEventListener('change', () => {
      renderAuthMode();
      refreshStartState();
    });
    els.loadOrgsBtn.addEventListener('click', loadOrganizations);
    els.saveSettingsBtn.addEventListener('click', saveSettings);
    els.apiToken.addEventListener('input', refreshStartState);
    els.login.addEventListener('input', refreshStartState);
    els.password.addEventListener('input', refreshStartState);
    els.organizationSelect.addEventListener('change', refreshStartState);
    els.trackingType.addEventListener('change', refreshStartState);
    els.emissionType.addEventListener('change', refreshStartState);
    els.chooseFileBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => parseSelectedFile(els.fileInput.files[0]));
    els.dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      els.dropZone.classList.add('drag-over');
    });
    els.dropZone.addEventListener('dragleave', (event) => {
      if (!els.dropZone.contains(event.relatedTarget)) {
        els.dropZone.classList.remove('drag-over');
      }
    });
    els.dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('drag-over');
      parseSelectedFile(getDroppedFile(event));
    });
    els.startBtn.addEventListener('click', startRun);
    els.stopBtn.addEventListener('click', stopRun);
    els.resetBtn.addEventListener('click', reset);
    els.copyBtn.addEventListener('click', () => navigator.clipboard.writeText(els.summaryDetails.value));
    els.createTabBtn.addEventListener('click', () => showView('input'));
    els.printTabBtn.addEventListener('click', () => {
      showView('printInput');
      checkBrowserStatus();
    });
    els.browserLoginBtn.addEventListener('click', loginBrowser);
    els.printUrls.addEventListener('input', invalidatePrintValidation);
    els.validatePrintBtn.addEventListener('click', validatePrintDocuments);
    els.startPrintBtn.addEventListener('click', startPrintRun);
    els.printResetBtn.addEventListener('click', resetPrint);
    checkBrowserStatus();
  }

  init();
}());
