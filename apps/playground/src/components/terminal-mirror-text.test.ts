import { describe, expect, it } from 'vitest';
import { terminalMirrorText } from './terminal-mirror-text.ts';

const ESC = String.fromCharCode(27);

describe('terminalMirrorText', () => {
  it('removes style and cursor restore controls from the searchable mirror', () => {
    const serialized = `${ESC}[32mready${ESC}[0m\r\n> ${ESC}[1A${ESC}[2C`;

    const text = terminalMirrorText(serialized);

    expect(text).toBe('ready\r\n> ');
    expect(text).toMatch(/>\s*$/u);
    expect(text).not.toContain(ESC);
  });
});
