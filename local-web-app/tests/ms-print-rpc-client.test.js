const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MODULE_BASE,
  buildRequestDocumentPayload,
  buildPrintServicePaths,
  buildTaskServicePaths,
  buildTemplateServicePaths,
  buildTaskPayload,
  buildTemplatePayload,
  extractGwtPermutation,
  extractModuleBase,
  extractServicePathsFromBundle,
  extractAsyncTaskId,
  extractPdfUrl,
  parseRuntimeConfigFromHtml,
  parseTemplateMetadata,
  responseContainsTemplate,
} = require('../server/lib/ms-print-rpc-client');

test('extractAsyncTaskId reads MoySklad async task id', () => {
  assert.equal(extractAsyncTaskId('//OK["ASYNC:11111111-2222-3333-4444-555555555555"]'), '11111111-2222-3333-4444-555555555555');
  assert.equal(extractAsyncTaskId('no task'), '');
});

test('extractPdfUrl reads temporary print-prod PDF URL', () => {
  const url = 'https://print-prod.moysklad.ru/temp/a/b/file.pdf';
  assert.equal(extractPdfUrl(`["done","${url}"]`), url);
  assert.equal(extractPdfUrl('pending'), '');
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

test('extractServicePathsFromBundle reads GWT service URLs from cache JS', () => {
  const bundle = [
    '"https://online.moysklad.ru/app/services/r1671/NewTemplateService"',
    '"/app/services/r1671/print/PriceTypePrintService"',
    '"app/services/r1671/ExportImportService"',
    '"\\/app\\/services\\/r1671\\/TemplateService"',
  ].join(';');

  assert.deepEqual(extractServicePathsFromBundle(bundle, ['TemplateService', 'NewTemplateService']), [
    '/app/services/r1671/NewTemplateService',
    '/app/services/r1671/TemplateService',
  ]);
  assert.deepEqual(extractServicePathsFromBundle(bundle, 'PriceTypePrintService'), [
    '/app/services/r1671/print/PriceTypePrintService',
  ]);
  assert.deepEqual(extractServicePathsFromBundle(bundle, 'ExportImportService'), [
    '/app/services/r1671/ExportImportService',
  ]);
});

test('buildTemplatePayload matches MoySklad GWT-RPC template request shape', () => {
  const payload = buildTemplatePayload(DEFAULT_MODULE_BASE);
  assert.equal(payload.startsWith(`7|0|6|${DEFAULT_MODULE_BASE}|C552A96838172DB5F7717A1B2EC74FD0|`), true);
  assert.equal(payload.includes('|getTemplate|java.lang.String/2004016611|EmissionOrder|'), true);
});

test('buildTaskPayload matches MoySklad GWT-RPC task polling shape', () => {
  const payload = buildTaskPayload('203b5527-51f4-11f1-0a80-056b0002e0f2');
  assert.equal(payload.includes('ExportImportService|getTask|'), true);
  assert.equal(payload.includes('|203b5527-51f4-11f1-0a80-056b0002e0f2|'), true);
});

test('buildPrintServicePaths includes old print servlet and current service servlet candidates', () => {
  assert.deepEqual(buildPrintServicePaths('r1777'), [
    '/app/services/print/r1777/PriceTypePrintService',
    '/app/services/r1777/PriceTypePrintService',
    '/app/services/r1777/print/PriceTypePrintService',
    '/app/services/print/PriceTypePrintService',
    '/app/services/PriceTypePrintService',
  ]);
});

test('template and task service paths include versioned and unversioned candidates', () => {
  assert.deepEqual(buildTemplateServicePaths('r1777'), [
    '/app/services/r1777/MxTemplateService',
    '/app/services/r1777/TemplateService',
    '/app/services/MxTemplateService',
    '/app/services/TemplateService',
    '/app/services/print/r1777/MxTemplateService',
    '/app/services/print/r1777/TemplateService',
    '/app/services/r1777/print/MxTemplateService',
    '/app/services/r1777/print/TemplateService',
    '/app/services/print/MxTemplateService',
    '/app/services/print/TemplateService',
  ]);
  assert.deepEqual(buildTaskServicePaths('r1777'), [
    '/app/services/r1777/ExportImportService',
    '/app/services/ExportImportService',
    '/app/services/print/r1777/ExportImportService',
    '/app/services/r1777/print/ExportImportService',
    '/app/services/print/ExportImportService',
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
  assert.equal(payload.includes('|39732d8d-5124-11f1-0a80-1385001c4e14|'), true);
  assert.equal(payload.includes('|fe298f4d-5124-11f1-0a80-188a001c572d|'), true);
  assert.equal(payload.includes('|Код маркировки и ШК.xml|Template|admin@example.com|token-1|Код маркировки и ШК|'), true);
  assert.equal(payload.includes('|0|45|11|'), true);
});
