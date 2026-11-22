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

The local web app is being prepared for tagged-release auto-updates.
The frontend now includes:

- an update banner area for "restart to update" and install progress states;
- a footer with the current version slot and a manual "Check for updates" action.

At the current worktree state, the updater backend endpoints (`/api/update/*`)
from [docs/plans/2026-06-27-auto-update-design.md](docs/plans/2026-06-27-auto-update-design.md)
are not wired yet, so the UI falls back to "updates unavailable" instead of
auto-installing a release.

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

## How updates reach installed apps

Publishing a GitHub release is the rollout. Every installed app checks the latest
release 2 minutes after start and then every 30 minutes, and installs it on its own
as soon as no task is running (users can also click «Перезапустить и обновить»).

- **Two stages.** `local-web-app/server/update-runner.js` runs from the *old* version:
  it only fetches and checks out the new tag, then runs the *new* release's
  `local-web-app/server/post-update.js` (npm install, Playwright, restart). Bugs in
  installing or restarting are fixed by shipping a release. Keep the runner tiny and
  the `post-update.js install|restart '<json>'` contract stable.
- **Failures don't stick.** A failed update rolls back to the previous version and
  only blocks that release: it is retried automatically after 6 hours (up to 3
  attempts), users can press «Повторить», and any newer release is tried right away.
- **Reports.** If a report address is configured on an install, every update outcome
  (installed or failed, with a redacted log tail) is sent there, next to print errors.
- **CI.** `.github/workflows/test.yml` runs the tests on Windows, macOS and Linux,
  including a real `npm install` through the update runner.

More usage notes are in [install-and-use.md](install-and-use.md).
