# ADR 0094: Terminal line-editor becomes cursor-aware (mid-line insert/delete + Home/End/Delete + Ctrl+A/Ctrl+E)

Status: Accepted (2026-06-08)
Date: 2026-06-08

> TL;DR: add `cursorPos` to the RiftyTerminal line editor; edit at the caret — Arrow Left/Right move+clamp, mid-line insert/backspace/Delete repaint tail, Home/End/Ctrl+A/Ctrl+E jump; word-motion/kill-ring/reverse-search deferred

## Context
`RiftyTerminal` (browser console over xterm.js) was intentionally APPEND-ONLY. `dispatch()` swallowed ArrowLeft/ArrowRight with the comment "Line-mode editing is append-only; swallow the keys so their raw escape sequence doesn't leak into the buffer as garbage." `buffer` was a plain string with no caret index; backspace only trimmed the tail (`\b \b`); `appendPrintable` always concatenated at the end. Live repro: typing `abc`, ArrowLeft, ArrowLeft, `X` produced `abcX` (X appended) instead of `aXbc`.

The USER explicitly requested caret movement while editing a command. This is a deliberate, user-requested behavior-contract change — not an incidental refactor.

Not Node-compat behavior: this is browser terminal UI, so no parity-runner case applies (the line discipline here is xterm.js echo, not a `node:*` module). Unit tests in the terminal package are the contract.

## Decision
Make the line editor caret-aware. Add `cursorPos` (index into `buffer`, 0..length) and edit AT the caret:

- **ArrowLeft/Right** — clamp at 0/len; echo one cell move (`\b` left, `\x1b[C` right). No longer swallowed.
- **Home / Ctrl+A** — caret to start (`\b`×cursorPos). **End / Ctrl+E** — caret to end (`\x1b[C`×(len−cursorPos)).
- **Delete** (`\x1b[3~`) — forward-delete char AT caret; repaint tail + blank trailing cell + restore caret. No-op at end.
- **Printable insert** — splice at caret; append fast-path keeps the old byte-exact echo (no caret restore), mid-line writes `text+tail` then `\b`×tail.len.
- **Backspace** — delete char BEFORE caret; at end stays the classic `\b \b`, mid-line repaints tail + blanks stale cell + restores caret.
- **History recall** (`replaceBuffer`, Up/Down) — walk caret to end first so the per-char erase clears the WHOLE visible line even when mid-line, then write the recalled command and set `cursorPos = len`.
- **Enter / Ctrl+C / prompt** — reset `buffer` AND `cursorPos`.

Scope deliberately bounded: caret motion + mid-line insert/delete + Home/End/Delete + Ctrl+A/Ctrl+E only. Word-motions, kill-ring, reverse-search are OUT (separate research effort).

`keys.ts`: add `home`/`end`/`delete` to the `KeyEvent` union; classify Home (`\x1b[H`, `\x1b[1~`, `\x1bOH`), End (`\x1b[F`, `\x1b[4~`, `\x1bOF`), Delete (`\x1b[3~`), Ctrl+A (`\x01`)→home, Ctrl+E (`\x05`)→end.

## Options considered
- **(a) Stay append-only** — simplest, no caret state; but directly contradicts the user's explicit request and is a real usability defect (can't fix a typo mid-line). Rejected.
- **(b) Cursor-aware line editor (chosen)** — caret index + mid-line redraw, no new deps, hand-rolled ANSI echo. Covers the requested edit ops with bounded complexity.
- **(c) Full readline** (word-motion, kill-ring, reverse-search, multiline) — most capable, but large surface, easy to diverge from real readline, and beyond the request. Deferred to a separate research effort; (b) is the right increment now.

## Consequences
- Mid-line editing works: `abc`,←,←,`X` → `aXbc`; Home/End/Delete/Ctrl+A/Ctrl+E behave as expected.
- New private caret state (`cursorPos`) must be reset on every line-end path (Enter, Ctrl+C, `writePrompt`) — done; covered by tests.
- Echo is hand-rolled ANSI (`\b`, space, `\x1b[C`); wide/CJK glyphs and line-wrap at the right margin are NOT handled (ASCII-cell assumption, same simplification as elsewhere). Acceptable for the console REPL; revisit if wide-char editing is needed.
- Append + paste echo paths are byte-for-byte unchanged (fast-path), so existing paste/append tests are untouched.
- No new dependency; no public API change (`handleInput` signature, `onInput`/`onSignal` contract all stable) — the change is observable terminal *behavior*, not a package API surface.

## Test-contract change
The test "ArrowLeft / ArrowRight are swallowed (not appended to the buffer)" asserted the OLD append-only contract (`['ab']`). It is REWRITTEN to assert the new caret contract (`abc`,←,←,`X` → `['aXbc']`). This is sanctioned because the user explicitly requested the behavior change — the rewritten test encodes the NEW contract, it is not a test weakened to make code pass (CLAUDE.md never-edit-a-test invariant respected: the old assertion no longer describes desired behavior). No other test is weakened; new tests cover Home/End/Delete, mid-line backspace/insert (incl. echoed bytes), clamping, and history-recall caret reset.

## Reversibility classification
**IRREVERSIBLE** — observable-behavior change + a new mechanism (caret-aware editing), per the reversibility checklist item 4. Recorded as this inline ADR. Reverting (back to append-only) would require a superseding ADR citing this one.

## Acceptance
- [x] `cursorPos` tracks the caret (0..len); reset on Enter / Ctrl+C / prompt.
- [x] ArrowLeft/Right move + clamp; mid-line printable inserts at caret; `abc`,←,←,`X` → `aXbc`.
- [x] Home/Ctrl+A → start; End/Ctrl+E → end; Delete forward-deletes at caret; Backspace deletes before caret (both mid-line and at end).
- [x] History recall clears the whole line when caret is mid-line and resets the caret to the end.
- [x] `keys.ts` classifies Home/End/Delete (all listed sequences) + Ctrl+A/Ctrl+E with unit tests.
- [x] "arrows swallowed" test rewritten to the caret contract; no other test weakened; terminal package tests + typecheck green.
