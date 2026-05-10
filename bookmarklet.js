(() => {
  'use strict';

  const ID = 'ms-bulk-codes-overlay';
  const TIMEOUT = 5000;
  const GAP = 150;

  const T = {
    title: 'Массовое добавление кодов маркировки',
    subtitle: 'Вставьте коды (по одному в строке)',
    add: 'Добавить',
    cancel: 'Отмена',
    stop: 'Стоп',
    close: 'Закрыть',
    copy: 'Скопировать ошибки',
    copied: 'Скопировано',
    noFailed: 'Ошибок нет',
    wrongPage: 'Откройте страницу документа "Ввод в оборот кодов маркировки" и попробуйте снова.',
    noInput: 'Не найдено поле "Добавить позицию".',
    readOnly: 'Поле добавления недоступно (документ только для чтения).',
    noCodes: 'Список пуст. Добавьте хотя бы один код.',
    running: 'Добавляется код',
    done: 'Готово',
    errorPrefix: 'Ошибка выполнения: '
  };

  function removeOld() {
    const old = document.getElementById(ID);
    if (old) old.remove();
  }

  function isEligible() {
    const h = location.hash || '';
    return /enrollorder\/edit/i.test(h) || /enrollorder\/edit/i.test(location.href || '');
  }

  function findInput() {
    const list = Array.from(document.querySelectorAll('input[type="text"],input:not([type])'));
    return list.find((el) => (el.placeholder || '').toLowerCase().includes('добавить позицию')) ||
      list.find((el) => (el.getAttribute('aria-label') || '').toLowerCase().includes('добавить позицию')) || null;
  }

  function rowCount(input) {
    let n = input;
    while (n && n !== document.body) {
      const rows = n.querySelectorAll ? n.querySelectorAll('tbody tr') : null;
      if (rows && rows.length) return rows.length;
      n = n.parentElement;
    }
    return document.querySelectorAll('tbody tr').length;
  }

  function visibleText(el) {
    if (!el) return '';
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return '';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return '';
    return (el.textContent || '').trim();
  }

  function errorText(input) {
    if (input.getAttribute('aria-invalid') === 'true') return 'Поле невалидно';
    const keys = ['не найден', 'уже добав', 'неверн', 'ошиб', 'формат', 'не удалось', 'нельзя'];
    const nodes = document.querySelectorAll('[role="alert"],[role="tooltip"],[class*="error"],[class*="Error"],[class*="tooltip"],[class*="Tooltip"]');
    for (const el of nodes) {
      if (el.closest('#' + ID)) continue;
      const txt = visibleText(el).toLowerCase();
      if (txt && keys.some((k) => txt.includes(k))) return txt;
    }
    return null;
  }

  function reactSet(input, val) {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (d && typeof d.set === 'function') d.set.call(input, val);
    else input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function enterEvent(type) {
    const ev = new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    try {
      Object.defineProperty(ev, 'keyCode', { get: () => 13 });
      Object.defineProperty(ev, 'which', { get: () => 13 });
    } catch (_e) {}
    return ev;
  }

  function sendCode(input, code) {
    input.scrollIntoView({ block: 'center', inline: 'nearest' });
    input.focus();
    reactSet(input, code);
    input.dispatchEvent(enterEvent('keydown'));
    input.dispatchEvent(enterEvent('keypress'));
    input.dispatchEvent(enterEvent('keyup'));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitOutcome(input, prevRows, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!document.body.contains(input)) return { status: 'failed', message: 'Поле исчезло' };
      if ((input.value || '') === '') return { status: 'added' };
      if (rowCount(input) > prevRows) return { status: 'added' };
      const err = errorText(input);
      if (err) return { status: 'failed', message: err };
      await sleep(80);
    }
    return { status: 'timeout', message: 'Таймаут' };
  }

  function parseCodes(raw) {
    const lines = (raw || '').split('\n').map((line) => line.replace(/\r/g, ''));
    const codes = [];
    let skipped = 0;
    for (const line of lines) {
      const code = line.trim();
      if (!code) skipped += 1;
      else codes.push(code);
    }
    return { codes, skipped };
  }

  function el(tag, css, text) {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function createOverlay() {
    const root = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483600;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif');
    root.id = ID;
    const card = el('div', 'width:min(760px,92vw);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.28);padding:16px;color:#111');
    root.appendChild(card);
    document.body.appendChild(root);
    return { root, card };
  }

  function inputStep(card, onSubmit, onCancel) {
    card.innerHTML = '';
    const ta = el('textarea', 'width:100%;height:320px;box-sizing:border-box;padding:10px;border:1px solid #ccd2d8;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.4');
    ta.placeholder = '010...';

    const actions = el('div', 'margin-top:12px;display:flex;gap:8px;justify-content:flex-end');
    const btnCancel = el('button', 'padding:8px 12px;border:1px solid #ccd2d8;background:#fff;border-radius:8px;cursor:pointer', T.cancel);
    const btnAdd = el('button', 'padding:8px 12px;border:1px solid #2f7cff;background:#2f7cff;color:#fff;border-radius:8px;cursor:pointer', T.add);

    btnCancel.onclick = onCancel;
    btnAdd.onclick = () => onSubmit(ta.value || '');
    actions.appendChild(btnCancel);
    actions.appendChild(btnAdd);

    card.appendChild(el('div', 'font-size:18px;font-weight:700;margin-bottom:6px', T.title));
    card.appendChild(el('div', 'font-size:13px;color:#555;margin-bottom:10px', T.subtitle));
    card.appendChild(ta);
    card.appendChild(actions);
    ta.focus();
  }

  function progressStep(card) {
    card.innerHTML = '';
    const line = el('div', 'font-size:14px;line-height:1.4;margin-bottom:8px');
    const counts = el('div', 'font-size:13px;color:#333;margin-bottom:12px');
    const stop = el('button', 'padding:8px 12px;border:1px solid #c33;background:#fff;color:#c33;border-radius:8px;cursor:pointer', T.stop);

    card.appendChild(el('div', 'font-size:18px;font-weight:700;margin-bottom:10px', T.title));
    card.appendChild(line);
    card.appendChild(counts);
    card.appendChild(stop);
    return { line, counts, stop };
  }

  function summaryStep(card, result, onClose) {
    card.innerHTML = '';
    const details = el('textarea', 'width:100%;height:180px;box-sizing:border-box;padding:10px;border:1px solid #ccd2d8;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.4');
    details.readOnly = true;
    details.value = result.failedCodes.length ? result.failedCodes.join('\n') : T.noFailed;

    const actions = el('div', 'margin-top:12px;display:flex;gap:8px;justify-content:flex-end');
    const copy = el('button', 'padding:8px 12px;border:1px solid #2f7cff;background:#fff;color:#2f7cff;border-radius:8px;cursor:pointer', T.copy);
    const close = el('button', 'padding:8px 12px;border:1px solid #ccd2d8;background:#fff;border-radius:8px;cursor:pointer', T.close);

    copy.onclick = async () => {
      if (!result.failedCodes.length) {
        copy.textContent = T.noFailed;
        setTimeout(() => (copy.textContent = T.copy), 1200);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.failedCodes.join('\n'));
      } catch (_e) {
        details.focus();
        details.select();
        document.execCommand('copy');
      }
      copy.textContent = T.copied;
      setTimeout(() => (copy.textContent = T.copy), 1200);
    };

    close.onclick = onClose;
    actions.appendChild(copy);
    actions.appendChild(close);

    card.appendChild(el('div', 'font-size:18px;font-weight:700;margin-bottom:10px', T.done));
    card.appendChild(el('div', 'font-size:14px;line-height:1.5;margin-bottom:10px', 'Добавлено: ' + result.added + ' | Ошибки: ' + result.failed + ' | Пропущено: ' + result.skipped));
    card.appendChild(details);
    card.appendChild(actions);
  }

  async function main() {
    removeOld();

    if (!isEligible()) {
      alert(T.wrongPage);
      return;
    }

    const input = findInput();
    if (!input) {
      alert(T.noInput);
      return;
    }

    if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') {
      alert(T.readOnly);
      return;
    }

    const { root, card } = createOverlay();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      root.remove();
    };

    inputStep(card, async (raw) => {
      const parsed = parseCodes(raw);
      const codes = parsed.codes;
      const skippedBlank = parsed.skipped;

      if (!codes.length) {
        alert(T.noCodes);
        return;
      }

      const ui = progressStep(card);
      let stopRequested = false;
      ui.stop.onclick = () => {
        stopRequested = true;
        ui.stop.disabled = true;
        ui.stop.textContent = 'Остановка...';
      };

      let added = 0;
      let failed = 0;
      let processed = 0;
      const failedCodes = [];

      for (let i = 0; i < codes.length; i += 1) {
        if (stopRequested) break;

        const code = codes[i];
        ui.line.textContent = T.running + ' ' + (i + 1) + ' из ' + codes.length;
        ui.counts.textContent = '✓ ' + added + ' | ✗ ' + failed + ' | последний: —';

        const prev = rowCount(input);
        sendCode(input, code);
        const res = await waitOutcome(input, prev, TIMEOUT);

        processed += 1;
        if (res.status === 'added') {
          added += 1;
          ui.counts.textContent = '✓ ' + added + ' | ✗ ' + failed + ' | последний: ✓ ' + code;
        } else {
          failed += 1;
          failedCodes.push(code);
          ui.counts.textContent = '✓ ' + added + ' | ✗ ' + failed + ' | последний: ✗ ' + code;
        }

        await sleep(GAP);
      }

      const skipped = skippedBlank + Math.max(0, codes.length - processed);
      summaryStep(card, { added, failed, skipped, failedCodes }, close);
    }, close);

    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });
  }

  main().catch((err) => {
    try {
      alert(T.errorPrefix + (err && err.message ? err.message : String(err)));
    } catch (_e) {}
  });
})();
