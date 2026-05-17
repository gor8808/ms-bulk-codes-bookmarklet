(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MSXlsxParserCore = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BARCODE_HEADERS = new Set(['штрихкод', 'barcode', 'код', 'code']);
  const QTY_HEADERS = new Set(['количество', 'кол-во', 'qty', 'quantity', 'кол', 'count']);

  function normalizeHeader(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function normalizeBarcode(value) {
    if (value == null) {
      return '';
    }

    return String(value).trim();
  }

  function parseQuantity(value) {
    if (typeof value === 'number') {
      return value;
    }

    const normalized = String(value == null ? '' : value).trim().replace(',', '.');
    if (!normalized) {
      return NaN;
    }

    return Number(normalized);
  }

  function looksLikeHeaderCell(value) {
    const normalized = normalizeHeader(value);
    return BARCODE_HEADERS.has(normalized) || QTY_HEADERS.has(normalized) || /[a-zа-я]/i.test(normalized);
  }

  function detectHeaderRow(rows) {
    const limit = Math.min(rows.length, 20);
    for (let index = 0; index < limit; index += 1) {
      const row = rows[index] || [];
      if (row.some((cell) => BARCODE_HEADERS.has(normalizeHeader(cell)) || QTY_HEADERS.has(normalizeHeader(cell)))) {
        return index;
      }
    }

    for (let index = 0; index < limit; index += 1) {
      const firstCell = rows[index] && rows[index][0];
      if (looksLikeHeaderCell(firstCell)) {
        return index;
      }
    }

    return -1;
  }

  function detectColumns(headerRow) {
    let barcodeIndex = -1;
    let qtyIndex = -1;

    headerRow.forEach((cell, index) => {
      const normalized = normalizeHeader(cell);
      if (barcodeIndex === -1 && BARCODE_HEADERS.has(normalized)) {
        barcodeIndex = index;
      }

      if (qtyIndex === -1 && QTY_HEADERS.has(normalized)) {
        qtyIndex = index;
      }
    });

    return {
      barcodeIndex: barcodeIndex === -1 ? 0 : barcodeIndex,
      qtyIndex: qtyIndex === -1 ? 1 : qtyIndex,
    };
  }

  function parseRows(rawRows) {
    if (!rawRows.length) {
      return { rows: [], skipped: [], error: 'Первый лист пустой' };
    }

    const headerIndex = detectHeaderRow(rawRows);
    const columnSource = headerIndex >= 0 ? rawRows[headerIndex] : rawRows[0];
    const { barcodeIndex, qtyIndex } = detectColumns(columnSource || []);
    const startIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
    const rows = [];
    const skipped = [];

    for (let index = startIndex; index < rawRows.length; index += 1) {
      const rawRow = rawRows[index] || [];
      const rowIndex = index + 1;
      const barcode = normalizeBarcode(rawRow[barcodeIndex]);
      const qty = parseQuantity(rawRow[qtyIndex]);

      if (!barcode && rawRow.every((cell) => normalizeBarcode(cell) === '')) {
        continue;
      }

      if (!barcode) {
        skipped.push({ rowIndex, reason: 'Пустой штрихкод' });
        continue;
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        skipped.push({ rowIndex, barcode, reason: 'Некорректное количество' });
        continue;
      }

      if (qty > 1000) {
        skipped.push({ rowIndex, barcode, reason: 'Количество превышает 1000' });
        continue;
      }

      rows.push({ barcode, qty, rowIndex });
    }

    return { rows, skipped, error: null };
  }

  return {
    detectColumns,
    detectHeaderRow,
    parseRows,
  };
}));
