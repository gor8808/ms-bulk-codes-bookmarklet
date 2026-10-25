const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_SAMPLE_LENGTH = 1200;
const MAX_PAGE_LINES = 12;
const MAX_SAMPLES_PER_GROUP = 3;
const MAX_TIMELINE_RUNS = 60;
const MAX_SKELETON_LENGTH = 4000;
const SKIPPED_KINDS = new Set(['not-logged-in', 'auth']);
const KEPT_PLAIN_STRINGS = new Set([
  'I', 'value', 'requestDocument', 'getTask', 'getTemplate', 'EmissionOrder', 'Template',
  'testPrintFilter', 'printAllCodesFilter',
]);
const PAGE_DIAGNOSTICS_MARKER = 'Диагностика страницы МойСклад:';
const SEND_TIMEOUT_MS = 8000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[\w.%+-]+@[\w.-]+/g;
const AUTH_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateReportUrl(value) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('Некорректный адрес для отчётов.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error('Адрес для отчётов должен начинаться с https://');
  }
  return raw;
}

function createRedactor(secrets = []) {
  const knownSecrets = secrets.map((value) => String(value || '')).filter((value) => value.length >= 4);
  const uuids = new Map();

  return function redact(text) {
    let result = String(text || '');
    for (const secret of knownSecrets) {
      result = result.split(secret).join('<secret>');
    }
    return result
      .replace(AUTH_PATTERN, '<auth>')
      .replace(UUID_PATTERN, (match) => {
        const key = match.toLowerCase();
        if (!uuids.has(key)) {
          uuids.set(key, `<uuid-${uuids.size + 1}>`);
        }
        return uuids.get(key);
      })
      .replace(EMAIL_PATTERN, '<email>');
  };
}

// The page dump appended to protocol errors contains visible page text; keep only the
// MoySklad resource/request URLs, which show the build and runtime in use.
function trimPageDiagnostics(message) {
  const text = String(message || '');
  const index = text.indexOf(PAGE_DIAGNOSTICS_MARKER);
  if (index < 0) {
    return text;
  }
  const kept = text.slice(index).split('\n')
    .filter((line) => /^(?:resource|request)=.*moysklad/i.test(line))
    .slice(0, MAX_PAGE_LINES);
  return `${text.slice(0, index).trimEnd()}\n${PAGE_DIAGNOSTICS_MARKER}\n${kept.join('\n')}`;
}

function classifyFailure(failure) {
  const text = String(failure.reason || '');
  if (/Войдите в МойСклад/.test(text)) return 'not-logged-in';
  if (/Неверный токен/.test(text) || [401, 403].includes(failure.status) || [401, 403].includes(failure.statusCode)) return 'auth';
  if (/Invalid type signature|IncompatibleRemoteService/i.test(text)) return 'signature-mismatch';
  if (/Не удалось загрузить параметры протокола/.test(text)) return 'protocol-discovery';
  if (/Шаблон ".*" не найден/.test(text)) return 'template-missing';
  if (/Не найден номер задачи печати/.test(text)) return 'no-task-id';
  if (/не смог подготовить PDF/.test(text)) return 'task-failed';
  if (/за отведенное время/.test(text)) return 'task-timeout';
  if (/Не удалось скачать PDF/.test(text)) return 'download-failed';
  if (failure.status) return `http-${failure.status}`;
  if (failure.gwt) return 'gwt-exception';
  if (/Протокол печати/.test(text)) return 'protocol';
  return 'other';
}

// Keeps the shape of a GWT-RPC request body (class names, signatures, strong names,
// token layout) and masks everything account specific, so it can be diffed against a
// request captured from MoySklad's own UI.
function skeletonizeGwtBody(body, redact) {
  const tokens = String(body || '').split('|');
  const count = Number(tokens[2]);
  if (tokens.length < 4 || tokens[0] !== '7' || !Number.isInteger(count) || count < 0 || tokens.length < 3 + count) {
    return '<unparsed request body>';
  }

  const maskString = (value) => {
    if (value === '' || /^https:\/\/cdn-static\.moysklad\.ru\//.test(value)) return value;
    if (/^[0-9A-F]{32}$/.test(value) || KEPT_PLAIN_STRINGS.has(value)) return value;
    if (/^(?:\[+L)?[A-Za-z_$][\w$]*(?:\.[\w$]+)+;?(?:\/\d+)?$/.test(value) && !value.includes('@')) return value;
    const masked = redact(value);
    return masked === value ? `<str:${value.length}>` : masked;
  };
  const maskToken = (value) => (/^-?\d+(?:\.\d+)?$/.test(value) || value.length <= 3 ? value : `<b64:${value.length}>`);

  const table = tokens.slice(3, 3 + count).map(maskString);
  const rest = tokens.slice(3 + count).map(maskToken);
  return [...tokens.slice(0, 3), ...table, ...rest].join('|').slice(0, MAX_SKELETON_LENGTH);
}

function buildTimeline(outcomes, kindOf) {
  const labels = (outcomes || []).map((outcome) => {
    if (outcome === null) return 'ok';
    if (outcome && outcome.stopped) return 'stopped';
    return `${outcome.stage || 'unknown'}:${kindOf(outcome)}`;
  });
  const runs = [];
  for (const label of labels) {
    const last = runs[runs.length - 1];
    if (last && last.label === label) {
      last.count += 1;
    } else {
      runs.push({ label, count: 1 });
    }
  }
  const text = runs.slice(0, MAX_TIMELINE_RUNS).map((run) => (run.count > 1 ? `${run.label}x${run.count}` : run.label));
  if (runs.length > MAX_TIMELINE_RUNS) {
    text.push(`...(+${runs.length - MAX_TIMELINE_RUNS} more)`);
  }
  return text;
}

function buildReport({ failures, totals, context, appVersion, secrets, outcomes }) {
  const redact = createRedactor(secrets);
  const groups = new Map();
  for (const failure of failures) {
    const kind = classifyFailure(failure);
    const stage = failure.stage || 'unknown';
    const key = `${stage}|${kind}`;
    const group = groups.get(key) || { stage, kind, count: 0, samples: [] };
    group.count += 1;
    const sample = redact(trimPageDiagnostics(failure.reason)).slice(0, MAX_SAMPLE_LENGTH);
    if (group.samples.length < MAX_SAMPLES_PER_GROUP && !group.samples.includes(sample)) {
      group.samples.push(sample);
    }
    if (!group.request && failure.request && failure.request.body) {
      group.request = {
        path: redact(String(failure.request.path || '')),
        bodySkeleton: skeletonizeGwtBody(failure.request.body, redact),
      };
    }
    groups.set(key, group);
  }

  const runtime = {};
  for (const [name, value] of Object.entries(context || {})) {
    runtime[name] = typeof value === 'string' ? redact(trimPageDiagnostics(value)) : value;
  }

  return {
    schema: 2,
    app: {
      version: appVersion || 'unknown',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    runtime,
    totals: {
      positions: totals ? totals.positions : failures.length,
      created: totals ? totals.created : 0,
      failed: failures.length,
    },
    timeline: buildTimeline(outcomes, classifyFailure),
    groups: Array.from(groups.values()).sort((left, right) => right.count - left.count),
  };
}

function parseSentryDsn(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!url.username || !/^\d+$/.test(projectId || '')) {
    return null;
  }
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  return {
    key: url.username,
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
}

function buildSentryEnvelope(report, now = new Date()) {
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const top = report.groups[0] || { stage: 'unknown', kind: 'other' };
  const rpcVersion = String(report.runtime.rpcVersion || 'unknown');
  const event = {
    event_id: eventId,
    timestamp: now.toISOString(),
    platform: 'node',
    level: 'error',
    logger: 'print',
    release: `ms-bulk-codes@${report.app.version}`,
    message: { formatted: `Print failed: ${top.stage}/${top.kind} (${report.totals.failed}/${report.totals.positions})` },
    tags: { stage: top.stage, kind: top.kind, rpc_version: rpcVersion, app_version: report.app.version },
    fingerprint: [top.stage, top.kind, rpcVersion],
    extra: report,
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  return `${body}\n`;
}

async function sendReport(url, report, { fetchImpl = globalThis.fetch, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  const dsn = parseSentryDsn(url);
  const signal = AbortSignal.timeout(timeoutMs);
  const response = dsn
    ? await fetchImpl(dsn.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=ms-bulk-codes/${report.app.version}, sentry_key=${dsn.key}`,
      },
      body: buildSentryEnvelope(report),
      signal,
    })
    : await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal,
    });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

class ReportConfigStore {
  constructor(filePath, env = process.env) {
    this.filePath = filePath;
    this.env = env;
  }

  async load() {
    if (this.env.MS_REPORT_URL) {
      return String(this.env.MS_REPORT_URL).trim();
    }
    try {
      return (await fs.readFile(this.filePath, 'utf8')).trim();
    } catch (error) {
      if (error.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  async save(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      await fs.rm(this.filePath, { force: true });
      return '';
    }
    const url = validateReportUrl(raw);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${url}\n`, { mode: 0o600 });
    return url;
  }

  async describe() {
    const url = await this.load();
    if (!url) {
      return { configured: false, host: '' };
    }
    try {
      return { configured: true, host: new URL(url).hostname };
    } catch (_) {
      return { configured: true, host: '' };
    }
  }
}

class ReportSender {
  constructor({
    configStore,
    getAppVersion = () => 'unknown',
    fetchImpl = globalThis.fetch,
    maxPerHour = 10,
    now = () => Date.now(),
    log = () => {},
  }) {
    this.configStore = configStore;
    this.getAppVersion = getAppVersion;
    this.fetchImpl = fetchImpl;
    this.maxPerHour = maxPerHour;
    this.now = now;
    this.log = log;
    this.sentAt = [];
  }

  // Never throws: a reporting problem must not affect the print run that triggered it.
  async send({ failures, totals, context, secrets, outcomes }) {
    let url;
    try {
      url = await this.configStore.load();
    } catch (_) {
      return { sent: false, reason: 'config-error' };
    }
    if (!url) {
      return { sent: false, reason: 'not-configured' };
    }

    const reportable = failures.filter((failure) => !SKIPPED_KINDS.has(classifyFailure(failure)));
    if (reportable.length === 0) {
      return { sent: false, reason: 'nothing-to-report' };
    }

    const current = this.now();
    this.sentAt = this.sentAt.filter((time) => current - time < 60 * 60 * 1000);
    if (this.sentAt.length >= this.maxPerHour) {
      return { sent: false, reason: 'rate-limited' };
    }
    this.sentAt.push(current);

    try {
      const report = buildReport({
        failures: reportable,
        totals,
        context,
        appVersion: this.getAppVersion(),
        secrets,
        outcomes,
      });
      await sendReport(url, report, { fetchImpl: this.fetchImpl });
      this.log('error report sent');
      return { sent: true };
    } catch (error) {
      const message = String(error && error.message ? error.message : error).split(url).join('<report-url>');
      this.log(`error report not sent: ${message}`);
      return { sent: false, reason: 'send-failed' };
    }
  }
}

module.exports = {
  ReportConfigStore,
  ReportSender,
  buildReport,
  buildSentryEnvelope,
  classifyFailure,
  createRedactor,
  parseSentryDsn,
  sendReport,
  skeletonizeGwtBody,
  trimPageDiagnostics,
  validateReportUrl,
};
