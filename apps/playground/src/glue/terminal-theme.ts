import type { RiftyTerminalOptions } from '@riftydev/terminal';

export type TerminalColorScheme = 'dark' | 'light';
export type TerminalTheme = NonNullable<RiftyTerminalOptions['theme']>;

// The playground shell is dark-only (Soft Panels), so both schemes resolve to
// the panel surface — a light xterm inside the dark card read as a glitch. The
// scheme hook stays for a future light shell.
const SOFT_PANEL_TERMINAL: TerminalTheme = {
  background: '#171a21',
  foreground: '#d7dae0',
  cursor: '#ff7a90',
  cursorAccent: '#171a21',
  selectionBackground: '#6ea8ff33',
  selectionForeground: '#f6f8fb',
  black: '#0f1117',
  red: '#ff6b7a',
  green: '#8bd976',
  yellow: '#e7c86f',
  blue: '#7aa2f7',
  magenta: '#c792ea',
  cyan: '#5fd7e5',
  white: '#d7dae0',
  brightBlack: '#697180',
  brightRed: '#ff8b98',
  brightGreen: '#a6e88f',
  brightYellow: '#f1d98b',
  brightBlue: '#9bbcff',
  brightMagenta: '#d8a7f3',
  brightCyan: '#7ee6f0',
  brightWhite: '#f6f8fb',
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
