#!/usr/bin/env node
// Builds wb-extension/wb-price-fit.user.js (Tampermonkey) from the extension sources.
// Version comes from wb-extension/manifest.json, the single source of truth.
// The built file is committed: Tampermonkey installs and auto-updates from its raw GitHub URL.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'wb-extension');
const OUT = path.join(EXT, 'wb-price-fit.user.js');
const RAW_URL =
  'https://raw.githubusercontent.com/gor8808/ms-bulk-codes-bookmarklet/main/wb-extension/wb-price-fit.user.js';

function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const [contentScript] = manifest.content_scripts;
  const css = contentScript.css.map((f) => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n');
  const js = contentScript.js.map((f) => `// ---- ${f} ----\n${fs.readFileSync(path.join(EXT, f), 'utf8')}`).join('\n');

  const body = [
    `(function () {`,
    `  const style = document.createElement('style');`,
    `  style.textContent = ${JSON.stringify(css)};`,
    `  (document.head || document.documentElement).append(style);`,
    `})();`,
    '',
    js,
  ].join('\n');

  // Hash of the code only (not the version), so tests can tell "code changed but version did not".
  const sourceHash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);

  const header = [
    '// ==UserScript==',
    `// @name         ${manifest.name}`,
    '// @namespace    https://github.com/gor8808/ms-bulk-codes-bookmarklet',
    `// @version      ${manifest.version}`,
    `// @description  ${manifest.description}`,
    '// @match        https://seller.wildberries.ru/*',
    '// @run-at       document-idle',
    '// @grant        none',
    `// @updateURL    ${RAW_URL}`,
    `// @downloadURL  ${RAW_URL}`,
    '// ==/UserScript==',
    '',
    '// СГЕНЕРИРОВАНО: не редактируйте вручную. Исходники в wb-extension/, сборка: npm run build:wb-userscript',
    `// source-hash: ${sourceHash}`,
    '',
  ].join('\n');

  return { text: header + body, version: manifest.version, sourceHash };
}

module.exports = { build, OUT };

if (require.main === module) {
  const { text, version } = build();
  fs.writeFileSync(OUT, text);
  console.log(`Built ${path.relative(ROOT, OUT)} v${version}`);
}
