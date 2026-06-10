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
