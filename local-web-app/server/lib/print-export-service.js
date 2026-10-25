const path = require('node:path');
const { buildPdfFileName, dedupeFileName } = require('./filename-builder');
const { parseEmissionOrderUrls } = require('./print-url-parser');
const { ZipWriter } = require('./zip-writer');

function normalizeError(error) {
  return error && error.message ? error.message : String(error);
}

function logPrint(message) {
  console.log(`[print] ${new Date().toISOString()} ${message}`);
}

class PrintExportService {
  constructor({ msClient, rpcClient, zipWriter, reporter = null }) {
    this.msClient = msClient;
    this.rpcClient = rpcClient;
    this.zipWriter = zipWriter;
    this.reporter = reporter;
  }

  // Fire-and-forget: the sender never throws and must not delay the run result.
  reportFailures({ failed, totalPositions, printed, settings, requests = new Map(), outcomes = [] }) {
    const rpcFailures = failed.filter((row) => row.stage).map((row) => ({ ...row, request: requests.get(row) }));
    if (!this.reporter || rpcFailures.length === 0) {
      return;
    }
    const context = typeof this.rpcClient.getReportContext === 'function' ? this.rpcClient.getReportContext() : {};
    const secrets = [settings && settings.apiToken, settings && settings.login, settings && settings.password];
    Promise.resolve(this.reporter.send({
      failures: rpcFailures,
      totals: { positions: totalPositions, created: printed },
      context,
      secrets,
      outcomes,
    })).catch(() => {});
  }

  async validate({ urls, settings }) {
    const parsed = parseEmissionOrderUrls(urls);
    if (parsed.invalid.length > 0) {
      throw new Error(`Некорректные ссылки: ${parsed.invalid.slice(0, 3).join(', ')}`);
    }
    if (parsed.ids.length === 0) {
      throw new Error('Добавьте ссылки на заказы кодов маркировки.');
    }

    const documents = [];
    for (const id of parsed.ids) {
      const document = await this.msClient.getEmissionOrder(settings, id);
      const positions = await this.msClient.getEmissionOrderPositions(settings, id);
      documents.push({
        id,
        name: document.name,
        accountId: document.accountId || '',
        positions: positions.map((position) => ({
          ...position,
          fileName: buildPdfFileName(position),
        })),
      });
    }

    return { ok: true, documents };
  }

  async run(input, hooks = {}) {
    const state = { stage: 'validate', totalPositions: 0, printed: 0 };
    try {
      return await this.runInternal(input, hooks, state);
    } catch (error) {
      this.reportFailures({
        failed: [{
          reason: normalizeError(error),
          stage: state.stage,
          status: error && (error.status || error.statusCode),
          gwt: false,
        }],
        totalPositions: state.totalPositions,
        printed: state.printed,
        settings: input && input.settings,
      });
      throw error;
    }
  }

  async runInternal({ urls, settings }, hooks, state) {
    const onProgress = hooks.onProgress || (() => {});
    const validated = await this.validate({ urls, settings });
    state.stage = 'run';
    const documents = validated.documents;
    const totalDocuments = documents.length;
    const totalPositions = documents.reduce((sum, doc) => sum + doc.positions.length, 0);
    state.totalPositions = totalPositions;
    const entries = [];
    const failed = [];
    const requests = new Map();
    const outcomes = [];
    const usedNames = new Set();
    let printed = 0;

    for (let docIndex = 0; docIndex < documents.length; docIndex += 1) {
      const document = documents[docIndex];

      for (const position of document.positions) {
        if (hooks.isStopped && hooks.isStopped()) {
          failed.push({ documentName: document.name, positionId: position.id, reason: 'Остановлено пользователем' });
          outcomes.push({ stopped: true });
          continue;
        }

        let fileName = dedupeFileName(position.fileName, usedNames);
        let stage = 'request';
        try {
          onProgress({
            step: 'print',
            phase: 'requesting',
            documentsCurrent: docIndex + 1,
            documentsTotal: totalDocuments,
            positionsCurrent: printed + failed.length,
            positionsTotal: totalPositions,
            lastFile: fileName,
            pdfCreated: printed,
            failed: failed.length,
          });
          logPrint(`requesting PDF for "${fileName}" (document=${document.id}, position=${position.id})`);
          const taskId = await this.rpcClient.requestPositionPdf({
            documentId: document.id,
            positionId: position.id,
            quantity: position.quantity,
            accountId: document.accountId,
          });
          logPrint(`task accepted for "${fileName}": ${taskId}`);
          onProgress({
            step: 'print',
            phase: 'waiting',
            documentsCurrent: docIndex + 1,
            documentsTotal: totalDocuments,
            positionsCurrent: printed + failed.length,
            positionsTotal: totalPositions,
            lastFile: fileName,
            pdfCreated: printed,
            failed: failed.length,
            waitSeconds: 0,
          });
          stage = 'poll';
          const downloadUrl = await this.rpcClient.pollPrintTask(taskId, {
            onHeartbeat: ({ elapsedMs }) => {
              const waitSeconds = Math.floor(elapsedMs / 1000);
              onProgress({
                step: 'print',
                phase: 'waiting',
                documentsCurrent: docIndex + 1,
                documentsTotal: totalDocuments,
                positionsCurrent: printed + failed.length,
                positionsTotal: totalPositions,
                lastFile: fileName,
                pdfCreated: printed,
                failed: failed.length,
                waitSeconds,
              });
              if (waitSeconds > 0 && waitSeconds % 15 === 0) {
                logPrint(`still waiting for "${fileName}" (${waitSeconds}s, task=${taskId})`);
              }
            },
          });
          stage = 'download';
          const pdf = await this.rpcClient.downloadPdf(downloadUrl);
          entries.push({ name: fileName, data: pdf });
          printed += 1;
          state.printed = printed;
          outcomes.push(null);
          logPrint(`downloaded PDF for "${fileName}"`);
        } catch (error) {
          logPrint(`failed "${fileName}": ${normalizeError(error)}`);
          const row = {
            documentName: document.name,
            positionId: position.id,
            fileName,
            reason: normalizeError(error),
            stage,
            status: error && error.status,
            gwt: Boolean(error && error.gwtException),
          };
          failed.push(row);
          outcomes.push(row);
          if (error && error.request) {
            requests.set(row, error.request);
          }
        }

        onProgress({
          step: 'print',
          phase: 'completed',
          documentsCurrent: docIndex + 1,
          documentsTotal: totalDocuments,
          positionsCurrent: printed + failed.length,
          positionsTotal: totalPositions,
          lastFile: fileName,
          pdfCreated: printed,
          failed: failed.length,
        });
      }
    }

    this.reportFailures({ failed, totalPositions, printed, settings, requests, outcomes });

    if (entries.length === 0) {
      const firstReason = failed[0] && failed[0].reason ? ` Первая ошибка: ${failed[0].reason}` : '';
      return { ok: false, error: `Не создан ни один PDF.${firstReason}`, result: { pdfCreated: 0, failed } };
    }

    state.stage = 'zip';
    const zip = await this.zipWriter.write(entries);
    return {
      ok: true,
      result: {
        pdfCreated: printed,
        failed,
        zipFileName: zip.fileName,
        zipPath: zip.filePath,
        zipBaseName: path.basename(zip.filePath),
      },
    };
  }
}

function createDefaultZipWriter(rootDir) {
  return new ZipWriter(path.join(rootDir, '.downloads'));
}

module.exports = {
  PrintExportService,
  createDefaultZipWriter,
};
