const { MsApiError } = require('./ms-api');

function normalizeError(error) {
  if (error instanceof MsApiError) {
    return error.message || `MoySklad API вернул ${error.statusCode}`;
  }

  return error && error.message ? error.message : String(error);
}

function validateSettings(settings) {
  if (!settings) {
    return 'Введите настройки авторизации';
  }

  if (settings.authMode === 'basic') {
    if (!settings.login || !settings.login.trim()) {
      return 'Введите логин';
    }

    if (!settings.password) {
      return 'Введите пароль';
    }
  } else if (!settings.apiToken || !settings.apiToken.trim()) {
    return 'Введите API токен';
  }

  if (!settings.organizationHref || !settings.organizationHref.trim()) {
    return 'Загрузите и выберите организацию';
  }

  return null;
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

const TRACKING_TYPE_ALIASES = {
  CLOTHES: 'LP_CLOTHES',
  FUR: 'FURSLP',
  BEER: 'BEER_ALCOHOL',
  WHEELCHAIRS: 'MEDICAL_DEVICES',
};

function normalizeTrackingType(trackingType) {
  const value = trackingType || 'LP_CLOTHES';
  return TRACKING_TYPE_ALIASES[value] || value;
}

class EmissionOrderService {
  constructor(msClient) {
    this.msClient = msClient;
  }

  async run(input, hooks = {}) {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const skipped = Array.isArray(input.skipped) ? input.skipped : [];
    const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
    const settings = input.settings || {};
    const isStopped = hooks.isStopped || (() => false);
    const onProgress = hooks.onProgress || (() => {});
    const settingsError = validateSettings(settings);

    if (settingsError) {
      return { ok: false, error: settingsError };
    }

    const lookupSuccess = [];
    const failed = [];
    const successful = [];

    for (let index = 0; index < rows.length; index += 1) {
      if (isStopped()) {
        for (const row of rows.slice(index)) {
          failed.push({ ...row, reason: 'Остановлено пользователем' });
        }
        break;
      }

      const row = rows[index];
      try {
        const assortment = await this.msClient.findAssortmentByBarcode(settings, row.barcode);
        if (!assortment) {
          failed.push({ ...row, reason: 'Штрихкод не найден' });
        } else {
          lookupSuccess.push({
            ...row,
            assortmentHref: assortment.href,
            assortmentType: assortment.type,
            assortmentName: assortment.name,
          });
        }
      } catch (error) {
        if (error instanceof MsApiError && error.statusCode === 401) {
          failed.push({ ...row, reason: 'Неверный токен' });
          for (const rest of rows.slice(index + 1)) {
            failed.push({ ...rest, reason: 'Неверный токен' });
          }
          break;
        }

        failed.push({ ...row, reason: normalizeError(error) });
      }

      onProgress({
        step: 'lookup',
        current: index + 1,
        total: rows.length,
        detail: row.barcode,
        found: lookupSuccess.length,
        failed: failed.length,
      });
    }

    const groups = chunk(lookupSuccess, 10);
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (isStopped()) {
        for (const row of groups.slice(index).flat()) {
          failed.push({ ...row, reason: 'Остановлено пользователем' });
        }
        break;
      }

      try {
        const document = await this.msClient.createEmissionOrder(settings, {
          organizationHref: settings.organizationHref,
          emissionType: settings.emissionType || 'REMAINS',
          trackingType: normalizeTrackingType(settings.trackingType),
          description: buildOrderDescription(fileName, index + 1),
          positions: group,
        });

        for (const row of group) {
          successful.push({
            barcode: row.barcode,
            qty: row.qty,
            rowIndex: row.rowIndex,
            assortmentName: row.assortmentName,
            docName: document.name,
          });
        }
      } catch (error) {
        const reason = normalizeError(error);
        for (const row of group) {
          failed.push({
            barcode: row.barcode,
            qty: row.qty,
            rowIndex: row.rowIndex,
            reason,
          });
        }
      }

      onProgress({
        step: 'create',
        current: index + 1,
        total: groups.length,
        detail: `Документ ${index + 1} из ${groups.length}`,
        found: successful.length,
        failed: failed.length,
      });
    }

    return {
      ok: true,
      result: {
        documentsCreated: new Set(successful.map((row) => row.docName)).size,
        totalRows: rows.length,
        successful,
        failed,
        skipped,
      },
    };
  }
}

function buildOrderDescription(fileName, fileNumber) {
  const safeFileName = fileName || 'не указан';
  const safeFileNumber = Number.isInteger(fileNumber) && fileNumber > 0 ? fileNumber : 1;
  return `Имя файла: ${safeFileName}\nНомер файла: ${safeFileNumber}\nЗагружено скриптом от Gor`;
}

module.exports = {
  EmissionOrderService,
  buildOrderDescription,
  chunk,
  normalizeError,
  normalizeTrackingType,
  validateSettings,
};
