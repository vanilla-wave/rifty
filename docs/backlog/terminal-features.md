# Terminal features backlog

Actionable, browser-feasible terminal-UX improvements for rifty's `RiftyTerminal`
(xterm.js). Distilled from the 2026-06-08 research sweep — see
[`terminal-ux-research-2026-06-08.md`](./terminal-ux-research-2026-06-08.md) for
rationale, citations, gotchas, and feasibility verdicts. Forward-looking terminal
fixes live in [`terminal.md`](./terminal.md); this file is the *feature* queue.

Legend: **I** = impact, **E** = effort (low/med/high). `dep` = needs a new npm
dep (IRREVERSIBLE → 1 ADR). `ADR` = needs an ADR for a public-API / parity /
observable-behavior change. Tick the box when shipped.

## Recently shipped (this PR)
- [x] Cursor-aware line editor — mid-line insert/delete, Home/End/Delete, Ctrl+A/E (ADR-0094)
- [x] Dev-mode HMR live preview via the cross-realm bridge (ADR-0095)
- [x] Terminal no longer overlaps the status bar (xterm fit `padding`→`inset`)

## Foundation (do first — unblocks several below)
- [ ] **Cell-width-correct, wrapped-line cursor model.** Today the editor counts
  UTF-16 code units and assumes a single visual row (`'\b'.repeat(str.length)`),
  so CJK/emoji and wrapped long lines desync the caret. Rewrite edit primitives
  (`handleBackspace`/`handleDelete`/`insertPrintable`/`moveTo*`/`replaceBuffer`)
  to an offset→(row,col) cell-aware model. **I:high E:high** · app-layer ·
  prerequisite for multiline, syntax highlight, CJK, long completions/suggestions.

## Tier 1 — quick wins (zero-dep app-layer, ship as one batch)
- [ ] **Prefix history search (Up/Down)** — filter history by the typed prefix; empty prefix = today's behaviour. **I:high E:low** · app-layer.
- [ ] **Word-wise motion (Ctrl+←/→, Alt+←/→)** — add `word-left/right` to `classifyKey` before the catch-all; reuse the boundary scanner for Ctrl-W. **I:high E:low** · app-layer.
- [ ] **Fish-style inline autosuggestions** — dim (`\x1b[2m`) suffix from history at EOL; accept on →/End/Ctrl+E. Avoid DECSC/DECRC. **I:high E:low** · app-layer.
- [ ] **Ctrl+C: copy-on-selection vs SIGINT** — `attachCustomKeyEventHandler`; copy when a selection exists, else SIGINT. The #1 web-terminal papercut. **I:high E:low** · app-layer.
- [ ] **Emacs/readline keymap** — Ctrl-F/B/P/N/D/T/L (+ those needing `preventDefault`). **I:high E:low** · app-layer · `ADR` (parity behavior; updates the `\x0c→ignored` keys.test contract).
- [ ] **Mouse selection → copy** — selection already works; wire copy + opt-in `copyOnSelect`. Wrap behind `RiftyTerminal` (D-002). **I:med E:low** · app-layer.
- [ ] **Clickable URLs** — `@xterm/addon-web-links`, gated on Cmd/Ctrl-click. **I:med E:low** · `dep`+`ADR`.
- [ ] **In-terminal find (Ctrl+F)** — `@xterm/addon-search` + Solid find-box. **I:med E:low** · `dep`+`ADR`.
- [ ] **Copy-on-select** — `onSelectionChange`→clipboard (guard empty, always `.catch()`). **I:med E:low** · app-layer.
- [ ] **Themes + OS light/dark** — `options.theme` swap + `matchMedia`. **I:med E:low** · `ADR` (new public `setTheme`).
- [ ] **`minimumContrastRatio: 4.5`** — one-line WCAG-AA legibility. **I:low E:low** · core option.
- [ ] **Did-you-mean (command-not-found)** — Damerau-Levenshtein over builtins at the shell error site; diagnostic-only, exit stays 127. **I:med E:low** · shell-side.
- [ ] **GPU rendering (WebGL) + DOM fallback** — `@xterm/addon-webgl` in try/catch; keep DOM renderer in e2e. **I:med E:low** · `dep`+`ADR`.

## Tier 2 — high impact (medium effort)
- [ ] **Kill-ring (Ctrl-W/U/K/Y, Alt-D/Backspace/Y)** — Ctrl-tier always-on; Alt-tier behind `macOptionIsMeta`. Note Ctrl-W vs Alt-Backspace word rules differ. **I:high E:med** · app-layer.
- [ ] **Reverse history search (Ctrl+R)** — search-mode state machine + `(reverse-i-search)` prompt; `preventDefault` browser default. **I:high E:med** · app-layer.
- [ ] **Tab completion + menu/LCP** — inject `completer(line,cursor)` on `RiftyTerminalOptions`; reuse `Shell.commands` + VFS `readdir` + `packColumns`/`matchSegment`. The capability unlock. **I:high E:med** · app-layer · `ADR` (public callback).
- [ ] **OSC 8 hyperlinks → vfs/editor** — TTY-gated emit in coreutils + core `linkHandler` routing file paths to editor tabs. **I:med→high E:low–med** · `ADR` (new `onLink`) · security: scheme allowlist, reject `../`.
- [ ] **Exit-status gutter marks** — `registerMarker`/`registerDecoration` per command (green/red, height=1); needs exit code threaded back. The substrate for #blocks. **I:high E:med** · `ADR` (`onInput`→exitCode).
- [ ] **Scrollbar history marks + jump (Ctrl-↑/↓)** — markers + `overviewRulerWidth` + `scrollToLine`. **I:med E:low** · app-layer (rides the marker substrate).
- [ ] **Syntax highlighting of the command line** — SGR truecolor in the echo path via an offset-preserving lexer; shell-mode only. **I:high E:med** · app-layer (needs cell-width foundation).
- [ ] **Jump-to-prompt nav (Ctrl/Cmd+↑/↓)** — key handler + marker walk + `scrollToLine`; Shift→`selectLines`. **I:med E:med** · app-layer.
- [ ] **Select-whole-command-output** — start/end markers + gutter-decoration click → `selectLines`→copy. **I:med E:med** · app-layer.
- [ ] **Command palette (Ctrl/Cmd+Shift+P)** — Solid overlay + additive `injectLine`/`focus`; seed from `Shell.commands`. **I:med E:med** · `ADR` (public methods).
- [ ] **Sticky command header** — markers + `onScroll` + DOM overlay pinned over `.xterm`. **I:med E:med** · app-layer (after marker substrate).
- [ ] **Quick-fixes from output (lightbulb)** — `QuickFixProvider` registry at the `App.onLine` seam (EADDRINUSE→kill+rerun, did-you-mean, etc.). **I:med E:med** · `ADR` (prefill/run method).
- [ ] **CJK/emoji widths** — `@xterm/addon-unicode11` fixes output; editor needs the cell-width foundation for correct editing. **I:med E:med** · `dep`+`ADR`.
- [ ] **Bracketed paste / robust paste** — `Terminal.paste()` + DECSET 2004 (mostly redundant today). **I:low E:low** · app-layer.
- [ ] **Undo/redo of line edits** — snapshot stack; ship undo-only first (redo binding is byte-collision-constrained). **I:med E:low** · app-layer.
- [ ] **Screen-reader / a11y mode** — core `screenReaderMode`, opt-in (conflicts with Ctrl+R/F). **I:low E:low** · core option.

## Tier 3 — ambitious / optional (gated on prerequisites)
- [ ] **Multi-line editing + input validator** — Enter-when-complete; the cost is the cell-width/wrapped-layout rewrite. **I:med E:high** · app-layer.
- [ ] **IDE-style autocomplete dropdown (Fig/Amazon Q)** — `registerDecoration` anchor + portaled DOM list; build atop tab-completion. **I:high E:high** · app-layer.
- [ ] **Command blocks (VS Code subset)** — gutter rail + ruler marks + nav + block-copy (NOT Warp widgets). **I:high E:high** · app-layer (marker substrate).
- [ ] **Atuin-style rich history (Ctrl+R overlay)** — DOM overlay over rich in-memory records + OPFS persistence; capture metadata directly. **I:high E:high** · app-layer.
- [ ] **Background blocks (`&` jobs)** — blocked on `shell.background` (NotImplementedError) + pipes/redirect; needs a job table. **I:med E:high** · shell+kernel.
- [ ] **Inline images (SIXEL/IIP)** — `@xterm/addon-image` + an `img` coreutil producer. **I:low E:med** · `dep`+`ADR`.
- [ ] **AI command suggestions (`#`-prefix)** — ghost-text plumbing + endpoint/key; constrain to rifty's coreutils; opt-in, never auto-run. **I:med E:med** · `ADR`.
- [ ] **State persistence** — history/cwd/env to OPFS (addon-serialize only restores visual scrollback). **I:med E:med** · app-layer.
- [ ] **Shareable/exportable output** — `serializeAsHTML` → clipboard-HTML / download / fragment-URL. **I:low E:med** · `dep`.
- [ ] **Configurable cursor style (DECSCUSR)** / **OSC 52 clipboard write** (drop read for security) / **fish abbreviations** / **snippets**. **I:low E:low–med**.
- [ ] **Mouse reporting (DECSET 1000/1002/1006)** — render side free, but needs raw-stdin TTY mode + a TUI consumer first. **I:low E:high** · kernel+shell.

## Out of scope — NOT feasible in a browser (don't build)
Middle-click X11 PRIMARY paste · Warp/Wave atomic block *widgets* (ship the VS Code
subset instead) · ligatures on the DOM renderer (needs WebGL + xterm 6) · cross-line/
cross-wrap regex search · reliable Ctrl+N / Ctrl+T (browser-reserved) · hosted share
permalinks (no backend) · true OS taskbar progress. See the research doc §"Not feasible".

## Suggested sequencing
1. Cell-width/wrapped-line cursor **foundation**.
2. **Zero-dep line-editor batch** (Tier 1 #1–6 + kill-ring + Ctrl+R) — 1 ADR for the keymap.
3. **Marker substrate** (exit-status + scrollbar marks) — 1 ADR for `onInput`→exitCode; reused by jump/select/sticky/blocks.
4. **Addon drop-ins** (web-links, search, webgl, unicode11, contrast) — 1 short ADR each.
5. **Tab completion** (ADR) → then syntax highlight + palette on the same seam.
6. **Tier 3** as appetite allows.
