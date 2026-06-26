import { describe, expect, it } from 'vitest';
import {
  type MediaQueryLike,
  preferredTerminalTheme,
  terminalSchemeFromMedia,
  terminalThemes,
  watchPreferredTerminalTheme,
} from './terminal-theme.ts';

function mediaQuery(matches: boolean): MediaQueryLike & { fire(): void } {
  let listener: (() => void) | null = null;
  return {
    get matches() {
      return matches;
    },
    addEventListener(_type, next) {
      listener = next;
    },
    removeEventListener(_type, next) {
      if (listener === next) listener = null;
    },
    fire() {
      listener?.();
    },
  };
}

describe('terminal-theme', () => {
  it('maps prefers-color-scheme dark matches to terminal schemes', () => {
    expect(terminalSchemeFromMedia({ matches: true })).toBe('dark');
    expect(terminalSchemeFromMedia({ matches: false })).toBe('light');
  });

  it('defaults to the current dark terminal theme when matchMedia is absent', () => {
    expect(preferredTerminalTheme({})).toEqual(terminalThemes.dark);
  });

  it('uses a modern matte palette with a non-lime bar cursor', () => {
    expect(terminalThemes.dark.background).toBe('#171a21');
    expect(terminalThemes.dark.foreground).toBe('#d7dae0');
    expect(terminalThemes.dark.cursor).toBe('#ff7a90');
    expect(terminalThemes.dark.cursor).not.toBe('#c7f05a');
    expect(terminalThemes.dark.selectionBackground).toBe('#6ea8ff33');
    expect(terminalThemes.dark.brightBlack).toBe('#697180');
    expect(terminalThemes.dark.blue).toBe('#7aa2f7');
    expect(terminalThemes.dark.cyan).toBe('#5fd7e5');
  });

  it('watches OS theme changes and disposes the listener', () => {
    const query = mediaQuery(false);
    const applied: unknown[] = [];
    const dispose = watchPreferredTerminalTheme({ matchMedia: () => query }, (theme) =>
      applied.push(theme),
    );
    expect(applied).toEqual([terminalThemes.light]);
    query.fire();
    expect(applied).toEqual([terminalThemes.light, terminalThemes.light]);
    dispose();
    query.fire();
    expect(applied).toEqual([terminalThemes.light, terminalThemes.light]);
  });
});
