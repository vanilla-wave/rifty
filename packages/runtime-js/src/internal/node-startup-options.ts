/**
 * Node startup options carried on `fork`/`Worker` launches (ADR-0449): one
 * compiler for `-r`/`--require`, `-C`/`--conditions` and
 * `--experimental-import-meta-resolve`, and the realm-scoped record a child
 * installs from its launch before any loader exists. Every other token is a
 * named `NotImplementedError`, never a dropped flag.
 */

import { NotImplementedError } from '@riftydev/io';

export type StartupOptionsOwner = 'worker_threads.Worker' | 'child_process.fork';

export interface NodeStartupOptions {
  /** The exact tokens (the child's `process.execArgv`). */
  readonly execArgv: readonly string[];
  /** `--require` operands in order, resolved from the child's cwd. */
  readonly preloads: readonly string[];
  /** User conditions, added to Node's defaults for every resolution. */
  readonly conditions: readonly string[];
  /** `--experimental-import-meta-resolve`: `import.meta.resolve` honours its parent. */
  readonly importMetaResolve: boolean;
}

const NONE: NodeStartupOptions = Object.freeze({
  execArgv: Object.freeze([]),
  preloads: Object.freeze([]),
  conditions: Object.freeze([]),
  importMetaResolve: false,
});

const RECORD = Symbol.for('rifty.runtime-js.node-startup-options.v1');
const FAMILIES = new Map<string, 'preloads' | 'conditions'>([
  ['-r', 'preloads'],
  ['--require', 'preloads'],
  ['-C', 'conditions'],
  ['--conditions', 'conditions'],
]);

function quoted(token: unknown): string {
  return `'${typeof token === 'symbol' ? token.toString() : String(token)}'`;
}

function unsupported(owner: StartupOptionsOwner, token: unknown): never {
  throw new NotImplementedError(
    `${owner}.execArgv`,
    `startup option ${quoted(token)} is not carried; rifty honours -r/--require, -C/--conditions and --experimental-import-meta-resolve`,
  );
}

function missingOperand(owner: StartupOptionsOwner, flag: string): never {
  if (owner === 'worker_threads.Worker') {
    throw Object.assign(
      new Error(`Initiated Worker with invalid execArgv flags: ${flag} requires an argument`),
      { code: 'ERR_WORKER_INVALID_EXEC_ARGV' },
    );
  }
  // Node appends the module path after execArgv: a bare trailing flag takes it
  // as its operand and the entry-less child runs stdin (evidence §fork operands).
  throw new NotImplementedError(
    'child_process.fork.execArgv',
    `startup option ${quoted(flag)} has no operand of its own`,
  );
}

/** Compile `tokens` or throw the owner's error before anything is allocated. */
export function compileNodeStartupOptions(
  tokens: unknown,
  owner: StartupOptionsOwner,
): NodeStartupOptions {
  if (!Array.isArray(tokens)) unsupported(owner, tokens);
  const execArgv: string[] = [];
  const preloads: string[] = [];
  const conditions: string[] = [];
  let importMetaResolve = false;
  for (let index = 0; index < tokens.length; index++) {
    const token: unknown = tokens[index];
    if (typeof token !== 'string') unsupported(owner, token);
    execArgv.push(token);
    if (token === '--experimental-import-meta-resolve') {
      importMetaResolve = true;
      continue;
    }
    const equals = token.indexOf('=');
    const inline = equals > 0 && token.startsWith('--') ? token.slice(0, equals) : null;
    const family = FAMILIES.get(inline ?? token);
    if (family === undefined) unsupported(owner, token);
    let operand: unknown;
    if (inline !== null) {
      operand = token.slice(equals + 1);
      if (operand === '') missingOperand(owner, `${inline}=`);
    } else {
      operand = tokens[index + 1];
      if (operand === undefined || (typeof operand === 'string' && operand.startsWith('-'))) {
        missingOperand(owner, token);
      }
      if (typeof operand !== 'string') unsupported(owner, operand);
      execArgv.push(operand);
      index++;
    }
    (family === 'preloads' ? preloads : conditions).push(operand as string);
  }
  return Object.freeze({
    execArgv: Object.freeze(execArgv),
    preloads: Object.freeze(preloads),
    conditions: Object.freeze(conditions),
    importMetaResolve,
  });
}

/**
 * Install this realm's record from its launch tokens (the node-entry pre-entry
 * hook). A `Symbol.for` key: every bundle copy in the realm reads one record.
 */
export function installNodeStartupOptions(tokens: readonly string[]): void {
  const options = compileNodeStartupOptions(tokens, 'child_process.fork');
  Object.defineProperty(globalThis, RECORD, { value: options, configurable: true });
}

/** This realm's startup options; none outside a launched child. */
export function nodeStartupOptions(): NodeStartupOptions {
  return (globalThis as { [RECORD]?: NodeStartupOptions })[RECORD] ?? NONE;
}
