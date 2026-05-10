# Test report: Bulk add marking codes bookmarklet

Date: May 10, 2026
Workspace: `/Users/gorgrigoryan/Documents/New project`

## Environment note

This run was completed in a shell-only workspace without access to the logged-in MoySklad browser tab and without page-level automation tools (`read_page` / page JS execution in the target tab). Because of this, live UI validation on `online.moysklad.ru` could not be executed here.

What was validated locally:
- `bookmarklet.js` syntax check: pass (`node --check`)
- `bookmarklet.min.js` syntax check: pass (`node --check`)
- Bookmarklet length check: pass (`bookmarklet.url.txt` is raw `javascript:` URL, 7651 chars, below 8000 target)
- Automated DOM tests: pass (`npm test`, 6/6)

## Automated test coverage (local, headless)

Test file: `/Users/gorgrigoryan/Documents/New project/tests/bookmarklet.test.js`

Covered scenarios:
1. Wrong page -> friendly alert and exit.
2. Eligible page with missing input -> friendly alert.
3. Read-only input -> friendly alert.
4. Happy path with multiple codes + blank lines -> added/skipped counts are correct.
5. Failure path -> failed count and failed-code list in summary.
6. Stop mid-run + GS1 separator preservation (`\\u001D`) -> stop produces skipped items, submitted payload remains unchanged.

## Required test cases from brief

1. Happy path, 1 code
- Status: Blocked in this environment (requires real MoySklad tab).
- Expected: `added=1, failed=0`, new row added.

2. Happy path, 6 codes (provided sample)
- Status: Blocked in this environment.
- Expected: 6 attempts, summary reflects real acceptance/rejections.

3. Invalid code (`garbage123`)
- Status: Blocked in this environment.
- Expected: failed, error captured.

4. Empty + blank lines mixed in
- Status: Logic-verified in code review, not live-verified.
- Implemented behavior: trims lines, ignores empty, increments skipped count.

5. Stop mid-run
- Status: Logic-verified in code review, not live-verified.
- Implemented behavior: Stop sets abort flag; current code finishes wait cycle; remaining codes become skipped.

6. Re-run on same page without reload
- Status: Logic-verified in code review, not live-verified.
- Implemented behavior: removes prior overlay by ID at startup.

7. Wrong page
- Status: Logic-verified in code review, not live-verified.
- Implemented behavior: URL check for `enrollorder/edit`, alert and exit.

8. Read-only doc
- Status: Logic-verified in code review, not live-verified.
- Implemented behavior: exits if input is disabled/readOnly/aria-disabled.

9. Bookmarklet length and save in Chrome
- Status: Partially verified.
- Verified: raw URL length 7651 chars (<8000).
- Not verified here: manual save/click in Chrome UI.

## Screenshot evidence

Live screenshots are not included in this environment because the real MoySklad tab was not accessible to this run. Placeholders expected by install guide:
- `/Users/gorgrigoryan/Documents/New project/screenshots/install-bookmark-example.png`
- `/Users/gorgrigoryan/Documents/New project/screenshots/progress-example.png`
- `/Users/gorgrigoryan/Documents/New project/screenshots/summary-example.png`
- `/Users/gorgrigoryan/Documents/New project/screenshots/wrong-page-example.png`

To finalize acceptance, run tests 1-9 in a logged-in browser tab and capture the screenshots above.
