# Terminal UX research — making the rifty terminal more user-friendly

> Provenance: generated 2026-06-08 by a fan-out research workflow (`terminal-ux-research`,
> 78 agents across 6 survey angles → adversarial xterm.js-feasibility verification →
> synthesis). 76 features surveyed, 71 confirmed browser-feasible. Each recommendation
> was fact-checked against the real xterm.js API/addons and grounded in rifty's actual
> `RiftyTerminal`/`classifyKey`/`Shell` code. Seeds tickets/ADRs — not yet ratified.
> Companion to `docs/backlog/terminal.md` (the forward-looking terminal queue).

## Executive summary

- **rifty owns both ends of the wire** (it *is* the shell and the line editor, no PTY round-trip). This is a structural superpower that several "hard" native features collapse into trivial app-layer code: command boundaries, exit codes, cwd, and history are all already in-process, so anything VS Code/Warp need OSC 133/633 escape-parsing for, rifty just reads directly. Lean into this everywhere.
- **The biggest wins are pure app-layer line-editor work with zero new dependencies**: word-wise motion, kill-ring, prefix history search (Up/Down), reverse search (Ctrl+R), Emacs keymap, fish-style autosuggestions, and Ctrl+C-vs-copy disambiguation. These ride the existing `onData → classifyKey → dispatch` seam you already have, and most are `low` effort. Ship these first.
- **Tab-completion is the single highest-value capability unlock** and the one feature whose absence is most felt; it needs a small public-API addition (a `completer` callback on `RiftyTerminalOptions`) and ~150–250 LOC, reusing in-repo `Shell.commands`, `packColumns`, `matchSegment`, and VFS `readdir`.
- **One shared substrate — command-boundary markers via `registerMarker`/`registerDecoration`** — unlocks a whole tier at once: exit-status gutter marks, scrollbar history navigation, jump-to-prompt, sticky scroll, output-select, command blocks, quick-fixes. Build the marker/decoration layer once (it's cheap because you control `writePrompt`/`handleEnter`) and amortize it across six features.
- **A few first-party `@xterm/addon-*` are clean drop-ins** with high polish-per-effort: `addon-web-links` (clickable URLs), `addon-search` (Ctrl+F / find), and OSC 8 hyperlinks (no addon at all). Each new dep is IRREVERSIBLE per the checklist → one short ADR each, but they're same-vendor/version-line as the `addon-fit` you already ship.
- **A short list is genuinely *not* worth chasing in a browser** — middle-click X11 PRIMARY paste, draggable/collapsible Warp-style block *widgets*, ligatures on the current DOM renderer, cross-line regex search, and reliable Ctrl+N/Ctrl+T bindings. Call these out so nobody burns time on them (see §"Not feasible").

A hard prerequisite threads through many items: **the line editor's cursor math is single-row and counts UTF-16 code units, not display cells.** Backspace/insert/`replaceBuffer` all assume the input fits one visual row and use `'\b'.repeat(str.length)`. Wide chars (CJK/emoji) and wrapped lines already desync this latently. **Make "wrapped-line + cell-width-correct cursor model" a shared foundation task** — it's a prerequisite for multi-line editing, syntax highlighting, transient prompts, and correct rendering of long completions/suggestions. Treat it as infrastructure, not a feature. (This is the same limitation noted as a consequence in ADR-0094.)

---

## Prioritized roadmap (sorted by impact-per-effort, quick wins first)

| Feature | Borrowed from | Impact | Effort | xterm.js mechanism / addon | Notes |
|---|---|---|---|---|---|
| Prefix history search (Up/Down) | fish / zsh / readline | high | low | app-layer; `onData`/`write` only | Strict superset of current Up/Down; do *with* the cursor-aware editor |
| Word-wise motion (Alt+←/→, Ctrl+←/→) | readline / emacs | high | low | app-layer; new `classifyKey` cases | Ctrl+arrows portable & config-free; reuse boundary scanner |
| Fish-style inline autosuggestions | fish / zsh-autosuggestions | high | low | app-layer; dim SGR `\x1b[2m` + cursor-back | Accept on →/End/Ctrl+E; only paint at EOL |
| Ctrl+C copy vs SIGINT disambiguation | iTerm2 / VS Code / GNOME | high | low | `attachCustomKeyEventHandler` + `navigator.clipboard` | Fixes the #1 web-terminal papercut |
| Emacs/readline keymap (Ctrl-F/B/P/N/D/T/L, etc.) | readline | high | low | app-layer; C0 bytes already arrive | Ctrl-N/Ctrl-T browser-reserved — see Not-feasible |
| Mouse selection → copy (drag/dbl/triple-click) | every native terminal | med | low | core `SelectionService` (built-in) + clipboard | Selection already works; only copy glue missing |
| Kill-ring (Ctrl-W/U/K/Y) | readline / emacs | high | med | app-layer; new `classifyKey` cases | Ctrl-tier always-on; Alt-tier needs `macOptionIsMeta` |
| Reverse history search (Ctrl+R) | readline / fish | high | med | app-layer + `attachCustomKeyEventHandler` (preventDefault) | No XON/XOFF problem; browser-default suppression mandatory |
| Tab completion + menu/LCP | bash / zsh / fish | high | med | app-layer; new `completer` on options (ADR) | Reuses `Shell.commands`, `packColumns`, `matchSegment`, VFS `readdir` |
| Clickable URLs | iTerm2 / Kitty / VS Code | med | low | `@xterm/addon-web-links` (new dep, ADR) | Gate on Cmd/Ctrl-click; high value for preview-server URLs |
| OSC 8 hyperlinks → vfs/editor | Kitty / WezTerm / VS Code | med→high | low–med | core `linkHandler` (no addon) + emit side in coreutils | `allowNonHttpProtocols:true`; route file paths to editor tabs |
| In-terminal find (Ctrl+F) | VS Code / WezTerm | med | low | `@xterm/addon-search` (new dep, ADR) | JS RegExp, no cross-wrap match; bump `scrollback` |
| Exit-status gutter marks | iTerm2 / VS Code | high | med | core `registerMarker`/`registerDecoration` | Needs exit code threaded back (onInput→number) → ADR |
| Scrollbar history marks + jump | Windows Terminal / VS Code | med | low | core markers + `overviewRulerWidth` + `scrollToLine` | Set `overviewRulerWidth` or ruler stays invisible |
| Copy-on-select | iTerm2 / Windows Terminal | med | low | `onSelectionChange` + clipboard | Opt-in `copyOnSelect`; guard empty selection |
| Themes + OS light/dark | Ghostty / iTerm2 | med | low | core `options.theme` + `matchMedia` | Lazy-load catalog; flip app CSS vars too |
| `minimumContrastRatio` (a11y legibility) | iTerm2 / kitty | low | low | core option (1 line) | WCAG AA=4.5; DOM renderer supported |
| Did-you-mean (command-not-found) | zsh / fish | med | low | shell-side; Damerau-Levenshtein over builtins | Non-interactive variant only; no PATH walk needed |
| GPU rendering (WebGL) + fallback | VS Code / Ghostty | med | low | `@xterm/addon-webgl` (new dep, ADR) | Try/catch → DOM fallback; invisible win until heavy output |
| Jump-to-prompt nav (Ctrl/Cmd+↑/↓) | VS Code / iTerm2 | med | med | markers + `attachCustomKeyEventHandler` + `scrollToLine` | Must use key handler, not `onData` |
| Select-whole-command-output | iTerm2 / Ghostty | med | med | markers + `selectLines` + gutter decoration | Decoration-click target > triple-click hack |
| Bracketed paste / robust paste | xterm / readline | low | low | `Terminal.paste()` + DECSET 2004 | Mostly redundant — multi-line paste already non-submitting |
| Undo/redo of line edits | reedline / isocline | med | low | app-layer snapshot stack; Ctrl-_ | Redo binding is the real constraint (byte collision) |
| Quick-fixes from output | VS Code | med | med | matcher registry + decoration lightbulb | App-layer; needs prefill-buffer method (ADR) |
| Syntax highlighting of input | fish / zsh-syntax-highlighting | high | med | app-layer; SGR truecolor in echo | Needs offset-preserving lexer + cell-width repaint |
| Command palette (Ctrl/Cmd+Shift+P) | Warp / Hyper | med | med | `attachCustomKeyEventHandler` + `input()` (ADR) | 95% app-layer Solid; needs `injectLine`/`focus` |
| Sticky command header | Warp / VS Code | med | med | markers + `onScroll` + DOM overlay | Build after boundary infra lands |
| CJK/emoji widths | every terminal | med | med | `@xterm/addon-unicode11` (ADR) + editor cell-width | Addon fixes *output*; editor needs cell-width rewrite |
| Screen-reader / a11y mode | VS Code | low | low | core `screenReaderMode` | Conflicts with Ctrl+R/F bindings; opt-in |
| Multi-line editing + validator | reedline / ptpython | med | high | app-layer; offset→(row,col) wrapped layout | The cursor-math rewrite *is* the cost |
| IDE-style autocomplete dropdown | Fig / Amazon Q | high | high | `registerDecoration` anchor + DOM list | Engine is the work; build atop tab-completion |
| Command blocks (gutter rail + nav) | Warp / VS Code | high | high | markers + decorations + `scrollToLine` | Ship the VS Code subset, not Warp widgets |
| Atuin-style rich history search | Atuin | high | high | DOM overlay + `attachCustomKeyEventHandler` | Capture metadata directly (no PTY hooks) |
| Background blocks (`&` jobs) | Warp / Wave | med | high | shell job control + kernel surfacing | Blocked on `shell.background` NotImplementedError |
| Inline images (SIXEL/IIP) | iTerm2 / Kitty | low | med | `@xterm/addon-image` (ADR) + emitter | Inert without a producer; build `img` coreutil |
| AI command suggestions | Warp / Amazon Q | med | med | app-layer ghost text + `fetch` | Endpoint/key/ADR is the real cost; opt-in |
| Ligatures | — | low | med–high | needs WebGL + xterm 6 OR CSS+font | See Not-feasible; low value for a shell |

---

## Tier 1 — Quick wins (low effort, ship first)

These are almost all pure app-layer changes inside the editor you already have, with **zero new dependencies**, and they convert rifty's "append-only-ish" prompt into something that feels like readline/fish.

### 1. Prefix history search on Up/Down — *highest ratio in the whole set*
`historyPrev`/`historyNext` already walk `this.history`. Capture `searchPrefix = this.buffer` once when Up/Down is first pressed, then make the walkers skip entries that don't `startsWith(searchPrefix)`; reset `searchPrefix = null` in `insertPrintable`/`handleBackspace`/`handleDelete`/`handleEnter`/`handleCtrlC`. Empty prefix = today's exact chronological scroll, so existing `keys.test`/`terminal.test` stay green (strict superset — write *new* cases, never edit old ones). Do this in the same PR as the cursor-aware editor since both touch `replaceBuffer`. ([fishshell.com/docs/current/interactive.html](https://fishshell.com/docs/current/interactive.html), [zsh-users/zsh-history-substring-search](https://github.com/zsh-users/zsh-history-substring-search))

### 2. Word-wise motion (Alt+←/→, Ctrl+←/→)
Add `word-left`/`word-right` to `classifyKey` **before** the `unrecognised-escape` catch-all (today `\x1bf`, `\x1b[1;5D` etc. are silently dropped at keys.ts:72). Ctrl+arrows (`\x1b[1;5C/D`) are portable and need no config; Alt+arrows work on Mac via xterm's built-in alt→ctrl rewrite. Add `moveWordLeft/Right` reusing the existing `'\b'.repeat()` / `'\x1b[C'.repeat()` echo. The same word-boundary scanner feeds Ctrl-W later. **Do not flip `macOptionIsMeta` globally** — it breaks accented chars; treat bare Alt+B/F as best-effort. ([xterm Keyboard.ts](https://github.com/xtermjs/xterm.js/blob/master/src/common/input/Keyboard.ts), [#3725](https://github.com/xtermjs/xterm.js/issues/3725))

### 3. Fish-style inline autosuggestions
Add `suggest(prefix): string|null` scanning `this.history` for the most-recent match, returning the suffix. On every buffer mutation, *only when `cursorPos === buffer.length`*, write `\x1b[K` then echo then `\x1b[2m` + suffix + `\x1b[22m`, then walk the caret back with `\x1b[<n>D`. Accept on →/End/Ctrl+E (no-op moves at EOL today → no regression). **Never use DECSC/DECRC** (`\x1b7`/`\x1b8`) — xterm's DECRC restores attributes and leaks dim onto real input ([#1521](https://github.com/xtermjs/xterm.js/issues/1521)). Clip the suffix to remaining columns so it never wraps. ([fishshell.com](https://fishshell.com/docs/current/interactive.html), [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions))

### 4. Ctrl+C copy vs SIGINT disambiguation — *fixes the worst papercut*
Register `attachCustomKeyEventHandler` in the constructor (a new front gate; `classifyKey('\x03')→SIGINT` stays as the fallback). Guard `e.type==='keydown'`. On Ctrl+C **with** selection: `navigator.clipboard.writeText(term.getSelection())`, `clearSelection()`, `return false` (no `\x03` → no SIGINT). With **no** selection: `return true` → existing SIGINT path. Ctrl-Shift-C/V: `preventDefault()` + copy/`term.paste(readText())`. macOS Cmd+C/V: `return false` without preventDefault → native. Factor the decision into a pure `classifyClipboardKey(e)` helper so it unit-tests like `classifyKey`. ([xterm docs](https://xtermjs.org/docs/api/terminal/classes/terminal/), [#2293](https://github.com/xtermjs/xterm.js/issues/2293), [web.dev/async-clipboard](https://web.dev/articles/async-clipboard))

### 5. Mouse selection → copy
Drag/double-click-word/triple-click-line **already work** in the mounted xterm — only *copy* is unwired. Add `onSelectionChange` auto-copy (opt-in `copyOnSelect`) and/or wire copy into the Ctrl+C handler above. Wrap behind `RiftyTerminal.hasSelection()/copySelection()/clearSelection()` so the Solid playground never imports xterm (D-002). **Guard `getSelection().length > 0`** — a 1-char selection can return `''` while `hasSelection()` is true ([#2617](https://github.com/xtermjs/xterm.js/issues/2617), [#724](https://github.com/xtermjs/xterm.js/issues/724)).

### 6. Emacs/readline keymap (the missing C0 bindings)
Ctrl-A/E already map. Add Ctrl-F/B (`\x06`/`\x02`→move), Ctrl-P/N (`\x10`/`\x0e`→history, but see Ctrl-N caveat), Ctrl-D (`\x04`→EOF on empty / forward-delete mid-line), Ctrl-T (`\x14`→transpose), Ctrl-L (`\x0c`→clear+redraw). Ctrl-L/P/D fire browser defaults on keydown → `attachCustomKeyEventHandler` returning **true** + `preventDefault()` on just those. The `\x0c→ignored` test (keys.test.ts:144) encodes a contract — change it via the design-discussion path, not silently. This is a Node-parity observable-behavior change → **ADR** (subset vs full map; Ctrl-D EOF wiring; reserved Ctrl-N/T). ([readline.kablamo.org/emacs.html](https://readline.kablamo.org/emacs.html), [#4269](https://github.com/xtermjs/xterm.js/issues/4269))

### 7. Clickable URLs
Add `@xterm/addon-web-links` (new dep → short ADR; same vendor as `addon-fit`). Load in `mount()` next to FitAddon with a custom activate handler gating `isMac ? e.metaKey : e.ctrlKey` (the addon's **default fires on plain click** — you must add the modifier yourself). Keep `noopener`, validate `http(s)://`. High-value: the preview-server URL and any URL printed by `npm`/dev output become one-click. ([npm @xterm/addon-web-links](https://www.npmjs.com/package/@xterm/addon-web-links), [link-handling guide](https://xtermjs.org/docs/guides/link-handling/))

### 8. In-terminal find (Ctrl+F)
Add `@xterm/addon-search` (new dep → ADR). Load with `{highlightLimit:1000}`; expose thin `findNext/findPrevious/clearSearch/onSearchResults` wrappers on RiftyTerminal; the find-box overlay (input + N-of-M + toggles) is a Solid component in the playground. Bind Ctrl+F via a DOM key handler returning false (don't echo `\x06`, suppress browser find). Set `overviewRulerWidth` for scrollbar match marks. Limits: JS RegExp (not grep/ICU), no cross-wrap match, bump `scrollback` for deep history. ([addon-search typings](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-search/typings/addon-search.d.ts))

### 9. Scrollbar history marks + jump
Set `overviewRulerWidth: 8` (or ruler stays invisible). In `writePrompt()`, `registerMarker()` + `registerDecoration({ marker, overviewRulerOptions:{ color, position:'full' }})`; keep an ordered `IMarker[]`. Add `scroll-mark-prev/next` to `classifyKey` (Ctrl-Up/Down = `\x1b[1;5A/B`) routing to `scrollToLine(marker.line)`. Filter `line === -1` (disposed) before jumping. Core APIs, no dep. ([IDecorationOverviewRulerOptions](https://xtermjs.org/docs/api/terminal/interfaces/idecorationoverviewruleroptions/))

### 10. Copy-on-select
`onSelectionChange(() => { const s = term.getSelection(); if (s) clipboard.writeText(s).catch(()=>{}); })`. Opt-in via `copyOnSelect`. **Always `.catch()`** (gesture/secure-context), and **guard `if (s)`** so a click-clear never wipes the clipboard ([#3193](https://github.com/xtermjs/xterm.js/issues/3193)). Needs a Playwright e2e (DOM-only). ([Windows Terminal selection docs](https://learn.microsoft.com/en-us/windows/terminal/selection))

### 11. Themes + OS light/dark
Define `ITheme` objects (dark/light/high-contrast derived from the existing terminal-luxe palette), swap live via `term.options.theme = {...fresh}` (must be a new object ref). Detect with `matchMedia('(prefers-color-scheme: dark)')` + `change`. Lazy-import the catalog (mbadolato/iTerm2-Color-Schemes → ITheme). New `setTheme()`/`setAutoColorScheme()` = public API → ADR + CHANGELOG. Flip the playground CSS vars on the same event. ([ITheme](https://xtermjs.org/docs/api/terminal/interfaces/itheme/), [mbadolato/iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes))

### 12. `minimumContrastRatio` — one line, real a11y
Add `minimumContrastRatio: 4.5` to the constructor (default 1 = off). Renderer lifts per-cell fg until WCAG AA contrast is met — protects against unforeseen fg/bg and user-printed ANSI, beyond anything palette math can do. DOM-renderer-supported in 5.5.0; re-verify if WebGL lands (reverse-video bug [#4752](https://github.com/xtermjs/xterm.js/issues/4752)). ([ITerminalOptions](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/))

### 13. Did-you-mean (command-not-found)
At the single error site (shell.ts:322), run a ~30-LOC Damerau-Levenshtein over `[...this.commands.keys()]` (catches `gerp→grep`), threshold `≤2`, append `Did you mean 'X'?` to the same stderr write (already red). No PATH walk — rifty has only builtins. **Non-interactive variant only**; the zsh `[nyae]?` prompt needs a read-single-key channel = cross-package API = IRREVERSIBLE → defer. Diagnostic-only, never auto-run; exit stays 127. ([fish_command_not_found](https://fishshell.com/docs/current/cmds/fish_command_not_found.html))

### 14. GPU rendering (WebGL)
In `mount()` after `term.open()`: `try { const gl = new WebglAddon(); gl.onContextLoss(()=>gl.dispose()); term.loadAddon(gl); } catch {}` → silent DOM fallback. New dep → ADR; single long-lived terminal makes the "no-retry" simplicity acceptable. Invisible until heavy output (`cat` big files, fast loops) — cheap future-proofing, not a felt upgrade. **Keep the DOM renderer in the e2e env** (WebGL canvas is invisible to DOM-snapshot assertions). ([addon-webgl README](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-webgl/README.md))

---

## Tier 2 — High impact (worth the medium effort)

### 15. Kill-ring (Ctrl-W/U/K/Y, + Alt-D/Backspace/Y)
Classify Ctrl-K `\x0b` / Ctrl-U `\x15` / Ctrl-W `\x17` / Ctrl-Y `\x19` **before** the `<32 → control-byte` branch. State: `killRing: string[]`, `yankIndex`, `lastWasKill`/`lastWasYank`. Reuse the `handleDelete` tail-repaint idiom for cuts and `insertPrintable` for yank. **The load-bearing subtlety:** Ctrl-W (unix-word-rubout) stops at *whitespace* (`foo-bar/baz` whole); Alt-Backspace (backward-kill-word) stops at *non-alphanumeric* — implement both with the *same* rule and it's wrong (test both). Ship the **Ctrl-tier always-on** (plain C0, every OS); gate the Alt-tier behind `macOptionIsMeta`. The yank buffer is editor-internal, *not* the OS clipboard (matches readline). ([Bash readline killing commands](https://www.gnu.org/software/bash/manual/html_node/Readline-Killing-Commands.html), [prompt-toolkit #426](https://github.com/prompt-toolkit/python-prompt-toolkit/issues/426))

### 16. Reverse history search (Ctrl+R)
Classify Ctrl+R `\x12` / Ctrl+S `\x13` before the catch-all. Small search-mode state machine: snapshot `{buffer,cursorPos}`, accumulate `searchQuery`, scan `history` backward, repaint `(reverse-i-search)\`q\`: <match>`. Enter/arrow accepts (load match, optionally editable); Ctrl+G/Esc restores. **`attachCustomKeyEventHandler` + `preventDefault()` is mandatory** to kill the browser's reload/save — but `return true` so xterm still emits the byte. No XON/XOFF hang (xterm dropped it in 4.1, rifty has no PTY). Parity target: bash `reverse-i-search`. ([readline emacs](https://readline.kablamo.org/emacs.html), [flow control guide](https://xtermjs.org/docs/guides/flowcontrol/))

### 17. Tab completion with menu + longest-common-prefix — *the capability unlock*
Map Shift+Tab (`\x1b[Z`, today dropped) → `back-tab`. Add an injected `completer(line, cursorPos): Promise<{replaceStart, candidates}>` to `RiftyTerminalOptions` (cross-package public API → **ADR**; options: in-terminal pager vs DOM overlay, sync vs async, menu-cycle vs list). The host supplies it from `Shell.commands` (word 0), VFS `readdir` + `matchSegment` (path args), per-command flag specs. Replace the literal-`\t` case: 0→bell, 1→insert remainder+space, >1→insert LCP or open a column pager via the existing `packColumns`. Guard the async readdir with the existing `busy` flag. Get path quoting/escaping right or completed paths break the next command. Reuses in-repo helpers; ~150–250 LOC. ([wavesoft/local-echo](https://github.com/wavesoft/local-echo), [reedline](https://github.com/nushell/reedline))

### 18. OSC 8 hyperlinks → vfs/editor routing
Two halves. **Emit** (coreutils): wrap paths in `\x1b]8;;TARGET\x1b\\name\x1b]8;;\x1b\\`, **TTY-gated** (`ctx.isTTY`, same pattern as `_sgr.ts` color gating) so pipes/redirects stay clean. **Route**: set core `linkHandler` (no addon) with `allowNonHttpProtocols:true`, branch on scheme — `http(s)→window.open`, `file://`/`rifty-vfs:`→`openFileTab(...)` (the existing editor-tabs glue). Gate on Ctrl/Cmd-click. **Security:** allowlist schemes, validate paths (reject `../` escapes), never `eval`/`innerHTML`. The new `onLink` callback on options is IRREVERSIBLE → ADR. Emit side is unit/parity-testable; click→route needs Playwright. ([ILinkHandler](https://xtermjs.org/docs/api/terminal/interfaces/ilinkhandler/), [egmontkob OSC 8 spec](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda))

### 19. Exit-status gutter marks (red/green per command)
rifty skips OSC 133 entirely — it has the exit code in hand (`shell.run()→{exitCode}`, `runLine` already returns it). Widen `onInput` to return `number | void` (or add `onCommandEnd(code)`) — cross-package public API → **ADR**. In `writePrompt()` capture a marker; on completion `registerDecoration({ marker, x:0, width:1, backgroundColor: code===0?'#2ea043':'#f85149', overviewRulerOptions:{...}})`; do DOM wiring (`title`, `contextmenu→rerun`) inside `onRender` (element is undefined before first render). **Keep height=1** — multi-row `backgroundColor` mis-renders ([#4855](https://github.com/xtermjs/xterm.js/issues/4855)). This is the cheap substrate that later unlocks rerun/select-output/sticky-scroll/blocks. ([VS Code shell integration](https://code.visualstudio.com/docs/terminal/shell-integration), [registerDecoration](https://xtermjs.org/docs/api/terminal/interfaces/idecorationoptions/))

### 20. CJK/emoji widths
Add `@xterm/addon-unicode11` (new dep → ADR); `term.unicode.activeVersion='11'` fixes **output** alignment (~3 lines). But the editor's cursor math counts `.length` (UTF-16) — `界`=1 unit/2 cells, `😀`=2 units/2 cells — so caret desyncs the moment a wide char is on the line, **independent of the addon**. The second half is the app-layer **cell-width helper** (`[...str]` + a small wide/zero-width table) wired into `handleBackspace/handleDelete/insertPrintable/moveTo*/replaceBuffer`. Both halves required for correct *interactive editing*. This is the same cell-width foundation §"prerequisite" calls out. Defer `addon-unicode-graphemes` (experimental). ([addon-unicode11](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11))

### 21. Jump-to-prompt navigation (Ctrl/Cmd+↑/↓)
**The trap:** `onData` can't see modifier+arrow — wire a **new `attachCustomKeyEventHandler`** matching `keydown && (ctrlKey||metaKey) && ArrowUp/Down`, `preventDefault()`, `return false`. Walk the marker list relative to `buffer.active.viewportY`, `scrollToLine(marker.line)`. With Shift: `selectLines(target, current)` → copy. Pure viewport nav (not history recall — that's plain Up/Down). Guard `undefined` on alt buffer.

### 22. Select-whole-command-output
You already bracket every command (`handleEnter`). Drop `registerMarker()` before `onInput` and after it resolves; store `{startMarker, endMarker, command}`. **Recommended gesture: a gutter decoration as the click target** (`onRender`→DOM element→click→`selectLines(start, end-1)`→copy) — sidesteps the fact that xterm has *no* public mouse-event hook. Prune disposed markers (`line===-1`). ([IMarker](https://xtermjs.org/docs/api/terminal/interfaces/imarker/))

### 23. Syntax highlighting of the command line
"Color the echo" — wrap tokens in SGR truecolor (`\x1b[38;2;R;G;Bm`) in the echo path; first word green/red via injected `resolveCommand` predicate (backed by `Shell.hasCommand`, passed in to avoid the reverse import). **Needs an offset-preserving lexer** — the exec `tokenize` returns expanded values with no source offsets, so write a small separate `{start,end,category}` lexer. Repaint the whole input region per keystroke (`\r`+prompt+recolored+`\x1b[0K`, batched into one `write()`); xterm's WriteBuffer makes this cheap. **Disable in REPL mode** (JS ≠ shell). Inherits the cell-width/wrapped-line repaint requirement — start single-row, narrow-char. ([zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting), [xterm truecolor](https://xtermjs.org/docs/api/vtfeatures/))

### 24. Command palette (Ctrl/Cmd+Shift+P)
95% app-layer Solid overlay; xterm contributes the trigger (`attachCustomKeyEventHandler` or a playground global keydown) and command injection. Needs **additive public methods** `injectLine(text,{run})` + `focus()` passthrough (cross-package → ADR; ~15 LOC reusing `insertPrintable`+`handleEnter`). Blur the hidden `.xterm-helper-textarea` while open or keystrokes leak. Seed from the `Shell.commands` Map + built-in actions (clear, switch theme/mode); ~50-LOC zero-dep fuzzy matcher. Sequence **after** completion + reverse-search. ([Warp command palette](https://docs.warp.dev/terminal/command-palette/), [#757](https://github.com/xtermjs/xterm.js/issues/757))

### 25. Sticky command header
Markers (at `writePrompt`) + `onScroll` math (`viewportY`) + a **DOM overlay** (decorations scroll *with* content, so they can't pin to the top — render your own `position:absolute;top:0` div over `.xterm`, click→`scrollToLine`). Overlay lives in the playground (D-002); terminal exposes `onScroll/getBlocks/scrollToBlock`. Add `role=button`/`aria-label`. Build *after* the boundary-marker infra. ([Warp blocks](https://docs.warp.dev/terminal/blocks/block-basics/))

### 26. Quick-fixes from output (lightbulb)
At the `App.onLine` seam where command+`{exitCode,stdout,stderr}` coexist, a `QuickFixProvider` registry (`{commandLineMatcher, outputMatcher, getActions}`) maps VS Code's set 1:1 (git-no-upstream, did-you-mean, EADDRINUSE→kill+rerun, create-PR URL). Render a lightbulb via `registerMarker`+`registerDecoration` (`onRender`→button→prefill). No OSC 633 needed (rifty has the data directly). Clicking a fix needs a new "prefill/run the buffer" public method → ADR. ([VS Code shell integration](https://code.visualstudio.com/docs/terminal/shell-integration))

---

## Tier 3 — Ambitious / optional

- **Multi-line editing + input validator** (Enter inserts newline when incomplete, Alt+Enter forces): the validator is trivial (reuse `tokenize` quote/op state for shell; a JS parse-probe for REPL); **the cost is rewriting every edit primitive to an offset→(row,col) wrapped-layout model**. Same cursor-math foundation §20/§23 need — do it once. Watch wrap-edge bugs ([#832](https://github.com/xtermjs/xterm.js/issues/832), [#2752](https://github.com/xtermjs/xterm.js/issues/2752)) and re-wrap on resize. ([local-echo](https://github.com/wavesoft/local-echo), [reedline Validator](https://www.nushell.sh/book/line_editor.html))
- **IDE-style autocomplete dropdown (Fig/Amazon Q)**: anchor a `registerDecoration` to the cursor cell, render the list as a portaled `position:fixed` div (decoration `element` is clipped by xterm's `overflow:hidden`). The hard part is the position-aware completion engine + per-command specs (Fig's MIT spec *format* is borrowable, its runtime isn't). Build atop Tier-2 tab-completion. ([withfig/autocomplete](https://github.com/withfig/autocomplete))
- **Command blocks (VS Code subset)**: gutter rail + overview-ruler marks + Cmd/Ctrl+↑/↓ nav + block-copy. **Ship the VS Code model, not Warp/Wave widgets** (see Not-feasible). Use the 1-cell thin-left-rail-per-row workaround for the `#4855` multi-row bg bug.
- **Atuin-style rich history (Ctrl+R overlay, cwd/exit/duration/session)**: a DOM overlay over an in-memory rich record array + OPFS/IndexedDB persistence. rifty captures the metadata *directly* (owns shell+editor) — don't pitch it as "port Atuin" (no SQLite/PTY hooks). ~40-LOC fuzzy matcher beats adding sql.js (1–3MB). ([atuinsh/atuin](https://github.com/atuinsh/atuin), [uFuzzy](https://github.com/leeoniya/uFuzzy))
- **Background blocks (`&` jobs)**: blocked today — `shell.background` throws `NotImplementedError` and the editor is hard-serial (`busy` drops keys). Needs `&` job-spawn + per-job output sink + a job table (jobs/fg/bg/wait/`$!`) + kernel `ProcessManager` surfacing. Sequence **after** pipes (`|`) and input redirect. Prefer app-rendered text blocks over N live xterm instances. ([Warp background blocks](https://docs.warp.dev/terminal/blocks/background-blocks/))
- **Inline images (SIXEL/IIP)**: `@xterm/addon-image` renders, but is **inert without a producer** — build an `img <file>` coreutil that base64-encodes a VFS image into an IIP OSC. IIP > SIXEL. Niche for a shell+REPL. ([addon-image](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-image))
- **AI command suggestions (`#`-prefix)**: terminal side is trivial (reuses §3 ghost-text plumbing); the real cost is endpoint+key+proxy+ADR + constraining the model to rifty's ~13 coreutils. Never auto-run. Opt-in, off-by-default, sequenced last. ([Warp AI](https://docs.warp.dev/features/ai-command-search))
- **State persistence (`@xterm/addon-serialize`)**: restores *visual scrollback* only — not `history`, cwd, env, VFS, or live process. The real persistence (history array + cwd/env to OPFS) is separate app-layer work. ([addon-serialize](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize))
- **Shareable/exportable output (`serializeAsHTML`)**: preserves color; deliver via clipboard-HTML / download / fragment-URL (no Warp permalink — needs a server). Block-boundary tracking is the new code.
- **Mouse reporting (DECSET 1000/1002/1006)**: xterm does the render side for free, but it's **enabling infrastructure with no consumer** — needs a raw-stdin/non-cooked TTY mode in kernel+shell, pays off only once a full-screen TUI runs in the worker. Defer.
- **Other low-priority polish**: undo/redo (ship undo-only first — redo binding is byte-collision-constrained), configurable cursor style (DECSCUSR), OSC 52 clipboard write-through (drop the `?`-query read for security), screen-reader mode (opt-in; collides with Ctrl+R/F), fish abbreviations, command snippets/workflows.

---

## NOT feasible in a browser (don't chase these)

1. **Middle-click X11 PRIMARY-selection paste** — browsers expose exactly one clipboard; the X11 PRIMARY buffer is unreachable. You can fake middle-click from an app-tracked `lastSelection`, but it will *never* paste selections made in other apps.
2. **Warp/Wave "atomic block widgets"** (draggable, collapsible, independently-scrollable per-command windows) — Warp abandoned xterm.js for a custom Rust+Metal renderer *specifically because* a single text grid can't host rich per-command UI; Wave is Electron with a custom block layer. Ship the **VS Code subset** (gutter rail + ruler marks + nav + copy), which *is* native-grade on this stack.
3. **Ligatures on the current renderer** — `registerCharacterJoiner` is honored only by WebGL/canvas; on the DOM renderer the ligatures addon is a silent no-op. The browser-safe rewrite needs **xterm 6 beta** (0.10 stable pulls Node `fs` deps, won't bundle in Vite). The cheap path is CSS `font-feature-settings:"calt"` + a ligature webfont — cosmetic, divisive, low-value for a shell.
4. **Cross-line / cross-wrap regex search** — `@xterm/addon-search` matches per logical row only ([#1654](https://github.com/xtermjs/xterm.js/issues/1654)); JS V8 `RegExp`, **not iTerm2's ICU** — no lookbehind/Unicode-property parity.
5. **Reliable Ctrl+N (history-next) and Ctrl+T (transpose)** — Chrome handles new-window/new-tab above page JS and **ignores `preventDefault`**; these never reach `onData` in a normal tab. Use Ctrl-P + arrows for history; pick a non-reserved chord (or Esc-T) for transpose. Best-effort only in PWA-standalone/Electron.
6. **Hosted share permalinks** (Warp's `app.warp.dev/block/...`) — needs a backend rifty doesn't have. Offer copy-HTML / download / fragment-URL; call it "export", not "permalink".
7. **True OS taskbar progress** (`@xterm/addon-progress` on Windows Terminal/Ghostty) — no browser taskbar to drive; rifty must render its own widget. The addon only *parses* OSC 9;4.

---

## Suggested sequencing for tickets/ADRs

1. **Foundation PR** (no ADR): land the cell-width-correct, wrapped-line cursor model alongside the in-flight cursor-aware editor (ADR-0094). Everything else gets easier and more correct.
2. **Zero-dep line-editor batch** (Tier 1 #1–6, Tier 2 #15–16): prefix search, word motion, autosuggestions, Ctrl+C/copy, mouse-copy, Emacs keymap, kill-ring, Ctrl+R. One ADR for the Emacs-keymap parity change. Highest felt impact, lowest risk.
3. **Boundary-marker substrate** (ADR for the `onInput→exitCode` API change): ships #19 (exit marks) + #9 (scrollbar marks); reused by #21/#22/#25/Tier-3 blocks. One marker model, six features.
4. **Addon drop-ins** (one short ADR each): #7 web-links, #8 OSC 8, #14 webgl, #20 unicode11, #12 contrast (no dep).
5. **Tab completion** (ADR for the `completer` callback) — the capability unlock; then #23 syntax highlighting and #24 palette build on the same seam.
6. **Tier 3** as appetite allows, gated on their stated prerequisites (pipes before background blocks; tab-completion before the IDE dropdown; the cursor-math foundation before multi-line).

Relevant files for every ticket: `packages/terminal/src/terminal.ts` (`buffer`/`cursorPos`, `dispatch`, `writePrompt`, `handleEnter`, `replaceBuffer`), `packages/terminal/src/keys.ts` (`classifyKey` — add cases *before* the `unrecognised-escape`/`control-byte` catch-alls), `apps/playground/src/components/TerminalPanel.tsx` + `adapters/shell-adapter.ts` (host wiring, exit-code plumbing), `packages/shell/src/shell.ts` (`commands` Map, `hasCommand`, `cwd`, the command-not-found site).
