// Adds a «Подогнать» button to every promo card in the WB product drawer.
// Click -> preview of new discount/price -> «Применить» fills the two inputs. Never saves.
(function () {
  'use strict';
  if (globalThis.__wbPriceFitLoaded) return;
  globalThis.__wbPriceFitLoaded = true;

  const { fitToCeiling, parseNumber, parseCeiling } = globalThis.WBPriceFit;
  const { S, inputsFor } = globalThis.WBSelectors;
  const MARK = 'wbFitDone';
  const fmt = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // React-controlled inputs ignore plain `.value =`; use the native setter and fire events.
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }

  function closePanels() {
    document.querySelectorAll('.wbfit-panel').forEach((p) => p.remove());
  }

  function compute(card) {
    const inputs = inputsFor(card);
    if (inputs.error) return { ok: false, error: `WB изменил страницу: ${inputs.error}` };
    const ceiling = parseCeiling(card.innerText ?? card.textContent);
    const result = fitToCeiling({
      price: parseNumber(inputs.priceInput.value),
      discount: parseNumber(inputs.discountInput.value),
      ceiling,
    });
    return { ...result, inputs, before: { price: parseNumber(inputs.priceInput.value), discount: parseNumber(inputs.discountInput.value) } };
  }

  function row(label, from, to, note) {
    const r = el('div', 'wbfit-row');
    r.append(el('span', 'wbfit-label', label), el('span', 'wbfit-value', from ? `${from} → ${to}` : to));
    if (note) r.append(el('span', 'wbfit-note', note));
    return r;
  }

  function showPanel(card) {
    closePanels();
    const res = compute(card);
    const panel = el('div', 'wbfit-panel');
    const title = card.querySelector(S.promoTitle)?.textContent?.trim();
    if (title) panel.append(el('div', 'wbfit-title', title));

    if (!res.ok) {
      panel.append(el('div', 'wbfit-error', res.error));
    } else {
      if (res.alreadyQualifies) panel.append(el('div', 'wbfit-info', 'Уже подходит. Цена поднимется до потолка акции.'));
      if (res.capped) panel.append(el('div', 'wbfit-warn', 'Скидка упёрлась в максимум, цена снижена.'));
      panel.append(
        row('Скидка', `${res.before.discount}%`, `${res.discount}%`, res.discountDelta ? signed(res.discountDelta) + ' п.п.' : ''),
        row('Цена до скидки', `${fmt(res.before.price)} ₽`, `${fmt(res.price)} ₽`, res.priceDelta ? signed(res.priceDelta) + ' ₽' : ''),
        row('Итог', '', `${fmt(res.finalPrice)} ₽ ≤ ${fmt(res.ceiling)} ₽`, `запас ${fmt(res.gap)} ₽`),
      );
    }

    const actions = el('div', 'wbfit-actions');
    if (res.ok) {
      const apply = el('button', 'wbfit-btn wbfit-btn-primary', 'Применить');
      apply.type = 'button';
      apply.addEventListener('click', () => {
        setInputValue(res.inputs.discountInput, res.discount);
        setInputValue(res.inputs.priceInput, res.price);
        // Read back after React re-renders: confirm WB accepted both values.
        setTimeout(() => {
          const gotPrice = parseNumber(res.inputs.priceInput.value);
          const gotDiscount = parseNumber(res.inputs.discountInput.value);
          actions.replaceChildren();
          if (gotPrice === res.price && gotDiscount === res.discount) {
            panel.append(el('div', 'wbfit-info', 'Готово. Проверьте и нажмите «Сохранить».'));
            setTimeout(closePanels, 2500);
          } else {
            panel.append(el('div', 'wbfit-error', `WB не принял значения: сейчас ${gotDiscount}% и ${fmt(gotPrice)} ₽.`));
          }
        }, 150);
      });
      actions.append(apply);
    }
    const cancel = el('button', 'wbfit-btn', 'Отмена');
    cancel.type = 'button';
    cancel.addEventListener('click', closePanels);
    actions.append(cancel);
    panel.append(actions);

    // Keep clicks inside the panel from reaching WB's card/drawer handlers.
    for (const type of ['click', 'mousedown', 'pointerdown']) panel.addEventListener(type, (e) => e.stopPropagation());
    card.after(panel);
  }

  function decorate(card) {
    if (card.dataset[MARK]) return;
    card.dataset[MARK] = '1';
    const btn = el('button', 'wbfit-trigger', 'Подогнать');
    btn.type = 'button';
    btn.title = 'Подобрать скидку и цену под цену акции';
    for (const type of ['mousedown', 'pointerdown']) btn.addEventListener(type, (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPanel(card);
    });
    card.append(btn);
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    document.querySelectorAll(`${S.promoWidget} ${S.promoCard}`).forEach(decorate);
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
