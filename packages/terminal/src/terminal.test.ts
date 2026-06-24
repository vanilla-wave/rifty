/**
 * Tests for `RiftyTerminal` orchestrator behaviour.
 *
 * We drive the public {@link RiftyTerminal.handleInput} entry point —
 * the same code path xterm.js routes user input through — and observe
 * effects via the {@link RiftyTerminalOptions} callbacks plus a tap
 * on the underlying `term.write` for the Ctrl+C echo-order test.
 *
 * The class is constructible in plain Node (no DOM) once we stub the
 * `@xterm/addon-fit` module — its bundle references `self`, which is
 * undefined here. `mount()` itself is DOM-bound and never called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addonMocks = vi.hoisted(() => ({
  loaded: [] as string[],
  searchOptions: [] as Array<Record<string, unknown>>,
  webLinkHandler: null as ((event: MouseEvent, uri: string) => void) | null,
  contextLossListener: null as (() => void) | null,
  webglDisposed: 0,
  findNext: vi.fn((_term?: string, _options?: Record<string, unknown>) => true),
  findPrevious: vi.fn((_term?: string, _options?: Record<string, unknown>) => false),
  clearDecorations: vi.fn(),
  serialize: vi.fn((_options?: Record<string, unknown>) => 'serialized text'),
  serializeAsHTML: vi.fn((_options?: Record<string, unknown>) => '<pre>serialized html</pre>'),
}));

// `vi.mock` is hoisted by vitest above all imports, so the stub is
// active before `RiftyTerminal` (which depends on `@xterm/addon-fit`)
// loads. The real bundle references `self`, which is undefined under a
// plain `node` environment.
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddonStub {
    activate(): void {}
    dispose(): void {}
    fit(): void {}
  },
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class SearchAddonStub {
    constructor(options?: Record<string, unknown>) {
      addonMocks.searchOptions.push(options ?? {});
    }

    activate(): void {
      addonMocks.loaded.push('search');
    }

    dispose(): void {}

    findNext(term: string, options?: Record<string, unknown>): boolean {
      return addonMocks.findNext(term, options);
    }

    findPrevious(term: string, options?: Record<string, unknown>): boolean {
      return addonMocks.findPrevious(term, options);
    }

    clearDecorations(): void {
      addonMocks.clearDecorations();
    }
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class WebLinksAddonStub {
    constructor(handler?: (event: MouseEvent, uri: string) => void) {
      addonMocks.webLinkHandler = handler ?? null;
    }

    activate(): void {
      addonMocks.loaded.push('web-links');
    }

    dispose(): void {}
  },
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class Unicode11AddonStub {
    activate(terminal: {
      unicode: {
        register(provider: {
          readonly version: string;
          wcwidth(codepoint: number): 0 | 1 | 2;
          charProperties(codepoint: number, preceding: number): number;
        }): void;
      };
    }): void {
      terminal.unicode.register({
        version: '11',
        wcwidth: () => 1,
        charProperties: () => 0,
      });
      addonMocks.loaded.push('unicode11');
    }

    dispose(): void {}
  },
}));

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: class ImageAddonStub {
    activate(): void {
      addonMocks.loaded.push('image');
    }

    dispose(): void {}
  },
}));

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class SerializeAddonStub {
    activate(): void {
      addonMocks.loaded.push('serialize');
    }

    dispose(): void {}

    serialize(options?: Record<string, unknown>): string {
      return addonMocks.serialize(options);
    }

    serializeAsHTML(options?: Record<string, unknown>): string {
      return addonMocks.serializeAsHTML(options);
    }
  },
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class WebglAddonStub {
    readonly onContextLoss = (listener: () => void): { dispose(): void } => {
      addonMocks.contextLossListener = listener;
      return { dispose(): void {} };
    };

    constructor(readonly preserveDrawingBuffer?: boolean) {}

    activate(): void {
      addonMocks.loaded.push('webgl');
    }

    dispose(): void {
      addonMocks.webglDisposed++;
    }
  },
}));

import { RiftyTerminal, type RiftyTerminalOptions, type TerminalRawInput } from './terminal.ts';

beforeEach(() => {
  addonMocks.loaded.length = 0;
  addonMocks.searchOptions.length = 0;
  addonMocks.webLinkHandler = null;
  addonMocks.contextLossListener = null;
  addonMocks.webglDisposed = 0;
  addonMocks.findNext.mockClear();
  addonMocks.findPrevious.mockClear();
  addonMocks.clearDecorations.mockClear();
  addonMocks.serialize.mockClear();
  addonMocks.serializeAsHTML.mockClear();
});

interface Recorder {
  lines: string[];
  signals: 'SIGINT'[];
  // Resolves the next `onInput` call to simulate a long-running command.
  resolveNextInput: (() => void) | null;
}

function createTerminal(opts: Omit<Partial<RiftyTerminalOptions>, 'onInput' | 'onSignal'> = {}): {
  term: RiftyTerminal;
  rec: Recorder;
} {
  const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
  const term = new RiftyTerminal({
    ...opts,
    onInput: (line) => {
      rec.lines.push(line);
      if (rec.resolveNextInput) {
        return new Promise<void>((resolve) => {
          rec.resolveNextInput = () => {
            rec.resolveNextInput = null;
            resolve();
          };
        });
      }
    },
    onSignal: (sig) => {
      rec.signals.push(sig);
    },
  });
  return { term, rec };
}

/**
 * Tap the underlying xterm `.write` so a test can assert the exact bytes
 * echoed to the screen (cursor moves, redraws). Accessed through the
 * private field for verification only — same technique as the Ctrl+C
 * echo-order test.
 */
function tapWrites(term: RiftyTerminal): string[] {
  const writes: string[] = [];
  const internalTerm = (term as unknown as { term: { write: (s: string) => void } }).term;
  const origWrite = internalTerm.write.bind(internalTerm);
  internalTerm.write = (s: string) => {
    writes.push(s);
    origWrite(s);
  };
  return writes;
}

function internalXterm(term: RiftyTerminal): {
  options: Record<string, unknown>;
  focus: () => void;
  getSelection: () => string;
  registerMarker: (offset?: number) => { id: number; line: number; dispose(): void };
  registerDecoration: (options: Record<string, unknown>) => unknown;
  scrollToLine: (line: number) => void;
  selectLines: (start: number, end: number) => void;
  resize: (cols: number, rows: number) => void;
  buffer: { active: { viewportY: number } };
  unicode: { activeVersion: string };
} {
  return (
    term as unknown as {
      term: {
        options: Record<string, unknown>;
        focus: () => void;
        getSelection: () => string;
        registerMarker: (offset?: number) => { id: number; line: number; dispose(): void };
        registerDecoration: (options: Record<string, unknown>) => unknown;
        scrollToLine: (line: number) => void;
        selectLines: (start: number, end: number) => void;
        resize: (cols: number, rows: number) => void;
        buffer: { active: { viewportY: number } };
        unicode: { activeVersion: string };
      };
    }
  ).term;
}

interface TestLinkHandler {
  readonly allowNonHttpProtocols?: boolean;
  activate(event: MouseEvent, text: string): void;
}

describe('RiftyTerminal — Enter and line buffering', () => {
  it('builds up a line from printable characters and emits onInput on Enter', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('h');
    await term.handleInput('i');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['hi']);
  });

  it('handles an empty Enter (passes empty line through)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['']);
  });
});

describe('RiftyTerminal — backspace', () => {
  it('xterm.js DEL (\\x7f) deletes the last buffered char', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('\x7f');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['a']);
  });

  it('classic BS (\\x08) also deletes (for terminals configured that way)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('\x08');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['a']);
  });
});

describe('RiftyTerminal — arrow keys navigate history', () => {
  it('ArrowUp (ESC [ A) recalls the previous command', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('first');
    await term.handleInput('\r');
    await term.handleInput('second');
    await term.handleInput('\r');
    // Now buffer is empty, history is ['first', 'second'].
    await term.handleInput('\x1b[A'); // Up
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['first', 'second', 'second']);
  });

  it('ArrowUp twice recalls the older command', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('first');
    await term.handleInput('\r');
    await term.handleInput('second');
    await term.handleInput('\r');
    await term.handleInput('\x1b[A'); // → second
    await term.handleInput('\x1b[A'); // → first
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['first', 'second', 'first']);
  });

  it('ArrowDown after ArrowUp moves back toward the empty line', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('first');
    await term.handleInput('\r');
    await term.handleInput('second');
    await term.handleInput('\r');
    await term.handleInput('\x1b[A'); // → second
    await term.handleInput('\x1b[A'); // → first
    await term.handleInput('\x1b[B'); // → second
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['first', 'second', 'second']);
  });

  it('ArrowLeft moves the caret so a typed char inserts mid-line (abc, Left, Left, X → aXbc)', async () => {
    // User-requested behaviour-contract change: the line editor is now
    // cursor-aware. Previously ArrowLeft/ArrowRight were swallowed and the
    // line stayed append-only (this case used to assert `ab`).
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('c');
    await term.handleInput('\x1b[D'); // Left → between b and c
    await term.handleInput('\x1b[D'); // Left → between a and b
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['aXbc']);
  });

  it('ArrowRight moves the caret back toward the end (a Left Left then Right then X → abXc... )', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('c');
    await term.handleInput('\x1b[D'); // → between b and c
    await term.handleInput('\x1b[D'); // → between a and b
    await term.handleInput('\x1b[C'); // → back between b and c
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abXc']);
  });

  it('ArrowLeft past the start is clamped (no move when already at column 0)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('\x1b[D'); // → before a
    await term.handleInput('\x1b[D'); // clamped, stays before a
    await term.handleInput('\x1b[D'); // clamped
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['Xa']);
  });

  it('ArrowRight past the end is clamped (no move when already at the end)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('\x1b[C'); // already at end → no-op
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abX']);
  });

  it('ArrowLeft at column 0 emits no cursor-move bytes (clamped, nothing echoed)', async () => {
    const { term } = createTerminal();
    const writes = tapWrites(term);
    await term.handleInput('a');
    writes.length = 0; // ignore the echo of 'a'
    await term.handleInput('\x1b[D'); // move left over 'a'
    await term.handleInput('\x1b[D'); // clamped — should echo nothing
    // First Left emits one move; the clamped second Left emits nothing.
    expect(writes).toEqual(['\b']);
  });

  it('the literal bytes "[A" (without ESC) are appended to the buffer — they are NOT a key', async () => {
    // Regression: the original code compared `data === '[A'` (with the
    // ESC byte stripped by an editor). That made arrow keys silently
    // never fire AND made literal `[A` get consumed. We want the
    // opposite: ESC[A is a key, plain `[A` is text.
    const { term, rec } = createTerminal();
    await term.handleInput('[A');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['[A']);
  });

  it('ArrowUp with a typed prefix recalls the newest matching command', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('npm test');
    await term.handleInput('\r');
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('git diff');
    await term.handleInput('\r');
    await term.handleInput('git');
    await term.handleInput('\x1b[A');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['npm test', 'git status', 'git diff', 'git diff']);
  });

  it('ArrowUp with a prefix skips non-matching commands while walking backward', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('npm test');
    await term.handleInput('\r');
    await term.handleInput('git diff');
    await term.handleInput('\r');
    await term.handleInput('git');
    await term.handleInput('\x1b[A');
    await term.handleInput('\x1b[A');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'npm test', 'git diff', 'git status']);
  });

  it('ArrowDown in prefix history restores the original prefix after the newest match', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('git diff');
    await term.handleInput('\r');
    await term.handleInput('git');
    await term.handleInput('\x1b[A');
    await term.handleInput('\x1b[B');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'git diff', 'git']);
  });

  it('ArrowUp with an unmatched prefix leaves the typed line intact', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('npm');
    await term.handleInput('\x1b[A');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'npm']);
  });
});

describe('RiftyTerminal — cursor-aware mid-line editing', () => {
  it('Home (ESC [ H) jumps to the start so the next char inserts there', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[H'); // Home
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['Xabc']);
  });

  it('Ctrl+A (\\x01) jumps to the start (readline binding)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x01'); // Ctrl+A → home
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['Xabc']);
  });

  it('End (ESC [ F) returns to the end after Home so a char appends', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[H'); // Home
    await term.handleInput('\x1b[F'); // End
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abcX']);
  });

  it('Ctrl+E (\\x05) returns to the end (readline binding)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x01'); // Ctrl+A → home
    await term.handleInput('\x05'); // Ctrl+E → end
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abcX']);
  });

  it('Delete (ESC [ 3 ~) forward-deletes the char AT the cursor', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[H'); // Home → before 'a'
    await term.handleInput('\x1b[3~'); // Delete → removes 'a'
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['bc']);
  });

  it('Delete at the end of the line is a no-op (nothing to forward-delete)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[3~'); // Delete at end → no-op
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abc']);
  });

  it('Backspace mid-line deletes the char BEFORE the cursor', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[D'); // Left → between b and c
    await term.handleInput('\x7f'); // Backspace → removes 'b'
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ac']);
  });

  it('Backspace at column 0 is a no-op', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[H'); // Home
    await term.handleInput('\x7f'); // Backspace at start → no-op
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abc']);
  });

  it('mid-line insert redraws the remainder and restores the cursor (echoed bytes)', async () => {
    const { term } = createTerminal();
    await term.handleInput('ac');
    await term.handleInput('\x1b[D'); // Left → between a and c
    const writes = tapWrites(term);
    await term.handleInput('b'); // insert b → buffer "abc", cursor after b
    // Echo: write the inserted char + the tail ("c"), then move the cursor
    // back over the 1-char tail so it sits right after the inserted char.
    expect(writes.join('')).toBe(`bc${'\b'.repeat(1)}`);
  });

  it('mid-line backspace redraws the remainder and erases the trailing cell (echoed bytes)', async () => {
    const { term } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[D'); // Left → between b and c
    const writes = tapWrites(term);
    await term.handleInput('\x7f'); // Backspace → removes 'b', buffer "ac"
    // Echo: step back over the deleted cell, repaint the tail ("c"), blank
    // the now-stale trailing cell, then restore the cursor before the tail.
    expect(writes.join('')).toBe('\bc \b\b');
  });

  it('Delete mid-line redraws the remainder and erases the trailing cell (echoed bytes)', async () => {
    const { term } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[D'); // Left → between b and c
    await term.handleInput('\x1b[D'); // Left → between a and b
    const writes = tapWrites(term);
    await term.handleInput('\x1b[3~'); // Delete → removes 'b', buffer "ac"
    // Repaint the tail ("c"), blank the stale trailing cell, restore cursor.
    expect(writes.join('')).toBe('c \b\b');
  });

  it('history recall after moving the cursor clears the whole line and resets the caret to the end', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('first');
    await term.handleInput('\r');
    await term.handleInput('xyz'); // partial line
    await term.handleInput('\x1b[H'); // Home → caret at column 0, NOT the end
    await term.handleInput('\x1b[A'); // Up → recall "first"
    // Caret must be at the END of the recalled line, so typing appends.
    await term.handleInput('Q');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['first', 'firstQ']);
  });

  it('Ctrl+Left moves to the start of the previous word', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('foo bar baz');
    await term.handleInput('\x1b[1;5D'); // before baz
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['foo bar Xbaz']);
  });

  it('Ctrl+Right moves to the end of the next word', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('foo bar');
    await term.handleInput('\x1b[H');
    await term.handleInput('\x1b[1;5C'); // after foo
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['fooX bar']);
  });

  it('Alt+B/F use the same word-motion actions', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('foo bar');
    await term.handleInput('\x1bb'); // before bar
    await term.handleInput('X');
    await term.handleInput('\x1bf'); // after bar
    await term.handleInput('Y');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['foo XbarY']);
  });

  it('Ctrl+B/F move left/right like arrow keys', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x02'); // Ctrl+B
    await term.handleInput('\x02'); // Ctrl+B
    await term.handleInput('X');
    await term.handleInput('\x06'); // Ctrl+F
    await term.handleInput('Y');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['aXbYc']);
  });

  it('Ctrl+D forward-deletes at the cursor', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[H');
    await term.handleInput('\x04');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['bc']);
  });

  it('Ctrl+T transposes adjacent edit segments', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('ab');
    await term.handleInput('\x14');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ba']);
  });

  it('Ctrl+L clears the screen and redraws the prompt plus current buffer', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    const writes = tapWrites(term);
    await term.handleInput('\x0c');
    expect(writes.join('')).toContain('\x1b[2J\x1b[H');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['abc']);
  });

  it('Ctrl+L restores a mid-line caret after redrawing', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('abc');
    await term.handleInput('\x1b[D');
    await term.handleInput('\x1b[D');
    const writes = tapWrites(term);

    await term.handleInput('\x0c');

    expect(writes.join('')).toBe('\x1b[2J\x1b[H\x1b[90m> \x1b[0mabc\b\b');
    await term.handleInput('X');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['aXbc']);
  });
});

describe('RiftyTerminal — Emacs history aliases', () => {
  it('Ctrl+P/N navigate history like ArrowUp/Down', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('first');
    await term.handleInput('\r');
    await term.handleInput('second');
    await term.handleInput('\r');
    await term.handleInput('\x10');
    await term.handleInput('\x10');
    await term.handleInput('\x0e');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['first', 'second', 'second']);
  });
});

describe('RiftyTerminal — autosuggestions', () => {
  it('renders a dim suffix from the most recent matching history entry', async () => {
    const { term } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    const writes = tapWrites(term);
    await term.handleInput('git');
    expect(writes.join('')).toContain('\x1b[2m status\x1b[22m');
    expect(writes.join('')).toContain('\b'.repeat(' status'.length));
  });

  it('Right at end accepts the visible autosuggestion', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('git');
    await term.handleInput('\x1b[C');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'git status']);
  });

  it('does not accept autosuggestion when the caret is mid-line', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('git');
    await term.handleInput('\x1b[D');
    await term.handleInput('\x1b[C');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'git']);
  });

  it('renders host ghost text and accepts it as a line replacement', async () => {
    const { term, rec } = createTerminal({
      ghostSuggestion: (state) =>
        state.line === '# list files' ? { display: '  -> ls -la', replacement: 'ls -la' } : null,
    });
    const writes = tapWrites(term);

    await term.handleInput('# list files');
    await Promise.resolve();

    expect(writes.join('')).toContain('\x1b[2m  -> ls -la\x1b[22m');
    await term.handleInput('\x1b[C');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ls -la']);
  });

  it('drops stale async host ghost suggestions after the line changes', async () => {
    let resolveGhost: (value: { display: string; replacement: string }) => void = () => {
      throw new Error('ghost request was not started');
    };
    const { term } = createTerminal({
      ghostSuggestion: (state) => {
        if (state.line !== '# slow') return null;
        return new Promise((resolve) => {
          resolveGhost = resolve;
        });
      },
    });
    const writes = tapWrites(term);

    await term.handleInput('# slow');
    await term.handleInput('x');
    resolveGhost?.({ display: '  -> ls', replacement: 'ls' });
    await Promise.resolve();

    expect(writes.join('')).not.toContain('  -> ls');
  });

  it('submits the literal line when Enter is pressed with a visible host ghost', async () => {
    const { term, rec } = createTerminal({
      ghostSuggestion: (state) =>
        state.line === '# pwd' ? { display: '  -> pwd', replacement: 'pwd' } : null,
    });

    await term.handleInput('# pwd');
    await Promise.resolve();
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['# pwd']);
  });
});

describe('RiftyTerminal — kill ring', () => {
  it('Ctrl+U kills before the cursor and Ctrl+Y yanks it back', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('foo bar');
    await term.handleInput('\x15');
    await term.handleInput('\x19');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['foo bar']);
  });

  it('Ctrl+K kills after the cursor', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('foo bar');
    await term.handleInput('\x1b[H');
    await term.handleInput('\x0b');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['']);
  });

  it('Ctrl+W kills the previous whitespace-delimited word', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('foo-bar/baz qux');
    await term.handleInput('\x17');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['foo-bar/baz ']);
  });

  it('yanks at the caret and preserves the tail', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('hello world');
    await term.handleInput('\x17'); // kill world
    await term.handleInput('again');
    await term.handleInput('\x1b[H');
    await term.handleInput('\x19'); // yank world at start
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['worldhello again']);
  });

  it('Alt+D kills a word after the cursor and Ctrl+Y yanks it back', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('alpha beta');
    await term.handleInput('\x01'); // Ctrl+A
    await term.handleInput('\x1bd'); // Alt+D
    await term.handleInput('\x19'); // Ctrl+Y
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['alpha beta']);
  });

  it('Alt+Backspace kills the previous word', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('alpha beta');
    await term.handleInput('\x1b\x7f');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['alpha ']);
  });

  it('Alt+Y rotates the latest yank through the kill ring', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('one two');
    await term.handleInput('\x1b\x7f');
    await term.handleInput('\x1b\x7f');
    await term.handleInput('\x19'); // Ctrl+Y: "one "
    await term.handleInput('\x1by'); // Alt+Y: "two"
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['two']);
  });
});

describe('RiftyTerminal — undo', () => {
  it('Ctrl+_ undoes the latest inserted segment', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('\x1f');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['a']);
  });

  it('Ctrl+Z undoes a kill-ring edit when xterm delivers it', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('alpha beta');
    await term.handleInput('\x17');
    await term.handleInput('\x1a');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['alpha beta']);
  });

  it('undo restores the cursor position for mid-line edits', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('ab');
    await term.handleInput('\x1b[D');
    await term.handleInput('X');
    await term.handleInput('\x1f');
    await term.handleInput('Y');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['aYb']);
  });

  it('redo restores an edit undone by Ctrl+_', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('\x1f');
    term.redoLastEdit();
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ab']);
  });

  it('new edits clear redo history', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('b');
    await term.handleInput('\x1f');
    await term.handleInput('c');
    term.redoLastEdit();
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ac']);
  });
});

describe('RiftyTerminal — abbreviations and snippets', () => {
  it('expands a trigger token when Space is typed', async () => {
    const { term, rec } = createTerminal({
      rewriteRules: [{ trigger: 'g', replacement: 'git' }],
    });

    await term.handleInput('g');
    await term.handleInput(' ');
    await term.handleInput('status');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['git status']);
  });

  it('expands a trigger token before Enter submits', async () => {
    const { term, rec } = createTerminal({
      rewriteRules: [{ trigger: 'serve', replacement: 'npm run dev' }],
    });

    await term.handleInput('serve');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['npm run dev']);
  });

  it('makes abbreviation expansion undoable', async () => {
    const { term, rec } = createTerminal({
      rewriteRules: [{ trigger: 'g', replacement: 'git' }],
    });

    await term.handleInput('g');
    await term.handleInput(' ');
    await term.handleInput('\x1f');
    await term.handleInput('x');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['gx']);
  });
});

describe('RiftyTerminal — tab completion', () => {
  it('applies a unique completion replacement', async () => {
    const { rec } = createTerminal();
    const term = new RiftyTerminal({
      onInput: (line) => {
        rec.lines.push(line);
      },
      completer: () => ({ start: 0, end: 2, items: [{ value: 'npm ' }] }),
    });
    await term.handleInput('np');
    await term.handleInput('\t');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['npm ']);
  });

  it('extends to the longest common prefix for multiple completions', async () => {
    const { rec } = createTerminal();
    const term = new RiftyTerminal({
      onInput: (line) => {
        rec.lines.push(line);
      },
      completer: () => ({
        start: 0,
        end: 1,
        items: [{ value: 'git ' }, { value: 'gist ' }],
      }),
    });
    await term.handleInput('g');
    await term.handleInput('\t');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['gi']);
  });

  it('prints a menu when multiple completions share no longer prefix', async () => {
    const term = new RiftyTerminal({
      onInput: () => {},
      completer: () => ({
        start: 0,
        end: 2,
        items: [{ value: 'git ' }, { value: 'gist ' }],
      }),
    });
    const writes = tapWrites(term);
    await term.handleInput('gi');
    await term.handleInput('\t');
    expect(writes.join('')).toContain('git');
    expect(writes.join('')).toContain('gist');
  });
});

describe('RiftyTerminal — reverse history search', () => {
  it('Ctrl+R searches history backward and Enter accepts the newest match', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('npm test');
    await term.handleInput('\r');
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('git diff');
    await term.handleInput('\r');
    await term.handleInput('\x12');
    await term.handleInput('git');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['npm test', 'git status', 'git diff', 'git diff']);
  });

  it('repeated Ctrl+R moves to the next older match', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('git diff');
    await term.handleInput('\r');
    await term.handleInput('\x12');
    await term.handleInput('git');
    await term.handleInput('\x12');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'git diff', 'git status']);
  });

  it('Ctrl+G cancels reverse search and restores the original buffer', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('git status');
    await term.handleInput('\r');
    await term.handleInput('draft');
    await term.handleInput('\x12');
    await term.handleInput('git');
    await term.handleInput('\x07');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['git status', 'draft']);
  });
});

describe('RiftyTerminal — cell-width-aware editing', () => {
  it('ArrowLeft moves over a CJK wide character by two terminal cells', async () => {
    const { term } = createTerminal();
    await term.handleInput('界');
    const writes = tapWrites(term);
    await term.handleInput('\x1b[D');
    expect(writes.join('')).toBe('\b\b');
  });

  it('ArrowRight moves over an emoji surrogate pair as one wide glyph', async () => {
    const { term } = createTerminal();
    await term.handleInput('😀');
    await term.handleInput('\x1b[H');
    const writes = tapWrites(term);
    await term.handleInput('\x1b[C');
    expect(writes.join('')).toBe('\x1b[C\x1b[C');
  });

  it('Backspace deletes a full emoji glyph instead of one UTF-16 code unit', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a😀b');
    await term.handleInput('\x1b[D'); // before b, after the emoji
    await term.handleInput('\x7f'); // remove emoji
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ab']);
  });

  it('Delete removes a full emoji glyph at the caret', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a😀b');
    await term.handleInput('\x1b[H');
    await term.handleInput('\x1b[C'); // after a, before emoji
    await term.handleInput('\x1b[3~'); // remove emoji
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ab']);
  });

  it('mid-line insert restores the caret by the tail display width', async () => {
    const { term } = createTerminal();
    await term.handleInput('a界');
    await term.handleInput('\x1b[D'); // before wide tail
    const writes = tapWrites(term);
    await term.handleInput('b');
    expect(writes.join('')).toBe(`b界${'\b'.repeat(2)}`);
  });

  it('Home moves left by display-cell width, not JS string length', async () => {
    const { term } = createTerminal();
    await term.handleInput('a界😀');
    const writes = tapWrites(term);
    await term.handleInput('\x1b[H');
    expect(writes.join('')).toBe('\b'.repeat(5));
  });

  it('keeps a combining accent with its base glyph while moving and deleting', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('e\u0301b');
    await term.handleInput('\x1b[D'); // before b, after accented e
    await term.handleInput('\x7f'); // remove accented e as one visible glyph
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['b']);
  });
});

describe('RiftyTerminal — command-line highlighting', () => {
  it('renders highlighter spans but submits the raw input line', async () => {
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
    const term = new RiftyTerminal({
      highlighter: () => [{ start: 0, end: 4, foreground: '#7fb2ff' }],
      onInput: (line) => {
        rec.lines.push(line);
      },
    });
    const writes = tapWrites(term);

    await term.handleInput('echo');
    await term.handleInput('\r');

    expect(writes.join('')).toContain('\x1b[38;2;127;178;255mecho\x1b[39m');
    expect(rec.lines).toEqual(['echo']);
  });

  it('restores the caret by raw tail width, not SGR byte length, during highlighted mid-line edits', async () => {
    const term = new RiftyTerminal({
      highlighter: () => [{ start: 0, end: 3, foreground: '#7fb2ff' }],
      onInput: () => {},
    });
    await term.handleInput('ac');
    await term.handleInput('\x1b[D');
    const writes = tapWrites(term);

    await term.handleInput('b');

    expect(writes).toEqual([
      `\x1b[?25l\r${'\x1b[C'.repeat(2)}\x1b[K\x1b[38;2;127;178;255mabc\x1b[39m\r${'\x1b[C'.repeat(4)}\x1b[?25h`,
    ]);
  });

  it('highlights host replaceLine redraws while submitting raw text', async () => {
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
    const term = new RiftyTerminal({
      highlighter: () => [{ start: 0, end: 4, foreground: '#7fb2ff' }],
      onInput: (line) => {
        rec.lines.push(line);
      },
    });
    const writes = tapWrites(term);

    term.replaceLine('echo hi');
    await term.handleInput('\r');

    expect(writes.join('')).toContain('\x1b[38;2;127;178;255mecho\x1b[39m hi');
    expect(rec.lines).toEqual(['echo hi']);
  });

  it('highlights recalled history lines', async () => {
    const term = new RiftyTerminal({
      highlighter: () => [{ start: 0, end: 4, foreground: '#7fb2ff' }],
      onInput: () => {},
    });
    await term.handleInput('echo hi');
    await term.handleInput('\r');
    const writes = tapWrites(term);

    await term.handleInput('\x1b[A');

    expect(writes.join('')).toContain('\x1b[38;2;127;178;255mecho\x1b[39m hi');
  });
});

describe('RiftyTerminal — multiline input validator', () => {
  it('inserts a newline on Enter while input is incomplete, then submits when complete', async () => {
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
    const term = new RiftyTerminal({
      inputValidator: (line) => (line.endsWith('\\') ? 'incomplete' : 'complete'),
      onInput: (line) => {
        rec.lines.push(line);
      },
    });
    const writes = tapWrites(term);

    await term.handleInput('echo \\');
    await term.handleInput('\r');
    expect(rec.lines).toEqual([]);
    expect(writes.join('')).toContain('\r\n');

    await term.handleInput('next');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['echo \\\nnext']);
  });

  it('undo removes a validator-inserted newline', async () => {
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
    const term = new RiftyTerminal({
      inputValidator: (line) => (line.endsWith('\\') ? 'incomplete' : 'complete'),
      onInput: (line) => {
        rec.lines.push(line);
      },
    });

    await term.handleInput('echo \\');
    await term.handleInput('\r');
    await term.handleInput('\x1f');
    await term.handleInput('x');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['echo \\x']);
  });

  it('inserts validator newlines at the caret', async () => {
    let incomplete = true;
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
    const term = new RiftyTerminal({
      inputValidator: () => {
        if (!incomplete) return 'complete';
        incomplete = false;
        return 'incomplete';
      },
      onInput: (line) => {
        rec.lines.push(line);
      },
    });

    await term.handleInput('ab');
    await term.handleInput('\x1b[D');
    await term.handleInput('\r');
    await term.handleInput('X');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['a\nXb']);
  });
});

describe('RiftyTerminal — wrapped-line cursor layout', () => {
  it('moves the caret across a wrapped row before mid-line insert', async () => {
    const { term, rec } = createTerminal();
    internalXterm(term).resize(8, 24);
    await term.handleInput('abcdefg');
    const writes = tapWrites(term);

    await term.handleInput('\x1b[D');
    await term.handleInput('\x1b[D');
    await term.handleInput('X');
    await term.handleInput('\r');

    expect(writes).toContain(`\r\x1b[A${'\x1b[C'.repeat(7)}`);
    expect(rec.lines).toEqual(['abcdeXfg']);
  });

  it('repaints and clears wrapped stale cells after Delete', async () => {
    const { term, rec } = createTerminal();
    internalXterm(term).resize(8, 24);
    await term.handleInput('abcdefg');
    await term.handleInput('\x1b[D');
    await term.handleInput('\x1b[D');
    const writes = tapWrites(term);

    await term.handleInput('\x1b[3~');
    await term.handleInput('\r');

    expect(writes.join('')).toContain('\x1b[K\x1b[B\r\x1b[K');
    expect(rec.lines).toEqual(['abcdeg']);
  });

  it('clears wrapped rows when history recall replaces a long line', async () => {
    const { term } = createTerminal();
    internalXterm(term).resize(8, 24);
    await term.handleInput('z');
    await term.handleInput('\r');
    await term.handleInput('abcdefg');
    await term.handleInput('\x1b[D');
    const writes = tapWrites(term);

    await term.handleInput('\x1b[A');

    expect(writes.join('')).toContain('\x1b[K\x1b[B\r\x1b[K');
  });
});

describe('RiftyTerminal — Ctrl+C', () => {
  it('invokes onSignal("SIGINT")', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('\x03');
    expect(rec.signals).toEqual(['SIGINT']);
  });

  it('echoes "^C\\r\\n" to xterm BEFORE emitting the signal', async () => {
    const writes: string[] = [];
    // Spy on the xterm `.write` calls. We do that by replacing the
    // xterm instance's `write` method via the prototype property the
    // class accesses internally.
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
    const term = new RiftyTerminal({
      onInput: (line) => {
        rec.lines.push(line);
      },
      onSignal: (sig) => {
        rec.signals.push(sig);
        writes.push('<SIGNAL>');
      },
    });
    // Tap the underlying xterm `.write` — accessed through the private
    // field for test verification only.
    const internalTerm = (term as unknown as { term: { write: (s: string) => void } }).term;
    const origWrite = internalTerm.write.bind(internalTerm);
    internalTerm.write = (s: string) => {
      writes.push(s);
      origWrite(s);
    };

    await term.handleInput('\x03');

    // The first write after Ctrl+C must be the visible echo. The
    // SIGNAL marker must come AFTER it.
    const echoIdx = writes.indexOf('^C\r\n');
    const signalIdx = writes.indexOf('<SIGNAL>');
    expect(echoIdx).toBeGreaterThanOrEqual(0);
    expect(signalIdx).toBeGreaterThan(echoIdx);
  });

  it('clears the in-progress buffer so the next Enter does not submit garbage', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('h');
    await term.handleInput('a');
    await term.handleInput('l');
    await term.handleInput('f');
    await term.handleInput('\x03'); // Ctrl+C mid-typing.
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['']);
  });

  it('is processed even while a command is running (busy=true)', async () => {
    // Reproduce the bug: with the old `busy=true` gate at the top of
    // handleData, Ctrl+C during a long-running command was silently
    // dropped. The fix processes Ctrl+C before the busy check.
    const rec: Recorder = { lines: [], signals: [], resolveNextInput: () => {} };
    const slot: { resolve: (() => void) | null } = { resolve: null };
    const term = new RiftyTerminal({
      onInput: () =>
        new Promise<void>((resolve) => {
          slot.resolve = resolve;
        }),
      onSignal: (sig) => {
        rec.signals.push(sig);
      },
    });
    // Start a "long-running" command.
    const enterPromise = term.handleInput('\r');
    // The handler is now awaiting our onInput promise, busy=true.
    await Promise.resolve();
    // Ctrl+C should still go through.
    await term.handleInput('\x03');
    expect(rec.signals).toEqual(['SIGINT']);
    // Unblock the command so the test doesn't leak a promise.
    slot.resolve?.();
    await enterPromise;
  });

  it('forwards non-Ctrl+C bytes to raw input while a command is running', async () => {
    const raw: TerminalRawInput[] = [];
    const slot: { resolve: (() => void) | null } = { resolve: null };
    const term = new RiftyTerminal({
      onInput: () =>
        new Promise<void>((resolve) => {
          slot.resolve = resolve;
        }),
      onRawInput: (data) => raw.push(data),
    });

    const enterPromise = term.handleInput('\r');
    await Promise.resolve();
    await term.handleInput('\x1b[<0;10;20M');

    expect(raw).toEqual(['\x1b[<0;10;20M']);
    slot.resolve?.();
    await enterPromise;
  });

  it('forwards xterm binary input as bytes while a command is running', async () => {
    const raw: Uint8Array[] = [];
    const slot: { resolve: (() => void) | null } = { resolve: null };
    const term = new RiftyTerminal({
      onInput: () =>
        new Promise<void>((resolve) => {
          slot.resolve = resolve;
        }),
      onRawInput: (data) => {
        if (typeof data !== 'string') raw.push(data);
      },
    });

    const enterPromise = term.handleInput('\r');
    await Promise.resolve();
    term.handleBinaryInput('M !\u0080');

    expect(Array.from(raw[0] ?? [])).toEqual([0x4d, 0x20, 0x21, 0x80]);
    slot.resolve?.();
    await enterPromise;
  });

  it('does NOT throw when onSignal is not provided (REPL-only mode)', async () => {
    const term = new RiftyTerminal({
      onInput: () => {},
    });
    await expect(term.handleInput('\x03')).resolves.toBeUndefined();
  });
});

describe('RiftyTerminal — paste handling', () => {
  it('appends a multi-line paste in one shot (preserves embedded \\n)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('line1\nline2');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['line1\nline2']);
  });

  it('appends a paste containing a literal tab', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a\tb');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['a\tb']);
  });

  it('strips embedded ESC bytes from a paste (CSI-injection safety)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('safe\x1b[Aevil');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['safeevil']);
  });
});

describe('RiftyTerminal — other input', () => {
  it('writes via .write() do not get fed back as input', async () => {
    const { term, rec } = createTerminal();
    term.write('output from program\n');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['']);
  });

  it('redraws an in-progress input line after async output', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('next');
    const writes = tapWrites(term);

    term.write('[1] Done slow\n');
    await term.handleInput('\r');

    expect(writes.join('')).toContain('[1] Done slow\r\n');
    expect(writes.join('')).toContain('\x1b[90m> \x1b[0mnext');
    expect(rec.lines).toEqual(['next']);
  });

  it('drops lone unprintable control bytes that are not whitelisted', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('\x0c'); // form feed — not whitelisted
    await term.handleInput('b');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ab']);
  });
});

describe('RiftyTerminal — onSignal contract', () => {
  it('passes "SIGINT" exactly (so the host can match a string literal)', async () => {
    const onSignal = vi.fn();
    const term = new RiftyTerminal({
      onInput: () => {},
      onSignal,
    });
    await term.handleInput('\x03');
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith('SIGINT');
  });
});

describe('RiftyTerminal — dimensions', () => {
  it('exposes cols/rows so the host can forward ctx.cols/ctx.rows into the shell', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    // xterm defaults to 80x24 before mount(); the getters must surface them.
    expect(term.cols).toBeGreaterThan(0);
    expect(term.rows).toBeGreaterThan(0);
  });
});

describe('RiftyTerminal — options polish API', () => {
  it('threads theme/font/accessibility/cursor options into xterm defaults', () => {
    const theme = { background: '#101010', foreground: '#eeeeee' };
    const term = new RiftyTerminal({
      onInput: () => {},
      theme,
      fontFamily: 'Test Mono',
      fontSize: 15,
      minimumContrastRatio: 7,
      screenReaderMode: true,
      cursorStyle: 'bar',
      macOptionIsMeta: true,
    });
    const xterm = internalXterm(term);
    expect(xterm.options.theme).toEqual(theme);
    expect(xterm.options.fontFamily).toBe('Test Mono');
    expect(xterm.options.fontSize).toBe(15);
    expect(xterm.options.minimumContrastRatio).toBe(7);
    expect(xterm.options.screenReaderMode).toBe(true);
    expect(xterm.options.cursorStyle).toBe('bar');
    expect(xterm.options.macOptionIsMeta).toBe(true);
  });

  it('defaults minimumContrastRatio to 4.5', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    expect(internalXterm(term).options.minimumContrastRatio).toBe(4.5);
  });

  it('threads lineHeight into xterm and defaults it to 1', () => {
    const custom = new RiftyTerminal({ onInput: () => {}, lineHeight: 19 / 12 });
    expect(internalXterm(custom).options.lineHeight).toBeCloseTo(19 / 12);
    const fallback = new RiftyTerminal({ onInput: () => {} });
    expect(internalXterm(fallback).options.lineHeight).toBe(1);
  });

  it('strips bracketed paste wrappers at the xterm paste boundary', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    expect(internalXterm(term).options.ignoreBracketedPasteMode).toBe(true);
  });

  it('routes OSC 8 link activation through the host webLinks handler', () => {
    const opened: string[] = [];
    const term = new RiftyTerminal({
      onInput: () => {},
      webLinks: { onLink: (uri) => opened.push(uri) },
    });
    const handler = internalXterm(term).options.linkHandler as TestLinkHandler;

    expect(handler.allowNonHttpProtocols).toBe(true);
    handler.activate({ ctrlKey: true } as MouseEvent, 'file:///workspace/src/main.js');

    expect(opened).toEqual(['file:///workspace/src/main.js']);
  });

  it('setTheme swaps the xterm theme option', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    const theme = { background: '#ffffff', foreground: '#000000' };
    term.setTheme(theme);
    expect(internalXterm(term).options.theme).toEqual(theme);
  });

  it('focus delegates to xterm focus', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    const xterm = internalXterm(term);
    const focus = vi.fn();
    xterm.focus = focus;
    term.focus();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('replaceLine redraws and focuses the current input buffer for host overlays', async () => {
    const { term, rec } = createTerminal();
    const xterm = internalXterm(term);
    const focus = vi.fn();
    xterm.focus = focus;

    await term.handleInput('old');
    term.replaceLine('echo hi');
    await term.handleInput('\r');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(rec.lines).toEqual(['echo hi']);
  });

  it('replaceLine can restore the caret before the line end', async () => {
    const { term, rec } = createTerminal();

    term.replaceLine('abc', 1);
    await term.handleInput('X');
    await term.handleInput('\r');

    expect(rec.lines).toEqual(['aXbc']);
  });

  it('submitLine replaces then runs through the same Enter path', async () => {
    const { term, rec } = createTerminal();

    await term.handleInput('old');
    await term.submitLine('pwd');

    expect(rec.lines).toEqual(['pwd']);
  });

  it('loads constructor-safe xterm addon drop-ins and switches output widths to Unicode 11', () => {
    const term = new RiftyTerminal({
      onInput: () => {},
      search: { highlightLimit: 25 },
    });

    expect(addonMocks.loaded).toEqual(['unicode11', 'web-links', 'search', 'image', 'serialize']);
    expect(addonMocks.searchOptions).toEqual([{ highlightLimit: 25 }]);
    expect(internalXterm(term).unicode.activeVersion).toBe('11');
  });

  it('gates web links on Ctrl/Cmd-click and delegates to the host opener', () => {
    const opened: string[] = [];
    new RiftyTerminal({
      onInput: () => {},
      webLinks: {
        onLink: (uri) => opened.push(uri),
      },
    });
    const handler = addonMocks.webLinkHandler;
    expect(handler).toBeTypeOf('function');

    handler?.({ ctrlKey: false, metaKey: false } as MouseEvent, 'https://example.test/nope');
    handler?.({ ctrlKey: true, metaKey: false } as MouseEvent, 'https://example.test/yes');
    handler?.({ ctrlKey: false, metaKey: true } as MouseEvent, 'https://example.test/mac');

    expect(opened).toEqual(['https://example.test/yes', 'https://example.test/mac']);
  });

  it('delegates search and serialize helpers to their loaded addons', () => {
    const term = new RiftyTerminal({ onInput: () => {} });

    expect(term.findNext('needle', { caseSensitive: true })).toBe(true);
    expect(addonMocks.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({
        caseSensitive: true,
        decorations: expect.objectContaining({ matchOverviewRuler: '#6cb6ff' }),
      }),
    );

    expect(term.findPrevious('needle')).toBe(false);
    expect(addonMocks.findPrevious).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({
        decorations: expect.objectContaining({ activeMatchColorOverviewRuler: '#f2cc60' }),
      }),
    );

    expect(term.serializeText({ scrollback: 5 })).toBe('serialized text');
    expect(addonMocks.serialize).toHaveBeenCalledWith({ scrollback: 5 });
    expect(term.serializeHtml({ onlySelection: true })).toBe('<pre>serialized html</pre>');
    expect(addonMocks.serializeAsHTML).toHaveBeenCalledWith({ onlySelection: true });
  });

  it('clears search on an empty search term', () => {
    const term = new RiftyTerminal({ onInput: () => {} });

    expect(term.findNext('')).toBe(false);
    expect(addonMocks.clearDecorations).toHaveBeenCalledTimes(1);
    expect(addonMocks.findNext).not.toHaveBeenCalled();
  });

  it('throws loudly when optional wrappers are disabled', () => {
    const term = new RiftyTerminal({
      onInput: () => {},
      search: false,
      serialize: false,
    });

    expect(() => term.findNext('needle')).toThrow('terminal.search unavailable');
    expect(() => term.serializeText()).toThrow('terminal.serialize unavailable');
  });

  it('loads WebGL best-effort and disposes it on context loss', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    const loadWebglAddon = (term as unknown as { loadWebglAddon(): void }).loadWebglAddon.bind(
      term,
    );

    loadWebglAddon();
    expect(addonMocks.loaded).toContain('webgl');
    expect(addonMocks.contextLossListener).toBeTypeOf('function');

    addonMocks.contextLossListener?.();

    expect(addonMocks.webglDisposed).toBe(1);
  });

  it('does not throw when an addon fails during terminal dispose', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    const disposable = {
      dispose: vi.fn(() => {
        throw new Error('addon dispose failed');
      }),
    };
    (term as unknown as { disposables: Array<{ dispose(): void }> }).disposables.push(disposable);

    expect(() => term.dispose()).not.toThrow();
    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it('copyOnSelect writes non-empty selections through the injected clipboard', () => {
    const writes: string[] = [];
    const term = new RiftyTerminal({
      onInput: () => {},
      copyOnSelect: true,
      clipboard: {
        writeText: (text) => {
          writes.push(text);
        },
      },
    });
    const xterm = internalXterm(term);
    xterm.getSelection = () => 'selected';
    const selectionListeners = (term as unknown as { selectionListeners: Array<() => void> })
      .selectionListeners;
    for (const listener of selectionListeners) listener();
    expect(writes).toEqual(['selected']);
  });

  it('copyOnSelect ignores empty selections', () => {
    const writes: string[] = [];
    const term = new RiftyTerminal({
      onInput: () => {},
      copyOnSelect: true,
      clipboard: {
        writeText: (text) => {
          writes.push(text);
        },
      },
    });
    const xterm = internalXterm(term);
    xterm.getSelection = () => '';
    const selectionListeners = (term as unknown as { selectionListeners: Array<() => void> })
      .selectionListeners;
    for (const listener of selectionListeners) listener();
    expect(writes).toEqual([]);
  });

  it('strips OSC 52 clipboard writes without touching the clipboard by default', () => {
    const writes: string[] = [];
    const term = new RiftyTerminal({
      onInput: () => {},
      clipboard: {
        writeText: (text) => {
          writes.push(text);
        },
      },
    });
    const screen = tapWrites(term);
    term.write(`before\x1b]52;c;${globalThis.btoa('copied')}\x07after`);

    expect(writes).toEqual([]);
    expect(screen.join('')).toBe('beforeafter');
  });

  it('handles OSC 52 clipboard writes when explicitly enabled', () => {
    const writes: string[] = [];
    const term = new RiftyTerminal({
      onInput: () => {},
      allowOsc52Clipboard: true,
      clipboard: {
        writeText: (text) => {
          writes.push(text);
        },
      },
    });
    const screen = tapWrites(term);
    term.write(`before\x1b]52;c;${globalThis.btoa('copied')}\x07after`);

    expect(writes).toEqual(['copied']);
    expect(screen.join('')).toBe('beforeafter');
  });
});

describe('RiftyTerminal — edit state host seam', () => {
  it('emits editable line and cursor changes for host overlays', async () => {
    const states: Array<{ line: string; cursor: number }> = [];
    const term = new RiftyTerminal({
      onInput: () => {},
      onEditStateChange: (state) => states.push(state),
    });

    await term.handleInput('ab');
    await term.handleInput('\x1b[D');

    expect(states).toContainEqual({ line: 'ab', cursor: 2 });
    expect(states.at(-1)).toEqual({ line: 'ab', cursor: 1 });
  });
});

describe('RiftyTerminal — command marker substrate', () => {
  it('records command blocks with exit code without coloring terminal cells', async () => {
    const term = new RiftyTerminal({
      onInput: () => 7,
    });
    const xterm = internalXterm(term);
    let nextLine = 10;
    const decorations: Array<Record<string, unknown>> = [];
    xterm.registerMarker = () => ({
      id: nextLine,
      line: nextLine++,
      dispose(): void {},
    });
    xterm.registerDecoration = (options) => {
      decorations.push(options);
      return { dispose(): void {} };
    };

    await term.handleInput('bad');
    await term.handleInput('\r');

    expect(term.getCommandBlocks()).toEqual([
      {
        id: 1,
        command: 'bad',
        exitCode: 7,
        startLine: 10,
        endLine: 11,
      },
    ]);
    expect(decorations).toEqual([]);
  });

  it('records success and void exit codes without terminal cell decorations', async () => {
    const ok = new RiftyTerminal({ onInput: () => 0 });
    const okXterm = internalXterm(ok);
    const okDecorations: Array<Record<string, unknown>> = [];
    okXterm.registerMarker = () => ({ id: 1, line: 1, dispose(): void {} });
    okXterm.registerDecoration = (options) => {
      okDecorations.push(options);
      return { dispose(): void {} };
    };
    await ok.handleInput('true');
    await ok.handleInput('\r');
    expect(ok.getCommandBlocks()[0]?.exitCode).toBe(0);
    expect(okDecorations).toEqual([]);

    const noCode = new RiftyTerminal({ onInput: () => {} });
    const noCodeXterm = internalXterm(noCode);
    const noCodeDecorations: Array<Record<string, unknown>> = [];
    noCodeXterm.registerMarker = () => ({ id: 2, line: 2, dispose(): void {} });
    noCodeXterm.registerDecoration = (options) => {
      noCodeDecorations.push(options);
      return { dispose(): void {} };
    };
    await noCode.handleInput('repl');
    await noCode.handleInput('\r');
    expect(noCode.getCommandBlocks()[0]?.exitCode).toBeUndefined();
    expect(noCodeDecorations).toEqual([]);
  });

  it('scrolls and selects recorded command blocks', async () => {
    const term = new RiftyTerminal({ onInput: () => 0 });
    const xterm = internalXterm(term);
    const lines = [3, 6];
    const scrolled: number[] = [];
    const selected: Array<[number, number]> = [];
    xterm.registerMarker = () => {
      const line = lines.shift() ?? 9;
      return { id: line, line, dispose(): void {} };
    };
    xterm.registerDecoration = () => ({ dispose(): void {} });
    xterm.scrollToLine = (line) => scrolled.push(line);
    xterm.selectLines = (start, end) => selected.push([start, end]);

    await term.handleInput('echo hi');
    await term.handleInput('\r');
    const block = term.getCommandBlocks()[0];
    expect(block).toBeDefined();
    term.scrollToBlock(block!.id);
    term.selectBlockOutput(block!.id);
    expect(scrolled).toEqual([3]);
    expect(selected).toEqual([[3, 6]]);
  });

  it('copies recorded command block output through the clipboard port', async () => {
    const copied: string[] = [];
    const term = new RiftyTerminal({
      onInput: () => 0,
      clipboard: {
        writeText: (text) => {
          copied.push(text);
        },
      },
    });
    const xterm = internalXterm(term);
    const lines = [3, 6];
    const selected: Array<[number, number]> = [];
    xterm.registerMarker = () => {
      const line = lines.shift() ?? 9;
      return { id: line, line, dispose(): void {} };
    };
    xterm.registerDecoration = () => ({ dispose(): void {} });
    xterm.selectLines = (start, end) => selected.push([start, end]);
    xterm.getSelection = () => 'echo hi\r\nhi';

    await term.handleInput('echo hi');
    await term.handleInput('\r');
    const block = term.getCommandBlocks()[0];
    expect(block).toBeDefined();
    term.copyBlockOutput(block!.id);

    expect(selected).toEqual([[3, 6]]);
    expect(copied).toEqual(['echo hi\r\nhi']);
  });

  it('jumps to previous and next command blocks relative to the viewport', async () => {
    const term = new RiftyTerminal({ onInput: () => 0 });
    const xterm = internalXterm(term);
    const markerLines = [3, 4, 8, 9, 15, 16];
    const scrolled: number[] = [];
    xterm.registerMarker = () => {
      const line = markerLines.shift() ?? 99;
      return { id: line, line, dispose(): void {} };
    };
    xterm.registerDecoration = () => ({ dispose(): void {} });
    xterm.scrollToLine = (line) => scrolled.push(line);
    Object.defineProperty(xterm, 'buffer', {
      configurable: true,
      value: { active: { viewportY: 9 } },
    });

    await term.handleInput('one');
    await term.handleInput('\r');
    await term.handleInput('two');
    await term.handleInput('\r');
    await term.handleInput('three');
    await term.handleInput('\r');

    term.jumpBlockPrev();
    term.jumpBlockNext();
    await term.handleInput('\x1b[1;5A');
    await term.handleInput('\x1b[1;5B');

    expect(scrolled).toEqual([8, 15, 8, 15]);
  });

  it('selects previous and next command blocks with Ctrl+Shift navigation', async () => {
    const term = new RiftyTerminal({ onInput: () => 0 });
    const xterm = internalXterm(term);
    const markerLines = [3, 4, 8, 9, 15, 16];
    const selected: Array<[number, number]> = [];
    xterm.registerMarker = () => {
      const line = markerLines.shift() ?? 99;
      return { id: line, line, dispose(): void {} };
    };
    xterm.registerDecoration = () => ({ dispose(): void {} });
    xterm.selectLines = (start, end) => selected.push([start, end]);
    Object.defineProperty(xterm, 'buffer', {
      configurable: true,
      value: { active: { viewportY: 9 } },
    });

    await term.handleInput('one');
    await term.handleInput('\r');
    await term.handleInput('two');
    await term.handleInput('\r');
    await term.handleInput('three');
    await term.handleInput('\r');
    await term.handleInput('\x1b[1;6A');
    await term.handleInput('\x1b[1;6B');

    expect(selected).toEqual([
      [8, 9],
      [15, 16],
    ]);
  });

  it('exposes the current viewport line for sticky command headers', () => {
    const term = new RiftyTerminal({ onInput: () => {} });
    const xterm = internalXterm(term);
    Object.defineProperty(xterm, 'buffer', {
      configurable: true,
      value: { active: { viewportY: 42 } },
    });

    expect(term.getViewportLine()).toBe(42);
  });

  it('notifies when command blocks are added and then completed', async () => {
    const snapshots: unknown[] = [];
    const term = new RiftyTerminal({
      onInput: () => 0,
      onCommandBlocksChange: (blocks) => snapshots.push(blocks.map((block) => ({ ...block }))),
    });
    const xterm = internalXterm(term);
    const markerLines = [5, 7];
    xterm.registerMarker = () => {
      const line = markerLines.shift() ?? 9;
      return { id: line, line, dispose(): void {} };
    };
    xterm.registerDecoration = () => ({ dispose(): void {} });

    await term.handleInput('echo hi');
    await term.handleInput('\r');

    expect(snapshots).toEqual([
      [{ id: 1, command: 'echo hi', startLine: 5, endLine: 5 }],
      [{ id: 1, command: 'echo hi', exitCode: 0, startLine: 5, endLine: 7 }],
    ]);
  });

  it('exposes a stable serialized buffer snapshot for tests/debug UI', () => {
    const term = new RiftyTerminal({ onInput: () => {} });

    expect(term.snapshotBuffer()).toBe('serialized text');
    expect(addonMocks.serialize).toHaveBeenCalledWith({ excludeModes: true });
  });

  it('reports busy input when foreground stdin owns typed data', async () => {
    const rawInputs: TerminalRawInput[] = [];
    const busyInputs: unknown[] = [];
    const { term, rec } = createTerminal({
      onRawInput: (data) => rawInputs.push(data),
      onBusyInput: (event) => busyInputs.push(event),
    });
    rec.resolveNextInput = () => {};

    const pending = term.handleInput('\r');
    await term.handleInput('next command');
    rec.resolveNextInput?.();
    await pending;

    expect(rawInputs).toEqual(['next command']);
    expect(busyInputs).toEqual([{ data: 'next command', binary: false }]);
  });

  it('accepts a new command after a non-zero foreground command exits', async () => {
    const lines: string[] = [];
    const term = new RiftyTerminal({
      onInput: (line) => {
        lines.push(line);
        return line === 'bad' ? 1 : 0;
      },
    });

    await term.submitLine('bad');
    await term.submitLine('echo after');

    expect(lines).toEqual(['bad', 'echo after']);
    expect(term.getCommandBlocks().map((block) => block.exitCode)).toEqual([1, 0]);
  });
});
