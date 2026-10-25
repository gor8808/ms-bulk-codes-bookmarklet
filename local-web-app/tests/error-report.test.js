const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ReportConfigStore,
  ReportSender,
  buildReport,
  buildSentryEnvelope,
  classifyFailure,
  createRedactor,
  parseSentryDsn,
  skeletonizeGwtBody,
  validateReportUrl,
} = require('../server/lib/error-report');

const ACCOUNT = '22920a00-185d-11ec-0a80-04c00001a91c';
const OTHER = '22cbc1c8-9c8e-11f1-0a80-00600027c92c';

function failure(overrides = {}) {
  return { reason: 'boom', stage: 'poll', status: undefined, gwt: false, ...overrides };
}

test('createRedactor hides secrets, auth headers, emails and keeps UUID equality visible', () => {
  const redact = createRedactor(['my-secret-token']);
  const out = redact(`token my-secret-token Bearer abc.def admin@alextextilerus ${ACCOUNT} ${OTHER} ${ACCOUNT}`);
  assert.equal(out, 'token <secret> <auth> <email> <uuid-1> <uuid-2> <uuid-1>');
});

test('classifyFailure maps known failure texts and statuses', () => {
  assert.equal(classifyFailure(failure({ reason: 'x Invalid type signature for Type' })), 'signature-mismatch');
  assert.equal(classifyFailure(failure({ reason: 'Войдите в МойСклад через кнопку' })), 'not-logged-in');
  assert.equal(classifyFailure(failure({ reason: 'МойСклад не подготовил PDF за отведенное время.' })), 'task-timeout');
  assert.equal(classifyFailure(failure({ reason: 'Протокол печати МойСклад изменился', status: 500 })), 'http-500');
  assert.equal(classifyFailure(failure({ reason: 'weird' })), 'other');
});

test('buildReport groups failures, drops page text and redacts sensitive values', () => {
  const reason = `Протокол печати МойСклад изменился. Ответ сервера: //EX["${ACCOUNT}","admin@alextextilerus"]\nПроверенные endpoint-ы: /app/services/r1742/ExportImportService\nДиагностика страницы МойСклад:\npage.title=МойСклад\nbody.text=секретный текст компании\nresource=https://cdn-static.moysklad.ru/app/cdn/r1742/a.js\nrequest=GET https://example.com/track`;
  const report = buildReport({
    failures: [failure({ reason }), failure({ reason }), failure({ reason: 'other', stage: 'download' })],
    totals: { positions: 32, created: 6 },
    context: { rpcVersion: 'r1742', typeSignatureDiagnostics: `account ${ACCOUNT}` },
    appVersion: 'v0.1.8',
    secrets: ['tok-12345'],
  });

  assert.equal(report.app.version, 'v0.1.8');
  assert.deepEqual(report.totals, { positions: 32, created: 6, failed: 3 });
  assert.equal(report.groups[0].count, 2);
  assert.equal(report.groups[0].stage, 'poll');
  const text = JSON.stringify(report);
  assert.equal(text.includes('секретный текст компании'), false);
  assert.equal(text.includes('page.title'), false);
  assert.equal(text.includes('example.com'), false);
  assert.equal(text.includes('admin@alextextilerus'), false);
  assert.equal(text.includes(ACCOUNT), false);
  assert.equal(text.includes('cdn-static.moysklad.ru/app/cdn/r1742/a.js'), true);
  assert.equal(report.runtime.rpcVersion, 'r1742');
});

test('parseSentryDsn builds the envelope endpoint and ignores plain URLs', () => {
  assert.deepEqual(parseSentryDsn('https://abc123@o1.ingest.sentry.io/4507'), {
    key: 'abc123',
    endpoint: 'https://o1.ingest.sentry.io/api/4507/envelope/',
  });
  assert.equal(parseSentryDsn('https://relay.example.com/report'), null);
});

test('buildSentryEnvelope emits header, item header and event lines', () => {
  const report = buildReport({ failures: [failure({ reason: 'x' })], totals: { positions: 1, created: 0 }, context: { rpcVersion: 'r1742' }, appVersion: 'v0.1.8' });
  const lines = buildSentryEnvelope(report, new Date('2026-10-25T00:00:00Z')).trim().split('\n');
  assert.equal(lines.length, 3);
  const [header, itemHeader, event] = lines.map((line) => JSON.parse(line));
  assert.equal(itemHeader.type, 'event');
  assert.equal(header.event_id, event.event_id);
  assert.equal(event.release, 'ms-bulk-codes@v0.1.8');
  assert.deepEqual(event.fingerprint, ['poll', 'other', 'r1742']);
  assert.equal(event.extra.groups[0].kind, 'other');
});

test('validateReportUrl requires https except for localhost', () => {
  assert.equal(validateReportUrl(' https://a@b.io/1 '), 'https://a@b.io/1');
  assert.equal(validateReportUrl('http://localhost:9/x'), 'http://localhost:9/x');
  assert.throws(() => validateReportUrl('http://example.com/x'), /https/);
  assert.throws(() => validateReportUrl('not a url'), /Некорректный/);
});

test('ReportConfigStore saves, describes without exposing the key, and clears', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-cfg-'));
  const store = new ReportConfigStore(path.join(dir, '.env', 'report-url.txt'), {});
  assert.deepEqual(await store.describe(), { configured: false, host: '' });
  await store.save('https://secretkey@o1.ingest.sentry.io/4507');
  assert.deepEqual(await store.describe(), { configured: true, host: 'o1.ingest.sentry.io' });
  await assert.rejects(store.save('http://example.com/x'), /https/);
  await store.save('');
  assert.deepEqual(await store.describe(), { configured: false, host: '' });
  await fs.rm(dir, { recursive: true, force: true });
});

test('ReportConfigStore prefers MS_REPORT_URL from the environment', async () => {
  const store = new ReportConfigStore('/nonexistent/report-url.txt', { MS_REPORT_URL: 'https://k@h.io/1' });
  assert.equal(await store.load(), 'https://k@h.io/1');
});

function senderWith(url, fetchImpl, extra = {}) {
  return new ReportSender({
    configStore: { async load() { return url; } },
    getAppVersion: () => 'v0.1.8',
    fetchImpl,
    ...extra,
  });
}

const payload = () => ({ failures: [failure()], totals: { positions: 2, created: 1 }, context: {}, secrets: [] });

test('ReportSender does nothing when no report url is configured', async () => {
  let calls = 0;
  const sender = senderWith('', async () => { calls += 1; return { ok: true }; });
  assert.deepEqual(await sender.send(payload()), { sent: false, reason: 'not-configured' });
  assert.equal(calls, 0);
});

test('ReportSender posts JSON to a plain url and an envelope to a Sentry DSN', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => { seen.push({ url, options }); return { ok: true, status: 200 }; };

  assert.deepEqual(await senderWith('https://relay.example.com/report', fetchImpl).send(payload()), { sent: true });
  assert.equal(seen[0].url, 'https://relay.example.com/report');
  assert.equal(seen[0].options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(seen[0].options.body).app.version, 'v0.1.8');

  assert.deepEqual(await senderWith('https://k3y@o1.ingest.sentry.io/77', fetchImpl).send(payload()), { sent: true });
  assert.equal(seen[1].url, 'https://o1.ingest.sentry.io/api/77/envelope/');
  assert.match(seen[1].options.headers['X-Sentry-Auth'], /sentry_key=k3y/);
  assert.equal(seen[1].options.body.trim().split('\n').length, 3);
});

test('ReportSender never throws and does not leak the url when sending fails', async () => {
  const logs = [];
  const url = 'https://k3y@o1.ingest.sentry.io/77';
  const sender = senderWith(url, async () => { throw new Error(`connect failed ${url}`); }, { log: (m) => logs.push(m) });
  assert.deepEqual(await sender.send(payload()), { sent: false, reason: 'send-failed' });
  assert.equal(logs.join('\n').includes('k3y'), false);
});

test('ReportSender skips not-logged-in failures and caps reports per hour', async () => {
  let calls = 0;
  let clock = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true }; };
  const sender = senderWith('https://relay.example.com/r', fetchImpl, { maxPerHour: 2, now: () => clock });

  assert.deepEqual(
    await sender.send({ ...payload(), failures: [failure({ reason: 'Войдите в МойСклад через кнопку' })] }),
    { sent: false, reason: 'nothing-to-report' },
  );
  assert.equal((await sender.send(payload())).sent, true);
  assert.equal((await sender.send(payload())).sent, true);
  assert.deepEqual(await sender.send(payload()), { sent: false, reason: 'rate-limited' });
  clock += 61 * 60 * 1000;
  assert.equal((await sender.send(payload())).sent, true);
  assert.equal(calls, 3);
});

test('buildReport keeps up to three distinct redacted samples per group', () => {
  const failures = ['a', 'b', 'a', 'c', 'd'].map((reason) => failure({ reason }));
  const report = buildReport({ failures, totals: { positions: 5, created: 0 }, context: {} });
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].count, 5);
  assert.deepEqual(report.groups[0].samples, ['a', 'b', 'c']);
});

test('buildReport records a compact run-length timeline of position outcomes', () => {
  const poll = failure({ stage: 'poll', reason: 'МойСклад не смог подготовить PDF: x' });
  const request = failure({ stage: 'request', status: 500, reason: 'HTTP 500' });
  const report = buildReport({
    failures: [poll, poll, request],
    totals: { positions: 7, created: 4 },
    context: {},
    outcomes: [null, null, null, null, poll, poll, request, { stopped: true }],
  });
  assert.deepEqual(report.timeline, ['okx4', 'poll:task-failedx2', 'request:http-500', 'stopped']);
});

test('skeletonizeGwtBody keeps contract shape and masks account specific values', () => {
  const body = '7|0|8|https://cdn-static.moysklad.ru/app/cdn/r1742/|523A2C005B818141D85FA157BCF35F27|com.lognex.print.face.common.service.PriceTypePrintService|requestDocument|com.lognex.type.ID/131549306|admin@example.com|SecretTemplateTok01234567|' + ACCOUNT + '|1|2|3|4|1|5|ZxQxboj|7|8|8|';
  const skeleton = skeletonizeGwtBody(body, createRedactor([]));
  assert.equal(
    skeleton,
    '7|0|8|https://cdn-static.moysklad.ru/app/cdn/r1742/|523A2C005B818141D85FA157BCF35F27|com.lognex.print.face.common.service.PriceTypePrintService|requestDocument|com.lognex.type.ID/131549306|<email>|<str:25>|<uuid-1>|1|2|3|4|1|5|<b64:7>|7|8|8|',
  );
  assert.equal(skeletonizeGwtBody('garbage', createRedactor([])), '<unparsed request body>');
});

test('buildReport attaches one masked request skeleton per group', () => {
  const body = '7|0|2|https://cdn-static.moysklad.ru/app/cdn/r1742/|My Secret Name|1|2|';
  const report = buildReport({
    failures: [
      failure({ request: { path: '/app/services/r1742/ExportImportService', body } }),
      failure({ reason: 'second', request: { path: '/other', body: '7|0|0|' } }),
    ],
    totals: { positions: 2, created: 0 },
    context: {},
  });
  assert.equal(report.groups[0].request.path, '/app/services/r1742/ExportImportService');
  assert.equal(report.groups[0].request.bodySkeleton.includes('My Secret Name'), false);
  assert.match(report.groups[0].request.bodySkeleton, /<str:14>/);
});

test('auth failures are classified and never reported', async () => {
  assert.equal(classifyFailure(failure({ reason: 'Неверный токен', stage: 'validate' })), 'auth');
  assert.equal(classifyFailure(failure({ reason: 'x', status: 403 })), 'auth');
  let calls = 0;
  const sender = senderWith('https://relay.example.com/r', async () => { calls += 1; return { ok: true }; });
  const result = await sender.send({ ...payload(), failures: [failure({ reason: 'Неверный токен', stage: 'validate', status: 401 })] });
  assert.deepEqual(result, { sent: false, reason: 'nothing-to-report' });
  assert.equal(calls, 0);
});
