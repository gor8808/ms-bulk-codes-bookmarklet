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
