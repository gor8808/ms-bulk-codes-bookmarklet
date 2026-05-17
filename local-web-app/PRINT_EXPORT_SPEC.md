# Spec: Bulk Print Marking Code PDFs from MoySklad Emission Orders

## Goal

Add a second workflow to the local web app that accepts multiple MoySklad `emissionorder` URLs and returns one ZIP file containing PDFs for all printable positions.

Users are non-technical. They must not copy cookies, inspect DevTools, or manually export session data.

The target MoySklad UI action is:

- Open `Заказ кодов маркировки`
- For each line, click `Печать`
- Template: `Код маркировки и ШК`
- Quantity option: `Печать всех кодов`
- Print type: `Печать КМ`
- Download resulting PDF

## Key Finding

The public JSON API can read emission orders and positions, but it does not expose the `Код маркировки и ШК` emission-order print template.

Confirmed public API works for:

- `GET /entity/emissionorder/{id}`
- `GET /entity/emissionorder/{id}/positions?expand=assortment`

Confirmed public API does not expose the needed template:

- `GET /entity/emissionorder/metadata/embeddedtemplate` returns `rows: 0`
- `GET /entity/emissionorder/metadata/customtemplate` returns `rows: 0`
- `POST /entity/emissionorder/{id}/publication` requires a template `meta`, but no emission-order template meta is exposed

The MoySklad web UI uses internal GWT-RPC endpoints to generate the PDF. We will use those endpoints, but use Playwright only for normal browser login/session management.

## UX

Add a new tab:

```text
Печать кодов
```

Controls:

```text
[Войти в МойСклад]

Ссылки на заказы кодов маркировки:
[textarea, one URL per line]

[Проверить документы]
[Скачать ZIP]
```

Progress:

```text
Документы: 2 из 5
Позиции: 7 из 19
Последний файл: Bdm2-55d БЕЛЫЙ р.104(36-48).pdf
```

Summary:

```text
PDF создано: 19
Ошибки: 0
ZIP: marking-labels-2026-05-17-18-30.zip
```

## Authentication

Use Playwright with a persistent Chrome profile:

```text
local-web-app/.browser-profile/
```

This folder must be git-ignored.

Flow:

1. User clicks `Войти в МойСклад`.
2. Server launches persistent Chrome:
   - `headless: false`
   - profile dir: `local-web-app/.browser-profile`
3. User logs into MoySklad normally.
4. App detects successful login when the page reaches `https://online.moysklad.ru/app/`.
5. Later internal API calls are sent through the same Playwright browser context, so cookies/session are attached automatically.

No cookie copying is required.

## Architecture

Add modules:

```text
local-web-app/server/lib/
  browser-session-service.js
  ms-print-rpc-client.js
  print-export-service.js
  filename-builder.js
  zip-writer.js
```

Existing public API client remains responsible for stable JSON API calls:

```text
ms-api.js
```

### BrowserSessionService

Responsibilities:

- Launch persistent Chrome
- Open MoySklad login/app page
- Detect if user is logged in
- Expose authenticated Playwright request context
- Keep session reusable across runs

Suggested API:

```js
class BrowserSessionService {
  async launch()
  async ensureLoggedIn()
  async getRequestContext()
  async close()
}
```

### MoySkladPrintRpcClient

Responsibilities:

- Call internal MoySklad GWT-RPC services using the authenticated browser context
- Build GWT-RPC payloads
- Parse task ids and download URLs from GWT-RPC responses

Internal endpoints observed in HAR:

```text
POST https://online.moysklad.ru/app/services/r1668/MxTemplateService
POST https://online.moysklad.ru/app/services/print/r1668/PriceTypePrintService
POST https://online.moysklad.ru/app/services/r1668/ExportImportService
GET  https://print-prod.moysklad.ru/temp/...pdf
```

Suggested API:

```js
class MoySkladPrintRpcClient {
  async getEmissionOrderTemplates()
  async requestPositionPdf({ documentId, positionId })
  async pollPrintTask(taskId)
  async downloadPdf(downloadUrl)
}
```

### PrintExportService

Responsibilities:

- Parse user-provided URLs
- Load each emission order and positions through public API
- Generate one PDF per position through `MoySkladPrintRpcClient`
- Name PDFs
- Write ZIP
- Report progress

Suggested API:

```js
class PrintExportService {
  async run({ urls, settings }, hooks)
}
```

### FilenameBuilder

Convert full product name + article into user-friendly filename.

Rule:

1. Remove leading barcode if present.
2. If `article` exists and appears in name, keep substring starting from article.
3. Remove trailing marker like `(МАТ)`.
4. Replace filesystem-invalid characters.
5. Append `.pdf`.

Examples:

```text
Full:
Боди для малышей МАЙКА с Лямками Bdm2-55d БЕЛЫЙ р.104(36-48) (МАТ)

Article:
Bdm2-55d

PDF:
Bdm2-55d БЕЛЫЙ р.104(36-48).pdf
```

```text
Bdm2-55d БЕЛЫЙ р.62(1-3).pdf
Bdm2-55d БЕЛЫЙ р.68(3-6).pdf
```

### ZipWriter

Create one ZIP file:

```text
local-web-app/.downloads/marking-labels-YYYY-MM-DD-HH-mm.zip
```

Folder structure inside ZIP:

```text
00468/Bdm2-55d БЕЛЫЙ р.104(36-48).pdf
00468/Bdm2-55d БЕЛЫЙ р.62(1-3).pdf
00468/Bdm2-55d БЕЛЫЙ р.68(3-6).pdf
00469/...
```

Use the emission order document `name` as the folder name, for example `00468`.

Handle duplicate filenames by appending:

```text
filename.pdf
filename (2).pdf
filename (3).pdf
```

## Internal RPC Details from HAR

Known document id:

```text
39732d8d-5124-11f1-0a80-1385001c4e14
```

Known positions:

```text
fe298f4d-5124-11f1-0a80-188a001c572d
fe29940f-5124-11f1-0a80-188a001c572e
fe2997e2-5124-11f1-0a80-188a001c572f
```

Template from HAR:

```text
Код маркировки и ШК
Код маркировки и ШК.xml
```

Observed RPC sequence:

1. Get templates:

```text
POST /app/services/r1668/MxTemplateService
method: getTemplate
argument: EmissionOrder
```

2. Request print:

```text
POST /app/services/print/r1668/PriceTypePrintService
method: requestDocument
```

Response contains:

```text
ASYNC:<taskId>
```

3. Poll print task:

```text
POST /app/services/r1668/ExportImportService
method: getTask
argument: <taskId>
```

Response contains a temporary PDF URL:

```text
https://print-prod.moysklad.ru/temp/...pdf
```

4. Download PDF through authenticated browser request context.

## Required Spike Before Full Implementation

Implement a narrow proof:

1. Launch persistent Chrome.
2. User logs in.
3. Call `MxTemplateService.getTemplate("EmissionOrder")` through Playwright request context.
4. Confirm response contains `Код маркировки и ШК`.
5. Call `PriceTypePrintService.requestDocument(...)` for one known position:

```text
documentId: 39732d8d-5124-11f1-0a80-1385001c4e14
positionId: fe298f4d-5124-11f1-0a80-188a001c572d
```

6. Poll `ExportImportService.getTask(taskId)`.
7. Download one PDF.
8. Save to:

```text
local-web-app/.downloads/spike.pdf
```

Only after this succeeds, build bulk URLs and ZIP.

## API Endpoints for Local App

Add local endpoints:

```http
POST /api/browser/login
```

Launches Chrome and waits/checks login.

```http
GET /api/browser/status
```

Returns whether a browser profile appears logged in.

```http
POST /api/print/validate
```

Payload:

```json
{
  "urls": ["https://online.moysklad.ru/app/#emissionorder/edit?id=..."]
}
```

Response:

```json
{
  "ok": true,
  "documents": [
    {
      "id": "...",
      "name": "00468",
      "positions": [
        {
          "id": "...",
          "quantity": 45,
          "productName": "...",
          "article": "Bdm2-55d",
          "fileName": "Bdm2-55d БЕЛЫЙ р.104(36-48).pdf"
        }
      ]
    }
  ]
}
```

```http
POST /api/print/run
```

Starts the full PDF generation and ZIP job.

```http
GET /api/print/runs/{id}/events
```

SSE progress stream.

```http
GET /api/print/runs/{id}/download
```

Downloads ZIP.

## Risks

### Internal RPC Can Change

The internal endpoints contain build-specific paths like:

```text
r1668
```

and GWT permutation strings. These can change after MoySklad deploys.

Mitigation:

- Keep all RPC logic in `ms-print-rpc-client.js`.
- Extract current build version from loaded app script URLs when possible.
- Fail with clear message:

```text
Протокол печати МойСклад изменился. Требуется обновление интеграции.
```

### Browser Login Can Expire

Mitigation:

- Check login status before print run.
- If expired, open Chrome and prompt user to log in again.

### Duplicate Product Names

Mitigation:

- Deduplicate ZIP entry names with suffix `(2)`, `(3)`, etc.

### Download Failures

Mitigation:

- Retry PDF download once.
- Keep failed positions in summary.

## Testing

Unit tests:

- URL parser extracts emission order ids.
- Filename builder handles product examples.
- ZIP writer deduplicates names.
- RPC response parser extracts:
  - `ASYNC:<taskId>`
  - `print-prod.moysklad.ru/temp/...pdf`

Integration spike:

- Requires real MoySklad login in persistent Chrome profile.
- Tests one known document/position.

Do not commit:

```text
local-web-app/.browser-profile/
local-web-app/.downloads/
```
