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

  it('classifies ETX (\\x03) as Ctrl+C', () => {
    expect(classifyKey('\x03')).toEqual({ kind: 'ctrl-c' });
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
    // Form feed — not in whitelist, drop.
    const ev = classifyKey('\x0c');
    expect(ev.kind).toBe('ignored');
  });
});
