// Runs the built userscript against a trimmed copy of the WB product drawer markup
// (testids/names as seen live on 2026-11-22) and checks the full click -> preview -> apply flow.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { build } = require('../scripts/build-wb-userscript.js');

const card = (title, ceiling) => `
  <div data-testid="promotion-card-test-id" role="presentation">
    <h5>${title}</h5>
    <div data-testid="promotion-card-boost-test-id-chips-component">до 35%</div>
    <div data-testid="promotion-card-advantages-test-id-chips-component">+4</div>
    <span>до ${ceiling} ₽</span>
  </div>`;

const DRAWER = `
  <div class="R6PvuAKCn9 Drawer--min-content">
    <div data-testid="price-input-valid"><input name="price" value="15 490"></div>
    <div data-testid="discount-input-wrapper"><input id="discount" name="discount" value="52"></div>
    <div data-testid="promotion-participation-widget-test-id">
      ${card('Чёрная пятница (автоакция), до 01.12.26', '6 696')}
      ${card('Повышаем заказы (автоматические скидки), до 16.12.26', '6 387')}
    </div>
  </div>`;

function load() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${DRAWER}</body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://seller.wildberries.ru/discount-and-prices/main-table',
  });
  dom.window.eval(build().text);
  return dom.window;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('adds a «Подогнать» button to every promo card', () => {
  const w = load();
  const buttons = w.document.querySelectorAll('.wbfit-trigger');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].textContent, 'Подогнать');
});

test('preview then apply fills price and discount', async () => {
  const w = load();
  const doc = w.document;
  doc.querySelectorAll('.wbfit-trigger')[0].click();
  const panel = doc.querySelector('.wbfit-panel');
  assert.ok(panel, 'preview panel shown');
  assert.match(panel.textContent, /52% → 57%/);
  assert.match(panel.textContent, /15\s490 ₽ → 15\s572 ₽/);

  [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Применить').click();
  assert.equal(doc.querySelector('input[name=price]').value, '15572');
  assert.equal(doc.querySelector('input[name=discount]').value, '57');
  await tick(200);
  assert.match(panel.textContent, /Готово/);
});

test('cards rendered later (after «Ещё 1») get a button too', async () => {
  const w = load();
  const doc = w.document;
  const widget = doc.querySelector('[data-testid=promotion-participation-widget-test-id]');
  widget.insertAdjacentHTML('beforeend', card('Ещё одна акция', '6 000'));
  await tick(50);
  assert.equal(doc.querySelectorAll('.wbfit-trigger').length, 3);
});

test('missing inputs show «WB изменил страницу»', () => {
  const w = load();
  const doc = w.document;
  doc.querySelector('input[name=discount]').remove();
  doc.querySelectorAll('.wbfit-trigger')[0].click();
  assert.match(doc.querySelector('.wbfit-panel').textContent, /WB изменил страницу/);
});
