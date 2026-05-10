const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const BOOKMARKLET_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'bookmarklet.js'),
  'utf8'
);

function createDom(options = {}) {
  const url = options.url || 'https://online.moysklad.ru/app/#enrollorder/edit?id=test&moduleName=CrptOrder';
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const { window } = dom;
  const { document } = window;
  const alerts = [];

  window.alert = (msg) => {
    alerts.push(String(msg));
  };

  if (!window.navigator.clipboard) {
    window.navigator.clipboard = {};
  }
  window.navigator.clipboard.writeText = async () => {};
  document.execCommand = () => true;

  let input = null;
  let tbody = null;

  if (options.withInput !== false) {
    const container = document.createElement('div');
    const table = document.createElement('table');
    tbody = document.createElement('tbody');
    table.appendChild(tbody);

    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Добавить позицию — введите наименование, код, штрихкод или артикул';
    input.scrollIntoView = () => {};

    if (options.disabled) input.disabled = true;
    if (options.readOnly) input.readOnly = true;
    if (options.ariaDisabled) input.setAttribute('aria-disabled', 'true');

    container.appendChild(table);
    container.appendChild(input);
    document.body.appendChild(container);
  }

  return { dom, window, document, alerts, input, tbody };
}

function runBookmarklet(dom) {
  const script = new vm.Script(BOOKMARKLET_SOURCE, { filename: 'bookmarklet.js' });
  script.runInContext(dom.getInternalVMContext());
}

async function waitFor(predicate, { timeout = 4000, interval = 20, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Timed out waiting for ' + label);
}

function getOverlay(document) {
  return document.getElementById('ms-bulk-codes-overlay');
}

function clickButtonByText(document, text) {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find((b) => (b.textContent || '').trim() === text);
  if (!btn) throw new Error('Button not found: ' + text);
  btn.click();
}

test('shows alert on non-eligible page and exits', async () => {
  const env = createDom({ url: 'https://online.moysklad.ru/app/#dashboard' });
  runBookmarklet(env.dom);

  await waitFor(() => env.alerts.length > 0, { label: 'wrong page alert' });
  assert.match(env.alerts[0], /Откройте страницу документа/i);
  assert.equal(getOverlay(env.document), null);
});

test('shows alert when add-position input is missing', async () => {
  const env = createDom({ withInput: false });
  runBookmarklet(env.dom);

  await waitFor(() => env.alerts.length > 0, { label: 'missing input alert' });
  assert.match(env.alerts[0], /Не найдено поле/i);
});

test('shows alert on read-only document', async () => {
  const env = createDom({ readOnly: true });
  runBookmarklet(env.dom);

  await waitFor(() => env.alerts.length > 0, { label: 'read-only alert' });
  assert.match(env.alerts[0], /только для чтения/i);
});

test('processes valid codes, skips blanks, and supports rerun without reload', async () => {
  const env = createDom();
  const submissions = [];

  env.input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    submissions.push(env.input.value);
    const tr = env.document.createElement('tr');
    env.tbody.appendChild(tr);
    setTimeout(() => {
      env.input.value = '';
    }, 10);
  });

  runBookmarklet(env.dom);
  await waitFor(() => !!getOverlay(env.document), { label: 'overlay open' });

  const ta = env.document.querySelector('textarea');
  ta.value = 'CODE-1\n\n CODE-2 \n';
  clickButtonByText(env.document, 'Добавить');

  await waitFor(() => (getOverlay(env.document)?.textContent || '').includes('Готово'), {
    timeout: 5000,
    label: 'summary'
  });

  const text = getOverlay(env.document).textContent;
  assert.match(text, /Добавлено:\s*2\s*\|\s*Ошибки:\s*0\s*\|\s*Пропущено:\s*2/);
  assert.deepEqual(submissions, ['CODE-1', 'CODE-2']);

  clickButtonByText(env.document, 'Закрыть');
  await waitFor(() => !getOverlay(env.document), { label: 'overlay closed' });

  runBookmarklet(env.dom);
  await waitFor(() => !!getOverlay(env.document), { label: 'overlay reopened' });
  assert.ok(getOverlay(env.document));
});

test('keeps latest processed status visible while next code is running', async () => {
  const env = createDom();

  env.input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const submitted = env.input.value;
    const delay = submitted === 'CODE-2' ? 450 : 20;
    setTimeout(() => {
      const tr = env.document.createElement('tr');
      env.tbody.appendChild(tr);
      env.input.value = '';
    }, delay);
  });

  runBookmarklet(env.dom);
  await waitFor(() => !!getOverlay(env.document), { label: 'overlay open' });

  env.document.querySelector('textarea').value = 'CODE-1\nCODE-2';
  clickButtonByText(env.document, 'Добавить');

  await waitFor(
    () => (getOverlay(env.document)?.textContent || '').includes('Добавляется код 2 из 2'),
    { label: 'second code started' }
  );

  const duringSecond = getOverlay(env.document).textContent || '';
  assert.match(duringSecond, /последний:\s*✓\s*CODE-1/);
});

test('records failed code when error tooltip appears', async () => {
  const env = createDom();
  const failedCode = 'garbage123';

  env.input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    setTimeout(() => {
      env.input.setAttribute('aria-invalid', 'true');
    }, 10);
  });

  runBookmarklet(env.dom);
  await waitFor(() => !!getOverlay(env.document), { label: 'overlay open' });

  env.document.querySelector('textarea').value = failedCode;
  clickButtonByText(env.document, 'Добавить');

  await waitFor(() => (getOverlay(env.document)?.textContent || '').includes('Готово'), {
    timeout: 5000,
    label: 'summary'
  });

  const text = getOverlay(env.document).textContent;
  assert.match(text, /Добавлено:\s*0\s*\|\s*Ошибки:\s*1/);

  const details = getOverlay(env.document).querySelector('textarea');
  assert.match(details.value, new RegExp(failedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*->\\s*Поле невалидно'));
});

test('captures failure reason from generic notification container (not timeout)', async () => {
  const env = createDom();
  const failedCode = 'bad-code-2';

  env.input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    setTimeout(() => {
      const note = env.document.createElement('div');
      note.className = 'app-notification-message';
      note.textContent = 'Код уже добавлен';
      env.document.body.appendChild(note);
    }, 10);
  });

  runBookmarklet(env.dom);
  await waitFor(() => !!getOverlay(env.document), { label: 'overlay open' });

  env.document.querySelector('textarea').value = failedCode;
  clickButtonByText(env.document, 'Добавить');

  await waitFor(() => (getOverlay(env.document)?.textContent || '').includes('Готово'), {
    timeout: 5000,
    label: 'summary'
  });

  const details = getOverlay(env.document).querySelector('textarea').value;
  assert.match(details, new RegExp(failedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*->\\s*Код уже добавлен'));
  assert.doesNotMatch(details, /Таймаут/i);
});

test('preserves GS1 group separator and supports stop mid-run', async () => {
  const env = createDom();
  const submissions = [];

  env.input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    submissions.push(env.input.value);
    setTimeout(() => {
      const tr = env.document.createElement('tr');
      env.tbody.appendChild(tr);
      env.input.value = '';
    }, 200);
  });

  runBookmarklet(env.dom);
  await waitFor(() => !!getOverlay(env.document), { label: 'overlay open' });

  const gs1 = '0104850035693014215ABC\u001D93TAIL';
  env.document.querySelector('textarea').value = [gs1, 'CODE-B', 'CODE-C', 'CODE-D'].join('\n');
  clickButtonByText(env.document, 'Добавить');

  await waitFor(
    () => (getOverlay(env.document)?.textContent || '').includes('Добавляется код 1 из 4'),
    { label: 'progress step' }
  );
  clickButtonByText(env.document, 'Стоп');

  await waitFor(() => (getOverlay(env.document)?.textContent || '').includes('Готово'), {
    timeout: 6000,
    label: 'summary after stop'
  });

  assert.equal(submissions[0], gs1);

  const text = getOverlay(env.document).textContent;
  const skippedMatch = text.match(/Пропущено:\s*(\d+)/);
  assert.ok(skippedMatch, 'Expected skipped count in summary');
  assert.ok(Number(skippedMatch[1]) >= 1, 'Expected at least one skipped code after stop');
});
