import { FitAddon } from '@xterm/addon-fit';
import { type IImageAddonOptions, ImageAddon } from '@xterm/addon-image';
import { type ISearchOptions, SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  type IDisposable,
  type ILinkHandler,
  type IMarker,
  type ITerminalAddon,
  type ITerminalOptions,
  type ITheme,
  Terminal,
} from '@xterm/xterm';
import { classifyClipboardKey } from './clipboard-keys.ts';
import { classifyCommandNavKey } from './command-nav-keys.ts';
import { isEditRedoKey } from './edit-redo-keys.ts';
import { type KeyEvent, classifyKey } from './keys.ts';
import { extractOsc52Writes } from './osc52.ts';
import type { TerminalStream } from './types.ts';

const ANSI_RED = '\x1b[31m';
const ANSI_GREY = '\x1b[90m';
const ANSI_DIM = '\x1b[2m';
const ANSI_DIM_OFF = '\x1b[22m';
const ANSI_RESET = '\x1b[0m';
const PROMPT = `${ANSI_GREY}> ${ANSI_RESET}`;
const PROMPT_CELLS = 2;
const CURSOR_RIGHT = '\x1b[C';
const CURSOR_UP = '\x1b[A';
const CURSOR_DOWN = '\x1b[B';
const CLEAR_TO_EOL = '\x1b[K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const SEARCH_DECORATIONS = {
  matchBackground: '#264f78',
  matchBorder: '#6cb6ff',
  matchOverviewRuler: '#6cb6ff',
  activeMatchBackground: '#9e6a03',
  activeMatchBorder: '#f2cc60',
  activeMatchColorOverviewRuler: '#f2cc60',
} satisfies NonNullable<ISearchOptions['decorations']>;

interface ReverseSearchState {
  readonly originalBuffer: string;
  readonly originalCursorPos: number;
  query: string;
  matchIdx: number;
}

interface YankState {
  readonly start: number;
  readonly end: number;
  readonly ringIdx: number;
}

interface EditSnapshot {
  readonly buffer: string;
  readonly cursorPos: number;
}

export interface TerminalCommandBlock {
  readonly id: number;
  readonly command: string;
  readonly exitCode?: number;
  readonly startLine: number;
  readonly endLine: number;
}

export interface TerminalEditState {
  readonly line: string;
  readonly cursor: number;
}

export interface TerminalGhostSuggestionState extends TerminalEditState {}

export interface TerminalGhostSuggestion {
  readonly display: string;
  readonly replacement: string;
}

export type TerminalGhostSuggestionProvider = (
  state: TerminalGhostSuggestionState,
  signal: AbortSignal,
) => TerminalGhostSuggestion | null | Promise<TerminalGhostSuggestion | null>;

export interface TerminalRewriteRule {
  readonly trigger: string;
  readonly replacement: string;
  readonly description?: string;
}

export type TerminalInputResult = number | undefined;

export type TerminalInputHandler =
  | ((line: string) => TerminalInputResult | Promise<TerminalInputResult>)
  | ((line: string) => void);

export interface TerminalCompletionItem {
  readonly value: string;
  readonly display?: string;
}

export interface TerminalCompletionResult {
  readonly start: number;
  readonly end: number;
  readonly items: readonly TerminalCompletionItem[];
}

export type TerminalCompleter = (
  line: string,
  cursor: number,
) => TerminalCompletionResult | null | Promise<TerminalCompletionResult | null>;

export interface TerminalHighlightSpan {
  readonly start: number;
  readonly end: number;
  readonly foreground: `#${string}`;
}

export type TerminalLineHighlighter = (line: string) => readonly TerminalHighlightSpan[];

export type TerminalInputValidation = 'complete' | 'incomplete';

export type TerminalInputValidator = (line: string, cursor: number) => TerminalInputValidation;

export type TerminalRawInput = string | Uint8Array;

export interface TerminalBusyInputEvent {
  readonly data: TerminalRawInput;
  readonly binary: boolean;
}

export interface TerminalWebLinksOptions {
  /** Require Ctrl/Cmd when opening a detected URL. Defaults to true. */
  readonly requireModifier?: boolean;
  /** Host-owned opener. Defaults to `window.open(uri, '_blank', 'noopener,noreferrer')`. */
  readonly onLink?: (uri: string, event: MouseEvent) => void;
}

function webLinksOptions(
  webLinks: boolean | TerminalWebLinksOptions | undefined,
): TerminalWebLinksOptions {
  return typeof webLinks === 'object' ? webLinks : {};
}

function shouldOpenTerminalLink(event: MouseEvent, options: TerminalWebLinksOptions): boolean {
  return !(options.requireModifier ?? true) || event.ctrlKey || event.metaKey;
}

function openTerminalLink(uri: string, event: MouseEvent, options: TerminalWebLinksOptions): void {
  if (!shouldOpenTerminalLink(event, options)) return;
  if (options.onLink) {
    options.onLink(uri, event);
    return;
  }
  globalThis.window?.open(uri, '_blank', 'noopener,noreferrer');
}

function createOsc8LinkHandler(
  webLinks: boolean | TerminalWebLinksOptions | undefined,
): ILinkHandler | null {
  if (webLinks === false) return null;
  const options = webLinksOptions(webLinks);
  return {
    allowNonHttpProtocols: Boolean(options.onLink),
    activate: (event, text) => openTerminalLink(text, event, options),
  };
}

export interface TerminalSearchAddonOptions {
  /** Max highlighted matches when search decorations are enabled. Defaults to xterm's 1000. */
  readonly highlightLimit?: number;
}

export interface TerminalSearchOptions {
  readonly regex?: boolean;
  readonly wholeWord?: boolean;
  readonly caseSensitive?: boolean;
  readonly incremental?: boolean;
}

export interface TerminalWebglOptions {
  readonly preserveDrawingBuffer?: boolean;
}

export type TerminalImageOptions = IImageAddonOptions;

export interface TerminalSerializeOptions {
  readonly scrollback?: number;
  readonly excludeModes?: boolean;
  readonly excludeAltBuffer?: boolean;
}

export interface TerminalSerializeHtmlOptions {
  readonly scrollback?: number;
  readonly onlySelection?: boolean;
  readonly includeGlobalBackground?: boolean;
}

interface MutableCommandBlock {
  readonly id: number;
  readonly command: string;
  exitCode?: number;
  readonly startMarker: IMarker;
  endMarker?: IMarker;
}

interface LineSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly cells: number;
}

function codePointSize(value: string, offset: number): number {
  const code = value.codePointAt(offset);
  return code != null && code > 0xffff ? 2 : 1;
}

function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isVariationSelector(code: number): boolean {
  return (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef);
}

function isWideCodePoint(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f000 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}

function segmentCellWidth(text: string): number {
  let cells = 0;
  for (let i = 0; i < text.length; i += codePointSize(text, i)) {
    const code = text.codePointAt(i) ?? 0;
    if (code === 0x200d || isCombiningMark(code) || isVariationSelector(code)) continue;
    if (code === 0x09 || code === 0x0a) {
      cells += 1;
      continue;
    }
    cells += isWideCodePoint(code) ? 2 : 1;
  }
  return Math.max(cells, text.length > 0 ? 1 : 0);
}

function lineSegments(value: string): LineSegment[] {
  const segments: LineSegment[] = [];
  for (let i = 0; i < value.length; ) {
    const start = i;
    i += codePointSize(value, i);
    while (i < value.length) {
      const code = value.codePointAt(i) ?? 0;
      if (isCombiningMark(code) || isVariationSelector(code)) {
        i += codePointSize(value, i);
        continue;
      }
      if (code === 0x200d && i + codePointSize(value, i) < value.length) {
        i += codePointSize(value, i);
        i += codePointSize(value, i);
        continue;
      }
      break;
    }
    const text = value.slice(start, i);
    segments.push({ start, end: i, text, cells: segmentCellWidth(text) });
  }
  return segments;
}

function previousSegment(value: string, offset: number): LineSegment | null {
  let prev: LineSegment | null = null;
  for (const segment of lineSegments(value)) {
    if (segment.end > offset) break;
    prev = segment;
  }
  return prev;
}

function nextSegment(value: string, offset: number): LineSegment | null {
  for (const segment of lineSegments(value)) {
    if (segment.end <= offset) continue;
    return segment;
  }
  return null;
}

function cellWidth(value: string): number {
  return lineSegments(value).reduce((sum, segment) => sum + segment.cells, 0);
}

function cursorLeft(cells: number): string {
  return '\b'.repeat(Math.max(0, cells));
}

function cursorRight(cells: number): string {
  return CURSOR_RIGHT.repeat(Math.max(0, cells));
}

function hexToRgb(
  hex: `#${string}`,
): { readonly r: number; readonly g: number; readonly b: number } | null {
  const full = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (!full) return null;
  const raw = full[1] ?? '';
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function foregroundSgr(hex: `#${string}`): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

function renderHighlightedLine(
  line: string,
  highlighter: TerminalLineHighlighter | undefined,
): string {
  if (!highlighter || line.length === 0) return line;
  const spans = highlighter(line)
    .map((span) => ({
      start: Math.max(0, Math.min(span.start, line.length)),
      end: Math.max(0, Math.min(span.end, line.length)),
      sgr: foregroundSgr(span.foreground),
    }))
    .filter((span) => span.end > span.start && span.sgr.length > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let pos = 0;
  for (const span of spans) {
    if (span.start < pos) continue;
    out += line.slice(pos, span.start);
    out += `${span.sgr}${line.slice(span.start, span.end)}\x1b[39m`;
    pos = span.end;
  }
  return `${out}${line.slice(pos)}`;
}

interface CursorPosition {
  readonly row: number;
  readonly col: number;
}

function layoutCols(cols: number): number {
  return Math.max(1, cols);
}

function cursorPositionForOffset(buffer: string, offset: number, cols: number): CursorPosition {
  const safeCols = layoutCols(cols);
  let row = 0;
  let col = PROMPT_CELLS;
  for (const segment of lineSegments(buffer.slice(0, offset))) {
    if (segment.text === '\n') {
      row++;
      col = 0;
      continue;
    }
    const cells = col + segment.cells;
    row += Math.floor(cells / safeCols);
    col = cells % safeCols;
  }
  return { row, col };
}

function cursorMovePosition(from: CursorPosition, to: CursorPosition): string {
  let out = '\r';
  const rows = to.row - from.row;
  if (rows < 0) out += CURSOR_UP.repeat(-rows);
  if (rows > 0) out += CURSOR_DOWN.repeat(rows);
  if (to.col > 0) out += cursorRight(to.col);
  return out;
}

function cursorMoveByOffset(buffer: string, from: number, to: number, cols: number): string {
  if (from === to) return '';
  return cursorMovePosition(
    cursorPositionForOffset(buffer, from, cols),
    cursorPositionForOffset(buffer, to, cols),
  );
}

function wrappedRows(buffer: string, cols: number): number {
  return cursorPositionForOffset(buffer, buffer.length, cols).row;
}

function spansWrappedRows(buffer: string, cols: number): boolean {
  return wrappedRows(buffer, cols) > 0;
}

function clearWrappedInputRegion(buffer: string, cols: number): string {
  const rows = wrappedRows(buffer, cols);
  if (rows === 0) return CLEAR_TO_EOL;
  let out = CLEAR_TO_EOL;
  for (let row = 0; row < rows; row++) {
    out += `${CURSOR_DOWN}\r${CLEAR_TO_EOL}`;
  }
  return `${out}${cursorMovePosition({ row: rows, col: 0 }, { row: 0, col: PROMPT_CELLS })}`;
}

function isWhitespaceSegment(segment: LineSegment): boolean {
  return /^\s+$/u.test(segment.text);
}

function isWordSegment(segment: LineSegment): boolean {
  return /^[\p{L}\p{M}\p{N}_]+$/u.test(segment.text);
}

function isMacPlatform(): boolean {
  const platform = globalThis.navigator?.platform ?? '';
  return /\bMac|iPhone|iPad|iPod\b/i.test(platform);
}

function commonPrefix(values: readonly string[]): string {
  const first = values[0] ?? '';
  let end = first.length;
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < end && i < value.length && first[i] === value[i]) i++;
    end = i;
  }
  return first.slice(0, end);
}

function latin1Bytes(data: string): Uint8Array {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
  return bytes;
}

export interface RiftyTerminalOptions {
  /** Called once per Enter with the buffered line (no trailing CR/LF). */
  onInput: TerminalInputHandler;
  /**
   * Called on Ctrl+C. Host wires this to the kernel's
   * `processHandle.kill('SIGINT')` for the process consuming stdin.
   *
   * The terminal echoes `"^C\r\n"` itself (TTY-style: echo before signal
   * delivery), so the host only emits the signal. If omitted, Ctrl+C
   * still echoes and resets the buffer but emits no signal — for
   * REPL-only mode with no child process to kill.
   */
  onSignal?(signal: 'SIGINT'): void;
  /** Raw stdin bytes received while a foreground command is running. */
  onRawInput?(data: TerminalRawInput): void;
  /** Called after xterm changes its character-cell grid (fit or explicit resize). */
  onResize?(cols: number, rows: number): void;
  /**
   * Called when editable terminal input is redirected to a running foreground
   * command instead of becoming a new command line.
   */
  onBusyInput?(event: TerminalBusyInputEvent): void;
  /** Host-owned completion source. Terminal owns rendering/application only. */
  completer?: TerminalCompleter;
  /** Host-owned editable-input highlighter. Spans use raw line offsets. */
  highlighter?: TerminalLineHighlighter;
  /** Host-owned Enter policy. `'incomplete'` inserts an undoable newline. */
  inputValidator?: TerminalInputValidator;
  /** Called after editable line or caret changes. */
  onEditStateChange?(state: TerminalEditState): void;
  /** Host-owned ghost text. Accept replaces the editable line, never submits. */
  ghostSuggestion?: TerminalGhostSuggestionProvider;
  /** Host-owned fish-style abbreviations/snippets. */
  rewriteRules?: readonly TerminalRewriteRule[];
  /**
   * Content-agnostic onboarding banner printed ONCE on the first {@link mount},
   * before the first prompt. The host owns the copy (and any ANSI styling /
   * `\r\n` line breaks); this package ships none. Not reprinted on `clear`; a
   * fresh terminal instance reprints it.
   */
  banner?: string;
  /** Called when xterm scrolls the viewport. */
  onViewportChange?(line: number): void;
  /** Called when command block markers are added or updated. */
  onCommandBlocksChange?(blocks: readonly TerminalCommandBlock[]): void;
  /** xterm theme override. Defaults to rifty's dark console palette. */
  theme?: ITheme;
  /** xterm font family override. */
  fontFamily?: string;
  /** xterm font size override. Defaults to 13. */
  fontSize?: number;
  /** xterm line-height multiplier override (e.g. 19/12). Defaults to xterm's 1. */
  lineHeight?: number;
  /** xterm cursor style override. */
  cursorStyle?: ITerminalOptions['cursorStyle'];
  /** xterm macOS Option-as-Meta. Defaults to false. */
  macOptionIsMeta?: boolean;
  /** xterm screen reader mode. Defaults to false. */
  screenReaderMode?: boolean;
  /** xterm contrast lift. Defaults to 4.5 for WCAG-AA legibility. */
  minimumContrastRatio?: number;
  /** Copy non-empty selections as soon as xterm reports them. Best effort. */
  copyOnSelect?: boolean;
  /** Clipboard port for browser writes and tests. Defaults to `navigator.clipboard`. */
  clipboard?: { writeText(text: string): void | Promise<void> };
  /** Allow OSC 52 output to write the host clipboard. Defaults to false. */
  allowOsc52Clipboard?: boolean;
  /** Detect web URLs. Default opens only on Ctrl/Cmd-click. */
  webLinks?: boolean | TerminalWebLinksOptions;
  /** Enable in-terminal scrollback search wrappers. Defaults to true. */
  search?: boolean | TerminalSearchAddonOptions;
  /** Enable best-effort WebGL renderer after mount. Defaults to true. */
  webgl?: boolean | TerminalWebglOptions;
  /** Enable xterm Unicode 11 width tables for output. Defaults to true. */
  unicode11?: boolean;
  /** Enable SIXEL / iTerm inline image protocols. Defaults to true. */
  inlineImages?: boolean | TerminalImageOptions;
  /** Enable terminal scrollback serialization helpers. Defaults to true. */
  serialize?: boolean;
}

/**
 * Thin line-mode wrapper over xterm.js. Keeps history (up/down arrows),
 * echoes typed characters, emits one full line per Enter to `onInput`,
 * and emits `SIGINT` on Ctrl+C via `onSignal`.
 *
 * Framework-agnostic: knows nothing about Solid/React/etc.
 *
 * Construction does not touch the DOM — only {@link mount} does. This
 * keeps the class testable in a plain Node environment.
 */
export class RiftyTerminal {
  private readonly term: Terminal;
  private fit: FitAddon | null = null;
  /** Set once the onboarding banner has printed (first mount); never reprinted. */
  private bannerPrinted = false;
  private readonly opts: RiftyTerminalOptions;
  private readonly clipboard?: { writeText(text: string): void | Promise<void> };
  private readonly disposables: IDisposable[] = [];
  private readonly selectionListeners: Array<() => void> = [];
  private searchAddon: SearchAddon | null = null;
  private serializeAddon: SerializeAddon | null = null;
  private webglAddon: WebglAddon | null = null;
  private commandSeq = 0;
  private readonly commandBlocks: MutableCommandBlock[] = [];
  private buffer = '';
  /** Caret index into `buffer`, 0..buffer.length. Insert/delete happen here. */
  private cursorPos = 0;
  private history: string[] = [];
  private historyIdx = 0;
  private historySearch: { prefix: string; idx: number } | null = null;
  private suggestion: TerminalGhostSuggestion | null = null;
  private suggestionSeq = 0;
  private suggestionAbort: AbortController | null = null;
  private killRing: string[] = [];
  private lastYank: YankState | null = null;
  private readonly undoStack: EditSnapshot[] = [];
  private readonly redoStack: EditSnapshot[] = [];
  private reverseSearch: ReverseSearchState | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private promptActive = false;
  private busy = false;
  private disposed = false;
  /** Tracks whether the cursor is at column 0 (last output ended in a line
   *  break) so {@link writePrompt} re-draws bash-style — no blank row when the
   *  command's own output already ended the line. Mirrors the write queue
   *  synchronously (xterm `write()` is async, so `buffer.cursorX` lags). */
  private atLineStart = false;

  constructor(opts: RiftyTerminalOptions) {
    this.opts = opts;
    this.clipboard = opts.clipboard ?? globalThis.navigator?.clipboard;
    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: opts.fontFamily ?? 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: opts.fontSize ?? 13,
      lineHeight: opts.lineHeight ?? 1,
      theme: opts.theme ?? { background: '#0f1115', foreground: '#e6e6e6' },
      convertEol: true,
      minimumContrastRatio: opts.minimumContrastRatio ?? 4.5,
      screenReaderMode: opts.screenReaderMode,
      cursorStyle: opts.cursorStyle,
      macOptionIsMeta: opts.macOptionIsMeta,
      ignoreBracketedPasteMode: true,
      linkHandler: createOsc8LinkHandler(opts.webLinks),
      overviewRulerWidth: 8,
    });
    this.term.onData((data) => {
      void this.handleInput(data);
    });
    this.term.onBinary((data) => {
      this.handleBinaryInput(data);
    });
    this.disposables.push(this.term.onResize(({ cols, rows }) => this.opts.onResize?.(cols, rows)));
    this.disposables.push(this.term.onScroll((line) => this.opts.onViewportChange?.(line)));
    this.loadConstructorAddons();
    this.term.attachCustomKeyEventHandler((event) => {
      if (isEditRedoKey(event)) {
        event.preventDefault();
        this.redoLastEdit();
        return false;
      }
      const navAction = classifyCommandNavKey(event);
      if (navAction !== 'ignore') {
        event.preventDefault();
        if (navAction === 'jump-prev') this.jumpBlockPrev();
        if (navAction === 'jump-next') this.jumpBlockNext();
        if (navAction === 'select-prev') this.selectBlockPrev();
        if (navAction === 'select-next') this.selectBlockNext();
        return false;
      }
      const selection = this.term.getSelection();
      const action = classifyClipboardKey(event, {
        hasSelection: selection.length > 0,
        isMac: isMacPlatform(),
      });
      if (action === 'copy-selection') {
        event.preventDefault();
        this.writeClipboard(selection);
        this.term.clearSelection();
        return false;
      }
      return true;
    });
    if (opts.copyOnSelect) {
      const copySelection = () => {
        const selection = this.term.getSelection();
        if (selection.length === 0) return;
        this.writeClipboard(selection);
      };
      this.selectionListeners.push(copySelection);
      this.disposables.push(this.term.onSelectionChange(copySelection));
    }
  }

  mount(element: HTMLElement): void {
    this.term.open(element);
    // FitAddon reads parentElement.getComputedStyle — only valid once
    // attached to a real DOM.
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.loadWebglAddon();
    this.fit.fit();
    // xterm measures the glyph cell at open() time. With a self-hosted webfont
    // (font-display: swap) that is still loading, it measures the FALLBACK →
    // wrong cell width → the real font swaps in mis-aligned ("strange"). Re-measure
    // once fonts settle so the grid matches the font actually painted.
    this.remeasureFontOnLoad();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fit?.fit());
      this.resizeObserver.observe(element);
    }
    // Onboarding banner once, before the first prompt (host owns the copy). Not
    // reprinted on `clear`; a fresh instance reprints. writePrompt's leading
    // `\r\n` separates it from the prompt, so the banner carries no trailing one.
    if (this.opts.banner && !this.bannerPrinted) {
      this.term.write(this.opts.banner);
      this.atLineStart = /[\n\r]$/.test(this.opts.banner);
      this.bannerPrinted = true;
    }
    this.writePrompt();
  }

  /**
   * Force xterm to re-measure the glyph cell once the terminal font has loaded.
   * Reassigning `fontFamily` fires the options-change path that re-runs the char
   * size measurement with the now-available webfont; `fit()` then re-derives
   * rows/cols. No-op outside a browser (no `document.fonts`).
   */
  private remeasureFontOnLoad(): void {
    const fonts = globalThis.document?.fonts;
    if (!fonts?.ready) return;
    void fonts.ready.then(() => {
      if (this.disposed) return;
      const family = this.term.options.fontFamily;
      if (family) {
        // Toggle to a different-but-equivalent value and back so the change
        // fires even if the options proxy guards against equal assignments.
        this.term.options.fontFamily = `${family}, monospace`;
        this.term.options.fontFamily = family;
      }
      this.fit?.fit();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    for (const disposable of this.disposables.splice(0)) this.safeDispose(disposable);
    this.safeDispose(this.term);
  }

  setTheme(theme: ITheme): void {
    this.term.options.theme = { ...theme };
  }

  focus(): void {
    this.term.focus();
  }

  replaceLine(line: string, cursor = line.length): void {
    const nextCursor = Math.max(0, Math.min(cursor, line.length));
    this.renderBuffer(line, nextCursor);
    this.resetEditState();
    this.redoStack.length = 0;
    this.renderSuggestion();
    this.term.focus();
  }

  redoLastEdit(): void {
    const snapshot = this.redoStack.pop();
    if (snapshot == null) return;
    this.undoStack.push({ buffer: this.buffer, cursorPos: this.cursorPos });
    if (this.undoStack.length > 128) this.undoStack.shift();
    this.restoreSnapshot(snapshot);
  }

  async submitLine(line?: string): Promise<void> {
    if (line != null) this.replaceLine(line);
    await this.handleEnter();
  }

  findNext(term: string, options: TerminalSearchOptions = {}): boolean {
    if (term.length === 0) {
      this.clearSearch();
      return false;
    }
    return this.requireSearchAddon().findNext(term, {
      ...options,
      decorations: SEARCH_DECORATIONS,
    });
  }

  findPrevious(term: string, options: TerminalSearchOptions = {}): boolean {
    if (term.length === 0) {
      this.clearSearch();
      return false;
    }
    return this.requireSearchAddon().findPrevious(term, {
      ...options,
      decorations: SEARCH_DECORATIONS,
    });
  }

  clearSearch(): void {
    this.searchAddon?.clearDecorations();
  }

  serializeText(options: TerminalSerializeOptions = {}): string {
    return this.requireSerializeAddon().serialize(options);
  }

  serializeHtml(options: TerminalSerializeHtmlOptions = {}): string {
    return this.requireSerializeAddon().serializeAsHTML(options);
  }

  /**
   * Stable test/debug text snapshot of the terminal scrollback. Prefer this over
   * renderer DOM internals such as `.xterm-rows`, which are absent with canvas
   * or WebGL renderers.
   */
  snapshotBuffer(options: TerminalSerializeOptions = { excludeModes: true }): string {
    return this.serializeSnapshot(options);
  }

  /**
   * {@link snapshotBuffer} that resolves only after xterm has parsed every write
   * issued so far. `term.write()` parses on a deferred macrotask, so a snapshot
   * taken synchronously after a *final* write (a dev-server "ready" line with no
   * trailing output) serializes the pre-parse buffer and misses it — the root of
   * the CI-only `data-terminal-buffer` marker flake. xterm fires the `write`
   * callback once its buffer drains past that point, so an empty-write barrier
   * (FIFO after all pending writes) guarantees the snapshot reflects the last
   * write. Resolves `''` if the terminal is disposed before/while draining.
   */
  snapshotBufferSettled(
    options: TerminalSerializeOptions = { excludeModes: true },
  ): Promise<string> {
    if (this.disposed) return Promise.resolve('');
    return new Promise((resolve) => {
      this.term.write('', () => resolve(this.disposed ? '' : this.serializeSnapshot(options)));
    });
  }

  getCommandBlocks(): TerminalCommandBlock[] {
    return this.commandBlocks
      .filter((block) => block.startMarker.line !== -1)
      .map((block) => ({
        id: block.id,
        command: block.command,
        exitCode: block.exitCode,
        startLine: block.startMarker.line,
        endLine: block.endMarker?.line ?? block.startMarker.line,
      }));
  }

  getViewportLine(): number {
    return this.term.buffer.active.viewportY;
  }

  scrollToBlock(id: number): void {
    const block = this.commandBlocks.find((item) => item.id === id);
    if (!block || block.startMarker.line === -1) return;
    this.term.scrollToLine(block.startMarker.line);
  }

  selectBlockOutput(id: number): void {
    const block = this.commandBlocks.find((item) => item.id === id);
    if (!block || block.startMarker.line === -1) return;
    this.term.selectLines(block.startMarker.line, block.endMarker?.line ?? block.startMarker.line);
  }

  /** Select and copy one recorded command block's terminal text. */
  copyBlockOutput(id: number): void {
    this.selectBlockOutput(id);
    const selection = this.term.getSelection();
    if (selection.length === 0) return;
    this.writeClipboard(selection);
  }

  jumpBlockPrev(): void {
    const target = this.relativeCommandBlock('prev');
    if (target) this.term.scrollToLine(target.startLine);
  }

  jumpBlockNext(): void {
    const target = this.relativeCommandBlock('next');
    if (target) this.term.scrollToLine(target.startLine);
  }

  selectBlockPrev(): void {
    const target = this.relativeCommandBlock('prev');
    if (target) this.term.selectLines(target.startLine, target.endLine);
  }

  selectBlockNext(): void {
    const target = this.relativeCommandBlock('next');
    if (target) this.term.selectLines(target.startLine, target.endLine);
  }

  private relativeCommandBlock(direction: 'prev' | 'next'): TerminalCommandBlock | undefined {
    const blocks = this.getCommandBlocks();
    const current = this.term.buffer.active.viewportY;
    if (direction === 'prev') {
      return (
        blocks
          .slice()
          .reverse()
          .find((block) => block.startLine < current) ?? blocks.at(-1)
      );
    }
    return blocks.find((block) => block.startLine > current) ?? blocks[0];
  }

  private emitCommandBlocksChange(): void {
    this.opts.onCommandBlocksChange?.(this.getCommandBlocks());
  }

  private emitEditStateChange(): void {
    this.opts.onEditStateChange?.({ line: this.buffer, cursor: this.cursorPos });
  }

  /** Current terminal width in columns (xterm default 80 before {@link mount}). */
  get cols(): number {
    return this.term.cols;
  }

  /** Current terminal height in rows (xterm default 24 before {@link mount}). */
  get rows(): number {
    return this.term.rows;
  }

  write(data: string, stream: TerminalStream = 'stdout'): void {
    const osc52 = extractOsc52Writes(data);
    if (this.opts.allowOsc52Clipboard) {
      for (const write of osc52.writes) this.writeClipboard(write.text);
    }
    const endedAtLineStart = osc52.text.endsWith('\n');
    const text = osc52.text.replace(/\n/g, '\r\n');
    const rendered = stream === 'stderr' ? `${ANSI_RED}${text}${ANSI_RESET}` : text;
    // Track line-break on the LOGICAL text: the stderr ANSI wrapper ends in a
    // reset sequence, not a newline, so `rendered` would mis-report line start.
    this.writeOutput(rendered, endedAtLineStart);
  }

  writeLine(data: string, stream: TerminalStream = 'stdout'): void {
    this.write(`${data}\n`, stream);
  }

  private loadConstructorAddons(): void {
    this.loadUnicode11Addon();
    this.loadWebLinksAddon();
    this.loadSearchAddon();
    this.loadImageAddon();
    this.loadSerializeAddon();
  }

  private loadAddon(addon: ITerminalAddon): boolean {
    try {
      this.term.loadAddon(addon);
      return true;
    } catch {
      this.safeDispose(addon);
      return false;
    }
  }

  private loadUnicode11Addon(): void {
    if (this.opts.unicode11 === false) return;
    if (!this.loadAddon(new Unicode11Addon())) return;
    this.term.unicode.activeVersion = '11';
  }

  private loadWebLinksAddon(): void {
    const webLinks = this.opts.webLinks ?? true;
    if (webLinks === false) return;
    const options = webLinksOptions(webLinks);
    const addon = new WebLinksAddon((event, uri) => openTerminalLink(uri, event, options));
    this.loadAddon(addon);
  }

  private loadSearchAddon(): void {
    const search = this.opts.search ?? true;
    if (search === false) return;
    const options = typeof search === 'object' ? search : {};
    const addon = new SearchAddon({ highlightLimit: options.highlightLimit });
    if (this.loadAddon(addon)) this.searchAddon = addon;
  }

  private loadImageAddon(): void {
    const inlineImages = this.opts.inlineImages ?? true;
    if (inlineImages === false) return;
    const options = typeof inlineImages === 'object' ? inlineImages : {};
    this.loadAddon(
      new ImageAddon({
        enableSizeReports: false,
        ...options,
      }),
    );
  }

  private loadSerializeAddon(): void {
    if (this.opts.serialize === false) return;
    const addon = new SerializeAddon();
    if (this.loadAddon(addon)) this.serializeAddon = addon;
  }

  private loadWebglAddon(): void {
    const webgl = this.opts.webgl ?? true;
    if (webgl === false || this.webglAddon != null) return;
    const options = typeof webgl === 'object' ? webgl : {};
    const addon = new WebglAddon(options.preserveDrawingBuffer);
    if (!this.loadAddon(addon)) return;
    this.webglAddon = addon;
    this.disposables.push(
      addon.onContextLoss(() => {
        this.safeDispose(addon);
        if (this.webglAddon === addon) this.webglAddon = null;
      }),
    );
  }

  private safeDispose(disposable: { dispose(): void }): void {
    try {
      disposable.dispose();
    } catch {
      /* Addon teardown is best-effort; callers must not be left half-unmounted. */
    }
  }

  private requireSearchAddon(): SearchAddon {
    if (!this.searchAddon) throw new Error('terminal.search unavailable');
    return this.searchAddon;
  }

  private requireSerializeAddon(): SerializeAddon {
    if (!this.serializeAddon) throw new Error('terminal.serialize unavailable');
    return this.serializeAddon;
  }

  private serializeSnapshot(options: TerminalSerializeOptions): string {
    const bufferRows = this.term.buffer.normal.length;
    const includedRows =
      options.scrollback === undefined
        ? bufferRows
        : Math.max(0, Math.min(options.scrollback + this.term.rows, bufferRows));
    // Explicit ranges omit addon's final cursor restore: snapshot text, not replay input.
    return this.requireSerializeAddon().serialize({
      ...options,
      range: { start: bufferRows - includedRows, end: bufferRows - 1 },
    });
  }

  private writeClipboard(text: string): void {
    try {
      void this.clipboard?.writeText(text)?.catch(() => {});
    } catch {
      // Best-effort browser clipboard; never break terminal input.
    }
  }

  private writeOutput(text: string, endedAtLineStart: boolean): void {
    if (this.busy || this.reverseSearch != null || !this.promptActive) {
      this.term.write(text);
      this.atLineStart = endedAtLineStart;
      return;
    }

    const buffer = this.buffer;
    const cursorPos = this.cursorPos;
    this.cancelSuggestion();
    this.suggestion = null;
    this.term.write(cursorMoveByOffset(buffer, cursorPos, 0, this.term.cols));
    this.term.write(clearWrappedInputRegion(buffer, this.term.cols));
    this.term.write(text);
    if (!endedAtLineStart) this.term.write('\r\n');
    this.term.write(`${PROMPT}${this.renderInputBuffer(buffer)}`);
    const tail = buffer.slice(cursorPos);
    if (tail.length > 0) this.term.write(cursorLeft(cellWidth(tail)));
    this.buffer = buffer;
    this.cursorPos = cursorPos;
    // Redraw ends on the prompt + restored input, so the caret is not at col 0.
    this.atLineStart = false;
    this.renderSuggestion();
  }

  writePrompt(): void {
    // No leading CRLF when the previous output already ended the line — a
    // command whose stdout ends in `\n` gets its prompt on the very next row,
    // not after a blank one. Empty Enter / a non-terminated command still gets
    // the separating newline (`atLineStart` is false there).
    this.term.write(`${this.atLineStart ? '' : '\r\n'}${PROMPT}`);
    this.atLineStart = false;
    this.buffer = '';
    this.cursorPos = 0;
    this.promptActive = true;
    this.cancelSuggestion();
    this.reverseSearch = null;
    this.emitEditStateChange();
  }

  /**
   * Process a raw key payload (as delivered by xterm.js `onData`).
   *
   * Public so unit tests can drive the same code path xterm's event
   * pipeline does without needing a real DOM. Production callers should
   * not invoke this directly — let xterm route user input here.
   */
  async handleInput(data: string): Promise<void> {
    const event = classifyKey(data);

    // Ctrl+C runs even when `busy` — SIGINT must interrupt a running
    // command. Other keys are dropped while awaiting `onInput`, matching
    // line-mode TTY behaviour (no overlapping commands).
    if (event.kind === 'ctrl-c') {
      this.handleCtrlC();
      return;
    }

    if (this.busy) {
      this.opts.onRawInput?.(data);
      this.opts.onBusyInput?.({ data, binary: false });
      return;
    }
    this.promptActive = true;

    if (this.reverseSearch != null) {
      await this.dispatchReverseSearch(event);
      return;
    }

    await this.dispatch(event);
  }

  handleBinaryInput(data: string): void {
    if (!this.busy) return;
    const bytes = latin1Bytes(data);
    this.opts.onRawInput?.(bytes);
    this.opts.onBusyInput?.({ data: bytes, binary: true });
  }

  private async dispatch(event: KeyEvent): Promise<void> {
    switch (event.kind) {
      case 'enter':
        await this.handleEnter();
        return;
      case 'backspace':
        this.handleBackspace();
        return;
      case 'arrow-up':
        this.replaceBuffer(this.historyPrev());
        return;
      case 'arrow-down':
        this.replaceBuffer(this.historyNext());
        return;
      case 'arrow-left':
        this.moveLeft();
        return;
      case 'arrow-right':
        if (this.acceptSuggestion()) return;
        this.moveRight();
        return;
      case 'word-left':
        this.moveWordLeft();
        return;
      case 'word-right':
        this.moveWordRight();
        return;
      case 'command-prev':
        this.jumpBlockPrev();
        return;
      case 'command-next':
        this.jumpBlockNext();
        return;
      case 'command-prev-select':
        this.selectBlockPrev();
        return;
      case 'command-next-select':
        this.selectBlockNext();
        return;
      case 'home':
        this.moveToStart();
        return;
      case 'end':
        if (this.acceptSuggestion()) return;
        this.moveToEnd();
        return;
      case 'delete':
        this.handleDelete();
        return;
      case 'kill-before-cursor':
        this.killBeforeCursor();
        return;
      case 'kill-after-cursor':
        this.killAfterCursor();
        return;
      case 'kill-word-left':
        this.killWordLeft();
        return;
      case 'kill-word-right':
        this.killWordRight();
        return;
      case 'yank':
        this.yank();
        return;
      case 'yank-pop':
        this.yankPop();
        return;
      case 'reverse-search':
        this.startReverseSearch();
        return;
      case 'search-cancel':
        return;
      case 'clear-screen':
        this.clearScreen();
        return;
      case 'transpose':
        this.transpose();
        return;
      case 'undo':
        this.undoLastEdit();
        return;
      case 'tab':
        await this.handleTab();
        return;
      case 'printable':
        if (event.text === ' ' && this.applyRewriteAtCursor(' ')) return;
        this.insertPrintable(event.text);
        return;
      case 'ctrl-c':
        // Handled in handleInput before dispatch; unreachable here.
        return;
      case 'ignored':
        return;
    }
  }

  private resetHistorySearch(): void {
    this.historySearch = null;
    this.historyIdx = this.history.length;
  }

  private resetTransientSearch(): void {
    this.resetHistorySearch();
    this.reverseSearch = null;
  }

  private resetEditState(): void {
    this.resetTransientSearch();
    this.lastYank = null;
  }

  private recordUndo(): void {
    this.undoStack.push({ buffer: this.buffer, cursorPos: this.cursorPos });
    if (this.undoStack.length > 128) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private restoreSnapshot(snapshot: EditSnapshot): void {
    this.renderBuffer(snapshot.buffer, snapshot.cursorPos);
    this.resetEditState();
    this.renderSuggestion();
  }

  private needsWrappedRepaint(nextBuffer = this.buffer): boolean {
    return (
      spansWrappedRows(this.buffer, this.term.cols) || spansWrappedRows(nextBuffer, this.term.cols)
    );
  }

  private needsFullInputRepaint(nextBuffer = this.buffer): boolean {
    return this.opts.highlighter != null || this.needsWrappedRepaint(nextBuffer);
  }

  private renderInputBuffer(buffer: string): string {
    return renderHighlightedLine(buffer, this.opts.highlighter).replace(/\n/g, '\r\n');
  }

  private writeCursorMove(nextCursorPos: number): void {
    if (nextCursorPos === this.cursorPos) return;
    if (this.needsWrappedRepaint()) {
      this.term.write(
        cursorMoveByOffset(this.buffer, this.cursorPos, nextCursorPos, this.term.cols),
      );
    } else if (nextCursorPos < this.cursorPos) {
      this.term.write(cursorLeft(cellWidth(this.buffer.slice(nextCursorPos, this.cursorPos))));
    } else {
      this.term.write(cursorRight(cellWidth(this.buffer.slice(this.cursorPos, nextCursorPos))));
    }
    this.cursorPos = nextCursorPos;
    this.emitEditStateChange();
  }

  private renderBuffer(nextBuffer: string, nextCursorPos: number): void {
    this.clearSuggestion();
    if (this.needsFullInputRepaint(nextBuffer)) {
      const repaint =
        HIDE_CURSOR +
        cursorMoveByOffset(this.buffer, this.cursorPos, 0, this.term.cols) +
        clearWrappedInputRegion(this.buffer, this.term.cols) +
        this.renderInputBuffer(nextBuffer) +
        cursorMoveByOffset(nextBuffer, nextBuffer.length, nextCursorPos, this.term.cols) +
        SHOW_CURSOR;
      this.buffer = nextBuffer;
      this.cursorPos = nextBuffer.length;
      this.term.write(repaint);
      this.cursorPos = nextCursorPos;
      this.emitEditStateChange();
      return;
    }
    this.term.write(cursorRight(cellWidth(this.buffer.slice(this.cursorPos))));
    let remaining = this.buffer;
    while (remaining.length > 0) {
      const segment = previousSegment(remaining, remaining.length);
      if (segment == null) break;
      this.term.write(
        `${cursorLeft(segment.cells)}${' '.repeat(segment.cells)}${cursorLeft(segment.cells)}`,
      );
      remaining = remaining.slice(0, segment.start);
    }
    this.buffer = nextBuffer;
    this.cursorPos = nextBuffer.length;
    this.term.write(this.renderInputBuffer(nextBuffer));
    const right = nextBuffer.slice(nextCursorPos);
    if (right.length > 0) this.term.write(cursorLeft(cellWidth(right)));
    this.cursorPos = nextCursorPos;
    this.emitEditStateChange();
  }

  private undoLastEdit(): void {
    const snapshot = this.undoStack.pop();
    if (snapshot == null) return;
    this.redoStack.push({ buffer: this.buffer, cursorPos: this.cursorPos });
    if (this.redoStack.length > 128) this.redoStack.shift();
    this.restoreSnapshot(snapshot);
  }

  private clearSuggestion(): void {
    this.cancelSuggestion();
    if (this.suggestion == null) return;
    this.term.write(CLEAR_TO_EOL);
    this.suggestion = null;
  }

  private cancelSuggestion(): void {
    this.suggestionSeq++;
    this.suggestionAbort?.abort();
    this.suggestionAbort = null;
  }

  private findSuggestionSuffix(): string {
    if (this.buffer.length === 0 || this.cursorPos !== this.buffer.length) return '';
    for (let i = this.history.length - 1; i >= 0; i--) {
      const candidate = this.history[i] ?? '';
      if (candidate.length <= this.buffer.length) continue;
      if (candidate.startsWith(this.buffer)) return candidate.slice(this.buffer.length);
    }
    return '';
  }

  private renderSuggestion(): void {
    this.cancelSuggestion();
    if (this.buffer.length === 0 || this.cursorPos !== this.buffer.length) return;
    const provider = this.opts.ghostSuggestion;
    if (!provider) {
      this.renderHistorySuggestion();
      return;
    }
    const seq = ++this.suggestionSeq;
    const controller = new AbortController();
    this.suggestionAbort = controller;
    const state = { line: this.buffer, cursor: this.cursorPos };
    void Promise.resolve(provider(state, controller.signal))
      .then((suggestion) => {
        if (
          seq !== this.suggestionSeq ||
          controller.signal.aborted ||
          this.buffer !== state.line ||
          this.cursorPos !== state.cursor
        ) {
          return;
        }
        this.suggestionAbort = null;
        if (suggestion) {
          this.renderVisibleSuggestion(suggestion);
          return;
        }
        this.renderHistorySuggestion();
      })
      .catch(() => {
        if (seq !== this.suggestionSeq || controller.signal.aborted) return;
        this.suggestionAbort = null;
        this.renderHistorySuggestion();
      });
  }

  private renderHistorySuggestion(): void {
    const suffix = this.findSuggestionSuffix();
    if (suffix.length === 0) return;
    this.renderVisibleSuggestion({ display: suffix, replacement: `${this.buffer}${suffix}` });
  }

  private renderVisibleSuggestion(suggestion: TerminalGhostSuggestion): void {
    if (suggestion.display.length === 0 || suggestion.replacement.length === 0) return;
    if (suggestion.display.includes('\n') || suggestion.display.includes('\r')) return;
    this.suggestion = suggestion;
    this.term.write(
      `${ANSI_DIM}${suggestion.display}${ANSI_DIM_OFF}${cursorLeft(cellWidth(suggestion.display))}`,
    );
  }

  private acceptSuggestion(): boolean {
    const suggestion = this.suggestion;
    if (suggestion == null || this.cursorPos !== this.buffer.length) return false;
    this.recordUndo();
    const nextBuffer = suggestion.replacement;
    this.renderBuffer(nextBuffer, nextBuffer.length);
    this.resetEditState();
    return true;
  }

  private async handleTab(): Promise<void> {
    if (!this.opts.completer) {
      this.insertPrintable('\t');
      return;
    }
    const result = await this.opts.completer(this.buffer, this.cursorPos);
    if (!result || result.items.length === 0) return;
    const start = Math.max(0, Math.min(result.start, this.buffer.length));
    const end = Math.max(start, Math.min(result.end, this.buffer.length));
    const current = this.buffer.slice(start, end);
    const values = result.items.map((item) => item.value).filter((value) => value.length > 0);
    if (values.length === 0) return;
    if (values.length === 1) {
      this.applyCompletion(start, end, values[0] ?? '');
      return;
    }
    const prefix = commonPrefix(values);
    if (prefix.length > current.length) {
      this.applyCompletion(start, end, prefix);
      return;
    }
    this.printCompletionMenu(result.items);
  }

  private applyCompletion(start: number, end: number, value: string): void {
    this.recordUndo();
    const next = `${this.buffer.slice(0, start)}${value}${this.buffer.slice(end)}`;
    this.renderBuffer(next, start + value.length);
    this.resetEditState();
    this.renderSuggestion();
  }

  private printCompletionMenu(items: readonly TerminalCompletionItem[]): void {
    this.clearSuggestion();
    const labels = items.map((item) => item.display ?? item.value);
    this.term.write(`\r\n${labels.join('  ')}\r\n${PROMPT}${this.renderInputBuffer(this.buffer)}`);
    const tail = this.buffer.slice(this.cursorPos);
    if (tail.length > 0) this.term.write(cursorLeft(cellWidth(tail)));
    this.renderSuggestion();
  }

  private rewriteAtCursor(): {
    readonly start: number;
    readonly end: number;
    readonly value: string;
  } | null {
    const rules = this.opts.rewriteRules;
    if (!rules || rules.length === 0 || this.cursorPos === 0) return null;
    const next = this.buffer[this.cursorPos];
    if (next != null && !/\s/u.test(next)) return null;
    let start = this.cursorPos;
    while (start > 0 && !/\s/u.test(this.buffer[start - 1] ?? '')) start--;
    if (start === this.cursorPos) return null;
    const token = this.buffer.slice(start, this.cursorPos);
    const rule = rules.find(
      (item) => item.trigger === token && item.replacement.length > 0 && item.replacement !== token,
    );
    return rule ? { start, end: this.cursorPos, value: rule.replacement } : null;
  }

  private applyRewriteAtCursor(suffix = ''): boolean {
    const rewrite = this.rewriteAtCursor();
    if (!rewrite) return false;
    this.clearSuggestion();
    this.recordUndo();
    const next = `${this.buffer.slice(0, rewrite.start)}${rewrite.value}${suffix}${this.buffer.slice(rewrite.end)}`;
    this.renderBuffer(next, rewrite.start + rewrite.value.length + suffix.length);
    this.resetEditState();
    this.renderSuggestion();
    return true;
  }

  private async handleEnter(): Promise<void> {
    this.applyRewriteAtCursor();
    if (this.opts.inputValidator?.(this.buffer, this.cursorPos) === 'incomplete') {
      this.insertPrintable('\n');
      return;
    }
    const line = this.buffer;
    this.clearSuggestion();
    if (line.trim().length > 0) {
      this.term.write('\r\n');
      this.atLineStart = true;
    }
    const block = this.beginCommandBlock(line);
    this.buffer = '';
    this.cursorPos = 0;
    this.promptActive = false;
    this.emitEditStateChange();
    this.resetEditState();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    if (line.trim().length > 0) {
      this.history.push(line);
      this.historyIdx = this.history.length;
    }
    this.busy = true;
    try {
      const exitCode = await this.opts.onInput(line);
      this.finishCommandBlock(block, typeof exitCode === 'number' ? exitCode : undefined);
    } finally {
      this.busy = false;
      this.writePrompt();
    }
  }

  private beginCommandBlock(command: string): MutableCommandBlock | null {
    const marker = this.term.registerMarker(0);
    if (!marker) return null;
    const block: MutableCommandBlock = {
      id: ++this.commandSeq,
      command,
      startMarker: marker,
    };
    this.commandBlocks.push(block);
    this.emitCommandBlocksChange();
    return block;
  }

  private finishCommandBlock(
    block: MutableCommandBlock | null,
    exitCode: number | undefined,
  ): void {
    if (!block) return;
    block.exitCode = exitCode;
    block.endMarker = this.term.registerMarker(0);
    if (exitCode == null) {
      this.emitCommandBlocksChange();
      return;
    }
    this.emitCommandBlocksChange();
  }

  private handleBackspace(): void {
    // Delete the char BEFORE the caret. At the end of the line this is the
    // classic `\b \b`; mid-line it must repaint the tail and blank the stale
    // trailing cell, then restore the caret.
    if (this.cursorPos === 0) return;
    this.clearSuggestion();
    const removed = previousSegment(this.buffer, this.cursorPos);
    if (removed == null) return;
    const nextBuffer = this.buffer.slice(0, removed.start) + this.buffer.slice(this.cursorPos);
    if (this.needsFullInputRepaint(nextBuffer)) {
      this.recordUndo();
      this.renderBuffer(nextBuffer, removed.start);
      this.resetEditState();
      return;
    }
    this.recordUndo();
    const tail = this.buffer.slice(this.cursorPos);
    this.buffer = this.buffer.slice(0, removed.start) + tail;
    this.cursorPos = removed.start;
    this.emitEditStateChange();
    this.resetEditState();
    // Step left over the removed cell, repaint the tail, blank the now-stale
    // last cell, then walk the caret back to just before the tail.
    this.term.write(
      `${cursorLeft(removed.cells)}${tail}${' '.repeat(removed.cells)}${cursorLeft(
        cellWidth(tail) + removed.cells,
      )}`,
    );
  }

  /** Forward-delete the char AT the caret (Delete key). No-op at line end. */
  private handleDelete(): void {
    if (this.cursorPos >= this.buffer.length) return;
    this.clearSuggestion();
    const removed = nextSegment(this.buffer, this.cursorPos);
    if (removed == null) return;
    const nextBuffer = this.buffer.slice(0, this.cursorPos) + this.buffer.slice(removed.end);
    if (this.needsFullInputRepaint(nextBuffer)) {
      this.recordUndo();
      this.renderBuffer(nextBuffer, this.cursorPos);
      this.resetEditState();
      return;
    }
    this.recordUndo();
    const tail = this.buffer.slice(removed.end);
    this.buffer = this.buffer.slice(0, this.cursorPos) + tail;
    this.emitEditStateChange();
    this.resetEditState();
    // Caret stays put; repaint the shortened tail, blank the stale cell,
    // restore the caret.
    this.term.write(
      `${tail}${' '.repeat(removed.cells)}${cursorLeft(cellWidth(tail) + removed.cells)}`,
    );
  }

  private moveLeft(): void {
    if (this.cursorPos === 0) return;
    this.clearSuggestion();
    const prev = previousSegment(this.buffer, this.cursorPos);
    if (prev == null) return;
    this.writeCursorMove(prev.start);
  }

  private moveRight(): void {
    if (this.cursorPos >= this.buffer.length) return;
    this.clearSuggestion();
    const next = nextSegment(this.buffer, this.cursorPos);
    if (next == null) return;
    this.writeCursorMove(next.end);
  }

  private moveToStart(): void {
    if (this.cursorPos === 0) return;
    this.clearSuggestion();
    this.writeCursorMove(0);
  }

  private moveToEnd(): void {
    this.clearSuggestion();
    this.writeCursorMove(this.buffer.length);
  }

  private moveWordLeft(): void {
    if (this.cursorPos === 0) return;
    this.clearSuggestion();
    let nextOffset = this.cursorPos;
    let segment = previousSegment(this.buffer, nextOffset);
    while (segment != null && isWhitespaceSegment(segment)) {
      nextOffset = segment.start;
      segment = previousSegment(this.buffer, nextOffset);
    }
    if (segment == null) {
      this.moveToStart();
      return;
    }
    const word = isWordSegment(segment);
    while (segment != null && (word ? isWordSegment(segment) : !isWhitespaceSegment(segment))) {
      nextOffset = segment.start;
      segment = previousSegment(this.buffer, nextOffset);
    }
    this.writeCursorMove(nextOffset);
  }

  private moveWordRight(): void {
    if (this.cursorPos >= this.buffer.length) return;
    this.clearSuggestion();
    let nextOffset = this.cursorPos;
    let segment = nextSegment(this.buffer, nextOffset);
    while (segment != null && isWhitespaceSegment(segment)) {
      nextOffset = segment.end;
      segment = nextSegment(this.buffer, nextOffset);
    }
    if (segment == null) {
      this.moveToEnd();
      return;
    }
    const word = isWordSegment(segment);
    while (segment != null && (word ? isWordSegment(segment) : !isWhitespaceSegment(segment))) {
      nextOffset = segment.end;
      segment = nextSegment(this.buffer, nextOffset);
    }
    this.writeCursorMove(nextOffset);
  }

  private handleCtrlC(): void {
    // Echo `^C\r\n` BEFORE dispatching the signal — TTY line discipline
    // echoes the visible representation before delivering SIGINT to the
    // foreground process group.
    this.term.write('^C\r\n');
    this.atLineStart = true;
    this.buffer = '';
    this.cursorPos = 0;
    this.clearSuggestion();
    this.emitEditStateChange();
    this.resetEditState();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.opts.onSignal?.('SIGINT');
    if (!this.busy) {
      this.term.write(PROMPT);
      this.atLineStart = false;
      this.promptActive = true;
    }
    // When busy, the host's signal handler exits the running command; the
    // busy=false transition in handleEnter redraws the prompt once
    // `onInput` resolves.
  }

  private insertPrintable(text: string): void {
    // Insert AT the caret (append when the caret is already at the end).
    // Multi-line paste may embed `\n`: don't auto-submit intermediate lines
    // (surprising for code paste), but render LF as CRLF so xterm's cursor
    // moves correctly.
    this.clearSuggestion();
    this.recordUndo();
    const tail = this.buffer.slice(this.cursorPos);
    const nextBuffer = this.buffer.slice(0, this.cursorPos) + text + tail;
    const nextCursorPos = this.cursorPos + text.length;
    if (
      this.opts.highlighter != null ||
      (tail.length > 0 && this.needsWrappedRepaint(nextBuffer))
    ) {
      this.renderBuffer(nextBuffer, nextCursorPos);
      this.resetEditState();
      return;
    }
    this.buffer = nextBuffer;
    this.cursorPos = nextCursorPos;
    this.emitEditStateChange();
    this.resetEditState();
    const echo = `${text}${tail}`.replace(/\n/g, '\r\n');
    if (tail.length === 0) {
      // Pure append — no caret restore needed (fast path; also keeps the
      // existing append/paste echo byte-for-byte unchanged).
      this.term.write(echo);
      this.renderSuggestion();
      return;
    }
    // Mid-line: write the inserted text + the repainted tail, then walk the
    // caret back over the tail so it sits right after the inserted text.
    this.term.write(`${echo}${cursorLeft(cellWidth(tail))}`);
  }

  private historyPrev(): string {
    if (this.history.length === 0) return this.buffer;
    if (
      this.historySearch != null ||
      (this.buffer.length > 0 &&
        this.cursorPos === this.buffer.length &&
        this.historyIdx === this.history.length)
    ) {
      const prefix = this.historySearch?.prefix ?? this.buffer;
      const start = this.historySearch?.idx ?? this.history.length;
      for (let i = start - 1; i >= 0; i--) {
        if (!this.history[i]?.startsWith(prefix)) continue;
        this.historySearch = { prefix, idx: i };
        this.historyIdx = i;
        return this.history[i] ?? '';
      }
      return this.buffer;
    }
    this.historyIdx = Math.max(0, this.historyIdx - 1);
    return this.history[this.historyIdx] ?? '';
  }

  private historyNext(): string {
    if (this.history.length === 0) return this.buffer;
    if (this.historySearch != null) {
      const { prefix, idx } = this.historySearch;
      for (let i = idx + 1; i < this.history.length; i++) {
        if (!this.history[i]?.startsWith(prefix)) continue;
        this.historySearch = { prefix, idx: i };
        this.historyIdx = i;
        return this.history[i] ?? '';
      }
      this.historySearch = null;
      this.historyIdx = this.history.length;
      return prefix;
    }
    if (this.historyIdx >= this.history.length - 1) {
      this.historyIdx = this.history.length;
      return '';
    }
    this.historyIdx += 1;
    return this.history[this.historyIdx] ?? '';
  }

  private replaceBuffer(next: string): void {
    this.renderBuffer(next, next.length);
    this.renderSuggestion();
  }

  private rememberKill(text: string): void {
    if (text.length === 0) return;
    this.killRing.push(text);
    if (this.killRing.length > 32) this.killRing.shift();
  }

  private killBeforeCursor(): void {
    if (this.cursorPos === 0) return;
    this.clearSuggestion();
    this.recordUndo();
    this.lastYank = null;
    const killed = this.buffer.slice(0, this.cursorPos);
    const tail = this.buffer.slice(this.cursorPos);
    this.rememberKill(killed);
    if (this.needsWrappedRepaint(tail)) {
      this.renderBuffer(tail, 0);
      this.resetTransientSearch();
      this.renderSuggestion();
      return;
    }
    this.term.write(
      `${cursorLeft(cellWidth(killed))}${tail}${' '.repeat(cellWidth(killed))}${cursorLeft(cellWidth(tail) + cellWidth(killed))}`,
    );
    this.buffer = tail;
    this.cursorPos = 0;
    this.emitEditStateChange();
    this.resetTransientSearch();
    this.renderSuggestion();
  }

  private killAfterCursor(): void {
    if (this.cursorPos >= this.buffer.length) return;
    this.clearSuggestion();
    this.recordUndo();
    this.lastYank = null;
    const killed = this.buffer.slice(this.cursorPos);
    this.rememberKill(killed);
    const nextBuffer = this.buffer.slice(0, this.cursorPos);
    if (this.needsWrappedRepaint(nextBuffer)) {
      this.renderBuffer(nextBuffer, this.cursorPos);
      this.resetTransientSearch();
      this.renderSuggestion();
      return;
    }
    this.buffer = nextBuffer;
    this.emitEditStateChange();
    this.term.write(`${' '.repeat(cellWidth(killed))}${cursorLeft(cellWidth(killed))}`);
    this.resetTransientSearch();
    this.renderSuggestion();
  }

  private killWordLeft(): void {
    if (this.cursorPos === 0) return;
    this.clearSuggestion();
    this.recordUndo();
    this.lastYank = null;
    let start = this.cursorPos;
    let segment = previousSegment(this.buffer, start);
    while (segment != null && isWhitespaceSegment(segment)) {
      start = segment.start;
      segment = previousSegment(this.buffer, start);
    }
    while (segment != null && !isWhitespaceSegment(segment)) {
      start = segment.start;
      segment = previousSegment(this.buffer, start);
    }
    const killed = this.buffer.slice(start, this.cursorPos);
    const tail = this.buffer.slice(this.cursorPos);
    this.rememberKill(killed);
    const nextBuffer = this.buffer.slice(0, start) + tail;
    if (this.needsWrappedRepaint(nextBuffer)) {
      this.renderBuffer(nextBuffer, start);
      this.resetTransientSearch();
      this.renderSuggestion();
      return;
    }
    this.buffer = nextBuffer;
    this.cursorPos = start;
    this.emitEditStateChange();
    this.term.write(
      `${cursorLeft(cellWidth(killed))}${tail}${' '.repeat(cellWidth(killed))}${cursorLeft(cellWidth(tail) + cellWidth(killed))}`,
    );
    this.resetTransientSearch();
    this.renderSuggestion();
  }

  private killWordRight(): void {
    if (this.cursorPos >= this.buffer.length) return;
    this.clearSuggestion();
    this.recordUndo();
    this.lastYank = null;
    let end = this.cursorPos;
    let segment = nextSegment(this.buffer, end);
    while (segment != null && isWhitespaceSegment(segment)) {
      end = segment.end;
      segment = nextSegment(this.buffer, end);
    }
    while (segment != null && !isWhitespaceSegment(segment)) {
      end = segment.end;
      segment = nextSegment(this.buffer, end);
    }
    const killed = this.buffer.slice(this.cursorPos, end);
    const tail = this.buffer.slice(end);
    this.rememberKill(killed);
    const nextBuffer = this.buffer.slice(0, this.cursorPos) + tail;
    if (this.needsWrappedRepaint(nextBuffer)) {
      this.renderBuffer(nextBuffer, this.cursorPos);
      this.resetTransientSearch();
      this.renderSuggestion();
      return;
    }
    this.buffer = nextBuffer;
    this.emitEditStateChange();
    this.term.write(
      `${tail}${' '.repeat(cellWidth(killed))}${cursorLeft(cellWidth(tail) + cellWidth(killed))}`,
    );
    this.resetTransientSearch();
    this.renderSuggestion();
  }

  private yank(): void {
    const ringIdx = this.killRing.length - 1;
    const text = this.killRing[ringIdx];
    if (text == null) return;
    const start = this.cursorPos;
    this.insertPrintable(text);
    this.lastYank = { start, end: this.cursorPos, ringIdx };
  }

  private yankPop(): void {
    if (this.lastYank == null || this.killRing.length < 2) return;
    if (this.cursorPos !== this.lastYank.end) return;
    const nextIdx = (this.lastYank.ringIdx - 1 + this.killRing.length) % this.killRing.length;
    const text = this.killRing[nextIdx];
    if (text == null) return;
    const { start, end } = this.lastYank;
    const removed = this.buffer.slice(start, end);
    const tail = this.buffer.slice(end);
    const padding = Math.max(0, cellWidth(removed) - cellWidth(text));
    this.clearSuggestion();
    this.recordUndo();
    const nextBuffer = this.buffer.slice(0, start) + text + tail;
    const nextCursorPos = start + text.length;
    if (this.needsWrappedRepaint(nextBuffer)) {
      this.renderBuffer(nextBuffer, nextCursorPos);
      this.resetTransientSearch();
      this.lastYank = { start, end: this.cursorPos, ringIdx: nextIdx };
      this.renderSuggestion();
      return;
    }
    this.buffer = nextBuffer;
    this.cursorPos = nextCursorPos;
    this.emitEditStateChange();
    this.term.write(
      `${cursorLeft(cellWidth(removed))}${text}${tail}${' '.repeat(padding)}${cursorLeft(cellWidth(tail) + padding)}`,
    );
    this.resetTransientSearch();
    this.lastYank = { start, end: this.cursorPos, ringIdx: nextIdx };
  }

  private clearScreen(): void {
    this.clearSuggestion();
    this.term.write(`\x1b[2J\x1b[H${PROMPT}${this.renderInputBuffer(this.buffer)}`);
    const tail = this.buffer.slice(this.cursorPos);
    if (tail.length > 0) this.term.write(cursorLeft(cellWidth(tail)));
    this.renderSuggestion();
  }

  private transpose(): void {
    const segments = lineSegments(this.buffer);
    if (segments.length < 2) return;
    this.clearSuggestion();
    const right = nextSegment(this.buffer, this.cursorPos);
    const second = right ?? previousSegment(this.buffer, this.cursorPos);
    if (second == null) return;
    const first = previousSegment(this.buffer, second.start);
    if (first == null) return;
    const before = this.buffer.slice(0, first.start);
    const between = this.buffer.slice(first.end, second.start);
    const after = this.buffer.slice(second.end);
    this.recordUndo();
    this.buffer = `${before}${second.text}${between}${first.text}${after}`;
    this.cursorPos = before.length + second.text.length + between.length + first.text.length;
    this.emitEditStateChange();
    this.replaceBuffer(this.buffer);
  }

  private startReverseSearch(): void {
    this.clearSuggestion();
    if (this.reverseSearch == null) {
      this.reverseSearch = {
        originalBuffer: this.buffer,
        originalCursorPos: this.cursorPos,
        query: '',
        matchIdx: this.history.length,
      };
    } else {
      this.reverseSearch.matchIdx = Math.max(0, this.reverseSearch.matchIdx);
    }
    this.updateReverseSearch(true);
  }

  private async dispatchReverseSearch(event: KeyEvent): Promise<void> {
    const state = this.reverseSearch;
    if (state == null) return;
    switch (event.kind) {
      case 'enter':
      case 'arrow-right':
      case 'end':
        this.reverseSearch = null;
        await (event.kind === 'enter' ? this.handleEnter() : Promise.resolve());
        return;
      case 'reverse-search':
        this.updateReverseSearch(true);
        return;
      case 'backspace':
        if (state.query.length > 0) {
          const prev = previousSegment(state.query, state.query.length);
          state.query = state.query.slice(0, prev?.start ?? 0);
          state.matchIdx = this.history.length;
          this.updateReverseSearch(false);
        }
        return;
      case 'search-cancel':
        this.cancelReverseSearch();
        return;
      case 'printable':
        state.query += event.text;
        state.matchIdx = this.history.length;
        this.updateReverseSearch(false);
        return;
      case 'ctrl-c':
        this.cancelReverseSearch();
        this.handleCtrlC();
        return;
      default:
        return;
    }
  }

  private updateReverseSearch(nextOlder: boolean): void {
    const state = this.reverseSearch;
    if (state == null) return;
    const start = nextOlder ? state.matchIdx - 1 : this.history.length - 1;
    let matchIdx = -1;
    for (let i = start; i >= 0; i--) {
      const candidate = this.history[i] ?? '';
      if (!candidate.includes(state.query)) continue;
      matchIdx = i;
      break;
    }
    if (matchIdx !== -1) {
      state.matchIdx = matchIdx;
      this.buffer = this.history[matchIdx] ?? '';
      this.cursorPos = this.buffer.length;
      this.emitEditStateChange();
    } else if (state.query.length === 0) {
      this.buffer = state.originalBuffer;
      this.cursorPos = state.originalCursorPos;
      this.emitEditStateChange();
      state.matchIdx = this.history.length;
    }
    this.redrawSearchPrompt(matchIdx !== -1);
  }

  private redrawSearchPrompt(found: boolean): void {
    const state = this.reverseSearch;
    if (state == null) return;
    const status = found ? 'reverse-i-search' : 'failed reverse-i-search';
    this.term.write(`\r${CLEAR_TO_EOL}(${status})\`${state.query}\`: ${this.buffer}`);
  }

  private cancelReverseSearch(): void {
    const state = this.reverseSearch;
    if (state == null) return;
    this.reverseSearch = null;
    this.buffer = state.originalBuffer;
    this.cursorPos = state.originalCursorPos;
    this.emitEditStateChange();
    this.term.write(`\r${CLEAR_TO_EOL}${PROMPT}${this.buffer}`);
  }
}
