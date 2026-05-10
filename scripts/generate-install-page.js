const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const bookmarkletPath = path.join(root, 'bookmarklet.url.txt');
const outPath = path.join(root, 'install-bookmarklet.html');

const bookmarklet = fs.readFileSync(bookmarkletPath, 'utf8').trim();

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getGitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const buildSha = getGitShortSha();
const builtAt = new Date().toISOString();
const codeLen = bookmarklet.length;

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>MS Bulk Codes — Установка</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#f5f7fb;color:#111827}
    .wrap{max-width:760px;margin:40px auto;padding:0 16px}
    .card{background:#fff;border:1px solid #dbe3f0;border-radius:14px;box-shadow:0 14px 36px rgba(8,24,64,.08);padding:20px}
    .btn{display:inline-block;margin:10px 0 14px;padding:12px 16px;border-radius:10px;background:#1f6feb;color:#fff;text-decoration:none;font-weight:700;cursor:grab}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
    .build{margin:12px 0;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;color:#334155}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Установка MS Bulk Codes (bookmarklet)</h1>
      <p>Перетащите кнопку на панель закладок Chrome:</p>
      <p><a class="btn" href="${esc(bookmarklet)}">MS Bulk Codes</a></p>
      <div class="build"><b>Build:</b> ${esc(buildSha)} | <b>Built (UTC):</b> ${esc(builtAt)} | <b>Length:</b> ${codeLen}</div>
      <ol>
        <li>Покажите панель закладок: <b>Cmd+Shift+B</b> / <b>Ctrl+Shift+B</b>.</li>
        <li>Перетащите кнопку <b>MS Bulk Codes</b> на панель закладок.</li>
        <li>Откройте документ МойСклад <code>#enrollorder/edit</code> и нажмите закладку.</li>
      </ol>
      <details>
        <summary>Показать javascript URL</summary>
        <p><code>${esc(bookmarklet)}</code></p>
      </details>
    </div>
  </div>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log('Generated', outPath);
console.log('Build:', buildSha, builtAt, 'length=' + codeLen);
