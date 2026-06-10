import type { RiftyTerminalOptions } from '@riftydev/terminal';

export type TerminalColorScheme = 'dark' | 'light';
export type TerminalTheme = NonNullable<RiftyTerminalOptions['theme']>;

export const terminalThemes: Record<TerminalColorScheme, TerminalTheme> = {
  dark: { background: '#0f1115', foreground: '#e6e6e6' },
  light: {
    background: '#f7f8fb',
    foreground: '#171a21',
    cursor: '#171a21',
    selectionBackground: '#c9d4e8',
  },
};

export interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

export interface MatchMediaHost {
  matchMedia?(query: string): MediaQueryLike;
}

export function terminalSchemeFromMedia(query: MediaQueryLike | null): TerminalColorScheme {
  return query?.matches ? 'dark' : 'light';
}

export function preferredTerminalTheme(host: MatchMediaHost = globalThis): TerminalTheme {
  const query = host.matchMedia?.('(prefers-color-scheme: dark)');
  return query ? terminalThemes[terminalSchemeFromMedia(query)] : terminalThemes.dark;
}

export function watchPreferredTerminalTheme(
  host: MatchMediaHost,
  apply: (theme: TerminalTheme) => void,
): () => void {
  const query = host.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) {
    apply(terminalThemes.dark);
    return () => {};
  }
  const update = () => apply(terminalThemes[terminalSchemeFromMedia(query)]);
  update();
  query.addEventListener?.('change', update);
  query.addListener?.(update);
  return () => {
    query.removeEventListener?.('change', update);
    query.removeListener?.(update);
  };
}
