const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  getOrganizations,
  findAssortmentByBarcode,
  createEmissionOrder,
  getEmissionOrder,
  getEmissionOrderPositions,
} = require('./server/lib/ms-api');
const { readJson, sendJson } = require('./server/lib/http-utils');
const { serveStatic } = require('./server/lib/static-server');
const { EmissionOrderService } = require('./server/lib/emission-order-service');
const { RunManager } = require('./server/lib/run-manager');
const { SettingsFileStore } = require('./server/lib/settings-file-store');
const { BrowserSessionService } = require('./server/lib/browser-session-service');
const { MoySkladPrintRpcClient } = require('./server/lib/ms-print-rpc-client');
const { PrintExportService, createDefaultZipWriter } = require('./server/lib/print-export-service');

const PORT = Number(process.env.PORT || 5177);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_PATH = path.join(__dirname, '.env', 'settings.json');

const msClient = {
  getOrganizations,
  findAssortmentByBarcode,
  createEmissionOrder,
  getEmissionOrder,
  getEmissionOrderPositions,
};
const runManager = new RunManager(new EmissionOrderService(msClient));
const settingsStore = new SettingsFileStore(SETTINGS_PATH);
const browserSession = new BrowserSessionService({ profileDir: path.join(__dirname, '.browser-profile') });
const printRpcClient = new MoySkladPrintRpcClient(browserSession);
const printRunManager = new RunManager(new PrintExportService({
  msClient,
  rpcClient: printRpcClient,
  zipWriter: createDefaultZipWriter(__dirname),
}));
const printExportService = printRunManager.service;

function normalizeError(error) {
  return error && error.message ? error.message : String(error);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/browser/login') {
    try {
      const loggedIn = await browserSession.ensureLoggedIn();
      sendJson(res, 200, { ok: true, loggedIn });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/browser/status') {
    try {
      sendJson(res, 200, { ok: true, loggedIn: await browserSession.isLoggedIn() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    try {
      sendJson(res, 200, { ok: true, settings: await settingsStore.load() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings') {
    try {
      const body = await readJson(req);
      const settings = await settingsStore.save(body.settings || {});
      sendJson(res, 200, { ok: true, settings });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/events')) {
    const runId = url.pathname.split('/')[3];
    const run = runManager.get(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: 'Запуск не найден' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('\n');
    runManager.addClient(runId, res);
    req.on('close', () => runManager.removeClient(runId, res));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/print/runs/') && url.pathname.endsWith('/events')) {
    const runId = url.pathname.split('/')[4];
    const run = printRunManager.get(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: 'Запуск не найден' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('\n');
    printRunManager.addClient(runId, res);
    req.on('close', () => printRunManager.removeClient(runId, res));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/print/runs/') && url.pathname.endsWith('/download')) {
    const runId = url.pathname.split('/')[4];
    const run = printRunManager.get(runId);
    const zipPath = run && run.result && run.result.result && run.result.result.zipPath;
    const zipFileName = run && run.result && run.result.result && run.result.result.zipFileName;
    if (!zipPath || !zipFileName || !fs.existsSync(zipPath)) {
      sendJson(res, 404, { ok: false, error: 'ZIP не найден' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(zipPath).pipe(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/organizations') {
    try {
      const body = await readJson(req);
      const settings = body.settings || {};
      const hasToken = settings.authMode !== 'basic' && settings.apiToken && settings.apiToken.trim();
      const hasBasic = settings.authMode === 'basic' && settings.login && settings.login.trim() && settings.password;
      if (!hasToken && !hasBasic) {
        sendJson(res, 400, { ok: false, error: settings.authMode === 'basic' ? 'Введите логин и пароль' : 'Введите API токен' });
        return;
      }

      const orgs = await msClient.getOrganizations(settings);
      sendJson(res, 200, { ok: true, orgs });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/runs') {
    try {
      const body = await readJson(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) {
        sendJson(res, 400, { ok: false, error: 'Нет строк для обработки' });
        return;
      }

      const runId = runManager.start({
        rows,
        skipped: Array.isArray(body.skipped) ? body.skipped : [],
        fileName: typeof body.fileName === 'string' ? body.fileName : '',
        settings: body.settings || {},
      });
      sendJson(res, 202, { ok: true, runId });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/print/validate') {
    try {
      const body = await readJson(req);
      const result = await printExportService.validate({
        urls: body.urls,
        settings: body.settings || {},
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/print/run') {
    try {
      const body = await readJson(req);
      const runId = printRunManager.start({
        urls: body.urls,
        settings: body.settings || {},
      });
      sendJson(res, 202, { ok: true, runId });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: normalizeError(error) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/stop')) {
    const runId = url.pathname.split('/')[3];
    if (!runManager.stop(runId)) {
      sendJson(res, 404, { ok: false, error: 'Запуск не найден' });
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    handleApi(req, res);
    return;
  }

  serveStatic(req, res, PUBLIC_DIR);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local MoySklad bulk app: http://localhost:${PORT}`);
});
