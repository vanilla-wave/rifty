import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets.ts';
import { EXPRESS_SQLITE_TEMPLATE } from '../templates/express-sqlite.ts';
import { MONO_FONT_STACK } from './fonts.ts';

const themeCss = readFileSync(
  fileURLToPath(new URL('../styles/theme.css', import.meta.url)),
  'utf8',
);
const fontsDir = fileURLToPath(new URL('../../public/fonts/', import.meta.url));
const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

describe('playground mono font', () => {
  it('leads the shared mono stack with JetBrains Mono', () => {
    expect(MONO_FONT_STACK.startsWith("'JetBrains Mono'")).toBe(true);
  });

  it('keeps system monospace fallbacks after JetBrains Mono', () => {
    expect(MONO_FONT_STACK).toContain('ui-monospace');
    expect(MONO_FONT_STACK.endsWith('monospace')).toBe(true);
  });

  it('declares JetBrains Mono via self-hosted @font-face, not Roboto Mono', () => {
    expect(themeCss).toContain('font-family: "JetBrains Mono"');
    expect(themeCss).toContain('/fonts/jetbrains-mono.woff2');
    expect(themeCss).not.toContain('Roboto Mono');
  });

  it('points the --rf-font-mono token at JetBrains Mono', () => {
    expect(themeCss).toMatch(/--rf-font-mono:\s*"JetBrains Mono"/);
  });

  it('uses JetBrains Mono for playground chrome text too', () => {
    expect(themeCss).toMatch(/--rf-font-sans:\s*"JetBrains Mono"/);
    expect(themeCss).not.toMatch(/--rf-font-sans:\s*"Inter"/);
    expect(themeCss).not.toContain('font-family: "Inter"');
  });

  it('ships the referenced self-hosted woff2 subsets', () => {
    expect(existsSync(`${fontsDir}jetbrains-mono.woff2`)).toBe(true);
    expect(existsSync(`${fontsDir}jetbrains-mono-cyr.woff2`)).toBe(true);
  });

  it('preloads the JetBrains Mono subset, not the removed Roboto Mono', () => {
    expect(indexHtml).toContain('/fonts/jetbrains-mono.woff2');
    expect(indexHtml).not.toContain('/fonts/inter.woff2');
    expect(indexHtml).not.toContain("'Inter'");
    expect(indexHtml).not.toContain('roboto-mono');
  });

  it('uses JetBrains Mono in seeded sandbox preview sources', () => {
    const seededSources = [
      ...PRESETS.flatMap((preset) => [
        preset.source,
        ...(preset.files?.map((file) => file.content) ?? []),
      ]),
      EXPRESS_SQLITE_TEMPLATE.entry.content,
      ...Object.values(EXPRESS_SQLITE_TEMPLATE.extraFiles),
    ].join('\n');

    expect(seededSources).toContain('JetBrains Mono');
    expect(seededSources).not.toContain('Inter');
    expect(seededSources).not.toContain('Roboto Mono');
    expect(seededSources).not.toContain("fontFamily = 'ui-monospace, monospace'");
    expect(seededSources).not.toMatch(/font:\s*14px\/1\.55 ui-monospace/);
  });
});
