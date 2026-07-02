import { describe, expect, it } from 'vitest';
import { TOOL_RESULT_CAP_BYTES, capToolText } from './truncate.ts';

describe('capToolText', () => {
  it('returns small text unchanged with truncatedBytes 0', () => {
    expect(capToolText('hello')).toEqual({ text: 'hello', truncatedBytes: 0 });
  });

  it('caps oversized text head+tail with an explicit byte-count marker', () => {
    const text = `${'a'.repeat(20_000)}MID${'z'.repeat(20_000)}`;
    const capped = capToolText(text);
    expect(capped.truncatedBytes).toBe(text.length - TOOL_RESULT_CAP_BYTES);
    expect(capped.text).toContain(`[truncated ${capped.truncatedBytes} bytes]`);
    expect(capped.text.startsWith('aaa')).toBe(true);
    expect(capped.text.endsWith('zzz')).toBe(true);
    expect(capped.text).not.toContain('MID');
  });

  it('honours a custom cap and never splits the marker mid-code-point', () => {
    const text = '№'.repeat(2_000); // 2-byte code points force byte-boundary cuts
    const capped = capToolText(text, 101);
    expect(capped.text).toMatch(/^№+\n\[truncated \d+ bytes\]\n№+$/u);
    expect(capped.text).not.toContain('�');
  });
});
