# Terminal features backlog

Actionable, browser-feasible terminal-UX improvements for rifty's `RiftyTerminal`
(xterm.js). Distilled from the 2026-06-08 research sweep — see
[`terminal-ux-research-2026-06-08.md`](./terminal-ux-research-2026-06-08.md) for
rationale, citations, gotchas, and feasibility verdicts. Forward-looking terminal
fixes live in [`terminal-backlog.md`](./terminal-backlog.md); this file is the *feature* queue.

Legend: **I** = impact, **E** = effort (low/med/high). `dep` = needs a new npm
dep (IRREVERSIBLE → 1 ADR). `ADR` = needs an ADR for a public-API / parity /
observable-behavior change. Tick the box when shipped.

## Recently shipped (this PR)
- [x] Cursor-aware line editor — mid-line insert/delete, Home/End/Delete, Ctrl+A/E (ADR-0094)
- [x] Dev-mode HMR live preview via the cross-realm bridge (ADR-0095)
- [x] Terminal no longer overlaps the status bar (xterm fit `padding`→`inset`)
- [x] Cell-width-aware single-row editing for CJK/emoji/combining marks (ADR-0096)
- [x] Readline-style keymap batch: prefix history, word motion, autosuggest,
  Ctrl+C copy-vs-SIGINT, Ctrl-tier kill ring, Ctrl+R reverse search (ADR-0097)
- [x] Alt-tier kill-ring keys: Alt+D, Alt+Backspace, Alt+Y, and
  `macOptionIsMeta` pass-through (ADR-0101)
- [x] Terminal options API: theme/font/contrast/a11y/cursor/copyOnSelect (ADR-0098)
- [x] Command-not-found suggestions (ADR-0099)
- [x] Command marker substrate: exit-code decorations, overview-ruler marks,
  block nav, and block selection helpers (ADR-0100)
- [x] Bracketed paste wrappers stripped for line-mode input (ADR-0102)
- [x] Line-edit undo via Ctrl+_ / delivered Ctrl+Z (ADR-0103)
- [x] Tab completion seam + playground command/path completion (ADR-0104)
- [x] Terminal xterm theme follows OS light/dark preference via ADR-0098 `setTheme`
- [x] Ctrl+Shift+Up/Down selects previous/next command block output (ADR-0100)
- [x] xterm addon drop-ins: Ctrl/Cmd-gated web links, WebGL renderer fallback,
  and Unicode 11 output widths (ADR-0105)
- [x] In-terminal find overlay with Enter/Shift+Enter navigation (ADR-0105)
- [x] Command palette seeded from shell commands (ADR-0106)
- [x] Did-you-mean quick-fix action for command-not-found output (ADR-0106)
- [x] Line-edit redo via Ctrl/Cmd+Shift+Z (ADR-0107)
- [x] Quick-fix provider registry with command typo + EADDRINUSE actions (ADR-0106)
- [x] Sticky command header over the current command block (ADR-0108)
- [x] Shareable/exportable output via serialize text/HTML actions (ADR-0105)
- [x] OSC 52 clipboard write, readback ignored for browser safety (ADR-0109)
- [x] Wrapped-line cursor layout for long single-line movement/repaint (ADR-0110)
- [x] OSC 8 grep file hyperlinks open safe workspace editor tabs (ADR-0111)
- [x] Shell-mode command-line syntax highlighting via host spans (ADR-0112)
- [x] Multiline input validator: Enter inserts newline until host says complete (ADR-0113)
- [x] IDE-style autocomplete dropdown over the existing completion seam (ADR-0114)
- [x] Command-block rail + sticky block-copy action (ADR-0115)
- [x] Atuin-style rich history overlay with OPFS-backed records (ADR-0116)
- [x] Terminal state persistence: rich history plus shell cwd/env saved through
  async OPFS with session-only memory fallback (ADR-0117)
- [x] fish abbreviations/snippets via host-provided terminal rewrite rules
  (ADR-0118)
- [x] Inline images: xterm image addon plus `img` builtin producer (ADR-0119)
- [x] AI command suggestions: opt-in `#` prompt ghost suggestions constrained to
  rifty coreutils and never auto-run (ADR-0120)
- [x] Background jobs: trailing `cmd &` starts transitional shell job with
  `jobs` table and async-output-safe prompt repaint (ADR-0121)
- [x] Mouse reporting: foreground raw stdin route plus `mouse-demo` verifies
  DECSET 1000/1006 click reports in Chromium (ADR-0122)

## Foundation (do first — unblocks several below)
- [x] **Wrapped-line cursor model.** Cell-width math for CJK/emoji/combining
  edits shipped in ADR-0096; ADR-0110 adds offset→(row,col) repaint math for
  long single-line input. Multiline, syntax highlight, and anchored dropdowns
  remain separate follow-ups. **I:high E:high** · app-layer.

## Tier 1 — quick wins (zero-dep app-layer, ship as one batch)
- [x] **Prefix history search (Up/Down)** — filter history by the typed prefix; empty prefix = today's behaviour. **I:high E:low** · app-layer.
- [x] **Word-wise motion (Ctrl+←/→, Alt+←/→)** — add `word-left/right` to `classifyKey` before the catch-all; reuse the boundary scanner for Ctrl-W. **I:high E:low** · app-layer.
- [x] **Fish-style inline autosuggestions** — dim (`\x1b[2m`) suffix from history at EOL; accept on →/End/Ctrl+E. Avoid DECSC/DECRC. **I:high E:low** · app-layer.
- [x] **Ctrl+C: copy-on-selection vs SIGINT** — `attachCustomKeyEventHandler`; copy when a selection exists, else SIGINT. The #1 web-terminal papercut. **I:high E:low** · app-layer.
- [x] **Emacs/readline keymap** — Ctrl-F/B/P/N/D/T/L (+ those needing `preventDefault`). **I:high E:low** · app-layer · `ADR` (parity behavior; updates the `\x0c→ignored` keys.test contract).
- [x] **Mouse selection → copy** — selection already works; wire copy + opt-in `copyOnSelect`. Wrap behind `RiftyTerminal` (D-002). **I:med E:low** · app-layer.
- [x] **Clickable URLs** — `@xterm/addon-web-links`, gated on Cmd/Ctrl-click. **I:med E:low** · `dep`+`ADR`.
- [x] **In-terminal find (Ctrl+F)** — `@xterm/addon-search` + Solid find-box. **I:med E:low** · `dep`+`ADR`.
- [x] **Copy-on-select** — `onSelectionChange`→clipboard (guard empty, always `.catch()`). **I:med E:low** · app-layer.
- [x] **Themes + OS light/dark** — `options.theme` swap + `matchMedia`. **I:med E:low** · `ADR` (new public `setTheme`).
- [x] **`minimumContrastRatio: 4.5`** — one-line WCAG-AA legibility. **I:low E:low** · core option.
- [x] **Did-you-mean (command-not-found)** — Damerau-Levenshtein over builtins at the shell error site; diagnostic-only, exit stays 127. **I:med E:low** · shell-side.
- [x] **GPU rendering (WebGL) + DOM fallback** — `@xterm/addon-webgl` in try/catch; keep DOM renderer in e2e. **I:med E:low** · `dep`+`ADR`.

## Tier 2 — high impact (medium effort)
- [x] **Kill-ring (Ctrl-W/U/K/Y, Alt-D/Backspace/Y)** — Ctrl-tier always-on; Alt-tier behind `macOptionIsMeta`. Note Ctrl-W vs Alt-Backspace word rules differ. **I:high E:med** · app-layer.
- [x] **Reverse history search (Ctrl+R)** — search-mode state machine + `(reverse-i-search)` prompt; `preventDefault` browser default. **I:high E:med** · app-layer.
- [x] **Tab completion + menu/LCP** — inject `completer(line,cursor)` on `RiftyTerminalOptions`; reuse `Shell.commands` + VFS `readdir` + `packColumns`/`matchSegment`. The capability unlock. **I:high E:med** · app-layer · `ADR` (public callback).
- [x] **OSC 8 hyperlinks → vfs/editor** — TTY-gated emit in coreutils + core `linkHandler` routing file paths to editor tabs. **I:med→high E:low–med** · `ADR` (new `onLink`) · security: scheme allowlist, reject `../`.
- [x] **Exit-status gutter marks** — `registerMarker`/`registerDecoration` per command (green/red, height=1); needs exit code threaded back. The substrate for #blocks. **I:high E:med** · `ADR` (`onInput`→exitCode).
- [x] **Scrollbar history marks + jump (Ctrl-↑/↓)** — markers + `overviewRulerWidth` + `scrollToLine`. **I:med E:low** · app-layer (rides the marker substrate).
- [x] **Syntax highlighting of the command line** — SGR truecolor in the echo path via an offset-preserving lexer; shell-mode only. **I:high E:med** · app-layer (needs cell-width foundation).
- [x] **Jump-to-prompt nav (Ctrl/Cmd+↑/↓)** — key handler + marker walk + `scrollToLine`; Shift→`selectLines`. **I:med E:med** · app-layer.
- [x] **Select-whole-command-output** — start/end markers + gutter-decoration click → `selectLines`→copy. **I:med E:med** · app-layer.
- [x] **Command palette (Ctrl/Cmd+Shift+P)** — Solid overlay + additive `injectLine`/`focus`; seed from `Shell.commands`. **I:med E:med** · `ADR` (public methods).
- [x] **Sticky command header** — markers + `onScroll` + DOM overlay pinned over `.xterm`. **I:med E:med** · app-layer (after marker substrate).
- [x] **Quick-fixes from output (lightbulb)** — `QuickFixProvider` registry at the `App.onLine` seam (EADDRINUSE→kill+rerun, did-you-mean, etc.). **I:med E:med** · `ADR` (prefill/run method).
- [x] **CJK/emoji widths** — `@xterm/addon-unicode11` fixes output; editor needs the cell-width foundation for correct editing. **I:med E:med** · `dep`+`ADR`.
- [x] **Bracketed paste / robust paste** — `Terminal.paste()` + DECSET 2004 (mostly redundant today). **I:low E:low** · app-layer.
- [x] **Undo of line edits** — snapshot stack; Ctrl+_ / delivered Ctrl+Z. **I:med E:low** · app-layer.
- [x] **Redo of line edits** — binding still byte-collision-constrained. **I:med E:low** · app-layer.
- [x] **Screen-reader / a11y mode** — core `screenReaderMode`, opt-in (conflicts with Ctrl+R/F). **I:low E:low** · core option.

## Tier 3 — ambitious / optional (gated on prerequisites)
- [x] **Multi-line editing + input validator** — Enter-when-complete; the cost is the cell-width/wrapped-layout rewrite. **I:med E:high** · app-layer.
- [x] **IDE-style autocomplete dropdown (Fig/Amazon Q)** — DOM list in the
  playground over the existing tab-completion seam; exact cursor anchoring remains
  a polish follow-up. **I:high E:high** · app-layer.
- [x] **Command blocks (VS Code subset)** — gutter rail + ruler marks + nav + block-copy (NOT Warp widgets). **I:high E:high** · app-layer (marker substrate).
- [x] **Atuin-style rich history (Ctrl+R overlay)** — DOM overlay over rich records
  captured at the terminal line seam and persisted through async OPFS when
  available.
  **I:high E:high** · app-layer.
- [x] **Background blocks (`&` jobs)** — shipped as transitional shell jobs:
  trailing `cmd &`, `jobs` table, dispose cleanup, async-output-safe prompt
  repaint; full kernel PID/fg/bg job control remains future work. **I:med
  E:high** · shell+kernel.
- [x] **Inline images (SIXEL/IIP)** — `@xterm/addon-image` + an `img` coreutil producer. **I:low E:med** · `dep`+`ADR`.
- [x] **AI command suggestions (`#`-prefix)** — ghost-text plumbing + endpoint/key; constrain to rifty's coreutils; opt-in, never auto-run. **I:med E:med** · `ADR`.
- [x] **State persistence** — history/cwd/env to OPFS (addon-serialize only restores visual scrollback). **I:med E:med** · app-layer.
- [x] **Shareable/exportable output** — `serializeAsHTML` → clipboard-HTML / download / fragment-URL. **I:low E:med** · `dep`.
- [x] **Configurable cursor style (DECSCUSR)** — `cursorStyle` pass-through (ADR-0098). **I:low E:low–med**.
- [x] **fish abbreviations** / **snippets**. **I:low E:low–med**.
- [x] **OSC 52 clipboard write** (drop read for security). **I:low E:low–med**.
- [x] **Mouse reporting (DECSET 1000/1002/1006)** — foreground raw stdin
  route plus a `mouse-demo` TUI consumer; browser e2e covers DECSET 1000/1006,
  `onBinary` unit coverage keeps default byte reports intact. **I:low E:high**
  · terminal+shell.

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
