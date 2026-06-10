# ADR 0097: Readline-style keymap and history UX

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: grow the browser line editor toward readline/fish behavior in zero-dep slices

## Context

ADR-0094 made the editor cursor-aware; ADR-0096 fixed cell-width math. The UX backlog's next high-value items are app-layer only: prefix history search, word motion, autosuggestions, Ctrl+C copy-vs-SIGINT, Emacs keys, kill-ring, and reverse search. These are observable terminal behavior, so record the policy once and implement in small tested slices.

## Decision

Adopt a readline-style keymap/history direction for `RiftyTerminal`:

- Prefix history: Up/Down with a non-empty buffer searches commands starting with that prefix; empty buffer keeps chronological history.
- Word motion: Ctrl/Alt left/right move by shell-ish words, not bytes.
- Autosuggestions: show the most recent matching history suffix as dim text at EOL; Right/End accepts.
- Kill-ring: Ctrl+U/K/W cut into an editor-local ring; Ctrl+Y yanks from it.
- Reverse search: Ctrl+R enters a small history-search mode; repeated Ctrl+R walks older matches; Enter accepts; Ctrl+G/Esc cancels.
- Ctrl+C with a non-empty xterm selection copies selection instead of sending SIGINT; Ctrl+C with no selection still reaches xterm as ETX/SIGINT.
- Emacs keymap aliases: Ctrl+B/F/P/N map to left/right/history, Ctrl+D forward-deletes, Ctrl+L redraws, Ctrl+T transposes.
- Later slices may add copy-on-select under this ADR.
- No new dependency. No public API change for this batch unless a later item explicitly needs one.

Reserved browser shortcuts are best-effort only; do not rely on Ctrl+N/T in normal browser tabs.

## Consequences

- More native-feeling editing without pulling a readline library into the browser.
- Tests, not Node parity, define the UI contract.
- Key conflicts must be handled before `classifyKey`'s escape/control catch-alls.

## Acceptance

- [x] Prefix history search covered for match, no-match, Down restore, and empty-prefix legacy behavior.
- [x] Word-left/right covered for Ctrl-arrow and Alt-B/F forms.
- [x] Autosuggestion render/accept covered without mutating `buffer` before accept.
- [x] Kill-ring covered for Ctrl+U/K/W/Y.
- [x] Reverse search covered for accept, older-match repeat, and cancel/restore.
- [x] Ctrl+C copy-vs-SIGINT classifier covered; terminal wiring uses `attachCustomKeyEventHandler`.
- [x] Emacs aliases covered for Ctrl+B/F/P/N/D/L/T.
- [x] Existing cursor-aware ASCII and cell-width tests stay green.
- [x] `packages/terminal/CHANGELOG.md` records shipped slices.
