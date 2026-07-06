import type { RiftyTerminalOptions } from '@riftydev/terminal';

/**
 * Terminal look: modern bar caret + denser typography (13px glyphs on 18px
 * rows). Pure config module (type-only import) so node tests can pin the
 * values — `RiftyTerminal` itself is constructed in `onMount` (client-only),
 * unobservable under the solid server runtime.
 */
export const TERMINAL_APPEARANCE = {
  fontSize: 13,
  lineHeight: 18 / 13,
  cursorStyle: 'bar',
} as const satisfies Pick<RiftyTerminalOptions, 'fontSize' | 'lineHeight' | 'cursorStyle'>;
