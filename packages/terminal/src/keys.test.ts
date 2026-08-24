import { describe, expect, it } from 'vitest';
import { classifyKey } from './keys.ts';

describe('classifyKey — control bytes', () => {
  it('classifies CR (\\r) as Enter', () => {
    expect(classifyKey('\r')).toEqual({ kind: 'enter' });
  });

  it('classifies a standalone LF (\\n) as Enter (some terminals send it)', () => {
    expect(classifyKey('\n')).toEqual({ kind: 'enter' });
  });

  it('classifies DEL (\\x7f) as Backspace — the xterm.js default', () => {
    expect(classifyKey('\x7f')).toEqual({ kind: 'backspace' });
  });

  it('classifies BS (\\x08) as Backspace — for terminals configured that way', () => {
    expect(classifyKey('\x08')).toEqual({ kind: 'backspace' });
  });

  it('classifies HT (\\t) as Tab', () => {
    expect(classifyKey('\t')).toEqual({ kind: 'tab' });
  });

  it('classifies NUL (\\x00, Ctrl+Space) as Tab completion', () => {
    expect(classifyKey('\x00')).toEqual({ kind: 'tab' });
  });

  it('classifies ETX (\\x03) as Ctrl+C', () => {
    expect(classifyKey('\x03')).toEqual({ kind: 'ctrl-c' });
  });

  it('classifies SOH (\\x01, Ctrl+A) as Home', () => {
    expect(classifyKey('\x01')).toEqual({ kind: 'home' });
  });

  it('classifies ENQ (\\x05, Ctrl+E) as End', () => {
    expect(classifyKey('\x05')).toEqual({ kind: 'end' });
  });
});

describe('classifyKey — Home / End / Delete (CSI + SS3 sequences)', () => {
  it('classifies ESC [ H as Home', () => {
    expect(classifyKey('\x1b[H')).toEqual({ kind: 'home' });
  });

  it('classifies ESC [ 1 ~ as Home', () => {
    expect(classifyKey('\x1b[1~')).toEqual({ kind: 'home' });
  });

  it('classifies ESC O H (SS3) as Home', () => {
    expect(classifyKey('\x1bOH')).toEqual({ kind: 'home' });
  });

  it('classifies ESC [ F as End', () => {
    expect(classifyKey('\x1b[F')).toEqual({ kind: 'end' });
  });

  it('classifies ESC [ 4 ~ as End', () => {
    expect(classifyKey('\x1b[4~')).toEqual({ kind: 'end' });
  });

  it('classifies ESC O F (SS3) as End', () => {
    expect(classifyKey('\x1bOF')).toEqual({ kind: 'end' });
  });

  it('classifies ESC [ 3 ~ as Delete (forward-delete)', () => {
    expect(classifyKey('\x1b[3~')).toEqual({ kind: 'delete' });
  });
});

describe('classifyKey — arrow keys (CSI sequences)', () => {
  it('classifies ESC [ A as ArrowUp', () => {
    expect(classifyKey('\x1b[A')).toEqual({ kind: 'arrow-up' });
  });

  it('classifies ESC [ B as ArrowDown', () => {
    expect(classifyKey('\x1b[B')).toEqual({ kind: 'arrow-down' });
  });

  it('classifies ESC [ C as ArrowRight', () => {
    expect(classifyKey('\x1b[C')).toEqual({ kind: 'arrow-right' });
  });

  it('classifies ESC [ D as ArrowLeft', () => {
    expect(classifyKey('\x1b[D')).toEqual({ kind: 'arrow-left' });
  });

  it('does NOT match the bare characters "[A" (without ESC) — that came from a stripped-byte bug', () => {
    const ev = classifyKey('[A');
    expect(ev.kind).toBe('printable');
    if (ev.kind === 'printable') expect(ev.text).toBe('[A');
  });

  it('ignores unknown CSI sequences (does not let them reach the line buffer)', () => {
    const ev = classifyKey('\x1b[E');
    expect(ev.kind).toBe('ignored');
  });
});

describe('classifyKey — word motion', () => {
  it('classifies Ctrl+Up/Down as command-block navigation', () => {
    expect(classifyKey('\x1b[1;5A')).toEqual({ kind: 'command-prev' });
    expect(classifyKey('\x1b[5A')).toEqual({ kind: 'command-prev' });
    expect(classifyKey('\x1b[1;5B')).toEqual({ kind: 'command-next' });
    expect(classifyKey('\x1b[5B')).toEqual({ kind: 'command-next' });
  });

  it('classifies Ctrl+Shift+Up/Down as command-block selection', () => {
    expect(classifyKey('\x1b[1;6A')).toEqual({ kind: 'command-prev-select' });
    expect(classifyKey('\x1b[6A')).toEqual({ kind: 'command-prev-select' });
    expect(classifyKey('\x1b[1;6B')).toEqual({ kind: 'command-next-select' });
    expect(classifyKey('\x1b[6B')).toEqual({ kind: 'command-next-select' });
  });

  it('classifies Ctrl+Left as word-left', () => {
    expect(classifyKey('\x1b[1;5D')).toEqual({ kind: 'word-left' });
  });

  it('classifies Ctrl+Right as word-right', () => {
    expect(classifyKey('\x1b[1;5C')).toEqual({ kind: 'word-right' });
  });

  it('classifies Alt+B/F as word-left/right', () => {
    expect(classifyKey('\x1bb')).toEqual({ kind: 'word-left' });
    expect(classifyKey('\x1bf')).toEqual({ kind: 'word-right' });
  });
});

describe('classifyKey — readline editing/search keys', () => {
  it('classifies Emacs movement aliases', () => {
    expect(classifyKey('\x02')).toEqual({ kind: 'arrow-left' }); // Ctrl+B
    expect(classifyKey('\x06')).toEqual({ kind: 'arrow-right' }); // Ctrl+F
    expect(classifyKey('\x10')).toEqual({ kind: 'arrow-up' }); // Ctrl+P
    expect(classifyKey('\x0e')).toEqual({ kind: 'arrow-down' }); // Ctrl+N
  });

  it('classifies kill/yank controls', () => {
    expect(classifyKey('\x04')).toEqual({ kind: 'delete' }); // Ctrl+D
    expect(classifyKey('\x15')).toEqual({ kind: 'kill-before-cursor' }); // Ctrl+U
    expect(classifyKey('\x0b')).toEqual({ kind: 'kill-after-cursor' }); // Ctrl+K
    expect(classifyKey('\x17')).toEqual({ kind: 'kill-word-left' }); // Ctrl+W
    expect(classifyKey('\x19')).toEqual({ kind: 'yank' }); // Ctrl+Y
  });

  it('classifies Alt-tier kill-ring controls', () => {
    expect(classifyKey('\x1bd')).toEqual({ kind: 'kill-word-right' }); // Alt+D
    expect(classifyKey('\x1b\x7f')).toEqual({ kind: 'kill-word-left' }); // Alt+Backspace
    expect(classifyKey('\x1b\b')).toEqual({ kind: 'kill-word-left' }); // Alt+BS
    expect(classifyKey('\x1by')).toEqual({ kind: 'yank-pop' }); // Alt+Y
  });

  it('classifies redraw and transpose controls', () => {
    expect(classifyKey('\x0c')).toEqual({ kind: 'clear-screen' }); // Ctrl+L
    expect(classifyKey('\x14')).toEqual({ kind: 'transpose' }); // Ctrl+T
  });

  it('classifies undo controls', () => {
    expect(classifyKey('\x1f')).toEqual({ kind: 'undo' }); // Ctrl+_
    expect(classifyKey('\x1a')).toEqual({ kind: 'undo' }); // Ctrl+Z, when delivered
  });

  it('classifies reverse-search controls', () => {
    expect(classifyKey('\x12')).toEqual({ kind: 'reverse-search' }); // Ctrl+R
    expect(classifyKey('\x07')).toEqual({ kind: 'search-cancel' }); // Ctrl+G
    expect(classifyKey('\x1b')).toEqual({ kind: 'search-cancel' }); // Esc
  });
});

describe('classifyKey — printable text', () => {
  it('classifies a single ASCII letter as printable', () => {
    expect(classifyKey('a')).toEqual({ kind: 'printable', text: 'a' });
  });

  it('classifies a multi-byte UTF-8 character as printable', () => {
    expect(classifyKey('é')).toEqual({ kind: 'printable', text: 'é' });
  });

  it('classifies a non-control multi-character chunk as printable', () => {
    expect(classifyKey('hello')).toEqual({ kind: 'printable', text: 'hello' });
  });
});

describe('classifyKey — paste containing newlines', () => {
  it('keeps embedded LF in a multi-line paste', () => {
    const ev = classifyKey('line1\nline2');
    expect(ev.kind).toBe('printable');
    if (ev.kind === 'printable') expect(ev.text).toBe('line1\nline2');
  });

  it('keeps tabs in a paste', () => {
    const ev = classifyKey('a\tb');
    expect(ev.kind).toBe('printable');
    if (ev.kind === 'printable') expect(ev.text).toBe('a\tb');
  });

  it('strips embedded ESC bytes from a paste so CSI cannot be injected', () => {
    const ev = classifyKey('safe\x1b[Aevil');
    expect(ev.kind).toBe('printable');
    if (ev.kind === 'printable') expect(ev.text).toBe('safeevil');
  });

  it('strips bracketed paste wrappers from a paste', () => {
    const ev = classifyKey('\x1b[200~line 1\nline 2\x1b[201~');
    expect(ev.kind).toBe('printable');
    if (ev.kind === 'printable') expect(ev.text).toBe('line 1\nline 2');
  });

  it('strips embedded NUL / SOH bytes from a paste', () => {
    const ev = classifyKey('a\x00b\x01c');
    expect(ev.kind).toBe('printable');
    if (ev.kind === 'printable') expect(ev.text).toBe('abc');
  });
});

describe('classifyKey — edge cases', () => {
  it('ignores the empty string', () => {
    expect(classifyKey('')).toEqual({ kind: 'ignored', reason: 'empty' });
  });

  it('drops a lone unprintable control byte that is not whitelisted', () => {
    // SYN — not in whitelist, drop.
    const ev = classifyKey('\x16');
    expect(ev.kind).toBe('ignored');
  });
});
