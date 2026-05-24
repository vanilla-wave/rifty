import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { TerminalStream } from './types.ts';

const ANSI_RED = '\x1b[31m';
const ANSI_GREY = '\x1b[90m';
const ANSI_RESET = '\x1b[0m';
const PROMPT = `${ANSI_GREY}> ${ANSI_RESET}`;

export interface RiftyTerminalOptions {
  onInput(line: string): void | Promise<void>;
}

/**
 * Thin line-mode wrapper over xterm.js. Keeps history (up/down arrows), echoes
 * typed characters, and emits one full line per Enter to `onInput`.
 *
 * Framework-agnostic: knows nothing about Solid/React/etc.
 */
export class RiftyTerminal {
  private readonly term: Terminal;
  private readonly fit: FitAddon;
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
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.onData((data) => {
      void this.handleData(data);
    });
  }

  mount(element: HTMLElement): void {
    this.term.open(element);
    this.fit.fit();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fit.fit());
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

  private async handleData(data: string): Promise<void> {
    if (this.busy) return;

    if (data === '\r') {
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
      return;
    }

    if (data === '') {
      if (this.buffer.length > 0) {
        this.buffer = this.buffer.slice(0, -1);
        this.term.write('\b \b');
      }
      return;
    }

    if (data === '[A') {
      this.replaceBuffer(this.historyPrev());
      return;
    }

    if (data === '[B') {
      this.replaceBuffer(this.historyNext());
      return;
    }

    if (data === '') {
      this.term.write('^C');
      this.writePrompt();
      return;
    }

    if (data.charCodeAt(0) < 32 && data !== '\t') {
      return;
    }

    this.buffer += data;
    this.term.write(data);
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
