import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { type KeyEvent, classifyKey } from './keys.ts';
import type { TerminalStream } from './types.ts';

const ANSI_RED = '\x1b[31m';
const ANSI_GREY = '\x1b[90m';
const ANSI_RESET = '\x1b[0m';
const PROMPT = `${ANSI_GREY}> ${ANSI_RESET}`;

export interface RiftyTerminalOptions {
  /** Called once per Enter with the buffered line (no trailing CR/LF). */
  onInput(line: string): void | Promise<void>;
  /**
   * Called when the user presses Ctrl+C. The host (typically the
   * playground) should invoke the kernel's `processHandle.kill('SIGINT')`
   * on whatever process is currently consuming stdin from this terminal.
   *
   * The terminal handles the local-echo of `"^C\r\n"` itself (matches
   * typical TTY behaviour where the kernel-side echo of `^C` happens
   * before the signal is delivered) — the host only needs to wire the
   * signal emission.
   *
   * If omitted, Ctrl+C still echoes `^C` and resets the buffer, but no
   * signal is emitted — useful for REPL-only mode where there is no
   * separate child process to kill.
   */
  onSignal?(signal: 'SIGINT'): void;
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
  private readonly opts: RiftyTerminalOptions;
  private buffer = '';
  private history: string[] = [];
  private historyIdx = 0;
  private resizeObserver: ResizeObserver | null = null;
  private busy = false;

  constructor(opts: RiftyTerminalOptions) {
    this.opts = opts;
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0f1115', foreground: '#e6e6e6' },
      convertEol: true,
    });
    this.term.onData((data) => {
      void this.handleInput(data);
    });
  }

  mount(element: HTMLElement): void {
    this.term.open(element);
    // FitAddon inspects parentElement.getComputedStyle, so it can only
    // be loaded once the terminal is attached to a real DOM.
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.fit.fit();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fit?.fit());
      this.resizeObserver.observe(element);
    }
    this.writePrompt();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.term.dispose();
  }

  write(data: string, stream: TerminalStream = 'stdout'): void {
    const text = data.replace(/\n/g, '\r\n');
    if (stream === 'stderr') {
      this.term.write(`${ANSI_RED}${text}${ANSI_RESET}`);
    } else {
      this.term.write(text);
    }
  }

  writeLine(data: string, stream: TerminalStream = 'stdout'): void {
    this.write(`${data}\n`, stream);
  }

  writePrompt(): void {
    this.term.write(`\r\n${PROMPT}`);
    this.buffer = '';
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

    // Ctrl+C is processed even when `busy` — the whole point of SIGINT
    // is to interrupt a running command. Every other key is dropped
    // while we wait for `onInput` to resolve, to match typical line-mode
    // TTY behaviour (no overlapping commands).
    if (event.kind === 'ctrl-c') {
      this.handleCtrlC();
      return;
    }

    if (this.busy) return;

    await this.dispatch(event);
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
      case 'arrow-right':
        // Cursor movement within the buffer is not implemented yet —
        // line-mode editing is append-only. We swallow the keys rather
        // than letting them reach the buffer (where the raw escape
        // sequence would appear as garbage).
        return;
      case 'tab':
        // No completion yet. Insert a literal tab so the user can paste
        // indented code.
        this.buffer += '\t';
        this.term.write('\t');
        return;
      case 'printable':
        this.appendPrintable(event.text);
        return;
      case 'ctrl-c':
        // Handled above; unreachable.
        return;
      case 'ignored':
        return;
    }
  }

  private async handleEnter(): Promise<void> {
    this.term.write('\r\n');
    const line = this.buffer;
    this.buffer = '';
    if (line.trim().length > 0) {
      this.history.push(line);
      this.historyIdx = this.history.length;
    }
    this.busy = true;
    try {
      await this.opts.onInput(line);
    } finally {
      this.busy = false;
      this.writePrompt();
    }
  }

  private handleBackspace(): void {
    if (this.buffer.length > 0) {
      this.buffer = this.buffer.slice(0, -1);
      this.term.write('\b \b');
    }
  }

  private handleCtrlC(): void {
    // Local echo of `^C\r\n` happens BEFORE the signal is dispatched —
    // matches kernel TTY behaviour where the line discipline echoes the
    // visible representation before delivering SIGINT to the foreground
    // process group.
    this.term.write('^C\r\n');
    this.buffer = '';
    this.opts.onSignal?.('SIGINT');
    if (!this.busy) {
      // Nothing is running, just give the user a fresh prompt.
      this.term.write(PROMPT);
    }
    // If `busy` is true, the host's signal handler is responsible for
    // making the running command exit; the busy=false transition in
    // {@link handleEnter} will redraw the prompt when `onInput` resolves.
  }

  private appendPrintable(text: string): void {
    // A multi-line paste may contain embedded `\n`. We don't auto-submit
    // intermediate lines — that would be surprising for code paste — but
    // we DO render the LF as CRLF so xterm's cursor moves correctly.
    this.buffer += text;
    this.term.write(text.replace(/\n/g, '\r\n'));
  }

  private historyPrev(): string {
    if (this.history.length === 0) return this.buffer;
    this.historyIdx = Math.max(0, this.historyIdx - 1);
    return this.history[this.historyIdx] ?? '';
  }

  private historyNext(): string {
    if (this.history.length === 0) return this.buffer;
    if (this.historyIdx >= this.history.length - 1) {
      this.historyIdx = this.history.length;
      return '';
    }
    this.historyIdx += 1;
    return this.history[this.historyIdx] ?? '';
  }

  private replaceBuffer(next: string): void {
    while (this.buffer.length > 0) {
      this.term.write('\b \b');
      this.buffer = this.buffer.slice(0, -1);
    }
    this.buffer = next;
    this.term.write(next);
  }
}
