const ONLINE_BASE = 'https://online.moysklad.ru';
const DEFAULT_RPC_VERSION = 'r1668';
const DEFAULT_MODULE_BASE = 'https://cdn-static.moysklad.ru/app/cdn/r1668/';
const DEFAULT_PERMUTATION = '65DD15C4D67E019A7A66BAD8ED43273D';
const DEFAULT_REF_ID = '0fecd212-1864-11ec-0a80-0865003ffa33';
const PRINT_PROTOCOL_ERROR = 'Протокол печати МойСклад изменился. Требуется обновление интеграции.';

function firstMatch(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1] : '';
}

function normalizeModuleBase(value) {
  if (!value) {
    return '';
  }
  return String(value).endsWith('/') ? String(value) : `${value}/`;
}

function extractRpcVersionFromModuleBase(moduleBase) {
  return firstMatch(moduleBase, /\/(r\d+)\//i);
}

function extractModuleBase(text) {
  const source = String(text || '');
  const absolute = firstMatch(source, /(https:\/\/cdn-static\.moysklad\.ru\/app\/cdn\/r\d+\/)/i);
  if (absolute) {
    return normalizeModuleBase(absolute);
  }

  const relative = source.match(/["']((?:https?:\/\/online\.moysklad\.ru)?\/app\/cdn\/r\d+\/)["']/i);
  if (relative) {
    return normalizeModuleBase(new URL(relative[1], ONLINE_BASE).href);
  }

  const version = firstMatch(source, /\/app\/(?:cdn\/)?(r\d+)\//i);
  if (version) {
    return `${ONLINE_BASE}/app/cdn/${version}/`;
  }

  const anyVersionedBase = firstMatch(source, /(https?:\/\/[^"'\s]+\/r\d+\/)/i);
  if (anyVersionedBase) {
    return normalizeModuleBase(anyVersionedBase);
  }

  const anyVersion = firstMatch(source, /\b(r\d{3,6})\b/i);
  return anyVersion ? `${ONLINE_BASE}/app/cdn/${anyVersion}/` : '';
}

function extractNocacheScriptUrl(text) {
  const source = String(text || '');
  const match = source.match(/<script[^>]+src=["']([^"']*\.nocache\.js[^"']*)["']/i);
  return match ? new URL(match[1], `${ONLINE_BASE}/app/`).href : '';
}

function extractGwtPermutation(text) {
  const values = Array.from(new Set(String(text || '').match(/\b[A-F0-9]{32}\b/g) || []));
  return values[0] || '';
}

function parseRuntimeConfigFromHtml(html) {
  const moduleBase = extractModuleBase(html);
  return {
    moduleBase,
    rpcVersion: extractRpcVersionFromModuleBase(moduleBase),
    nocacheScriptUrl: extractNocacheScriptUrl(html),
  };
}

function applyRuntimeConfig(client, runtime) {
  if (!runtime || !runtime.moduleBase || !runtime.rpcVersion) {
    return false;
  }

  const changed = client.moduleBase !== runtime.moduleBase || client.rpcVersion !== runtime.rpcVersion;
  client.moduleBase = runtime.moduleBase;
  client.rpcVersion = runtime.rpcVersion;
  if (changed) {
    client.template = null;
  }
  return true;
}

function extractAsyncTaskId(text) {
  const match = String(text || '').match(/ASYNC:([0-9a-f-]+)/i);
  return match ? match[1] : '';
}

function extractPdfUrl(text) {
  const match = String(text || '').match(/https:\/\/print-prod\.moysklad\.ru\/temp\/[^"',\]\s]+\.pdf/i);
  return match ? match[0] : '';
}

function responseContainsTemplate(text, templateName = 'Код маркировки и ШК') {
  return String(text || '').includes(templateName);
}

function buildTemplatePayload(moduleBase = DEFAULT_MODULE_BASE) {
  return `7|0|6|${moduleBase}|C552A96838172DB5F7717A1B2EC74FD0|com.lognex.sklad.face.common.client.print.TemplateService|getTemplate|java.lang.String/2004016611|EmissionOrder|1|2|3|4|1|5|6|`;
}

function buildTaskPayload(taskId, moduleBase = DEFAULT_MODULE_BASE) {
  return `7|0|7|${moduleBase}|B01E8C8D1D04DD6BB1F78BC90694438F|com.lognex.sklad.face.common.client.module.exportimport.ExportImportService|getTask|com.lognex.type.ID/131549306|java.util.UUID/2940008275|${taskId}|1|2|3|4|1|5|5|6|7|`;
}

function buildTemplateServicePaths(rpcVersion) {
  return [
    `/app/services/${rpcVersion}/MxTemplateService`,
    '/app/services/MxTemplateService',
    `/app/services/print/${rpcVersion}/MxTemplateService`,
    '/app/services/print/MxTemplateService',
  ];
}

function buildTaskServicePaths(rpcVersion) {
  return [
    `/app/services/${rpcVersion}/ExportImportService`,
    '/app/services/ExportImportService',
    `/app/services/print/${rpcVersion}/ExportImportService`,
    '/app/services/print/ExportImportService',
  ];
}

function buildPrintServicePaths(rpcVersion) {
  return [
    `/app/services/print/${rpcVersion}/PriceTypePrintService`,
    `/app/services/${rpcVersion}/PriceTypePrintService`,
    '/app/services/print/PriceTypePrintService',
    '/app/services/PriceTypePrintService',
  ];
}

function extractGwtStrings(text) {
  return Array.from(String(text || '').matchAll(/"((?:\\.|[^"\\])*)"/g), (match) => {
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch (_) {
      return match[1];
    }
  });
}

function parseTemplateMetadata(text, templateName = 'Код маркировки и ШК') {
  const strings = extractGwtStrings(text);
  const fileIndex = strings.findIndex((value) => value === `${templateName}.xml`);
  if (fileIndex < 0) {
    return null;
  }

  const uuidClassIndex = strings.indexOf('java.util.UUID/2940008275');
  return {
    fileName: strings[fileIndex],
    templateType: strings[fileIndex + 1] || 'Template',
    ownerLogin: strings[fileIndex + 2] || '',
    templateToken: strings[fileIndex + 3] || '',
    templateName: strings[fileIndex + 4] || templateName,
    templateId: strings[fileIndex + 5] || '',
    accountId: uuidClassIndex >= 0 ? strings[uuidClassIndex + 1] : '',
  };
}

function buildRequestDocumentPayload({
  documentId,
  positionId,
  quantity,
  template,
  moduleBase = DEFAULT_MODULE_BASE,
  refId = DEFAULT_REF_ID,
}) {
  const safeQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
  return `7|0|40|${moduleBase}|A405BC6EB6B36D4D5A38682DAAA9511E|com.lognex.print.face.common.service.PriceTypePrintService|requestDocument|com.lognex.api.base.gwt.client.to.DocumentTO/2469114615|com.lognex.type.ID/131549306|com.lognex.api.base.gwt.client.common.Type/1806655303|com.lognex.api.base.gwt.client.to.DocumentFormat/1520872499|com.lognex.api.base.gwt.client.to.IRefTO|I|com.lognex.api.base.gwt.client.print.PriceQuantitySource/1730076791|java.lang.Integer/3438268394|com.lognex.api.base.gwt.client.to.TemplateType/4288425977|java.util.Set|[Lcom.lognex.api.base.gwt.client.filter.PumpFilter;/2096942280|com.lognex.api.base.gwt.client.filter.ClientSortCriteria/2929609327|java.util.Date/3385151746|${template.fileName}|${template.templateType}|${template.ownerLogin}|${template.templateToken}|${template.templateName}|java.util.UUID/2940008275|${template.accountId}|com.lognex.api.base.gwt.client.change.DirtyTracker/1761046355||${template.templateId}|${documentId}|com.lognex.api.base.gwt.client.to.RefTO/3246906117|${refId}|java.util.HashSet/3273092938|${positionId}|com.lognex.api.base.gwt.client.filter.ImmutableBooleanFilter/599997023|com.lognex.api.base.gwt.client.filter2.PumpFilterDesc/304620322|testPrintFilter|[Lcom.lognex.api.base.gwt.client.filter.PumpFilterParameter;/204125189|com.lognex.api.base.gwt.client.filter.PumpFilterParameterBoolean/3862516349|java.lang.Boolean/476441737|value|printAllCodesFilter|1|2|3|4|13|5|6|7|8|9|10|11|9|12|13|14|15|16|5|17|ZxQxboj|0|1|18|12|4|19|BiB|20|0|0|21|22|23|24|0|25|0|0|26|6|23|27|1|1|0|26|0|0|17|ZxQxboj|26|A|6|23|28|7|125|8|3|29|0|26|25|0|0|26|0|${safeQuantity}|11|0|29|0|0|25|1|6|23|30|0|0|12|1|13|3|31|1|6|23|32|15|2|33|0|34|0|0|0|35|36|1|37|38|0|39|0|-28|33|0|34|0|0|0|40|36|1|37|38|1|39|0|-33|0|`;
}

class MoySkladPrintRpcClient {
  constructor(browserSession, options = {}) {
    this.browserSession = browserSession;
    this.rpcVersion = options.rpcVersion || DEFAULT_RPC_VERSION;
    this.moduleBase = options.moduleBase || DEFAULT_MODULE_BASE;
    this.permutation = options.permutation || DEFAULT_PERMUTATION;
    this.refId = options.refId || DEFAULT_REF_ID;
    this.templateName = options.templateName || 'Код маркировки и ШК';
    this.taskTimeoutMs = options.taskTimeoutMs || 120000;
    this.template = null;
    this.runtimeConfigResolved = Boolean(options.skipRuntimeDiscovery);
  }

  async resolveRuntimeConfig(force = false) {
    if (this.runtimeConfigResolved && !force) {
      return;
    }

    const request = await this.browserSession.getRequestContext();
    const response = await request.get(`${ONLINE_BASE}/app/`);
    let runtime = {};
    if (response.ok()) {
      runtime = parseRuntimeConfigFromHtml(await response.text());
    }
    let resolved = applyRuntimeConfig(this, runtime);

    if (!resolved && typeof this.browserSession.discoverGwtParams === 'function') {
      const params = await this.browserSession.discoverGwtParams();
      if (params && params.rpcVersion && params.moduleBase) {
        this.rpcVersion = params.rpcVersion;
        this.moduleBase = params.moduleBase;
        if (params.permutation) this.permutation = params.permutation;
        this.template = null;
        resolved = true;
        runtime = {};
      }
    }

    if (runtime.nocacheScriptUrl) {
      try {
        const scriptResponse = await request.get(runtime.nocacheScriptUrl);
        if (scriptResponse.ok()) {
          const permutation = extractGwtPermutation(await scriptResponse.text());
          if (permutation) {
            this.permutation = permutation;
          }
        }
      } catch (_) {
        // The old permutation is still a better fallback than failing before the RPC call.
      }
    }

    this.runtimeConfigResolved = true;
  }

  async postOnce(path, payload) {
    const request = await this.browserSession.getRequestContext();
    const response = await request.post(`${ONLINE_BASE}${path}`, {
      headers: {
        Accept: '*/*',
        'Content-Type': 'text/x-gwt-rpc; charset=utf-8',
        'X-GWT-Module-Base': this.moduleBase,
        'X-GWT-Permutation': this.permutation,
      },
      data: payload,
    });
    const text = await response.text();
    if (!response.ok()) {
      const error = new Error(`${PRINT_PROTOCOL_ERROR} ${path} HTTP ${response.status()}: ${text.slice(0, 200)}`);
      error.status = response.status();
      error.path = path;
      throw error;
    }
    return text;
  }

  async post(pathFactory, payloadFactory) {
    await this.resolveRuntimeConfig();

    try {
      return await this.postOnce(pathFactory(), payloadFactory());
    } catch (error) {
      if (error && error.status === 405) {
        await this.resolveRuntimeConfig(true);
        return this.postOnce(pathFactory(), payloadFactory());
      }
      throw error;
    }
  }

  async postAny(pathFactory, payloadFactory) {
    await this.resolveRuntimeConfig();
    let lastError = null;

    for (let refreshAttempt = 0; refreshAttempt < 2; refreshAttempt += 1) {
      const paths = pathFactory();
      const payload = payloadFactory();

      for (const path of paths) {
        try {
          return await this.postOnce(path, payload);
        } catch (error) {
          lastError = error;
          if (!error || error.status !== 405) {
            throw error;
          }
        }
      }

      if (refreshAttempt === 0) {
        await this.resolveRuntimeConfig(true);
      }
    }

    throw lastError;
  }

  async getEmissionOrderTemplates() {
    const text = await this.postAny(
      () => buildTemplateServicePaths(this.rpcVersion),
      () => buildTemplatePayload(this.moduleBase),
    );
    const template = parseTemplateMetadata(text, this.templateName);
    if (!template) {
      throw new Error(`${PRINT_PROTOCOL_ERROR} Шаблон "${this.templateName}" не найден.`);
    }
    this.template = template;
    return text;
  }

  async requestPositionPdf({ documentId, positionId, quantity }) {
    if (!this.template) {
      await this.getEmissionOrderTemplates();
    }
    const text = await this.postAny(
      () => buildPrintServicePaths(this.rpcVersion),
      () => buildRequestDocumentPayload({
        documentId,
        positionId,
        quantity,
        template: this.template,
        moduleBase: this.moduleBase,
        refId: this.refId,
      }),
    );
    const taskId = extractAsyncTaskId(text);
    if (!taskId) {
      throw new Error(`${PRINT_PROTOCOL_ERROR} Не найден номер задачи печати.`);
    }
    return taskId;
  }

  async pollPrintTask(taskId) {
    const started = Date.now();
    while (Date.now() - started < this.taskTimeoutMs) {
      const text = await this.postAny(
        () => buildTaskServicePaths(this.rpcVersion),
        () => buildTaskPayload(taskId, this.moduleBase),
      );
      const downloadUrl = extractPdfUrl(text);
      if (downloadUrl) {
        return downloadUrl;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error('МойСклад не подготовил PDF за отведенное время.');
  }

  async downloadPdf(downloadUrl) {
    const request = await this.browserSession.getRequestContext();
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await request.get(downloadUrl);
        const body = await response.body();
        if (response.ok() && body.length > 0) {
          return body;
        }
        lastError = new Error(`HTTP ${response.status()}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Не удалось скачать PDF: ${lastError && lastError.message ? lastError.message : lastError}`);
  }
}

module.exports = {
  MoySkladPrintRpcClient,
  DEFAULT_MODULE_BASE,
  DEFAULT_PERMUTATION,
  DEFAULT_REF_ID,
  PRINT_PROTOCOL_ERROR,
  buildRequestDocumentPayload,
  buildPrintServicePaths,
  buildTaskServicePaths,
  buildTemplateServicePaths,
  buildTaskPayload,
  buildTemplatePayload,
  extractGwtPermutation,
  extractModuleBase,
  extractAsyncTaskId,
  extractGwtStrings,
  extractPdfUrl,
  parseRuntimeConfigFromHtml,
  parseTemplateMetadata,
  responseContainsTemplate,
};
