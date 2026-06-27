# Auto-update for the local web app

**Date:** 2026-06-27
**Status:** design accepted, not implemented
**Repo:** `gor8808/ms-bulk-codes-bookmarklet` (public, GitHub)

## Goal

Stop SSHing into user machines to update the local web app. The app should
notice new releases on its own, install them silently when idle, and surface
a "Restart to update" banner when the user is in the middle of a job.

## Constraints

- Users are on macOS or Windows and already have `git` and Node.js.
- Each install is a `git clone` of this repo with `npm run install:local-app`
  run once. Autostart is wired via LaunchAgent (macOS) or registry Run key
  (Windows); the app listens on `localhost:5177`.
- The repo is public on GitHub, so the update check is unauthenticated.
- The app has two long-running job types managed by `RunManager` instances
  (bulk code upload, print/PDF export). Updates must not silently kill them.

## Update unit

Tagged GitHub releases. The author cuts a tag (`v0.2.0`); user machines pick
it up. Untagged commits on `main` do not trigger updates. This gives the
author a kill switch and keeps the version number meaningful.

Compared with semver: `current = git describe --tags --exact-match HEAD` (or
the latest reachable tag), `latest = GET /repos/<owner>/<repo>/releases/latest`.

## Architecture

Three pieces, all under `local-web-app/`:

1. **`server/updater.js`** — required by `server.js` at startup. Owns the
   poller, the GitHub client, the cached status, and the lock file. Exposes
   two HTTP handlers wired into the existing router.

2. **`server/update-runner.js`** — a detached child process spawned by the
   updater when an install is triggered. Performs git fetch/checkout, npm
   install (conditional), Playwright install (conditional), kill, restart.
   Detached so killing the server during restart does not kill the updater.

3. **`public/update-banner.js`** — small frontend component on the existing
   web UI. Polls `/api/update/status` every 5s and renders the banner.

## HTTP endpoints

- `GET /api/update/status` →
  ```
  {
    current: "v0.1.0",
    latest: "v0.2.0",
    updateAvailable: true,
    busy: false,
    phase: "idle" | "pulling" | "installing" | "restarting" | "failed",
    lastUpdate: { from, to, ts, error? } | null,
    releaseUrl: "https://github.com/.../releases/tag/v0.2.0",
    releaseNotes: "..."
  }
  ```
  Cheap; reads cached state. Polled by the banner.

- `POST /api/update/install` — explicit user trigger from the "Restart to
  update" button. Returns `202` if accepted, `409` if already in progress.

- `POST /api/update/check` — force an immediate GitHub poll, bypassing the
  30-min cadence and the status cache. Returns the fresh status payload.
  Rate-limited to one call per 10s per process to avoid hammering the
  GitHub API if a user spam-clicks.

- `GET /api/update/logs` (optional) — tail of `.update.log` for the "View
  logs" link on a failed update.

## Trigger logic

The poller runs every 30 min (and once on server startup). When it sees a
new tag:

- **Idle** (`!runManager.hasActiveRuns() && !printRunManager.hasActiveRuns()`)
  → spawn the update runner immediately. The banner shows the live phase.
- **Busy** → set `updateAvailable=true`, leave the install for the user.
  Banner shows "Update v0.2.0 ready — [Restart to update]". The user picks
  when to take the restart.

The manual "Restart to update" button POSTs `/api/update/install`. If a job
is running when the user clicks, the frontend confirms first
("A job is in progress. Stop it and update anyway?"). No silent data loss.

## Update runner steps

1. Acquire lock: create `.update-in-progress` (fail if present and < 10 min
   old; otherwise clear stale lock and proceed).
2. Append `pulling` to `.update-progress`.
3. `git fetch --tags`.
4. `git checkout <new-tag>`. Record previous tag for rollback.
5. If `package-lock.json` changed (hash compare): `npm install`. Append
   `installing`.
6. If `playwright` version in `package.json` changed: `npx playwright install
   chromium`.
7. Write `.last-update` = `{ from, to, ts }`.
8. Append `restarting`. Kill the server PID and restart:
   - **macOS:** `process.kill(serverPid, 'SIGTERM')` — LaunchAgent
     `KeepAlive=true` respawns within ~1s. Nothing else.
   - **Windows:** kill server, then exec `wscript.exe //B
     <APP_DIR>\start-hidden.vbs` (the same launcher the Run key uses).
9. Release lock.

### Failure handling

- If `npm install` fails: `git checkout <previous-tag>`, write `.last-update`
  with `error: "..."`. Do not restart. Server stays up on the old version.
  Banner switches to red "Update failed — staying on v0.1.0 [View logs]".
- Stale lock (>10 min) is cleared on next poll; this covers crashes mid-update.

## Frontend behavior

Single component driven entirely by `/api/update/status`:

| Server state | Banner |
|---|---|
| `updateAvailable=false` | hidden |
| `updateAvailable=true`, busy idle | hidden (auto-install running) |
| `updateAvailable=true`, busy=true | yellow "Update v0.2.0 ready. [Restart to update] [What's new]" |
| `phase` in `pulling`/`installing` | blue "Updating to v0.2.0… (phase)" + spinner |
| `phase=restarting` + status endpoint stops answering | "Restarting…" + poll every 2s; on success, full page reload |
| `lastUpdate.ts < 60s` and no error | transient green toast "Updated to v0.2.0 ✓", auto-dismiss 8s |
| `phase=failed` | red "Update to v0.2.0 failed — staying on v0.1.0 [View logs]" |

Polling (not SSE) for status: the banner is the one thing that must survive
the server restart. Polling reconnects trivially; SSE has to handle the drop
anyway.

### Always-visible version indicator

Separate from the banner (which is conditional), the footer of the existing
web UI shows the current version and a manual check control:

```
v0.1.0  ·  Check for updates
```

Clicking "Check for updates" POSTs `/api/update/check`. While in flight the
link shows "Checking…". The result paths:

- Already up to date → toast "You're on the latest version (v0.1.0)".
- New release found → the banner appears (the normal `updateAvailable=true`
  path takes over); no separate toast.
- GitHub unreachable → toast "Couldn't reach GitHub — will retry
  automatically".

This gives you a way to verify pickup immediately after cutting a release
without waiting up to 30 min for the next scheduled poll.

## Configuration (hardcoded in `updater.js`)

```js
GITHUB_REPO = 'gor8808/ms-bulk-codes-bookmarklet';
POLL_INTERVAL_MS = 30 * 60 * 1000;
STATUS_CACHE_TTL_MS = 60 * 1000;
LOCK_STALE_MS = 10 * 60 * 1000;
```

Not read from `git config`: one less failure mode, and users never fork.

## File layout

**New:**

- `local-web-app/server/updater.js`
- `local-web-app/server/update-runner.js`
- `local-web-app/public/update-banner.js` (+ hook into `public/index.html`)
- `local-web-app/tests/updater.test.js`
- `local-web-app/tests/update-runner.test.js`
- `local-web-app/tests/update-api.test.js`

**Touched:**

- `local-web-app/server.js` — require updater, instantiate with both
  `RunManager`s, wire two new routes.
- `local-web-app/server/lib/run-manager.js` — add `hasActiveRuns()` if it
  is not already present.
- `.gitignore` — add `local-web-app/.last-update`,
  `local-web-app/.update-in-progress`, `local-web-app/.update-progress`,
  `local-web-app/.update.log`.
- `README.md`, `install-and-use.md` — short note on the auto-update model.

## Testing

- `updater.test.js` — mocked `fetch` + mocked `exec`. Covers tag comparison
  (semver, not lexical), GitHub 304/rate-limit, busy-defer with stub
  `RunManager`s, lock-file race (second poller sees lock and bails).
- `update-runner.test.js` — runs the runner against a temp git repo (init,
  commit, tag, clone, fetch, checkout). No network. Includes the rollback
  path: induce `npm install` failure by pointing at a bogus registry, assert
  `git rev-parse HEAD` is on the previous tag.
- `update-api.test.js` — HTTP-level: `/api/update/status` shape,
  `/api/update/install` returns 202 then 409 on re-entry, `/api/update/check`
  bypasses cache and rate-limits to one call per 10s.
- Restart paths (LaunchAgent respawn, Windows VBS) are platform-specific
  shell behavior; skip in CI. Verify manually as part of the rollout drill.

## Rollout

Existing installs do not have the updater. The first hop has to happen the
old way — this is unavoidable.

1. Land the updater on `main` and tag `v0.1.0` (matches the existing
   release artifact).
2. SSH into each user machine one last time: `git pull && git checkout
   v0.1.0 && npm install`, then restart (`launchctl unload/load` on macOS,
   restart the hidden VBS launcher on Windows). Confirm the banner loads
   and `/api/update/status` returns `current: "v0.1.0", updateAvailable:
   false`.
3. Cut `v0.2.0` (a tiny no-op change is fine) and watch the machines pick
   it up. That is the live drill — if it works once, every future release
   is hands-off.

## What we are deliberately not building

- Forced updates that kill in-flight jobs. Defer until the user clicks
  restart. Add only if you actually hit a critical-fix scenario.
- A signed/verified update channel. The git remote is the trust root; users
  cloned from GitHub over HTTPS.
- A separate update daemon. The server process is fine as the host — the
  runner is detached precisely to survive the server's restart.
- Reading repo URL from `git config`. Hardcoded.
- Telemetry / reporting back update success to a central server. Out of scope.
