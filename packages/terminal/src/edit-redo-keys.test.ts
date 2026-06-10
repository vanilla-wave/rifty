import { describe, expect, it } from 'vitest';
import { isEditRedoKey } from './edit-redo-keys.ts';

describe('isEditRedoKey', () => {
  it('matches Ctrl+Shift+Z and Cmd+Shift+Z', () => {
    expect(
      isEditRedoKey({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }),
    ).toBe(true);
    expect(
      isEditRedoKey({ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }),
    ).toBe(true);
  });

  it('ignores plain undo and Alt-modified variants', () => {
    expect(
      isEditRedoKey({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }),
    ).toBe(false);
    expect(
      isEditRedoKey({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true, altKey: true }),
    ).toBe(false);
  });
});
