// ==UserScript==
// @name         WB: подгонка цены под акцию
// @namespace    https://github.com/gor8808/ms-bulk-codes-bookmarklet
// @version      0.1.0
// @description  Кнопка «Подогнать» в карточке товара на странице «Цены и скидки»: подбирает скидку и цену под цену участия в акции.
// @match        https://seller.wildberries.ru/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/gor8808/ms-bulk-codes-bookmarklet/main/wb-extension/wb-price-fit.user.js
// @downloadURL  https://raw.githubusercontent.com/gor8808/ms-bulk-codes-bookmarklet/main/wb-extension/wb-price-fit.user.js
// ==/UserScript==

// СГЕНЕРИРОВАНО: не редактируйте вручную. Исходники в wb-extension/, сборка: npm run build:wb-userscript
// source-hash: 4955f6a96f6e445b
(function () {
  const style = document.createElement('style');
  style.textContent = ".wbfit-trigger,\n.wbfit-panel,\n.wbfit-btn {\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Arial, sans-serif;\n}\n\n.wbfit-trigger {\n  flex: none;\n  align-self: center;\n  margin-left: 8px;\n  padding: 4px 10px;\n  border: 1px solid #7b2ff7;\n  border-radius: 8px;\n  background: transparent;\n  color: #b58cff;\n  font-size: 12px;\n  font-weight: 500;\n  cursor: pointer;\n  white-space: nowrap;\n}\n.wbfit-trigger:hover { background: #7b2ff7; color: #fff; }\n\n/* The promo column is narrow (~250px): stack label above value. */\n.wbfit-panel {\n  margin: 6px 0 10px;\n  padding: 10px 12px;\n  border: 1px solid #3a3a44;\n  border-radius: 10px;\n  background: #24242c;\n  color: #e8e8ee;\n  font-size: 13px;\n  line-height: 1.4;\n}\n.wbfit-title { font-weight: 600; margin-bottom: 8px; }\n.wbfit-row { margin-bottom: 6px; }\n.wbfit-label { display: block; color: #9a9aa6; font-size: 12px; }\n.wbfit-value { font-weight: 600; font-variant-numeric: tabular-nums; }\n.wbfit-note { margin-left: 6px; color: #9a9aa6; font-size: 12px; white-space: nowrap; }\n.wbfit-info { color: #7ad69a; margin: 4px 0; }\n.wbfit-warn { color: #f0c36a; margin: 4px 0; }\n.wbfit-error { color: #ff7a7a; margin: 4px 0; }\n.wbfit-actions { display: flex; gap: 8px; margin-top: 8px; }\n.wbfit-btn {\n  padding: 5px 12px;\n  border: 1px solid #3a3a44;\n  border-radius: 8px;\n  background: transparent;\n  color: inherit;\n  font-size: 13px;\n  cursor: pointer;\n}\n.wbfit-btn-primary { background: #7b2ff7; border-color: #7b2ff7; color: #fff; }\n";
  (document.head || document.documentElement).append(style);
})();

// ---- lib/price-fit.js ----
// Pure pricing math for fitting a WB product under a promo price ceiling.
// No DOM. Loaded as a content script (globalThis.WBPriceFit) and by node tests (module.exports).
(function (root) {
  'use strict';

  const DEFAULT_MAX_DISCOUNT = 99;

  // "15 490" / "15 490 ₽" / "6 696,5" -> number. Returns NaN when no digits.
  function parseNumber(text) {
    const cleaned = String(text ?? '')
      .replace(/[\s  ]/g, '')
      .replace(/[^\d.,]/g, '')
      .replace(',', '.');
    return cleaned ? Number(cleaned) : NaN;
  }

  // Finds the promo ceiling in a promo card's text: the last "до N ₽".
  // "до 01.12.26" (date) and "до 35%" (boost chip) have no ₽ and never match.
  function parseCeiling(text) {
    const matches = [...String(text ?? '').matchAll(/до\s*([\d\s  ]+(?:[.,]\d+)?)\s*₽/g)];
    if (!matches.length) return NaN;
    return parseNumber(matches[matches.length - 1][1]);
  }

  // Final price in kopecks for whole-ruble price and whole-percent discount.
  // price * (100 - discount) / 100 rubles == price * (100 - discount) kopecks.
  function finalKopecks(price, discount) {
    return price * (100 - discount);
  }

  /**
   * Discount has priority: it does the main work, never goes below the current one.
   * Price fine-tunes (up or down) so the final price lands within 1 ₽ under the ceiling.
   *
   * @param {{price:number, discount:number, ceiling:number, maxDiscount?:number}} input
   *   price: current price before discount (whole rubles)
   *   discount: current seller discount (whole percent)
   *   ceiling: promo ceiling T in rubles (final price must be <= T)
   */
  function fitToCeiling({ price, discount, ceiling, maxDiscount = DEFAULT_MAX_DISCOUNT }) {
    if (!Number.isInteger(price) || price <= 0) return { ok: false, error: 'Не удалось прочитать цену' };
    if (!Number.isInteger(discount) || discount < 0 || discount >= 100) {
      return { ok: false, error: 'Не удалось прочитать скидку' };
    }
    if (!Number.isFinite(ceiling) || ceiling <= 0) return { ok: false, error: 'Не удалось прочитать цену акции' };

    const ceilingKop = Math.floor(Math.round(ceiling * 1000) / 10); // ceiling in kopecks, rounded down
    const alreadyQualifies = finalKopecks(price, discount) <= ceilingKop;

    // Step 1: smallest whole discount that qualifies at the current price, never below the current one.
    let newDiscount = Math.max(discount, Math.ceil((100 * price - ceilingKop) / price));
    // Guard float edge cases with exact integer checks.
    while (newDiscount > discount && finalKopecks(price, newDiscount - 1) <= ceilingKop) newDiscount--;
    while (newDiscount < 100 && finalKopecks(price, newDiscount) > ceilingKop) newDiscount++;

    let capped = false;
    if (newDiscount > maxDiscount) {
      newDiscount = Math.max(discount, maxDiscount);
      capped = true;
    }

    // Step 2: largest whole price that still qualifies at newDiscount.
    const newPrice = Math.floor(ceilingKop / (100 - newDiscount));
    if (newPrice < 1) return { ok: false, error: 'Цена акции слишком низкая' };

    const finalKop = finalKopecks(newPrice, newDiscount);
    return {
      ok: true,
      price: newPrice,
      discount: newDiscount,
      priceDelta: newPrice - price,
      discountDelta: newDiscount - discount,
      finalPrice: finalKop / 100,
      gap: (ceilingKop - finalKop) / 100,
      ceiling: ceilingKop / 100,
      alreadyQualifies,
      capped,
    };
  }

  const api = { fitToCeiling, parseNumber, parseCeiling, DEFAULT_MAX_DISCOUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WBPriceFit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---- lib/selectors.js ----
// Every DOM selector the extension uses, in one place.
// WB CSS class names are hashed and change on deploy: only data-testid, name and structure here.
// Verified against seller.wildberries.ru/discount-and-prices/main-table on 2026-11-22.
(function (root) {
  'use strict';

  const S = {
    promoWidget: '[data-testid="promotion-participation-widget-test-id"]',
    promoCard: '[data-testid="promotion-card-test-id"]',
    promoTitle: 'h5',
    priceInput: 'input[name="price"]',
    discountInput: 'input[name="discount"]',
    // The drawer has no testid; "Drawer--*" is an unhashed BEM modifier on its root.
    drawer: '[class*="Drawer--"]',
  };

  // The product drawer that holds a given promo card. Falls back to the closest ancestor
  // that contains both inputs, so a renamed drawer class does not break us.
  function drawerFor(el) {
    const byClass = el.closest(S.drawer);
    if (byClass && byClass.querySelector(S.priceInput)) return byClass;
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.querySelector(S.priceInput) && node.querySelector(S.discountInput)) return node;
    }
    return null;
  }

  // Returns { priceInput, discountInput } for a promo card, or { error } naming what is missing.
  function inputsFor(card) {
    const drawer = drawerFor(card);
    if (!drawer) return { error: 'не найдена карточка товара' };
    const priceInput = drawer.querySelector(S.priceInput);
    const discountInput = drawer.querySelector(S.discountInput);
    if (!priceInput) return { error: 'не найдено поле «Цена продавца до скидки»' };
    if (!discountInput) return { error: 'не найдено поле «Скидка продавца»' };
    return { priceInput, discountInput };
  }

  root.WBSelectors = { S, drawerFor, inputsFor };
})(globalThis);

// ---- content.js ----
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
