/**
 * `@riftydev/shell` — minimal bash-flavoured shell for the playground terminal.
 *
 * Public API:
 *   - `Shell` — dispatcher with built-in commands; supports `registerCommand`
 *     for extension (npm, run-script, etc.).
 *   - `tokenize` — split a line into argv-style tokens.
 *   - Types for command writers / context.
 *
 * Higher-level commands (`npm install`, `npm run`) plug in via
 * `registerCommand` from the playground or test harness — keeps shell free of
 * upper-layer dependencies.
 */
export { coreCommandNames } from './builtins.ts';
export { img } from './commands/img.ts';
export { mouseDemo } from './commands/mouse-demo.ts';
export {
  Shell,
  type BinExecutor,
  type ChunkStream,
  type RunOptions,
  type RunResult,
  type ShellOptions,
} from './shell.ts';
export { tokenize, type Token } from './tokenize.ts';
export {
  createShellCompleter,
  shellLineHighlightSpans,
  validateShellInput,
  type CompletionDirEntry,
  type ShellCompletionDeps,
  type ShellCompletionItem,
  type ShellCompletionMode,
  type ShellCompletionResult,
  type ShellHighlightSpan,
  type ShellInputValidation,
} from './language-service.ts';
export type { CommandContext, ShellCommand, StdinReader, Writer } from './types.ts';
