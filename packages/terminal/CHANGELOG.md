# Changelog

## [Unreleased]

### Added

- `RiftyTerminalOptions.onResize(cols, rows)` reports each live xterm grid
  change after fit/explicit resize and detaches with terminal disposal, letting
  hosts propagate real foreground TTY resize (ADR-0225).
- `TerminalState.devCommand` (`{ line, cwd }`) — optional recorded dev-server
  command, round-tripped by the sync + async state stores; validated on parse
  (non-empty line, absolute cwd; malformed → dropped, cwd/env kept).
- `RiftyTerminalOptions.banner` — optional content-agnostic onboarding banner
  printed ONCE on the first `mount()`, before the first prompt. The host owns
  the copy (and any ANSI styling / `\r\n`); this package ships none. Not
  reprinted on `clear`; a fresh terminal instance reprints.
- `RiftyTerminal.snapshotBufferSettled()` — async buffer snapshot that resolves
  only after xterm has parsed every pending write (empty-write settle barrier).
  A synchronous `snapshotBuffer()` taken right after a *final* write can miss it:
  xterm parses on a deferred macrotask. Used by the host's `data-terminal-buffer`
  mirror to fix the CI-only "[vite] dev server ready never appears" e2e flake.
- `RiftyTerminalOptions.lineHeight` — optional xterm line-height multiplier
  forwarded to the renderer (defaults to 1). Lets hosts match designed
  terminal type scales (e.g. 12px/19px).

### Fixed

- No blank row after a command whose output ends in a newline. `writePrompt`
  now re-draws bash-style: the prompt follows the output directly (the output's
  own trailing `\n` already moved to a fresh line), and only prepends a
  separating `\r\n` when the caret is mid-line (empty Enter / non-terminated
  output). Carriage-return-only progress output is not treated as a completed
  line, and Ctrl+C's `^C\r\n` echo updates the prompt tracker. Tracked via
  `atLineStart` (mirrors the async write queue — `buffer.cursorX` lags xterm's
  deferred parse).
- Terminal font no longer renders "strange" (mis-aligned cells) when the
  self-hosted webfont is still loading at `mount()`. xterm measures the glyph
  cell at open time; with `font-display: swap` it measured the fallback, then
  the real font swapped in against a stale grid. `mount()` now re-measures on
  `document.fonts.ready` and re-fits.
- Empty Enter in line mode now submits the blank shell line but redraws the next
  prompt without appending an extra blank row.
- `RiftyTerminal.dispose()` now treats addon/xterm teardown as best-effort. A
  WebGL addon dispose failure no longer escapes into the host framework and
  leaves UI updates half-applied.
- OSC 52 output is now stripped from rendered terminal text without writing the
  host clipboard unless `allowOsc52Clipboard` is explicitly enabled on the
  terminal instance. Ctrl+L also restores a mid-line caret after redrawing the
  prompt buffer.

### Added

- Cursor-aware line editing (ADR-0094, user-requested). The line editor tracks a
  caret (`cursorPos`) so you can move it and edit mid-line: ArrowLeft/Right move
  the caret (clamped at the line ends), Home/Ctrl+A jump to the start, End/Ctrl+E
  to the end, Delete (`\x1b[3~`) forward-deletes the char at the caret, Backspace
  deletes before it, and printable input inserts at the caret. Previously the
  editor was append-only and ArrowLeft/Right were swallowed (so `abc`,←,←,`X`
  yielded `abcX`; now `aXbc`). `keys.ts` classifies Home (`\x1b[H`/`\x1b[1~`/
  `\x1bOH`), End (`\x1b[F`/`\x1b[4~`/`\x1bOF`), Delete (`\x1b[3~`), Ctrl+A, Ctrl+E.
  History recall now clears the whole visible line even when the caret is mid-line
  and resets the caret to the end.

- Cell-width-aware edit math (ADR-0096). The line editor still stores
  `cursorPos` as a string offset, but cursor motion, erase, and mid-line repaint
  now use display-cell widths over small grapheme-ish edit segments. CJK and
  emoji glyphs move/erase as two cells instead of one UTF-16 code unit, and
  combining marks stay attached to their base during Backspace/Delete.
  Full wrapped-row editing remains deferred.

- Readline-style history/word navigation (ADR-0096). ArrowUp/Down with a
  non-empty buffer at the end of the line now searches command history by that
  prefix; unmatched prefixes stay intact and empty-prefix history keeps its
  previous chronological behavior. Ctrl+Left/Right and Alt+B/F move by
  shell-ish words using the same cell-width-aware cursor math.
- Fish/readline-style editor aids (ADR-0096): a dim autosuggestion suffix from
  the newest matching history entry appears at end-of-line and Right/End accepts
  it; Ctrl+U/Ctrl+K/Ctrl+W cut into an editor-local kill ring and Ctrl+Y yanks;
  Ctrl+R opens reverse history search, repeated Ctrl+R walks older matches,
  Enter accepts, and Ctrl+G/Esc restores the original buffer.
- Ctrl+C copy-vs-SIGINT disambiguation (ADR-0096). `RiftyTerminal` now installs
  an xterm custom key handler: Ctrl+C/Ctrl+Shift+C (and Cmd+C on macOS) copies a
  non-empty terminal selection through `navigator.clipboard` and suppresses ETX;
  Ctrl+C with no selection still flows through xterm and emits SIGINT as before.
- Emacs/readline key aliases (ADR-0096): Ctrl+B/F move left/right, Ctrl+P/N walk
  history, Ctrl+D forward-deletes, Ctrl+L clears/redraws the current prompt, and
  Ctrl+T transposes adjacent edit segments.
- Alt-tier kill-ring keys (ADR-0096): `macOptionIsMeta` is now exposed through
  `RiftyTerminalOptions`; Alt+D kills the word to the right, Alt+Backspace kills
  the word to the left, and Alt+Y rotates the most recent yank through the local
  kill ring.
- Bracketed paste policy (ADR-0096): line-mode terminal sets xterm's
  `ignoreBracketedPasteMode` and strips pasted `\x1b[200~...\x1b[201~` wrappers
  before they can enter the command buffer.
- Line-edit undo (ADR-0096): Ctrl+_ and delivered Ctrl+Z restore the previous
  editor buffer/cursor snapshot for inserts, deletes, kills, yanks, suggestions,
  and transpose. Redo remains deferred.
- Tab completion seam (ADR-0104): `RiftyTerminalOptions.completer(line, cursor)`
  lets hosts return a replacement range + items. Tab applies a unique match,
  extends to the longest common prefix, or prints a simple completion menu.
- Terminal polish options API (ADR-0098): `RiftyTerminalOptions` now accepts
  `theme`, `fontFamily`, `fontSize`, `minimumContrastRatio`,
  `screenReaderMode`, `cursorStyle`, `copyOnSelect`, and a testable `clipboard`
  port. `minimumContrastRatio` defaults to 4.5. New `setTheme()` and `focus()`
  methods let the playground theme/focus terminal without importing xterm.
- Command marker substrate (ADR-0100): submitted commands are tracked as
  `TerminalCommandBlock`s with xterm markers at command start/end. `onInput` may
  now return an exit code; returned codes drive best-effort status decorations
  and overview-ruler marks. New `getCommandBlocks()`, `scrollToBlock()`,
  `selectBlockOutput()`, `copyBlockOutput()`, `jumpBlockPrev()`, and
  `jumpBlockNext()` helpers expose the history model needed for richer terminal
  UX. Ctrl/Cmd+Up/Down jump between recorded command blocks;
  Ctrl/Cmd+Shift+Up/Down select the previous/next command block output range.
- xterm addon drop-ins (ADR-0105): `RiftyTerminal` now loads official xterm
  addons for Ctrl/Cmd-gated web links, search helpers, best-effort WebGL
  rendering, Unicode 11 output widths, inline image protocols, and scrollback
  serialization. New `findNext()`, `findPrevious()`, `clearSearch()`,
  `serializeText()`, and `serializeHtml()` wrappers keep hosts off xterm
  internals.
- Host line injection (ADR-0104): `replaceLine()` redraws the current prompt
  buffer from host UI, and `submitLine()` optionally replaces before running
  through the same Enter path as user input. Command palettes and quick fixes can
  now prefill/submit without touching xterm internals.
- IDE autocomplete host seam (ADR-0104): `onEditStateChange` reports the current
  editable line/cursor to hosts, and `replaceLine(line, cursor?)` can restore the
  caret inside the injected line.
- Line-edit redo (ADR-0096): Ctrl/Cmd+Shift+Z is caught at xterm's DOM key
  handler and replays the latest undone edit. New edits, Enter, and Ctrl+C clear
  redo history.
- Viewport command-header seam (ADR-0100): `getViewportLine()`,
  `onViewportChange`, and `onCommandBlocksChange` let host UI build sticky
  command headers from public command-block state.
- OSC 52 clipboard writes (ADR-0105): terminal output may request a clipboard
  write with bounded OSC 52 payloads; readback requests are stripped and ignored.
- Wrapped-line cursor layout (ADR-0096): long line edits now map buffer offsets
  to prompt-relative visual rows/columns, so movement, mid-line repaint, Delete,
  and history recall stay coherent after the input crosses terminal `cols`.
- OSC 8 link handling (ADR-0105): xterm OSC 8 hyperlinks now route through the
  host-owned `webLinks.onLink` seam with the same Ctrl/Cmd modifier policy as
  detected web links; non-HTTP protocols are enabled only for that host seam.
- Command-line highlighting seam (ADR-0096): hosts may provide
  `highlighter(line)` spans with truecolor foregrounds. The terminal renders
  editable input with SGR while keeping `cursorPos` and submitted lines raw.
- Multiline input validator (ADR-0096): hosts may provide
  `inputValidator(line, cursor)`. Enter inserts an undoable newline while input
  is incomplete and submits the raw multiline buffer once complete.
- Abbreviations/snippets (ADR-0096): hosts may provide
  `rewriteRules` trigger/replacement pairs. Space expands the trigger token and
  keeps editing; Enter expands before submit; the rewrite is undoable.
- Ghost suggestions (ADR-0120): hosts may provide
  `ghostSuggestion(state, signal)` for async dim completions. Right/End/Ctrl+E
  accepts by replacing the editable line; Enter still submits the literal line.
- Async output repaint (ADR-0121): `.write()` now protects an active editable
  prompt by clearing/redrawing the line around host output, so background job
  completion text does not corrupt the command being typed.
- Raw stdin forwarding (ADR-0122): while a command is running,
  `RiftyTerminalOptions.onRawInput` receives non-Ctrl+C `onData` payloads and
  xterm `onBinary` bytes, enabling foreground TUI input such as mouse reports.

- `RiftyTerminal` exposes `cols`/`rows` getters so the host can forward the live
  terminal size into the shell's `ctx.cols`/`ctx.rows` (drives `ls` column layout).
  Review pass 2026-06-07.

- `RiftyTerminal` wrapper over xterm.js: mount/dispose, `write`, `writeError` with ANSI red, line-based `onInput`, history (up/down).
- `applyAnsi`/`writeWithStream` helpers to colour stdout (default) and stderr (red).
- `RiftyTerminalOptions.onSignal('SIGINT')` callback so the host can route Ctrl+C to a kernel `processHandle.kill('SIGINT')` capability. The terminal still local-echoes `^C\r\n` itself before invoking the callback, matching kernel-TTY behaviour.
- `classifyKey(data)` helper in `keys.ts` exposing the byte→event mapping as a pure function — driven by unit tests for every key form (Enter, Backspace, Tab, arrows, Ctrl+C, multi-line paste, CSI-injection guard).
- `RiftyTerminal.handleInput(data)` is currently `public` (still the same code path xterm `onData` routes through) so unit tests can drive it without a DOM. Privatisation deferred — see A-041 (REVIEW_ACTIONS.md): swap to `private handleInput` + `onHandleInput?` option requires rewriting `terminal.test.ts`'s ~30 direct-call sites to await a callback, which is out of scope for the current "don't break the test suite" pass. Tracked for a dedicated test-rewrite session.

### Fixed

- Arrow keys and Ctrl+C: the byte literals in `handleData` were stored as raw bytes that an editor could easily strip on save. Replaced with explicit `\x1b[A`/`\x1b[B`/`\x1b[C`/`\x1b[D`/`\x03`/`\x7f` escape sequences via the pure `classifyKey` classifier. (Was a 🔴 silent stub per the 2026-05-25 review.)
- Ctrl+C is now processed even while `busy=true` — previously the busy guard at the top of `handleData` blocked ALL keystrokes including the very signal you need to interrupt the running command.
- Ctrl+C now emits a SIGINT signal via `onSignal` instead of only echoing `^C` locally.
- Multi-line paste (containing embedded `\n`) is now appended to the line buffer correctly. Previously the `charCodeAt(0) < 32` filter at the top of `handleData` dropped the entire paste because it started with a printable char but the filter only inspected the FIRST byte. Replaced with a per-byte whitelist (`\n`, `\r`, `\t` allowed; ESC sequences inside a paste are stripped wholesale to prevent CSI injection).
- `mount()` now lazily constructs `FitAddon` instead of eagerly in the constructor, so `RiftyTerminal` is constructible in a plain Node environment (the addon's IIFE references `self`).
