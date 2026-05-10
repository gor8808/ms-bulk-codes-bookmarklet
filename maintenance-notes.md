# Maintenance notes: MS bulk marking codes bookmarklet

## Exact selectors and page checks

Implementation file: `/Users/gorgrigoryan/Documents/New project/bookmarklet.js`

Primary page eligibility check:
- `location.hash` or full `location.href` contains `enrollorder/edit`.

Input discovery selectors:
- `input[type="text"], input:not([type])`
- then filtered by:
  - `placeholder` contains `добавить позицию` (case-insensitive), or
  - `aria-label` contains `добавить позицию`.

Error detection selectors:
- `[role="alert"]`
- `[role="tooltip"]`
- `[class*="error"]`, `[class*="Error"]`
- `[class*="tooltip"]`, `[class*="Tooltip"]`

Row-count success fallback:
- closest ancestor containing `tbody tr`; fallback to global `document.querySelectorAll('tbody tr').length`.

## Three fragile points

1. React value setter bridge
- Current code uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)` plus `input`/`change` events.
- If MoySklad upgrades framework internals, this may stop syncing component state.

2. Enter event shape
- Current code dispatches `keydown`, `keypress`, `keyup` with `key='Enter'`, `code='Enter'`, `keyCode=13`, `which=13`.
- If handler moves to another event path, update `sendCode()` accordingly.

3. Success detection signal
- Current outcome logic waits for first of:
  - input value cleared,
  - rows count increased,
  - visible error text detected,
  - timeout.
- If UI behavior changes (e.g. input not cleared anymore), update `waitOutcome()` and `errorText()`.

## How to update when UI changes

1. Re-identify the input by inspecting placeholders/ARIA on the target page.
2. Manually test one code in DevTools:
   - set value via React setter,
   - dispatch Enter sequence,
   - watch which DOM change is the most reliable success signal.
3. Update only these functions first:
- `findInput()`
- `sendCode()`
- `waitOutcome()` / `errorText()` / `rowCount()`
4. Re-run smoke tests: one valid code, one invalid code, stop mid-run, rerun without reload.
