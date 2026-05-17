function parseEmissionOrderId(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const direct = raw.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  if (direct) {
    return raw;
  }

  const idMatch = raw.match(/[?&#]id=([0-9a-f-]{36})/i);
  if (idMatch) {
    return idMatch[1];
  }

  const apiMatch = raw.match(/\/entity\/emissionorder\/([0-9a-f-]{36})/i);
  return apiMatch ? apiMatch[1] : '';
}

function parseEmissionOrderUrls(urls) {
  const values = Array.isArray(urls) ? urls : String(urls || '').split(/\r?\n/);
  const seen = new Set();
  const ids = [];
  const invalid = [];

  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) {
      continue;
    }

    const id = parseEmissionOrderId(raw);
    if (!id) {
      invalid.push(raw);
    } else if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return { ids, invalid };
}

module.exports = {
  parseEmissionOrderId,
  parseEmissionOrderUrls,
};
