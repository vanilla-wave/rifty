import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, DEFAULT_PRESET, PRESETS, type Preset } from './presets.ts';
import { EXPRESS_SQLITE_TEMPLATE } from './templates/express-sqlite.ts';

function presetText(preset: Preset): string {
  return [preset.source, ...(preset.files ?? []).map((file) => file.content)].join('\n');
}

describe('playground presets', () => {
  it('offers file-oriented project examples alongside the full real npm project demo', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    const filePresets = PRESETS.filter((preset) => preset.category === 'Files + modules');

    expect(filePresets).toHaveLength(2);
    expect(filePresets.every((preset) => (preset.files?.length ?? 0) >= 2)).toBe(true);
    expect(filePresets.every((preset) => (preset.openFiles?.length ?? 0) >= 2)).toBe(true);
    for (const preset of filePresets) {
      const filePaths = new Set((preset.files ?? []).map((file) => file.path));
      expect(preset.openFiles?.every((path) => filePaths.has(path))).toBe(true);
    }
    expect(filePresets.every((preset) => preset.source.includes("new URL('src/"))).toBe(true);
    expect(filePresets.every((preset) => preset.source.includes('await import('))).toBe(true);
    expect(filePresets.every((preset) => preset.source.includes('@vite-ignore'))).toBe(true);
    expect(PRESETS.some((preset) => preset.id === 'real-vite')).toBe(true);
    expect(DEFAULT_PRESET.category).toBe('Files + modules');
    expect(CATEGORY_ORDER).toEqual(['Files + modules', 'Live preview']);
  });

  // Revised pin (node-server template ADR): the honesty invariant — preset
  // prose must not teach a boot line its terminal does not run — now scoped
  // per runtime instead of a global 'npm run dev' ban.
  it('keeps preset prose honest about each runtime boot line', () => {
    const vitePresets = PRESETS.filter((preset) => (preset.templateId ?? 'vite') === 'vite');
    expect(vitePresets.length).toBeGreaterThan(0);
    for (const preset of vitePresets) {
      expect(presetText(preset)).not.toContain('npm run dev');
    }
    expect(vitePresets.map(presetText).join('\n')).toContain('terminal prestarts vite');

    const nodePresets = PRESETS.filter(
      (preset) => preset.templateId && preset.templateId !== 'vite',
    );
    for (const preset of nodePresets) {
      expect(presetText(preset)).not.toContain('terminal prestarts vite');
    }
  });

  it('ships the express+sqlite fullstack demo wired to its node-server template', () => {
    const demo = PRESETS.find((preset) => preset.id === 'express-sqlite');
    expect(demo).toBeDefined();
    if (!demo) throw new Error('unreachable');
    expect(demo.templateId).toBe('express-sqlite');
    expect(demo.mode).toBe('real-vite');
    expect(demo.category).toBe('Live preview');

    // the editor program tab IS the template's server entry (single source)
    expect(demo.source).toBe(EXPRESS_SQLITE_TEMPLATE.entry.content);

    // the page-side explorer shows the same files the worker seeds, in lockstep
    const filePaths = new Set((demo.files ?? []).map((file) => file.path));
    for (const relPath of Object.keys(EXPRESS_SQLITE_TEMPLATE.extraFiles)) {
      expect(filePaths.has(relPath.replace(/^\//, ''))).toBe(true);
    }
    for (const file of demo.files ?? []) {
      expect(EXPRESS_SQLITE_TEMPLATE.extraFiles[`/${file.path}`]).toBe(file.content);
    }

    expect(demo.openFiles?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(demo.openFiles?.every((path) => filePaths.has(path))).toBe(true);
  });
});
