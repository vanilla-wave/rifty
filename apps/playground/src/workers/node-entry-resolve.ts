/**
 * Pure resolver for a `node <file>` argument (ADR-0155). Absolutizes the arg
 * against the shell cwd — it does NOT check existence: a missing entry flows on
 * into `runNodeEntry` → the module loader, which emits real Node's
 * `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND', requireStack: [] }`
 * (backlog/runtime-js/node-entry-miss-node-shape). The only `ok:false` here is the
 * empty-arg usage error — never a silent stub.
 *
 * `@riftydev/vfs` exports no `resolve`; this mirrors the shell's own
 * `resolve(cwd, p)` (commands/_shared.ts) via the public path helpers:
 * `normalizePath(isAbsolute(p) ? p : joinPath(cwd, p))`.
 */
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export type ResolveResult = { ok: true; path: string } | { ok: false; message: string };

/** Resolve (absolutize) a `node <file>` arg against cwd. No existence check. */
export function resolveNodeEntry(cwd: string, arg: string | undefined): ResolveResult {
  if (arg === undefined || arg === '') {
    return { ok: false, message: 'node: missing entry file\nUsage: node <file> [args]\n' };
  }
  return { ok: true, path: normalizePath(isAbsolute(arg) ? arg : joinPath(cwd, arg)) };
}

/**
 * Classification of a `node …` argv (ADR-0155 + frictionless-first-poke). The
 * old handler absolutized `args[0]` blindly, so `node --version` and every
 * `node -e "…"` became `/workspace/--version` → MODULE_NOT_FOUND. Now a leading
 * flag is parsed first: only a non-flag arg becomes an entry path.
 */
export type NodeInvocation =
  | { readonly kind: 'missing' }
  | { readonly kind: 'version' }
  | { readonly kind: 'badOption'; readonly flag: string }
  | {
      readonly kind: 'eval';
      readonly source: string;
      readonly print: boolean;
      readonly scriptArgs: readonly string[];
    }
  | { readonly kind: 'entry'; readonly arg: string; readonly scriptArgs: readonly string[] };

/** Recognize `-e`/`--eval`/`-p`/`--print` (and their `=value` inline forms). */
function evalFlag(arg: string): { print: boolean; inline?: string } | null {
  if (arg === '-e' || arg === '--eval') return { print: false };
  if (arg === '-p' || arg === '--print') return { print: true };
  if (arg.startsWith('--eval=')) return { print: false, inline: arg.slice('--eval='.length) };
  if (arg.startsWith('--print=')) return { print: true, inline: arg.slice('--print='.length) };
  return null;
}

/**
 * Classify a `node` invocation from its argv (the args after `node`). Pure — the
 * handler maps each kind to an action (print version / run eval / bad-option /
 * spawn entry). Only a leading NON-flag arg is treated as an entry path.
 */
export function classifyNodeInvocation(args: readonly string[]): NodeInvocation {
  const first = args[0];
  if (first === undefined || first === '') return { kind: 'missing' };
  if (first === '-v' || first === '--version') return { kind: 'version' };

  const ev = evalFlag(first);
  if (ev) {
    if (ev.inline !== undefined) {
      return { kind: 'eval', source: ev.inline, print: ev.print, scriptArgs: args.slice(1) };
    }
    const value = args[1];
    if (value === undefined) return { kind: 'badOption', flag: first }; // -e/-p needs a value
    return { kind: 'eval', source: value, print: ev.print, scriptArgs: args.slice(2) };
  }

  // Any other leading-`-` arg is an unknown/unsupported node option — loud
  // `bad option`, never absolutized into a `/workspace/<flag>` module path.
  if (first.startsWith('-')) return { kind: 'badOption', flag: first };

  return { kind: 'entry', arg: first, scriptArgs: args.slice(1) };
}

/**
 * The CommonJS source to run for a `-e`/`-p` invocation. `-e` runs the source
 * verbatim (CJS — `require`/`process` available, no implicit print); `-p` wraps
 * the expression in `util.inspect(...) + '\n'` to print its value (Node's
 * `--print`). Written to a temp `.cjs` so the loader runs it through the real
 * module realm (require faithful), not `new Function`.
 */
export function buildNodeEvalSource(source: string, print: boolean): string {
  if (!print) return source;
  return `process.stdout.write(require('node:util').inspect((${source})) + '\\n');\n`;
}
