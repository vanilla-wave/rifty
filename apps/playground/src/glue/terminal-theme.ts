import type { RiftyTerminalOptions } from '@riftydev/terminal';

export type TerminalColorScheme = 'dark' | 'light';
export type TerminalTheme = NonNullable<RiftyTerminalOptions['theme']>;

// The playground shell is dark-only (Soft Panels), so both schemes resolve to
// the panel surface — a light xterm inside the dark card read as a glitch. The
// scheme hook stays for a future light shell.
const SOFT_PANEL_TERMINAL: TerminalTheme = {
  background: '#1d1f26',
  foreground: '#bdbfc5',
  cursor: '#c7f05a',
  cursorAccent: '#1d1f26',
  selectionBackground: '#c7f05a40',
};

export const terminalThemes: Record<TerminalColorScheme, TerminalTheme> = {
  dark: SOFT_PANEL_TERMINAL,
  light: SOFT_PANEL_TERMINAL,
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
