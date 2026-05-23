const path = require('node:path');

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const LEADING_BARCODE = /^\s*\d{8,14}\s+/;
const TRAILING_MARKER = /\s+\([^)]+\)\s*$/;

function sanitizeSegment(value, fallback) {
  const cleaned = String(value || '')
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

function formatQuantitySuffix(quantity) {
  const value = Number(quantity);
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }

  return ` - ${Math.trunc(value)}шт`;
}

function buildPdfFileName({ productName, article, quantity }) {
  let base = String(productName || '').replace(LEADING_BARCODE, '').trim();
  const cleanArticle = String(article || '').trim();

  if (cleanArticle) {
    const articleIndex = base.toLocaleLowerCase().indexOf(cleanArticle.toLocaleLowerCase());
    if (articleIndex >= 0) {
      base = base.slice(articleIndex).trim();
    }
  }

  base = base.replace(TRAILING_MARKER, '').trim();
  return `${sanitizeSegment(base, cleanArticle || 'position')}${formatQuantitySuffix(quantity)}.pdf`;
}

function sanitizeZipFolderName(name) {
  return sanitizeSegment(name, 'document');
}

function splitPdfName(fileName) {
  const parsed = path.parse(fileName);
  return {
    name: parsed.name || 'position',
    ext: parsed.ext || '.pdf',
  };
}

function dedupeFileName(fileName, usedNames) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  const parts = splitPdfName(fileName);
  for (let index = 2; ; index += 1) {
    const candidate = `${parts.name} (${index})${parts.ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
}

module.exports = {
  buildPdfFileName,
  dedupeFileName,
  formatQuantitySuffix,
  sanitizeZipFolderName,
};
