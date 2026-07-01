/**
 * The terminal cold-load welcome banner (frictionless-first-poke). Playground-
 * owned copy passed to the content-agnostic `banner` option of `RiftyTerminal`.
 *
 * Two lines, ANSI-styled, version-interpolated from the runtime identity so it
 * can't drift from the child's `process.version` or over-claim Node compat. No
 * trailing newline — the terminal's first `writePrompt()` adds the separator.
 */
import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js/builtins/process-identity';

const ANSI_GREY = '\x1b[90m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

export const terminalWelcomeBanner: string =
  `${ANSI_GREY}rifty · node ${NODE_PROCESS_IDENTITY.version} · npm in your browser${ANSI_RESET}\r\n` +
  `${ANSI_DIM}try:  node -v   ·   npm install chalk   ·   help${ANSI_RESET}`;
