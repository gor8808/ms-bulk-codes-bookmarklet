const path = require('node:path');
const { buildPdfFileName, dedupeFileName } = require('./filename-builder');
const { parseEmissionOrderUrls } = require('./print-url-parser');
const { ZipWriter } = require('./zip-writer');

function normalizeError(error) {
  return error && error.message ? error.message : String(error);
}

class PrintExportService {
  constructor({ msClient, rpcClient, zipWriter }) {
    this.msClient = msClient;
    this.rpcClient = rpcClient;
    this.zipWriter = zipWriter;
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
        positions: positions.map((position) => ({
          ...position,
          fileName: buildPdfFileName(position),
        })),
      });
    }

    return { ok: true, documents };
  }

  async run({ urls, settings }, hooks = {}) {
    const onProgress = hooks.onProgress || (() => {});
    const validated = await this.validate({ urls, settings });
    const documents = validated.documents;
    const totalDocuments = documents.length;
    const totalPositions = documents.reduce((sum, doc) => sum + doc.positions.length, 0);
    const entries = [];
    const failed = [];
    const usedNames = new Set();
    let printed = 0;

    for (let docIndex = 0; docIndex < documents.length; docIndex += 1) {
      const document = documents[docIndex];

      for (const position of document.positions) {
        if (hooks.isStopped && hooks.isStopped()) {
          failed.push({ documentName: document.name, positionId: position.id, reason: 'Остановлено пользователем' });
          continue;
        }

        let fileName = dedupeFileName(position.fileName, usedNames);
        try {
          const taskId = await this.rpcClient.requestPositionPdf({
            documentId: document.id,
            positionId: position.id,
            quantity: position.quantity,
          });
          const downloadUrl = await this.rpcClient.pollPrintTask(taskId);
          const pdf = await this.rpcClient.downloadPdf(downloadUrl);
          entries.push({ name: fileName, data: pdf });
          printed += 1;
        } catch (error) {
          failed.push({
            documentName: document.name,
            positionId: position.id,
            fileName,
            reason: normalizeError(error),
          });
        }

        onProgress({
          step: 'print',
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

    if (entries.length === 0) {
      const firstReason = failed[0] && failed[0].reason ? ` Первая ошибка: ${failed[0].reason}` : '';
      return { ok: false, error: `Не создан ни один PDF.${firstReason}`, result: { pdfCreated: 0, failed } };
    }

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
