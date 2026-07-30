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
  | { readonly kind: 'usageError'; readonly message: string }
  | { readonly kind: 'badOption'; readonly flag: string }
  | { readonly kind: 'evalModule' }
  | { readonly kind: 'evalModulePrintError' }
  | { readonly kind: 'evalTypeScript' }
  | { readonly kind: 'preloadContext' }
  | { readonly kind: 'printProgram' }
  | {
      readonly kind: 'eval';
      readonly source: string;
      readonly print: boolean;
      readonly execArgv: readonly string[];
      readonly scriptArgs: readonly string[];
    }
  | { readonly kind: 'entry'; readonly arg: string; readonly scriptArgs: readonly string[] };

function isEvalOption(arg: string | undefined): boolean {
  return (
    arg === '-e' ||
    arg === '--eval' ||
    arg === '-p' ||
    arg === '--print' ||
    arg === '-pe' ||
    arg?.startsWith('--eval=') === true ||
    arg?.startsWith('--print=') === true
  );
}

function argsAfterOptionalTerminator(args: readonly string[], start: number): readonly string[] {
  return args.slice(args[start] === '--' ? start + 1 : start);
}

function evalUsageError(option: '-e' | '--eval' | '--eval=' | '-pe'): NodeInvocation {
  const reported = option === '-pe' ? '--eval' : option;
  return { kind: 'usageError', message: `node: ${reported} requires an argument\n` };
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

  if (
    (first === '--input-type=commonjs' ||
      first === '--input-type=module' ||
      first === '--input-type=commonjs-typescript' ||
      first === '--input-type=module-typescript') &&
    isEvalOption(args[1])
  ) {
    const nested = classifyNodeInvocation(args.slice(1));
    if (nested.kind === 'printProgram' || nested.kind === 'usageError') return nested;
    if (nested.kind !== 'eval') {
      throw new Error('node input-type eval classifier reached an impossible nested outcome');
    }
    if (first === '--input-type=commonjs') {
      return {
        ...nested,
        execArgv: [first, ...nested.execArgv],
      };
    }
    if (first !== '--input-type=commonjs-typescript' && nested.print) {
      return { kind: 'evalModulePrintError' };
    }
    return { kind: first === '--input-type=module' ? 'evalModule' : 'evalTypeScript' };
  }

  if (first === '-e' || first === '--eval' || first === '-pe') {
    const source = args[1];
    if (source === undefined || source === '--') return evalUsageError(first);
    return {
      kind: 'eval',
      source,
      print: first === '-pe',
      execArgv: [first, source],
      scriptArgs: argsAfterOptionalTerminator(args, 2),
    };
  }

  if (first.startsWith('--eval=')) {
    const source = first.slice('--eval='.length);
    if (source === '') return evalUsageError('--eval=');
    return {
      kind: 'eval',
      source,
      print: false,
      execArgv: [first],
      scriptArgs: argsAfterOptionalTerminator(args, 1),
    };
  }

  if (first === '-p' || first === '--print' || first.startsWith('--print=')) {
    const source = args[1];
    if (source === undefined) {
      return {
        kind: 'eval',
        source: '',
        print: true,
        execArgv: [first],
        scriptArgs: [],
      };
    }
    if (source === '--') {
      const entry = args[2];
      if (entry !== undefined && entry !== '') return { kind: 'printProgram' };
      return {
        kind: 'eval',
        source: '',
        print: true,
        execArgv: [first],
        scriptArgs: args.slice(2),
      };
    }
    if (source === '') {
      return {
        kind: 'eval',
        source: '',
        print: true,
        execArgv: [first],
        scriptArgs: args.slice(1),
      };
    }
    return {
      kind: 'eval',
      source,
      print: true,
      execArgv: [first, source],
      scriptArgs: argsAfterOptionalTerminator(args, 2),
    };
  }

  if (first === '-r' || first === '--require' || first === '--import') {
    // TODO(backlog: runtime-js/node-cli-preload-import-flags)
    if (args[1] === undefined) {
      return {
        kind: 'usageError',
        message: `node: ${first} requires an argument\n`,
      };
    }
    return { kind: 'preloadContext' };
  }

  if (first.startsWith('--require=') || first.startsWith('--import=')) {
    // TODO(backlog: runtime-js/node-cli-preload-import-flags)
    if (first.endsWith('=')) {
      return {
        kind: 'usageError',
        message: `node: ${first} requires an argument\n`,
      };
    }
    return { kind: 'preloadContext' };
  }

  // Any other leading-`-` arg is an unknown/unsupported node option — loud
  // `bad option`, never absolutized into a `/workspace/<flag>` module path.
  if (first.startsWith('-')) return { kind: 'badOption', flag: first };

  return { kind: 'entry', arg: first, scriptArgs: args.slice(1) };
}
