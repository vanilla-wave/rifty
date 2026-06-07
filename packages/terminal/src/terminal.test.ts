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
import { describe, expect, it, vi } from 'vitest';

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

import { RiftyTerminal } from './terminal.ts';

interface Recorder {
  lines: string[];
  signals: 'SIGINT'[];
  // Resolves the next `onInput` call to simulate a long-running command.
  resolveNextInput: (() => void) | null;
}

function createTerminal(): { term: RiftyTerminal; rec: Recorder } {
  const rec: Recorder = { lines: [], signals: [], resolveNextInput: null };
  const term = new RiftyTerminal({
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

  it('ArrowLeft / ArrowRight are swallowed (not appended to the buffer)', async () => {
    const { term, rec } = createTerminal();
    await term.handleInput('a');
    await term.handleInput('\x1b[D'); // Left
    await term.handleInput('\x1b[C'); // Right
    await term.handleInput('b');
    await term.handleInput('\r');
    expect(rec.lines).toEqual(['ab']);
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
