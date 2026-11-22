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
