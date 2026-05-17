const BASE_URL = 'https://api.moysklad.ru/api/remap/1.2';

class MsApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = 'MsApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

function buildAuthHeader(auth) {
  if (typeof auth === 'string') {
    return `Bearer ${auth}`;
  }

  if (auth && auth.authMode === 'basic') {
    const credentials = Buffer.from(`${auth.login || ''}:${auth.password || ''}`, 'utf8').toString('base64');
    return `Basic ${credentials}`;
  }

  return `Bearer ${auth && auth.apiToken ? auth.apiToken : ''}`;
}

function buildHeaders(auth) {
  return {
    Authorization: buildAuthHeader(auth),
    Accept: 'application/json;charset=utf-8',
    'Content-Type': 'application/json;charset=utf-8',
  };
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function getApiErrorMessage(body, fallback) {
  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    return body.errors
      .map((item) => item.error || item.parameter || item.code)
      .filter(Boolean)
      .join('; ') || fallback;
  }

  if (body && typeof body.message === 'string') {
    return body.message;
  }

  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }

  return fallback;
}

async function request(auth, path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...buildHeaders(auth),
      ...(options.headers || {}),
    },
  });

  const body = await parseBody(response);
  if (!response.ok) {
    const message = response.status === 401
      ? 'Неверный токен'
      : getApiErrorMessage(body, `MoySklad API вернул ${response.status}`);
    throw new MsApiError(message, response.status, body);
  }

  return body;
}

async function requestWithRetry(auth, path, options = {}) {
  try {
    return await request(auth, path, options);
  } catch (error) {
    if (error instanceof MsApiError && error.statusCode >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return request(auth, path, options);
    }

    throw error;
  }
}

async function getOrganizations(auth) {
  const body = await requestWithRetry(auth, '/entity/organization');
  return (body.rows || []).map((row) => ({
    name: row.name,
    href: row.meta && row.meta.href,
  })).filter((row) => row.name && row.href);
}

async function findAssortmentByBarcode(auth, barcode) {
  const path = `/entity/assortment?filter=${encodeURIComponent(`barcode=${barcode}`)}`;
  const body = await requestWithRetry(auth, path);
  const first = body.rows && body.rows[0];

  if (!first || !first.meta || !first.meta.href) {
    return null;
  }

  return {
    href: first.meta.href,
    type: first.meta.type || first.type,
    name: first.name || barcode,
  };
}

async function createEmissionOrder(auth, payload) {
  const positions = payload.positions.map((position) => ({
    quantity: position.qty,
    assortment: {
      meta: {
        href: position.assortmentHref,
        type: position.assortmentType,
        mediaType: 'application/json',
      },
    },
  }));

  const body = await requestWithRetry(auth, '/entity/emissionorder', {
    method: 'POST',
    body: JSON.stringify({
      organization: {
        meta: {
          href: payload.organizationHref,
          type: 'organization',
          mediaType: 'application/json',
        },
      },
      emissionType: payload.emissionType,
      trackingType: payload.trackingType,
      description: payload.description || '',
      positions,
    }),
  });

  return {
    id: body.id,
    name: body.name,
    href: body.meta && body.meta.href,
  };
}

function extractIdFromMetaHref(href) {
  if (typeof href !== 'string') {
    return '';
  }

  const match = href.match(/\/entity\/[^/]+\/([^/?#]+)/);
  return match ? match[1] : '';
}

async function getEmissionOrder(auth, id) {
  const body = await requestWithRetry(auth, `/entity/emissionorder/${encodeURIComponent(id)}`);
  return {
    id: body.id || id,
    name: body.name || id,
    href: body.meta && body.meta.href,
  };
}

function mapPosition(row) {
  const assortment = row.assortment || {};
  return {
    id: row.id || extractIdFromMetaHref(row.meta && row.meta.href),
    quantity: row.quantity,
    productName: assortment.name || row.name || '',
    article: assortment.article || '',
    assortmentId: assortment.id || extractIdFromMetaHref(assortment.meta && assortment.meta.href),
  };
}

async function getEmissionOrderPositions(auth, id) {
  const body = await requestWithRetry(
    auth,
    `/entity/emissionorder/${encodeURIComponent(id)}/positions?expand=assortment&limit=1000`,
  );
  return (body.rows || []).map(mapPosition).filter((position) => position.id);
}

module.exports = {
  MsApiError,
  buildAuthHeader,
  getOrganizations,
  findAssortmentByBarcode,
  createEmissionOrder,
  getEmissionOrder,
  getEmissionOrderPositions,
  extractIdFromMetaHref,
};
