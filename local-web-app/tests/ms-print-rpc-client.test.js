const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MoySkladPrintRpcClient,
  DEFAULT_MODULE_BASE,
  DEFAULT_PERMUTATION,
  DEFAULT_TYPE_SIGNATURES,
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
  extractServiceStrongName,
  extractEnumOrdinal,
  extractModuleBase,
  extractAsyncTaskId,
  extractPdfUrl,
  extractTaskFailure,
  parseRuntimeConfigFromHtml,
  parseTemplateMetadata,
  responseContainsTemplate,
} = require('../server/lib/ms-print-rpc-client');

test('extractAsyncTaskId reads MoySklad async task id', () => {
  assert.equal(extractAsyncTaskId('//OK["ASYNC:11111111-2222-3333-4444-555555555555"]'), '11111111-2222-3333-4444-555555555555');
  assert.equal(extractAsyncTaskId('//OK["taskId","11111111-2222-3333-4444-555555555555"]'), '11111111-2222-3333-4444-555555555555');
  assert.equal(extractAsyncTaskId('//OK["11111111-2222-3333-4444-555555555555"]'), '11111111-2222-3333-4444-555555555555');
  assert.equal(extractAsyncTaskId('//OK["11111111-2222-3333-4444-555555555555","66666666-7777-8888-9999-000000000000"]'), '');
  assert.equal(extractAsyncTaskId('no task'), '');
});

test('extractPdfUrl reads temporary print-prod PDF URL', () => {
  const url = 'https://print-prod.moysklad.ru/temp/a/b/file.pdf';
  assert.equal(extractPdfUrl(`["done","${url}"]`), url);
  assert.equal(extractPdfUrl('pending'), '');
});

test('extractTaskFailure reads a failed asynchronous print response', () => {
  const reason = 'Не удалось распечатать шаблон: Cannot invoke clazz';
  assert.equal(extractTaskFailure(`//OK[1,2,["${reason}","DocumentGenerationException"],0,7]`), reason);
  assert.equal(extractTaskFailure('//OK[1,2,["pending"],0,7]'), '');
});

test('responseContainsTemplate checks target template name', () => {
  assert.equal(responseContainsTemplate('Код маркировки и ШК.xml'), true);
  assert.equal(responseContainsTemplate('Другой шаблон'), false);
});

test('extractModuleBase reads current MoySklad app build URL', () => {
  assert.equal(
    extractModuleBase('<script src="https://cdn-static.moysklad.ru/app/cdn/r1777/app.nocache.js"></script>'),
    'https://cdn-static.moysklad.ru/app/cdn/r1777/',
  );
  assert.equal(
    extractModuleBase('<script src="https://cdn-static.moysklad.ru/app/cdn/r1671-1/app.nocache.js"></script>'),
    'https://cdn-static.moysklad.ru/app/cdn/r1671-1/',
  );
  assert.equal(
    extractModuleBase('<script src="/app/cdn/r1778/app.nocache.js"></script>'),
    'https://online.moysklad.ru/app/cdn/r1778/',
  );
  assert.equal(
    extractModuleBase('https://cdn-static.moysklad.ru/app/assets/r1779/main.js'),
    'https://cdn-static.moysklad.ru/app/assets/r1779/',
  );
  assert.equal(extractModuleBase('window.build="r1780"'), 'https://online.moysklad.ru/app/cdn/r1780/');
  assert.equal(extractModuleBase('window.build="r1780-2"'), 'https://online.moysklad.ru/app/cdn/r1780-2/');
});

test('parseRuntimeConfigFromHtml reads RPC version and nocache script URL', () => {
  assert.deepEqual(parseRuntimeConfigFromHtml('<script src="https://cdn-static.moysklad.ru/app/cdn/r1777/app.nocache.js"></script>'), {
    moduleBase: 'https://cdn-static.moysklad.ru/app/cdn/r1777/',
    rpcVersion: 'r1777',
    nocacheScriptUrl: 'https://cdn-static.moysklad.ru/app/cdn/r1777/app.nocache.js',
  });
  assert.equal(
    parseRuntimeConfigFromHtml('<script src="https://cdn-static.moysklad.ru/app/cdn/r1671-1/app.nocache.js"></script>').rpcVersion,
    'r1671-1',
  );
});

test('extractGwtPermutation reads first GWT permutation strong name', () => {
  assert.equal(extractGwtPermutation('x 0123456789ABCDEF0123456789ABCDEF y'), '0123456789ABCDEF0123456789ABCDEF');
  assert.equal(extractGwtPermutation('no permutation'), '');
});

test('compiled GWT metadata exposes service policy names and enum ordinals', () => {
  const cache = [
    "IoU='EmissionOrder';",
    "function px(){d9i.call(this,TJ(),null,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',serializer)}",
    "function init(){proxy(new gfk,new px,'PriceTypePrintService')}",
    "var type=rYS(UnU,'Type',39,Y0i,eEk,dEk);",
    'M7i(39,10,{39:1},RDk,SDk);',
    'Utk=new SDk(IoU,128,metadata);',
  ].join('');
  assert.equal(extractServiceStrongName(cache, 'PriceTypePrintService'), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(extractEnumOrdinal(cache, 'Type', 'EmissionOrder'), 128);
  assert.equal(extractServiceStrongName(cache, 'UnknownService'), '');
});

function buildCompiledMetadataFixture() {
  return [
    "var signature='com.lognex.api.base.gwt.client.common.Type/603672630';",
    "IoU='EmissionOrder';",
    "function templateProxy(){d9i.call(this,TJ(),null,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',serializer)}",
    "function printProxy(){d9i.call(this,TJ(),null,'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',serializer)}",
    "function taskProxy(){d9i.call(this,TJ(),null,'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',serializer)}",
    "function init(){proxy(new gfk,new templateProxy,'MxTemplateService');proxy(new gfk,new printProxy,'PriceTypePrintService');proxy(new gfk,new taskProxy,'ExportImportService')}",
    "var type=rYS(UnU,'Type',39,Y0i,eEk,dEk);",
    'M7i(39,10,{39:1},RDk,SDk);',
    'Utk=new SDk(IoU,128,metadata);',
  ].join('');
}

function mockResponse(status, body = '') {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    text: async () => body,
  };
}

test('runtime metadata discovery recovers with GWT params captured from the logged-in page', async () => {
  const requested = [];
  const browserSession = {
    getRequestContext: async () => ({
      get: async (url) => {
        requested.push(url);
        if (url.includes('CURRENTCURRENTCURRENTCURRENTCURRENT12.cache.js')) {
          return mockResponse(200, buildCompiledMetadataFixture());
        }
        return mockResponse(404);
      },
    }),
    discoverGwtParams: async () => ({
      rpcVersion: 'r1712',
      moduleBase: 'https://cdn-static.moysklad.ru/app/cdn/r1712/',
      permutation: 'CURRENTCURRENTCURRENTCURRENTCURRENT12',
    }),
  };
  const client = new MoySkladPrintRpcClient(browserSession);

  await client.resolveTypeSignatures();

  assert.equal(client.rpcVersion, 'r1712');
  assert.equal(client.permutation, 'CURRENTCURRENTCURRENTCURRENTCURRENT12');
  assert.equal(client.typeSignatures.get('com.lognex.api.base.gwt.client.common.Type'), '603672630');
  assert.equal(client.emissionOrderOrdinal, 128);
  assert.deepEqual(Object.fromEntries(client.serviceStrongNames), {
    template: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    print: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    task: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  });
  assert.equal(requested.some((url) => url.includes('CURRENTCURRENTCURRENTCURRENTCURRENT12.cache.js')), true);
});

test('runtime metadata discovery fails before printing when the protocol remains incomplete', async () => {
  let discoveryCalls = 0;
  const browserSession = {
    getRequestContext: async () => ({ get: async () => mockResponse(404) }),
    discoverGwtParams: async () => {
      discoveryCalls += 1;
      return null;
    },
  };
  const client = new MoySkladPrintRpcClient(browserSession);

  await assert.rejects(
    client.resolveTypeSignatures(),
    /Не удалось загрузить параметры протокола.*Сигнатур получено: 0/s,
  );
  await assert.rejects(client.resolveTypeSignatures(), /Не удалось загрузить параметры протокола/);
  assert.equal(discoveryCalls, 1);
});

test('requestPositionPdf keeps its template snapshot across a runtime retry', async () => {
  const client = new MoySkladPrintRpcClient({}, { skipRuntimeDiscovery: true });
  client.template = {
    fileName: 'template.xml',
    templateType: 'Template',
    ownerLogin: 'admin@example.com',
    templateToken: 'token',
    templateName: 'template',
    templateId: 'template-id',
    accountId: 'account-id',
  };
  client.serviceStrongNames = new Map([['print', 'PRINTPOLICYPRINTPOLICYPRINTPOLICY12']]);
  client.resolveRuntimeConfig = async (force = false) => {
    if (force) client.template = null;
  };
  client.resolveTypeSignatures = async () => {};
  let attempts = 0;
  client.postOnce = async (_path, payload) => {
    attempts += 1;
    assert.equal(payload.includes('|template.xml|Template|admin@example.com|token|template|'), true);
    if (attempts === 1) {
      const error = new Error('endpoint moved');
      error.status = 405;
      throw error;
    }
    return '//OK["ASYNC:11111111-2222-3333-4444-555555555555"]';
  };

  const taskId = await client.requestPositionPdf({
    documentId: 'document-id',
    positionId: 'position-id',
    quantity: 9,
  });

  assert.equal(taskId, '11111111-2222-3333-4444-555555555555');
  assert.equal(attempts, 2);
});

test('buildTemplatePayload matches MoySklad GWT-RPC template request shape', () => {
  const payload = buildTemplatePayload(DEFAULT_MODULE_BASE);
  assert.equal(payload.startsWith(`7|0|6|${DEFAULT_MODULE_BASE}|${DEFAULT_PERMUTATION}|`), true);
  assert.equal(payload.includes('|getTemplate|java.lang.String/2004016611|EmissionOrder|'), true);
});

test('buildTaskPayload matches MoySklad GWT-RPC task polling shape', () => {
  const payload = buildTaskPayload('203b5527-51f4-11f1-0a80-056b0002e0f2');
  assert.equal(payload.includes('ExportImportService|getTask|'), true);
  assert.equal(payload.includes('|203b5527-51f4-11f1-0a80-056b0002e0f2|'), true);
});

test('buildPrintServicePaths uses MoySklad print servlet path', () => {
  assert.deepEqual(buildPrintServicePaths('r1777'), [
    '/app/services/print/r1777/PriceTypePrintService',
  ]);
});

test('template and task service paths use versioned MoySklad servlet paths', () => {
  assert.deepEqual(buildTemplateServicePaths('r1777'), [
    '/app/services/r1777/MxTemplateService',
  ]);
  assert.deepEqual(buildTaskServicePaths('r1777'), [
    '/app/services/r1777/ExportImportService',
  ]);
});

test('parseTemplateMetadata extracts template values from GWT-RPC response string table', () => {
  const response = '//OK["java.util.UUID/2940008275","22920a00-185d-11ec-0a80-04c00001a91c","Код маркировки и ШК.xml","Template","admin@example.com","token-1","Код маркировки и ШК","template-id","EmissionOrder"]';
  assert.deepEqual(parseTemplateMetadata(response), {
    fileName: 'Код маркировки и ШК.xml',
    templateType: 'Template',
    ownerLogin: 'admin@example.com',
    templateToken: 'token-1',
    templateName: 'Код маркировки и ШК',
    templateId: 'template-id',
    accountId: '22920a00-185d-11ec-0a80-04c00001a91c',
  });
});

test('buildRequestDocumentPayload substitutes document, position, quantity, and template metadata', () => {
  const payload = buildRequestDocumentPayload({
    documentId: '39732d8d-5124-11f1-0a80-1385001c4e14',
    positionId: 'fe298f4d-5124-11f1-0a80-188a001c572d',
    quantity: 45,
    template: {
      fileName: 'Код маркировки и ШК.xml',
      templateType: 'Template',
      ownerLogin: 'admin@example.com',
      templateToken: 'token-1',
      templateName: 'Код маркировки и ШК',
      templateId: 'template-id',
      accountId: '22920a00-185d-11ec-0a80-04c00001a91c',
    },
  });

  assert.equal(payload.includes('PriceTypePrintService|requestDocument|'), true);
  assert.equal(payload.includes('com.lognex.api.base.gwt.client.common.Type/1193462921'), true);
  assert.equal(payload.includes('|39732d8d-5124-11f1-0a80-1385001c4e14|'), true);
  assert.equal(payload.includes('|fe298f4d-5124-11f1-0a80-188a001c572d|'), true);
  assert.equal(payload.includes('|Код маркировки и ШК.xml|Template|admin@example.com|token-1|Код маркировки и ШК|'), true);
  assert.equal(payload.includes('|7|126|8|3|'), true);
  assert.equal(payload.includes('|0|45|11|'), true);
});

test('buildRequestDocumentPayload accepts the runtime EmissionOrder ordinal', () => {
  const payload = buildRequestDocumentPayload({
    documentId: '39732d8d-5124-11f1-0a80-1385001c4e14',
    positionId: 'fe298f4d-5124-11f1-0a80-188a001c572d',
    quantity: 1,
    emissionOrderOrdinal: 128,
    template: {
      fileName: 'template.xml', templateType: 'Template', ownerLogin: 'admin@example.com',
      templateToken: 'token', templateName: 'template', templateId: 'template-id', accountId: 'account-id',
    },
  });
  assert.equal(payload.includes('|7|128|8|3|'), true);
});

function buildSamplePayload() {
  return buildRequestDocumentPayload({
    documentId: '39732d8d-5124-11f1-0a80-1385001c4e14',
    positionId: 'fe298f4d-5124-11f1-0a80-188a001c572d',
    quantity: 1,
    template: {
      fileName: 'Код маркировки и ШК.xml',
      templateType: 'Template',
      ownerLogin: 'admin@example.com',
      templateToken: 'token-1',
      templateName: 'Код маркировки и ШК',
      templateId: 'template-id',
      accountId: '22920a00-185d-11ec-0a80-04c00001a91c',
    },
  });
}

test('every DEFAULT_TYPE_SIGNATURES token appears verbatim across the GWT payloads', () => {
  const payloads = [
    buildSamplePayload(),
    buildTaskPayload('203b5527-51f4-11f1-0a80-056b0002e0f2'),
    buildTemplatePayload(DEFAULT_MODULE_BASE),
  ].join('\n');
  for (const [className, signature] of Object.entries(DEFAULT_TYPE_SIGNATURES)) {
    assert.equal(payloads.includes(`${className}/${signature}`), true, `missing ${className}/${signature}`);
  }
});

test('extractTypeSignatures reads Class/CRC tokens out of compiled GWT JS', () => {
  const js = 'a["com.lognex.api.base.gwt.client.common.Type/9998887776"]=1;'
    + 'b["[Lcom.lognex.api.base.gwt.client.filter.PumpFilter;/1112223334"]=2;';
  const signatures = extractTypeSignatures(js);
  assert.equal(signatures.get('com.lognex.api.base.gwt.client.common.Type'), '9998887776');
  assert.equal(signatures.get('[Lcom.lognex.api.base.gwt.client.filter.PumpFilter;'), '1112223334');
});

test('parseSerializationPolicy reads the CRC column out of a .gwt.rpc policy file', () => {
  const policy = [
    'com.lognex.api.base.gwt.client.common.Type, true, true, true, true, 9998887776',
    'java.lang.String, false, true, true, true, 2004016611',
    '# a comment line',
    'not.a.policy.line',
  ].join('\n');
  const signatures = parseSerializationPolicy(policy);
  assert.equal(signatures.get('com.lognex.api.base.gwt.client.common.Type'), '9998887776');
  assert.equal(signatures.get('java.lang.String'), '2004016611');
});

test('applySignatureOverrides swaps known type signatures and leaves the rest intact', () => {
  const payload = buildSamplePayload();
  const overrides = new Map([['com.lognex.api.base.gwt.client.common.Type', '9998887776']]);
  const rewritten = applySignatureOverrides(payload, overrides);

  assert.equal(rewritten.includes('com.lognex.api.base.gwt.client.common.Type/9998887776'), true);
  assert.equal(rewritten.includes('com.lognex.api.base.gwt.client.common.Type/1193462921'), false);
  // Unknown types and the module URL are untouched.
  assert.equal(rewritten.includes('java.util.UUID/2940008275'), true);
  assert.equal(rewritten.includes(DEFAULT_MODULE_BASE), true);
  // The document/position UUIDs must survive verbatim.
  assert.equal(rewritten.includes('|39732d8d-5124-11f1-0a80-1385001c4e14|'), true);
});

test('applySignatureOverrides is a no-op for an empty signature map', () => {
  const payload = buildSamplePayload();
  assert.equal(applySignatureOverrides(payload, new Map()), payload);
  assert.equal(applySignatureOverrides(payload, null), payload);
});

test('describeGwtException surfaces the MoySklad invalid-signature reason', () => {
  const body = '//EX[2,1,["com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException/3936916533",'
    + '"Invalid type signature for com.lognex.api.base.gwt.client.common.Type"],0,7]';
  const described = describeGwtException(body);
  assert.equal(described.includes('Invalid type signature for com.lognex.api.base.gwt.client.common.Type'), true);
});
