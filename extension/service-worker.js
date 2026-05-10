importScripts('lib/cdp-sequence.js', 'lib/outcome-evaluator.js', 'lib/response-parser.js');

(function () {
  'use strict';

  const DEBUGGER_VERSION = '1.3';
  const TARGET_RE = /^https:\/\/online\.moysklad\.ru\/app\/#enrollorder\/edit/i;
  const DEFAULT_DELAY_MS = 350;
  const DEFAULT_TIMEOUT_MS = 5000;
  const DISAPPEAR_GRACE_MS = 2500;
  const POLL_MS = 120;
  const networkEventsByTab = new Map();
  const SERVICE_RE = /\/app\/services\/r\d+\/(ConsignmentService|OrderService)\b/;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getActiveTab() {
    return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0] || null);
  }

  function attach(target) {
    return chrome.debugger.attach(target, DEBUGGER_VERSION);
  }

  function detach(target) {
    return chrome.debugger.detach(target).catch(() => {});
  }

  function sendCommand(target, method, params) {
    return chrome.debugger.sendCommand(target, method, params || {});
  }

  function getTabEvents(tabId) {
    let list = networkEventsByTab.get(tabId);
    if (!list) {
      list = [];
      networkEventsByTab.set(tabId, list);
    }
    return list;
  }

  function clearTabEvents(tabId) {
    networkEventsByTab.set(tabId, []);
  }

  async function runInTab(tabId, func, args) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args: args || []
    });
    return results[0] ? results[0].result : null;
  }

  async function readFocusedElement(tabId) {
    return runInTab(tabId, () => {
        const el = document.activeElement;
        if (!el) return { ok: false, reason: 'No active element' };
        return {
          ok: true,
          tag: el.tagName,
          type: 'type' in el ? el.type || '' : '',
          placeholder: 'placeholder' in el ? el.placeholder || '' : '',
          readOnly: !!el.readOnly,
          disabled: !!el.disabled
        };
      });
  }

  async function focusTargetInput(tabId) {
    return runInTab(tabId, () => {
      function isCandidate(el) {
        if (!el) return false;
        if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return false;
        const placeholder = String(el.placeholder || '').toLowerCase();
        const ariaLabel = String(el.getAttribute('aria-label') || '').toLowerCase();
        return placeholder.includes('добавить позицию') || ariaLabel.includes('добавить позицию');
      }

      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
      const target = inputs.find(isCandidate) || null;

      if (!target) {
        return { ok: false, reason: 'Не найдено поле "Добавить позицию".' };
      }

      try {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_error) {}
      target.focus();
      try {
        target.click();
      } catch (_error) {}

      return {
        ok: true,
        tag: target.tagName,
        type: target.type || '',
        placeholder: target.placeholder || '',
        readOnly: !!target.readOnly,
        disabled: !!target.disabled
      };
    });
  }

  async function capturePageState(tabId) {
    return runInTab(tabId, () => {
      function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      function isErrorLikeText(text) {
        const low = cleanText(text).toLowerCase();
        if (!low || low.length < 3 || low.length > 220) return false;
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
          'товар'
        ];
        return keys.some((key) => low.includes(key));
      }

      function collectErrorTexts(input) {
        const out = [];
        const push = (value) => {
          const text = cleanText(value);
          if (isErrorLikeText(text)) out.push(text);
        };

        if (!input) return out;

        if (input.getAttribute('aria-invalid') === 'true') push('Поле невалидно');
        push(input.getAttribute('title'));
        push(input.getAttribute('aria-label'));

        const ids = [
          input.getAttribute('aria-errormessage'),
          input.getAttribute('aria-describedby')
        ];

        ids.forEach((idList) => {
          if (!idList) return;
          idList.split(/\s+/).forEach((id) => {
            const node = document.getElementById(id);
            if (node) push(node.textContent);
          });
        });

        const selectors = [
          '[role="alert"]',
          '[role="tooltip"]',
          '[aria-live]',
          '[class*="error"]',
          '[class*="Error"]',
          '[class*="tooltip"]',
          '[class*="Tooltip"]',
          '[class*="warning"]',
          '[class*="Warning"]',
          '[class*="notification"]',
          '[class*="Notification"]',
          '[class*="message"]',
          '[class*="Message"]'
        ].join(',');

        Array.from(document.querySelectorAll(selectors)).forEach((node) => push(node.textContent));
        return Array.from(new Set(out));
      }

      function captureRowTexts() {
        return Array.from(document.querySelectorAll('tbody tr'))
          .map((row) => cleanText(row.textContent))
          .filter(Boolean)
          .slice(0, 200);
      }

      function rowCount(input) {
        let node = input;
        while (node && node !== document.body) {
          const rows = node.querySelectorAll ? node.querySelectorAll('tbody tr') : null;
          if (rows && rows.length) return rows.length;
          node = node.parentElement;
        }
        return document.querySelectorAll('tbody tr').length;
      }

      const input = document.activeElement;
      if (!input || !('value' in input)) {
        return {
          exists: false,
          rowCount: document.querySelectorAll('tbody tr').length,
          value: '',
          errorTexts: collectErrorTexts(null),
          activeTag: input ? input.tagName : '',
          rowTexts: captureRowTexts()
        };
      }

      return {
        exists: true,
        rowCount: rowCount(input),
        value: String(input.value || ''),
        errorTexts: collectErrorTexts(input),
        activeTag: input.tagName,
        activePlaceholder: 'placeholder' in input ? input.placeholder || '' : '',
        rowTexts: captureRowTexts()
      };
    });
  }

  function collectRecentNetwork(tabId, startedAt) {
    return getTabEvents(tabId)
      .filter((entry) => entry.ts >= startedAt)
      .map((entry) => ({
        method: entry.method,
        type: entry.type,
        url: entry.url
      }));
  }

  async function collectRecentServiceResponses(target, tabId, startedAt) {
    const entries = getTabEvents(tabId)
      .filter((entry) => entry.ts >= startedAt && SERVICE_RE.test(entry.url || ''));

    const out = [];

    for (const entry of entries) {
      const item = {
        url: entry.url,
        requestId: entry.requestId,
        statusCode: entry.statusCode || 0
      };

      if (entry.loadingFinished) {
        try {
          const body = await sendCommand(target, 'Network.getResponseBody', {
            requestId: entry.requestId
          });
          item.body = body && body.base64Encoded
            ? atob(body.body || '')
            : (body && body.body ? body.body : '');
        } catch (_error) {
          item.body = '';
        }
      } else {
        item.body = '';
      }

      out.push(item);
    }

    return out;
  }

  async function waitForOutcome(tabId, baseline, startedAt, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const current = await capturePageState(tabId);
      const outcome = self.MSBulkOutcome.evaluateOutcome(baseline, current);
      if (outcome.done) {
        if (outcome.reason === 'Field disappeared') {
          return observeAfterDisappear(tabId, baseline, startedAt, current);
        }
        const network = collectRecentNetwork(tabId, startedAt);
        return {
          status: outcome.status,
          reason: outcome.reason,
          state: current,
          network
        };
      }
      await sleep(POLL_MS);
    }

    return {
      status: 'timeout',
      reason: 'timeout',
      state: await capturePageState(tabId),
      network: collectRecentNetwork(tabId, startedAt)
    };
  }

  async function observeAfterDisappear(tabId, baseline, startedAt, initialState) {
    const deadline = Date.now() + DISAPPEAR_GRACE_MS;
    let latestState = initialState;

    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      latestState = await capturePageState(tabId);

      const freshError = self.MSBulkOutcome.firstFreshError(
        baseline.errorTexts,
        latestState.errorTexts
      );

      if (freshError) {
        const network = collectRecentNetwork(tabId, startedAt);
        return {
          status: 'failed',
          reason: freshError,
          state: latestState,
          network
        };
      }

      if (latestState.exists) {
        const followOutcome = self.MSBulkOutcome.evaluateOutcome(baseline, latestState);
        if (followOutcome.done) {
          const network = collectRecentNetwork(tabId, startedAt);
          return {
            status: followOutcome.status,
            reason: followOutcome.reason,
            state: latestState,
            network
          };
        }
      }
    }

    const rowChanged = JSON.stringify(latestState.rowTexts || []) !== JSON.stringify(baseline.rowTexts || []);

    return {
      status: 'transition',
      reason: rowChanged ? 'field_disappeared_row_changed' : 'field_disappeared_no_visible_change',
      state: latestState,
      network: collectRecentNetwork(tabId, startedAt)
    };
  }

  async function runSingleCode(payload) {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== 'number') {
      throw new Error('No active tab.');
    }

    if (!TARGET_RE.test(tab.url || '')) {
      throw new Error('Open a MoySklad enroll order tab first.');
    }

    const focusInfo = await focusTargetInput(tab.id);
    if (!focusInfo.ok) {
      throw new Error(focusInfo.reason || 'No active element.');
    }

    if (focusInfo.disabled || focusInfo.readOnly) {
      throw new Error('Focused field is not editable.');
    }

    const target = { tabId: tab.id };
    await attach(target);

    try {
      await sendCommand(target, 'Network.enable');
      clearTabEvents(tab.id);
      const baseline = await capturePageState(tab.id);
      const startedAt = Date.now();
      const seq = self.MSBulkCdpSequence.buildCodeSequence(payload.code, {
        clearFirst: !!payload.clearFirst
      });

      for (const cmd of seq) {
        await sendCommand(target, cmd.method, cmd.params);
      }

      const result = await waitForOutcome(
        tab.id,
        baseline,
        startedAt,
        payload.timeoutMs > 0 ? payload.timeoutMs : DEFAULT_TIMEOUT_MS
      );
      await sleep(250);
      const serviceResponses = await collectRecentServiceResponses(target, tab.id, startedAt);
      const serviceReason = self.MSBulkResponseParser.extractServiceReason(serviceResponses);
      const serviceOk = self.MSBulkResponseParser.isSuccessfulServiceResponse(serviceResponses);

      return {
        ok: true,
        result: {
          code: payload.code,
          status: result.status,
          reason: result.reason,
          networkCount: result.network.length,
          network: result.network.slice(0, 5),
          serviceReason,
          serviceOk,
          serviceResponses: serviceResponses.slice(0, 5).map((item) => ({
            url: item.url,
            statusCode: item.statusCode,
            body: item.body
          })),
          fieldValueAfter: result.state.value,
          fieldExistsAfter: !!result.state.exists,
          errorTexts: (result.state.errorTexts || []).slice(0, 3),
          focused: [
            focusInfo.tag,
            focusInfo.type ? 'type=' + focusInfo.type : null,
            focusInfo.placeholder ? '"' + focusInfo.placeholder + '"' : null
          ].filter(Boolean).join(' ')
        }
      };
    } finally {
      await detach(target);
    }
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (!source || typeof source.tabId !== 'number') return;
    const list = getTabEvents(source.tabId);

    if (method === 'Network.requestWillBeSent') {
      list.push({
        ts: Date.now(),
        method,
        type: params && params.type ? params.type : '',
        url: params && params.request ? params.request.url || '' : '',
        requestId: params && params.requestId ? params.requestId : ''
      });
      return;
    }

    if (method === 'Network.responseReceived') {
      const entry = list.find((item) => item.requestId === params.requestId);
      if (entry) {
        entry.statusCode = params.response && params.response.status ? params.response.status : 0;
      }
      return;
    }

    if (method === 'Network.loadingFinished') {
      const entry = list.find((item) => item.requestId === params.requestId);
      if (entry) {
        entry.loadingFinished = true;
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'RUN_SINGLE_CODE') return;

    runSingleCode(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));

    return true;
  });
})();
