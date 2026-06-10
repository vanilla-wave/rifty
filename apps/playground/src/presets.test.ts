import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, DEFAULT_PRESET, PRESETS } from './presets.ts';

describe('playground presets', () => {
  it('offers file-oriented project examples alongside the full real npm project demo', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    const filePresets = PRESETS.filter((preset) => preset.category === 'Files + modules');

    expect(filePresets).toHaveLength(2);
    expect(filePresets.every((preset) => (preset.files?.length ?? 0) >= 2)).toBe(true);
    expect(filePresets.every((preset) => preset.source.includes("new URL('src/"))).toBe(true);
    expect(filePresets.every((preset) => preset.source.includes('await import('))).toBe(true);
    expect(filePresets.every((preset) => preset.source.includes('@vite-ignore'))).toBe(true);
    expect(PRESETS.some((preset) => preset.id === 'real-vite')).toBe(true);
    expect(DEFAULT_PRESET.category).toBe('Files + modules');
    expect(CATEGORY_ORDER).toEqual(['Files + modules', 'Live preview']);
  });

  it('does not teach npm run dev for the visible Vite terminal command', () => {
    const joined = PRESETS.map((preset) =>
      [preset.source, ...(preset.files ?? []).map((file) => file.content)].join('\\n'),
    ).join('\\n');

    expect(joined).toContain('terminal prestarts vite');
    expect(joined).not.toContain('npm run dev');
  });
});
