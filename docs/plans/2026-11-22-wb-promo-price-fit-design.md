# WB promo price fit — design

Chrome extension for `seller.wildberries.ru/discount-and-prices/*`. In the product
drawer, each promo row under **«Цена для участия в акции»** gets a **Подогнать** button.
Clicking it rewrites **«Цена продавца до скидки»** (P) and **«Скидка продавца»** (D) so the
discounted price lands just under the promo ceiling (T, the «до 6 696 ₽» number).

## Inputs

| Symbol | Source on the page | Constraint |
|---|---|---|
| P | «Цена продавца до скидки» input | whole rubles |
| D | «Скидка продавца» input | whole percent, `0..Dmax` |
| T | «до N ₽» in the promo row | ceiling, inclusive |

Discounted price: `F = P × (100 − D) / 100` (WB shows it unrounded, e.g. `7 435.2 ₽`).

Goal: `F ≤ T` and `T − F < 1 ₽`.

## Algorithm

Discount has priority: it does the main work. Price only fine-tunes, and may go up.

1. **Discount:** smallest whole discount that qualifies at the current price, never below the current one:
   `D_new = max(D, ceil(100 − 100·T / P))`
2. **Price:** largest whole price that still qualifies at `D_new`:
   `P_new = floor(100·T / (100 − D_new))`
3. If `D_new > Dmax`: `D_new = Dmax`, and step 2 lowers the price instead.

Guarantees: `F ≤ T` and `T − F < 1 ₽`. Price rises by less than ~`P / (100 − D_new)`.
If the product already qualifies, the discount stays and only the price rises to the ceiling.

### Worked example (screenshot row 1: P = 15 490, D = 52%)

| Promo ceiling T | New D | New P | ΔP | Final F | Discount only |
|---|---|---|---|---|---|
| 6 696 | 57% | 15 572 | +82 | 6 695.96 | 6 660.70 |
| 6 495 | 59% | 15 841 | +351 | 6 494.81 | 6 350.90 |
| 6 452 | 59% | 15 736 | +246 | 6 451.76 | 6 350.90 |
| 6 387 | 59% | 15 578 | +88 | 6 386.98 | 6 350.90 |

## UI

- Button next to each «до N ₽» line in the drawer.
- Click → preview popover: `52% → 57%`, `15 490 → 15 572 (+82)`, `итог 6 695.96 ≤ 6 696`, buttons **Применить** / **Отмена**.
- **Применить** fills both inputs (React-safe: native value setter + `input`/`change` events). It does **not** press WB's save; the seller reviews and saves.
- MutationObserver re-injects buttons when the drawer opens or the product changes.

## Selectors (read from the live page, 2026-11-22)

CSS class names are hashed (`JN+-yWKyuL`) and change on every WB deploy, so they are never used.
Only `data-testid`, `name`, and DOM structure.

| What | Selector | Notes |
|---|---|---|
| Drawer scope | `input[name=discount]` → `.closest('[class*="Drawer"]')` | Drawer has no testid; `Drawer--*` is an unhashed BEM class |
| Price input | `input[name="price"]` | value `"15 490"` (spaces as thousands separator) |
| Discount input | `input#discount[name="discount"]` | inside `[data-testid=discount-input-wrapper]` |
| Promo widget | `[data-testid=promotion-participation-widget-test-id]` | |
| Promo card | `[data-testid=promotion-card-test-id]` | one per promo |
| Promo title | card `h5` | «Чёрная пятница (автоакция), до 01.12.26» |
| Promo ceiling | card text matching `/до\s*([\d\s]+)\s*₽/` (last `span`) | the `до 35%` chip lives under its own testid, so it can't match |
| More promos | `[data-testid=promotion-participation-widget-expand-test-id-browser-link]` | «Ещё 1»: extra cards render on expand; MutationObserver picks them up |
| Save / reset | drawer `button` with text «Сохранить» / «Сбросить» | disabled until inputs change; we never click them |
| Table row (product id) | `[data-testid=goods-table-row-test-id][data-row-key=<nmID>]` | for future bulk mode |

Resilience rules:
- One `selectors.js` file holds all of the above; nothing else touches the DOM by selector.
- If any required element is missing, the button shows «WB изменил страницу» instead of failing silently.
- Input fill: native `HTMLInputElement.prototype.value` setter + `input` and `change` events (React-controlled inputs).
  To be verified live during implementation (it changes the drawer inputs without saving).

## Code layout

```
wb-extension/
  manifest.json          MV3, content script on seller.wildberries.ru/discount-and-prices/*
  content.js             observe drawer, inject buttons, preview, fill inputs
  lib/selectors.js       every DOM selector, in one place
  lib/price-fit.js       pure math (the algorithm above), no DOM
  styles.css
  wb-price-fit.user.js   GENERATED Tampermonkey bundle (scripts/build-wb-userscript.js), committed
scripts/build-wb-userscript.js   bundles the files above; version from manifest.json
tests/wb-price-fit.test.js       math, table of cases incl. edge cases
tests/wb-userscript-dom.test.js  built bundle in jsdom against WB drawer markup
tests/wb-userscript.test.js      bundle is fresh; code change since main requires version bump
```

## Distribution

Tampermonkey userscript from the public repo's raw URL (`@updateURL`/`@downloadURL` → `main`).
Users install once with one click; Tampermonkey auto-updates daily when `@version` grows.
Chrome blocks off-store extension installs (no `--load-extension` since Chrome 137), so the
unpacked extension stays only as a dev/fallback path.

`price-fit.js` is pure so it is fully unit-testable; DOM selectors are isolated in `content.js`
(WB class names are hashed, so we anchor on visible Russian labels).

## Edge cases

- T ≥ current F → already qualifies.
- `D*` above `Dmax` → cap discount, lower price.
- Price parsing: strip NBSP / thin spaces and `₽`.
- Promo row text truncated («Чёрная пятница: выгодные предложе…») — we only need the «до N ₽» number.

## Open questions

1. ~~Raising P allowed?~~ Yes (decided 2026-11-22), discount has priority.
2. **Dmax**: what is the maximum seller discount WB accepts for you (99%? 95%?).
3. **Bulk mode**: one product at a time (v1), or later a button that fits a whole table/Excel?
