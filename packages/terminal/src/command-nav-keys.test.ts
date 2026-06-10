import { describe, expect, it } from 'vitest';
import { classifyCommandNavKey } from './command-nav-keys.ts';

describe('classifyCommandNavKey', () => {
  it('maps Ctrl/Cmd arrow keys to command-block navigation', () => {
    expect(
      classifyCommandNavKey({
        key: 'ArrowUp',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('jump-prev');
    expect(
      classifyCommandNavKey({
        key: 'ArrowDown',
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('jump-next');
  });

  it('maps shifted Ctrl/Cmd arrows to command-block selection', () => {
    expect(
      classifyCommandNavKey({
        key: 'ArrowUp',
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe('select-prev');
    expect(
      classifyCommandNavKey({
        key: 'ArrowDown',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe('select-next');
  });

  it('ignores plain arrows and Alt-modified arrows', () => {
    expect(
      classifyCommandNavKey({
        key: 'ArrowUp',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('ignore');
    expect(
      classifyCommandNavKey({
        key: 'ArrowUp',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      }),
    ).toBe('ignore');
  });
});
