(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MSKizImportCore = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KIZ_HEADER = 'киз';
  const GS = '\x1d';
  // DataMatrix codes start with AI 01 + 14-digit GTIN, then AI 21 + serial.
  const KIZ_PATTERN = /^01(\d{14})21/;
  const CSV_COLUMNS = ['Штрихкод GTIN', 'Штрихкод EAN13', 'Количество'];

  function normalizeHeader(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function normalizeKiz(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/^\](?:C1|d2|Q3)/, '')
      .replace(/^\x1d+/, '');
  }

  function findKizColumn(rawRows) {
    const limit = Math.min(rawRows.length, 20);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const row = rawRows[rowIndex] || [];
      const columnIndex = row.findIndex((cell) => normalizeHeader(cell) === KIZ_HEADER);
      if (columnIndex >= 0) {
        return { headerIndex: rowIndex, columnIndex };
      }
    }

    return null;
  }

  function buildImport(rawRows) {
    const column = findKizColumn(rawRows || []);
    if (!column) {
      return { products: [], totalCodes: 0, skipped: [], error: 'В файле не найден столбец «КИЗ»' };
    }

    const byGtin = new Map();
    const seen = new Set();
    const skipped = [];
    let totalCodes = 0;

    for (let index = column.headerIndex + 1; index < rawRows.length; index += 1) {
      const rawRow = rawRows[index] || [];
      const rowIndex = index + 1;
      const code = normalizeKiz(rawRow[column.columnIndex]);

      if (!code) {
        if (rawRow.some((cell) => String(cell == null ? '' : cell).trim() !== '')) {
          skipped.push({ rowIndex, reason: 'Пустой КИЗ' });
        }
        continue;
      }

      const match = KIZ_PATTERN.exec(code);
      if (!match) {
        skipped.push({ rowIndex, reason: 'КИЗ не похож на код маркировки', value: code });
        continue;
      }

      const identity = code.split(GS)[0];
      if (seen.has(identity)) {
        skipped.push({ rowIndex, reason: 'Повтор КИЗ', value: identity });
        continue;
      }

      seen.add(identity);
      totalCodes += 1;
      const gtin = match[1];
      byGtin.set(gtin, (byGtin.get(gtin) || 0) + 1);
    }

    const products = Array.from(byGtin, ([gtin, qty]) => ({
      gtin,
      ean13: gtin.replace(/^0/, ''),
      qty,
    }));

    return { products, totalCodes, skipped, error: null };
  }

  function toCsv(products) {
    const lines = [CSV_COLUMNS.join(';')];
    for (const product of products) {
      lines.push([product.gtin, product.ean13, product.qty].join(';'));
    }

    return `﻿${lines.join('\r\n')}\r\n`;
  }

  function csvFileName(sourceName) {
    const base = String(sourceName || '').replace(/\.[^./\\]+$/, '');
    return `${base || 'import'}.csv`;
  }

  return {
    buildImport,
    csvFileName,
    toCsv,
  };
}));
