const ONLINE_BASE = 'https://online.moysklad.ru';
const DEFAULT_RPC_VERSION = 'r1668';
const DEFAULT_MODULE_BASE = 'https://cdn-static.moysklad.ru/app/cdn/r1668/';
const DEFAULT_PERMUTATION = '65DD15C4D67E019A7A66BAD8ED43273D';
const DEFAULT_REF_ID = '0fecd212-1864-11ec-0a80-0865003ffa33';
const PRINT_PROTOCOL_ERROR = 'Протокол печати МойСклад изменился. Требуется обновление интеграции.';
const RPC_VERSION_PATTERN = 'r\\d+(?:-\\d+)?';

// GWT-RPC type signatures (the digits after `Class/...`) are CRCs of each class's
// serialized shape, baked into one MoySklad build. When MoySklad rebuilds their app
// the CRCs change and the server rejects our payloads with an IncompatibleRemoteService
// exception. These defaults document the build the payloads below were captured from;
// at runtime the real signatures are discovered from MoySklad's serialization policy
// and override these so a rebuild no longer breaks printing.
const DEFAULT_TYPE_SIGNATURES = {
  'java.lang.String': '2004016611',
  'java.lang.Integer': '3438268394',
  'java.lang.Boolean': '476441737',
  'java.util.UUID': '2940008275',
  'java.util.Date': '3385151746',
  'java.util.HashSet': '3273092938',
  'com.lognex.type.ID': '131549306',
  'com.lognex.api.base.gwt.client.to.DocumentTO': '2469114615',
  'com.lognex.api.base.gwt.client.common.Type': '1193462921',
  'com.lognex.api.base.gwt.client.to.DocumentFormat': '1520872499',
  'com.lognex.api.base.gwt.client.print.PriceQuantitySource': '1730076791',
  'com.lognex.api.base.gwt.client.to.TemplateType': '4288425977',
  '[Lcom.lognex.api.base.gwt.client.filter.PumpFilter;': '2096942280',
  'com.lognex.api.base.gwt.client.filter.ClientSortCriteria': '2929609327',
  'com.lognex.api.base.gwt.client.change.DirtyTracker': '1761046355',
  'com.lognex.api.base.gwt.client.to.RefTO': '3246906117',
  'com.lognex.api.base.gwt.client.filter.ImmutableBooleanFilter': '599997023',
  'com.lognex.api.base.gwt.client.filter2.PumpFilterDesc': '304620322',
  '[Lcom.lognex.api.base.gwt.client.filter.PumpFilterParameter;': '204125189',
  'com.lognex.api.base.gwt.client.filter.PumpFilterParameterBoolean': '3862516349',
};

// A type that only appears in the print payload, used to decide whether a discovered
// policy file actually covers the print service before we trust it.
const TYPE_SIGNATURE_PROBE = 'com.lognex.api.base.gwt.client.common.Type';

// Matches a GWT type-signature token: optional `[L` array prefix, a dotted (package
// qualified) class name, optional trailing `;`, then `/` and the CRC digits.
const TYPE_SIGNATURE_TOKEN = /((?:\[+L)?[A-Za-z_$][\w$]*(?:\.[\w$]+)+;?)\/(\d{6,})/g;

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
  return firstMatch(moduleBase, new RegExp(`/(${RPC_VERSION_PATTERN})/`, 'i'));
}

function extractModuleBase(text) {
  const source = String(text || '');
  const absolute = firstMatch(source, new RegExp(`(https://cdn-static\\.moysklad\\.ru/app/cdn/${RPC_VERSION_PATTERN}/)`, 'i'));
  if (absolute) {
    return normalizeModuleBase(absolute);
  }

  const relative = source.match(new RegExp(`["']((?:https?://online\\.moysklad\\.ru)?/app/cdn/${RPC_VERSION_PATTERN}/)["']`, 'i'));
  if (relative) {
    return normalizeModuleBase(new URL(relative[1], ONLINE_BASE).href);
  }

  const version = firstMatch(source, new RegExp(`/app/(?:cdn/)?(${RPC_VERSION_PATTERN})/`, 'i'));
  if (version) {
    return `${ONLINE_BASE}/app/cdn/${version}/`;
  }

  const anyVersionedBase = firstMatch(source, new RegExp(`(https?://[^"'\\s]+/${RPC_VERSION_PATTERN}/)`, 'i'));
  if (anyVersionedBase) {
    return normalizeModuleBase(anyVersionedBase);
  }

  const anyVersion = firstMatch(source, new RegExp(`\\b(${RPC_VERSION_PATTERN})\\b`, 'i'));
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
  const source = String(text || '');
  const asyncMatch = source.match(/ASYNC:([0-9a-f-]{36})/i);
  if (asyncMatch) {
    return asyncMatch[1];
  }

  const contextualMatch = source.match(/(?:task|async|export|print)[^0-9a-f]{0,80}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (contextualMatch) {
    return contextualMatch[1];
  }

  const uuidMatches = Array.from(source.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi), (match) => match[0]);
  return uuidMatches.length === 1 ? uuidMatches[0] : '';
}

function extractPdfUrl(text) {
  const match = String(text || '').match(/https:\/\/print-prod\.moysklad\.ru\/temp\/[^"',\]\s]+\.pdf/i);
  return match ? match[0] : '';
}

function responseContainsTemplate(text, templateName = 'Код маркировки и ШК') {
  return String(text || '').includes(templateName);
}

function buildTemplatePayload(moduleBase = DEFAULT_MODULE_BASE, permutation = DEFAULT_PERMUTATION) {
  return `7|0|6|${moduleBase}|${permutation}|com.lognex.sklad.face.common.client.print.TemplateService|getTemplate|java.lang.String/2004016611|EmissionOrder|1|2|3|4|1|5|6|`;
}

function buildTaskPayload(taskId, moduleBase = DEFAULT_MODULE_BASE, permutation = DEFAULT_PERMUTATION) {
  return `7|0|7|${moduleBase}|${permutation}|com.lognex.sklad.face.common.client.module.exportimport.ExportImportService|getTask|com.lognex.type.ID/131549306|java.util.UUID/2940008275|${taskId}|1|2|3|4|1|5|5|6|7|`;
}

function buildTemplateServicePaths(rpcVersion) {
  return [
    `/app/services/${rpcVersion}/MxTemplateService`,
  ];
}

function buildTaskServicePaths(rpcVersion) {
  return [
    `/app/services/${rpcVersion}/ExportImportService`,
  ];
}

function buildPrintServicePaths(rpcVersion) {
  return [
    `/app/services/print/${rpcVersion}/PriceTypePrintService`,
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

// Reads `Class/CRC` tokens out of any GWT artifact (compiled `*.cache.js`, an `//EX`
// error body, etc.) into a className -> signature map.
function extractTypeSignatures(text) {
  const signatures = new Map();
  const source = String(text || '');
  let match;
  TYPE_SIGNATURE_TOKEN.lastIndex = 0;
  while ((match = TYPE_SIGNATURE_TOKEN.exec(source)) !== null) {
    if (!signatures.has(match[1])) {
      signatures.set(match[1], match[2]);
    }
  }
  return signatures;
}

// Parses a GWT serialization policy file (`<strongName>.gwt.rpc`) — the same file the
// server validates incoming payloads against. Each type line is comma separated and,
// when the build embeds CRCs, the last numeric column is the type signature.
function parseSerializationPolicy(text) {
  const signatures = new Map();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const columns = line.split(',').map((column) => column.trim());
    const typeName = columns[0];
    if (!typeName || !typeName.includes('.')) {
      continue;
    }
    for (let index = columns.length - 1; index >= 1; index -= 1) {
      if (/^\d{6,}$/.test(columns[index])) {
        if (!signatures.has(typeName)) {
          signatures.set(typeName, columns[index]);
        }
        break;
      }
    }
  }
  return signatures;
}

// Rewrites every `Class/CRC` token in a payload whose class is present in the discovered
// signature map, leaving unknown tokens (and non-type slashes such as the module URL)
// untouched.
function applySignatureOverrides(payload, signatures) {
  if (!signatures || typeof signatures.get !== 'function' || signatures.size === 0) {
    return payload;
  }
  return String(payload).replace(TYPE_SIGNATURE_TOKEN, (whole, className) => {
    const discovered = signatures.get(className);
    return discovered ? `${className}/${discovered}` : whole;
  });
}

// Turns a GWT `//EX[...]` exception body into a short, readable reason.
function describeGwtException(text) {
  const strings = extractGwtStrings(text);
  const reason = strings.find((value) => /signature|exception|invalid|error/i.test(value) && !value.includes('/'));
  const snippet = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  return reason ? `${reason} Ответ сервера: ${snippet}` : `Ответ сервера: ${snippet}`;
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
  permutation = DEFAULT_PERMUTATION,
  refId = DEFAULT_REF_ID,
}) {
  const safeQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
  return `7|0|40|${moduleBase}|${permutation}|com.lognex.print.face.common.service.PriceTypePrintService|requestDocument|com.lognex.api.base.gwt.client.to.DocumentTO/2469114615|com.lognex.type.ID/131549306|com.lognex.api.base.gwt.client.common.Type/1193462921|com.lognex.api.base.gwt.client.to.DocumentFormat/1520872499|com.lognex.api.base.gwt.client.to.IRefTO|I|com.lognex.api.base.gwt.client.print.PriceQuantitySource/1730076791|java.lang.Integer/3438268394|com.lognex.api.base.gwt.client.to.TemplateType/4288425977|java.util.Set|[Lcom.lognex.api.base.gwt.client.filter.PumpFilter;/2096942280|com.lognex.api.base.gwt.client.filter.ClientSortCriteria/2929609327|java.util.Date/3385151746|${template.fileName}|${template.templateType}|${template.ownerLogin}|${template.templateToken}|${template.templateName}|java.util.UUID/2940008275|${template.accountId}|com.lognex.api.base.gwt.client.change.DirtyTracker/1761046355||${template.templateId}|${documentId}|com.lognex.api.base.gwt.client.to.RefTO/3246906117|${refId}|java.util.HashSet/3273092938|${positionId}|com.lognex.api.base.gwt.client.filter.ImmutableBooleanFilter/599997023|com.lognex.api.base.gwt.client.filter2.PumpFilterDesc/304620322|testPrintFilter|[Lcom.lognex.api.base.gwt.client.filter.PumpFilterParameter;/204125189|com.lognex.api.base.gwt.client.filter.PumpFilterParameterBoolean/3862516349|java.lang.Boolean/476441737|value|printAllCodesFilter|1|2|3|4|13|5|6|7|8|9|10|11|9|12|13|14|15|16|5|17|ZxQxboj|0|1|18|12|4|19|BiB|20|0|0|21|22|23|24|0|25|0|0|26|6|23|27|1|1|0|26|0|0|17|ZxQxboj|26|A|6|23|28|7|126|8|3|29|0|26|25|0|0|26|0|${safeQuantity}|11|0|29|0|0|25|1|6|23|30|0|0|12|1|13|3|31|1|6|23|32|15|2|33|0|34|0|0|0|35|36|1|37|38|0|39|0|-28|33|0|34|0|0|0|40|36|1|37|38|1|39|0|-33|0|`;
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
    this.typeSignatures = new Map();
    this.typeSignaturesResolved = Boolean(options.skipRuntimeDiscovery);
    this.typeSignatureDiagnostics = '';
  }

  // Discovers the live GWT type signatures for the current build from MoySklad's own
  // serialization policy (falling back to the compiled permutation) so the payloads stay
  // valid across MoySklad app rebuilds.
  async resolveTypeSignatures(force = false) {
    if (this.typeSignaturesResolved && !force) {
      return;
    }

    let request;
    try {
      request = await this.browserSession.getRequestContext();
    } catch (_) {
      // Without a session we keep the hardcoded defaults baked into the payloads.
      this.typeSignaturesResolved = true;
      return;
    }

    const fetchText = async (url) => {
      try {
        const response = await request.get(url);
        return response.ok() ? await response.text() : '';
      } catch (_) {
        return '';
      }
    };

    const merge = (source) => {
      for (const [className, signature] of source) {
        if (!merged.has(className)) {
          merged.set(className, signature);
        }
      }
    };

    const merged = new Map();
    const policyText = await fetchText(`${this.moduleBase}${this.permutation}.gwt.rpc`);
    if (policyText) {
      merge(parseSerializationPolicy(policyText));
      merge(extractTypeSignatures(policyText));
    }

    if (!merged.has(TYPE_SIGNATURE_PROBE)) {
      const cacheText = await fetchText(`${this.moduleBase}${this.permutation}.cache.js`);
      if (cacheText) {
        merge(extractTypeSignatures(cacheText));
      }
    }

    if (merged.size > 0) {
      this.typeSignatures = merged;
    }
    this.typeSignatureDiagnostics = `Сигнатур получено: ${merged.size}; ${TYPE_SIGNATURE_PROBE}=${merged.get(TYPE_SIGNATURE_PROBE) || 'не найдена'}`;
    this.typeSignaturesResolved = true;
  }

  isSignatureMismatch(error) {
    const haystack = error ? `${error.responseText || ''} ${error.message || ''}` : '';
    return Boolean(error && error.gwtException && /Invalid type signature|IncompatibleRemoteServiceException/i.test(haystack));
  }

  decorateError(error, tried) {
    if (!error || error.decorated) {
      return error;
    }
    const diagnostics = typeof this.browserSession.getRuntimeDiagnostics === 'function'
      ? this.browserSession.getRuntimeDiagnostics()
      : '';
    const uniqueTried = Array.from(new Set(tried));
    error.message = `${error.message}\nПроверенные endpoint-ы: ${uniqueTried.join(', ')}${
      this.typeSignatureDiagnostics ? `\n${this.typeSignatureDiagnostics}` : ''
    }${diagnostics ? `\nДиагностика страницы МойСклад:\n${diagnostics}` : ''}`;
    error.decorated = true;
    return error;
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
      data: applySignatureOverrides(payload, this.typeSignatures),
    });
    const text = await response.text();
    if (!response.ok()) {
      const error = new Error(`${PRINT_PROTOCOL_ERROR} ${path} HTTP ${response.status()}: ${text.slice(0, 200)}`);
      error.status = response.status();
      error.path = path;
      throw error;
    }
    // GWT returns server-side exceptions as an HTTP-200 body prefixed with `//EX`.
    if (text.startsWith('//EX')) {
      const error = new Error(`${PRINT_PROTOCOL_ERROR} ${describeGwtException(text)}`);
      error.gwtException = true;
      error.path = path;
      error.responseText = text;
      throw error;
    }
    return text;
  }

  async post(pathFactory, payloadFactory) {
    await this.resolveRuntimeConfig();
    await this.resolveTypeSignatures();

    try {
      return await this.postOnce(pathFactory(), payloadFactory());
    } catch (error) {
      if (error && error.status === 405) {
        await this.resolveRuntimeConfig(true);
        await this.resolveTypeSignatures(true);
        return this.postOnce(pathFactory(), payloadFactory());
      }
      if (this.isSignatureMismatch(error)) {
        await this.resolveTypeSignatures(true);
        return this.postOnce(pathFactory(), payloadFactory());
      }
      throw error;
    }
  }

  async postAny(pathFactory, payloadFactory) {
    await this.resolveRuntimeConfig();
    await this.resolveTypeSignatures();
    let lastError = null;
    const tried = [];
    let refreshedRuntime = false;
    let refreshedSignatures = false;

    // Retry loop: a 405 means the endpoint moved (refresh runtime config), an
    // `//EX` "Invalid type signature" means MoySklad rebuilt (refresh signatures).
    // Each refresh is attempted at most once before giving up.
    while (true) {
      const paths = pathFactory();
      const payload = payloadFactory();
      let retriable = false;

      for (const path of paths) {
        tried.push(path);
        try {
          return await this.postOnce(path, payload);
        } catch (error) {
          lastError = error;
          if (error && error.status === 405 && !refreshedRuntime) {
            retriable = true;
          } else if (this.isSignatureMismatch(error) && !refreshedSignatures) {
            retriable = true;
          } else {
            throw this.decorateError(error, tried);
          }
        }
      }

      if (!retriable) {
        break;
      }
      if (lastError && lastError.status === 405 && !refreshedRuntime) {
        refreshedRuntime = true;
        await this.resolveRuntimeConfig(true);
        await this.resolveTypeSignatures(true);
      } else if (!refreshedSignatures) {
        refreshedSignatures = true;
        await this.resolveTypeSignatures(true);
      } else {
        break;
      }
    }

    throw this.decorateError(lastError, tried);
  }

  async getEmissionOrderTemplates() {
    const text = await this.postAny(
      () => buildTemplateServicePaths(this.rpcVersion),
      () => buildTemplatePayload(this.moduleBase, this.permutation),
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
        permutation: this.permutation,
        refId: this.refId,
      }),
    );
    const taskId = extractAsyncTaskId(text);
    if (!taskId) {
      const sigInfo = this.typeSignatureDiagnostics ? `\n${this.typeSignatureDiagnostics}` : '';
      throw new Error(`${PRINT_PROTOCOL_ERROR} Не найден номер задачи печати. Ответ сервера: ${String(text || '').slice(0, 500)}${sigInfo}`);
    }
    return taskId;
  }

  async pollPrintTask(taskId) {
    const started = Date.now();
    while (Date.now() - started < this.taskTimeoutMs) {
      const text = await this.postAny(
        () => buildTaskServicePaths(this.rpcVersion),
        () => buildTaskPayload(taskId, this.moduleBase, this.permutation),
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
  DEFAULT_TYPE_SIGNATURES,
  PRINT_PROTOCOL_ERROR,
  applySignatureOverrides,
  describeGwtException,
  extractTypeSignatures,
  parseSerializationPolicy,
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
