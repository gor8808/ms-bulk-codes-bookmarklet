# MoySklad Bulk Codes

## Local Web App

Install dependencies, Playwright Chromium, and autostart:

```bash
npm run install:local-app
```

After installation the app starts at login and is available at:

```text
http://localhost:5177
```

Start manually:

```bash
npm run start:local-app
```

If the app is already running and you need to restart it, stop the process on port `5177` first:

macOS:

```bash
lsof -nP -iTCP:5177 -sTCP:LISTEN
kill <PID>
```

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5177 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID>
```

More usage notes are in [install-and-use.md](install-and-use.md).
