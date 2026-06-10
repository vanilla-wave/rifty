import { describe, expect, it } from 'vitest';
import { type ClipboardKeyLike, classifyClipboardKey } from './clipboard-keys.ts';

function key(overrides: Partial<ClipboardKeyLike> = {}): ClipboardKeyLike {
  return {
    type: 'keydown',
    key: 'c',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('classifyClipboardKey', () => {
  it('copies selection on Ctrl+C instead of letting ETX reach xterm', () => {
    expect(classifyClipboardKey(key(), { hasSelection: true, isMac: false })).toBe(
      'copy-selection',
    );
  });

  it('allows terminal input on Ctrl+C without selection so SIGINT still works', () => {
    expect(classifyClipboardKey(key(), { hasSelection: false, isMac: false })).toBe(
      'allow-terminal-input',
    );
  });

  it('copies selection on Ctrl+Shift+C but ignores it without selection', () => {
    expect(
      classifyClipboardKey(key({ shiftKey: true }), { hasSelection: true, isMac: false }),
    ).toBe('copy-selection');
    expect(
      classifyClipboardKey(key({ shiftKey: true }), { hasSelection: false, isMac: false }),
    ).toBe('ignore');
  });

  it('copies selection on macOS Cmd+C without treating empty selection as SIGINT', () => {
    const cmdC = key({ ctrlKey: false, metaKey: true });
    expect(classifyClipboardKey(cmdC, { hasSelection: true, isMac: true })).toBe('copy-selection');
    expect(classifyClipboardKey(cmdC, { hasSelection: false, isMac: true })).toBe('ignore');
  });

  it('ignores keyup, non-C keys, and Alt-modified chords', () => {
    expect(classifyClipboardKey(key({ type: 'keyup' }), { hasSelection: true, isMac: false })).toBe(
      'ignore',
    );
    expect(classifyClipboardKey(key({ key: 'v' }), { hasSelection: true, isMac: false })).toBe(
      'ignore',
    );
    expect(classifyClipboardKey(key({ altKey: true }), { hasSelection: true, isMac: false })).toBe(
      'ignore',
    );
  });
});
