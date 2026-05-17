const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MsApiError,
  buildAuthHeader,
  getOrganizations,
  findAssortmentByBarcode,
  createEmissionOrder,
} = require('../server/lib/ms-api');

test('buildAuthHeader supports Bearer token and Basic login password auth', () => {
  assert.equal(buildAuthHeader({ authMode: 'token', apiToken: 'abc' }), 'Bearer abc');
  assert.equal(buildAuthHeader('abc'), 'Bearer abc');
  assert.equal(
    buildAuthHeader({ authMode: 'basic', login: 'user@example.com', password: 'secret' }),
    `Basic ${Buffer.from('user@example.com:secret', 'utf8').toString('base64')}`,
  );
});

test('getOrganizations maps MoySklad rows to name and href', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.moysklad.ru/api/remap/1.2/entity/organization');
    assert.equal(options.headers.Authorization, 'Bearer token');
    return new Response(JSON.stringify({
      rows: [{ name: 'Org', meta: { href: 'org-href' } }],
    }), { status: 200 });
  });

  assert.deepEqual(await getOrganizations('token'), [
    { name: 'Org', href: 'org-href' },
  ]);
});

test('findAssortmentByBarcode returns null when API has no rows', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }));

  assert.equal(await findAssortmentByBarcode('token', '123'), null);
});

test('createEmissionOrder sends expected payload', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.moysklad.ru/api/remap/1.2/entity/emissionorder');
    const body = JSON.parse(options.body);
    assert.equal(body.organization.meta.href, 'org-href');
    assert.equal(body.emissionType, 'REMAINS');
    assert.equal(body.trackingType, 'LP_CLOTHES');
    assert.equal(body.description, 'Имя файла: заказ.xls\nНомер файла: 1\nЗагружено скриптом от Gor');
    assert.deepEqual(body.positions, [
      {
        quantity: 2,
        assortment: {
          meta: {
            href: 'assortment-href',
            type: 'product',
            mediaType: 'application/json',
          },
        },
      },
    ]);
    return new Response(JSON.stringify({
      id: 'doc-id',
      name: 'EO-1',
      meta: { href: 'doc-href' },
    }), { status: 200 });
  });

  assert.deepEqual(await createEmissionOrder('token', {
    organizationHref: 'org-href',
    emissionType: 'REMAINS',
    trackingType: 'LP_CLOTHES',
    description: 'Имя файла: заказ.xls\nНомер файла: 1\nЗагружено скриптом от Gor',
    positions: [{ assortmentHref: 'assortment-href', assortmentType: 'product', qty: 2 }],
  }), {
    id: 'doc-id',
    name: 'EO-1',
    href: 'doc-href',
  });
});

test('MoySklad non-2xx responses throw MsApiError with status and message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    errors: [{ error: 'Bad request details' }],
  }), { status: 400 }));

  await assert.rejects(
    () => getOrganizations('token'),
    (error) => {
      assert.equal(error instanceof MsApiError, true);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Bad request details');
      return true;
    },
  );
});
