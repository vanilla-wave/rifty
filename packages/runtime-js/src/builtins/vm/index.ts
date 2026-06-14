/**
 * `node:vm` public surface (dispatcher). Sandbox operations
 * (`runInContext`/`runInNewContext`/`Script.runInContext*`) delegate to the
 * selected {@link VmEngine} (quickjs default; rewrite opt-in after the T17 cutover —
 * ADR-0142). `runInThisContext` is NOT an engine op — it always runs in the host
 * realm via `(0,eval)`.
 *
 * Option-assertion + normalisation helpers and `createContext`/`isContext`/
 * `compileFunction` keep their original behavior. Engine-internal AST-rewrite
 * machinery lives in `rewrite-engine.ts`; shared types in `types.ts`.
 */

import { NotImplementedError } from '@riftydev/io';
import { recordDivergence } from '../../telemetry/divergence-sink.ts';
import { selectEngine } from './engine-config.ts';
import { type CompiledScript, type ContextObject, VM_CONTEXT, isVmContext } from './types.ts';

/**
 * Select the engine for a SANDBOX RUN (`runInContext`/`runInNewContext`/
 * `Script.runIn*Context`). When it resolves to the opt-in `rewrite` engine,
 * record a divergence hit and emit ONE loud stderr line per process/worker.
 *
 * Stderr path: `process.stderr.write` is available BOTH in the worker (rifty's
 * `process` → `console.error` → the worker stderr message bridge) and in plain
 * Node (conformance/parity → real fd 2). The parity runner diffs STDOUT and
 * only intercepts `console.*`, so the warning never leaks into parity stdout.
 *
 * NOT called from `createContext` (a contextify op, not a run) — the warning is
 * about EXECUTING under the divergent engine.
 */
function selectEngineForRun(): ReturnType<typeof selectEngine> {
  const engine = selectEngine();
  if (
    engine.name === 'rewrite' &&
    recordDivergence('vm.engine.rewrite-active', { warnOnce: true })
  ) {
    process.stderr.write(
      '[rifty] node:vm is using the hardened-rewrite engine (opt-in). Known divergences ' +
        'vs the default QuickJS real realm: cross-realm identity (instanceof across ' +
        'contexts), direct eval leaks to host, no real global-object semantics. See docs.\n',
    );
  }
  return engine;
}

export interface RunningScriptOptions {
  filename?: string;
  displayErrors?: boolean;
  timeout?: number;
  breakOnSigint?: boolean;
  microtaskMode?: string;
  contextExtensions?: object[];
}

export interface ScriptOptions extends RunningScriptOptions {
  lineOffset?: number;
  columnOffset?: number;
  cachedData?: Uint8Array;
  produceCachedData?: boolean;
  importModuleDynamically?: unknown;
}

export interface CompileFunctionOptions extends ScriptOptions {
  parsingContext?: object;
}

export interface CreateContextOptions {
  name?: string;
  origin?: string;
  codeGeneration?: {
    strings?: boolean;
    wasm?: boolean;
  };
  microtaskMode?: string;
}

type VmOptions = string | ScriptOptions | undefined;

const runGlobalScript = new Function('source', 'return (0, eval)(source);') as (
  source: string,
) => unknown;

function asSource(code: string): string {
  if (typeof code !== 'string') {
    throw new TypeError('The "code" argument must be of type string.');
  }
  return code;
}

/**
 * Engine-agnostic guard for the two entry points that take an ALREADY-contextified
 * object (`runInContext`, `Script.runInContext`). Node throws a TypeError for a
 * value that never went through `createContext`. The rewrite engine checked this
 * internally; the quickjs engine did not, so the assertion lives here at the shared
 * surface. Message wording matches real Node: a non-object value (null/primitive)
 * fails the "object" arg check first; a wrong-kind OBJECT fails the vm.Context check
 * ("must be an vm.Context. Received an instance of <Ctor>").
 */
function assertContextified(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(
      `The "object" argument must be of type object. Received ${describeNonObject(value)}`,
    );
  }
  if (!isVmContext(value)) {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
    throw new TypeError(
      `The "contextifiedObject" argument must be an vm.Context. Received an instance of ${ctor}`,
    );
  }
}

/**
 * Node ERR_INVALID_ARG_TYPE tail for a non-object value. `null`/`undefined`
 * render BARE; everything else as `type <t> (<inspected>)`. The inspected value
 * matches `util.inspect` for primitives (verified byte-for-byte vs real Node):
 * a `bigint` keeps its `n` suffix, `-0` stays `-0`, a `symbol` is its
 * `toString()`, and a `string` is quote-escaped + truncated like Node's helper.
 */
function describeNonObject(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return `type ${typeof value} (${inspectPrimitive(value)})`;
}

/** `util.inspect`-equivalent rendering of a non-object primitive (Node-exact). */
function inspectPrimitive(value: unknown): string {
  switch (typeof value) {
    case 'bigint':
      return `${value}n`;
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'string':
      return quoteString(value);
    case 'symbol':
      return (value as symbol).toString();
    default:
      // boolean (true/false) and any residual primitive
      return String(value);
  }
}

/**
 * Node's error-helper string rendering (the part real vm callers can hit): prefer
 * single quotes, switch to double when the string holds a single quote, escape the
 * ACTIVE quote char, then truncate the rendered literal to 25 chars + `...` once it
 * exceeds 28 (matches real Node v24 for plain text). Pathological strings mixing
 * backslashes / control chars are NOT modelled byte-exact here — that is full
 * `util.inspect` `strEscape` territory, out of scope for a context-arg-type error
 * (a non-object context arg is itself a programmer mistake); see the T19 divergence
 * note. The type rendering (bigint `n`, `-0`, symbol) above IS exact.
 */
function quoteString(value: string): string {
  const quote = value.includes("'") ? '"' : "'";
  let body = quote === '"' ? value.replaceAll('"', '\\"') : value;
  if (body.length > 28) body = `${body.slice(0, 25)}...`;
  return `${quote}${body}${quote}`;
}

function normalizeOptions(options?: VmOptions): ScriptOptions {
  if (options === undefined) return {};
  if (typeof options === 'string') return { filename: options };
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('The "options" argument must be a string or object.');
  }
  return options;
}

function assertSupportedRunOptions(options: RunningScriptOptions, feature: string): void {
  if (options.displayErrors !== undefined) {
    throw new NotImplementedError(`${feature}.displayErrors`);
  }
  if (options.timeout !== undefined) {
    throw new NotImplementedError(`${feature}.timeout`);
  }
  if (options.breakOnSigint) {
    throw new NotImplementedError(`${feature}.breakOnSigint`);
  }
  if (options.microtaskMode !== undefined) {
    throw new NotImplementedError(`${feature}.microtaskMode`);
  }
  if (options.contextExtensions !== undefined && options.contextExtensions.length > 0) {
    throw new NotImplementedError(`${feature}.contextExtensions`);
  }
}

function assertSupportedScriptOptions(options: ScriptOptions, feature: string): void {
  assertSupportedRunOptions(options, feature);
  if (options.lineOffset !== undefined && options.lineOffset !== 0) {
    throw new NotImplementedError(`${feature}.lineOffset`);
  }
  if (options.columnOffset !== undefined && options.columnOffset !== 0) {
    throw new NotImplementedError(`${feature}.columnOffset`);
  }
  if (options.cachedData !== undefined) {
    throw new NotImplementedError(`${feature}.cachedData`);
  }
  if (options.produceCachedData) {
    throw new NotImplementedError(`${feature}.produceCachedData`);
  }
  if (options.importModuleDynamically !== undefined) {
    throw new NotImplementedError(`${feature}.importModuleDynamically`);
  }
}

function assertSupportedCompileOptions(options: CompileFunctionOptions): void {
  assertSupportedScriptOptions(options, 'vm.compileFunction');
  if (options.parsingContext !== undefined) {
    throw new NotImplementedError('vm.compileFunction.parsingContext');
  }
}

function assertSupportedContextOptions(options?: CreateContextOptions): void {
  if (!options) return;
  if (options.name !== undefined) {
    throw new NotImplementedError('vm.createContext.name');
  }
  if (options.origin !== undefined) {
    throw new NotImplementedError('vm.createContext.origin');
  }
  if (options.codeGeneration !== undefined) {
    throw new NotImplementedError('vm.createContext.codeGeneration');
  }
  if (options.microtaskMode !== undefined) {
    throw new NotImplementedError('vm.createContext.microtaskMode');
  }
}

function withSourceURL(code: string, filename?: string): string {
  if (!filename) return code;
  return `${code}\n//# sourceURL=${filename}`;
}

export function createContext<T extends Record<string, unknown> = Record<string, unknown>>(
  contextObject?: T,
  options?: CreateContextOptions,
): T {
  assertSupportedContextOptions(options);
  if (contextObject === null) {
    throw new TypeError('The "object" argument must be of type object. Received null');
  }
  const context = (contextObject === undefined ? {} : contextObject) as T & ContextObject;
  Object.defineProperty(context, VM_CONTEXT, {
    configurable: false,
    enumerable: false,
    value: true,
  });
  selectEngine().initContext(context);
  return context;
}

export function isContext(value: unknown): boolean {
  return isVmContext(value);
}

export function runInThisContext(code: string, options?: VmOptions): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInThisContext');
  return runGlobalScript(withSourceURL(asSource(code), normalized.filename));
}

export function runInContext(
  code: string,
  contextifiedObject: Record<string, unknown>,
  options?: VmOptions,
): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInContext');
  assertContextified(contextifiedObject);
  return selectEngineForRun().runInContext(
    asSource(code),
    contextifiedObject as ContextObject,
    normalized.filename,
  );
}

export function runInNewContext(
  code: string,
  contextObject?: Record<string, unknown>,
  options?: VmOptions,
): unknown {
  if (contextObject === null) {
    throw new TypeError('The "object" argument must be of type object. Received null');
  }
  const context = createContext(contextObject === undefined ? {} : contextObject);
  return runInContext(code, context, options);
}

export class Script {
  readonly #code: string;
  readonly #filename?: string;
  // Memoised compiled payload — compile once, reuse across every run of this
  // Script instance. The engine keys its own per-script state (the rewrite, a
  // quickjs handle, …) on this stable CompiledScript identity, so reuse here is
  // what preserves the parse-once optimization across runs.
  #compiled?: CompiledScript;

  constructor(code: string, options?: VmOptions) {
    const normalized = normalizeOptions(options);
    assertSupportedScriptOptions(normalized, 'vm.Script');
    this.#code = asSource(code);
    this.#filename = normalized.filename;
  }

  #getCompiled(): CompiledScript {
    if (!this.#compiled) this.#compiled = selectEngine().compile(this.#code, this.#filename);
    return this.#compiled;
  }

  runInThisContext(options?: VmOptions): unknown {
    return runInThisContext(this.#code, { ...normalizeOptions(options), filename: this.#filename });
  }

  runInContext(contextifiedObject: Record<string, unknown>, options?: VmOptions): unknown {
    const normalized = { ...normalizeOptions(options), filename: this.#filename };
    assertSupportedScriptOptions(normalized, 'vm.Script');
    assertContextified(contextifiedObject);
    return selectEngineForRun().runCompiled(
      this.#getCompiled(),
      contextifiedObject as ContextObject,
    );
  }

  runInNewContext(contextObject?: Record<string, unknown>, options?: VmOptions): unknown {
    if (contextObject === null) {
      throw new TypeError('The "object" argument must be of type object. Received null');
    }
    const normalized = { ...normalizeOptions(options), filename: this.#filename };
    assertSupportedScriptOptions(normalized, 'vm.Script');
    const context = createContext(contextObject === undefined ? {} : contextObject);
    return selectEngineForRun().runCompiled(this.#getCompiled(), context as ContextObject);
  }
}

export function compileFunction(
  code: string,
  params: string[] = [],
  options?: CompileFunctionOptions,
): (...args: unknown[]) => unknown {
  assertSupportedCompileOptions(options ?? {});
  for (const param of params) {
    if (typeof param !== 'string') {
      throw new TypeError('Function parameters must be strings.');
    }
  }
  return new Function(...params, asSource(code)) as (...args: unknown[]) => unknown;
}

const vmModule = {
  Script,
  compileFunction,
  createContext,
  isContext,
  runInContext,
  runInNewContext,
  runInThisContext,
};

export default vmModule;
