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
import {
  type CompiledScript,
  type ContextCodeGeneration,
  type ContextObject,
  VM_CONTEXT,
  isVmContext,
  setContextCodeGeneration,
} from './types.ts';

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
  assertIntegerOffsets(options);
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
  if ((options.lineOffset ?? 0) !== 0) {
    throw new NotImplementedError('vm.compileFunction.lineOffset');
  }
  if ((options.columnOffset ?? 0) !== 0) {
    throw new NotImplementedError('vm.compileFunction.columnOffset');
  }
  if (options.parsingContext !== undefined) {
    throw new NotImplementedError('vm.compileFunction.parsingContext');
  }
}

function normalizeContextCodeGeneration(
  options?: CreateContextOptions,
): ContextCodeGeneration | undefined {
  if (options === undefined) return undefined;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalidArgumentType(
      `The "options" argument must be of type object. Received ${describeInvalidType(options)}`,
    );
  }
  const { name, origin, codeGeneration, microtaskMode } = options;
  if (name !== undefined && typeof name !== 'string') {
    throw invalidArgumentType(
      `The "options.name" property must be of type string. Received ${describeInvalidType(name)}`,
    );
  }
  if (origin !== undefined && typeof origin !== 'string') {
    throw invalidArgumentType(
      `The "options.origin" property must be of type string. Received ${describeInvalidType(origin)}`,
    );
  }
  if (
    codeGeneration !== undefined &&
    (typeof codeGeneration !== 'object' || codeGeneration === null || Array.isArray(codeGeneration))
  ) {
    throw invalidArgumentType(
      `The "options.codeGeneration" property must be of type object. Received ${describeInvalidType(codeGeneration)}`,
    );
  }
  if (microtaskMode !== undefined && microtaskMode !== 'afterEvaluate') {
    throw invalidArgumentValue(
      `The property 'options.microtaskMode' must be one of: 'afterEvaluate', undefined. Received ${inspectPrimitive(microtaskMode)}`,
    );
  }
  const { strings, wasm } = codeGeneration ?? {};
  if (strings !== undefined && typeof strings !== 'boolean') {
    throw invalidArgumentType(
      `The "options.codeGeneration.strings" property must be of type boolean. Received ${describeInvalidType(strings)}`,
    );
  }
  if (wasm !== undefined && typeof wasm !== 'boolean') {
    throw invalidArgumentType(
      `The "options.codeGeneration.wasm" property must be of type boolean. Received ${describeInvalidType(wasm)}`,
    );
  }
  if (origin !== undefined) throw new NotImplementedError('vm.createContext.origin');
  if (microtaskMode !== undefined) {
    throw new NotImplementedError('vm.createContext.microtaskMode');
  }
  if (codeGeneration === undefined) return undefined;
  return {
    strings: strings !== false,
    wasm: wasm !== false,
  };
}

function invalidArgumentType(message: string): TypeError {
  return Object.assign(new TypeError(message), { code: 'ERR_INVALID_ARG_TYPE' });
}

function invalidArgumentValue(message: string): TypeError {
  return Object.assign(new TypeError(message), { code: 'ERR_INVALID_ARG_VALUE' });
}

function describeInvalidType(value: unknown): string {
  if (Array.isArray(value)) return 'an instance of Array';
  if (typeof value === 'function') {
    return `function ${(value as { readonly name?: string }).name ?? ''}`;
  }
  if (typeof value === 'object' && value !== null) {
    const ctor = (value as { readonly constructor?: { readonly name?: string } }).constructor;
    return `an instance of ${ctor?.name ?? 'Object'}`;
  }
  return describeNonObject(value);
}

function withSourceURL(code: string, filename?: string): string {
  if (!filename) return code;
  return `${code}\n//# sourceURL=${filename}`;
}

/** Node validates offset options as integers (ERR_OUT_OF_RANGE otherwise). */
function assertIntegerOffsets(options: ScriptOptions): void {
  for (const key of ['lineOffset', 'columnOffset'] as const) {
    const value = options[key];
    if (value === undefined || (typeof value === 'number' && Number.isInteger(value))) continue;
    throw Object.assign(
      new RangeError(
        `The value of "options.${key}" is out of range. It must be an integer. Received ${String(value)}`,
      ),
      { code: 'ERR_OUT_OF_RANGE' },
    );
  }
}

/**
 * Shift stack-frame positions reported for `filename` while `run` executes
 * (Node semantics, oracle-verified): `columnOffset` applies ONLY to frames on
 * the (prefix-shifted) first line — raw, may display negative; other lines'
 * columns never move. A negative `lineOffset` (no physical prefix possible)
 * shifts every frame's line here. Reads inside the script and thrown errors
 * (materialised while installed) carry the shift, as in Node.
 */
function withOffsetStackShift<T>(
  filename: string | undefined,
  firstShiftedLine: number,
  columnShift: number,
  negativeLineShift: number,
  run: () => T,
): T {
  const errorCtor = Error as unknown as ErrorWithPrepareStackTrace;
  const previous = errorCtor.prepareStackTrace;
  const escapedName = filename?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const evalFrameRe =
    filename === undefined || escapedName === undefined
      ? null
      : new RegExp(`at eval \\(${escapedName}:(\\d+):(\\d+)\\)`, 'g');
  const frameRe =
    filename === undefined || escapedName === undefined
      ? null
      : new RegExp(`${escapedName}:(\\d+):(\\d+)`, 'g');
  errorCtor.prepareStackTrace = (err, frames) => {
    const rendered = previous
      ? String(previous(err, frames))
      : `${err.name}: ${err.message}\n${frames.map((frame) => `    at ${String(frame)}`).join('\n')}`;
    if (frameRe === null) return rendered;
    const shift = (line: string, col: string): string => {
      const outLine = Number(line) + negativeLineShift;
      let outCol = Number(col);
      if (Number(line) === firstShiftedLine) outCol += columnShift;
      return `${filename}:${outLine}:${outCol}`;
    };
    // The host compiles via indirect eval; Node's vm frames carry no `eval`
    // marker on frames of the script — normalize and shift in one pass.
    const out =
      evalFrameRe === null
        ? rendered
        : rendered.replace(
            evalFrameRe,
            (_m, line: string, col: string) => `at ${shift(line, col)}`,
          );
    return out.replace(frameRe, (_m, line: string, col: string) => shift(line, col));
  };
  try {
    return run();
  } catch (err) {
    if (err instanceof Error) void err.stack; // materialise while the shift is installed
    throw err;
  } finally {
    if (previous) errorCtor.prepareStackTrace = previous;
    else Reflect.deleteProperty(errorCtor, 'prepareStackTrace');
  }
}

interface ErrorWithPrepareStackTrace {
  prepareStackTrace?: (err: Error, frames: NodeJS.CallSite[]) => unknown;
}

/** Apply `lineOffset`/`columnOffset` to a host-realm script run (goal I4/I5). */
function runGlobalScriptWithOffsets(
  code: string,
  filename: string | undefined,
  lineOffset: number,
  columnOffset: number,
): unknown {
  const prefixed = lineOffset > 0 ? `${'\n'.repeat(lineOffset)}${code}` : code;
  const negativeLineShift = lineOffset < 0 ? lineOffset : 0;
  // The dispatcher also normalizes `eval` frame markers for this filename.
  if (lineOffset === 0 && columnOffset === 0) {
    return runGlobalScript(withSourceURL(prefixed, filename));
  }
  return withOffsetStackShift(
    filename,
    1 + Math.max(0, lineOffset),
    columnOffset,
    negativeLineShift,
    () => runGlobalScript(withSourceURL(prefixed, filename)),
  );
}

export function createContext<T extends Record<string, unknown> = Record<string, unknown>>(
  contextObject?: T,
  options?: CreateContextOptions,
): T {
  if (isVmContext(contextObject)) return contextObject as T;
  const codeGeneration = normalizeContextCodeGeneration(options);
  const engine = selectEngine();
  if (
    engine.name === 'rewrite' &&
    codeGeneration &&
    (!codeGeneration.strings || !codeGeneration.wasm)
  ) {
    throw new NotImplementedError('vm.createContext.codeGeneration.rewrite-engine');
  }
  if (contextObject === null) {
    throw new TypeError('The "object" argument must be of type object. Received null');
  }
  const context = (contextObject === undefined ? {} : contextObject) as T & ContextObject;
  Object.defineProperty(context, VM_CONTEXT, {
    configurable: false,
    enumerable: false,
    value: true,
  });
  if (codeGeneration) {
    setContextCodeGeneration(context, codeGeneration);
  }
  engine.initContext(context);
  return context;
}

export function isContext(value: unknown): boolean {
  return isVmContext(value);
}

export function runInThisContext(code: string, options?: VmOptions): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInThisContext');
  return runGlobalScriptWithOffsets(
    asSource(code),
    normalized.filename,
    normalized.lineOffset ?? 0,
    normalized.columnOffset ?? 0,
  );
}

export function runInContext(
  code: string,
  contextifiedObject: Record<string, unknown>,
  options?: VmOptions,
): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInContext');
  assertContextified(contextifiedObject);
  if ((normalized.columnOffset ?? 0) !== 0) {
    // Engine-op path (quickjs/rewrite) — column shifting needs the host stack
    // dispatcher, which cannot see engine frames. Loud, never silently lost.
    throw new NotImplementedError('vm.runInContext.columnOffset');
  }
  if ((normalized.lineOffset ?? 0) > 0) {
    const prefixed = `${'\n'.repeat(normalized.lineOffset ?? 0)}${asSource(code)}`;
    return selectEngineForRun().runInContext(
      prefixed,
      contextifiedObject as ContextObject,
      normalized.filename,
    );
  }
  if ((normalized.lineOffset ?? 0) < 0) {
    throw new NotImplementedError('vm.runInContext.lineOffset.negative');
  }
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
  readonly #lineOffset: number;
  readonly #columnOffset: number;
  // Memoised compiled payload — compile once, reuse across every run of this
  // Script instance. The engine keys its own per-script state (the rewrite, a
  // quickjs handle, …) on this stable CompiledScript identity, so reuse here is
  // what preserves the parse-once optimization across runs.
  #compiled?: CompiledScript;

  constructor(code: string, options?: VmOptions) {
    const normalized = normalizeOptions(options);
    assertSupportedScriptOptions(normalized, 'vm.Script');
    // Node bakes offsets at construction; a positive lineOffset is a physical
    // newline prefix (real frame coordinates), the rest a stack shift at run.
    this.#lineOffset = normalized.lineOffset ?? 0;
    this.#columnOffset = normalized.columnOffset ?? 0;
    this.#code =
      this.#lineOffset > 0 ? `${'\n'.repeat(this.#lineOffset)}${asSource(code)}` : asSource(code);
    this.#filename = normalized.filename;
  }

  #getCompiled(): CompiledScript {
    if (!this.#compiled) this.#compiled = selectEngine().compile(this.#code, this.#filename);
    return this.#compiled;
  }

  /** Sandbox (engine-op) runs cannot see the host stack dispatcher: column
   * offsets and negative line offsets are loudly unsupported there. */
  #assertSandboxOffsetsSupported(): void {
    if (this.#columnOffset !== 0) {
      throw new NotImplementedError('vm.Script.runInContext.columnOffset');
    }
    if (this.#lineOffset < 0) {
      throw new NotImplementedError('vm.Script.runInContext.lineOffset.negative');
    }
  }

  runInThisContext(options?: VmOptions): unknown {
    // Node ignores run-time lineOffset/columnOffset for a compiled Script
    // (they are construction options); construction offsets apply here.
    const normalized = normalizeOptions(options);
    assertSupportedRunOptions(normalized, 'vm.Script');
    const negativeLineShift = this.#lineOffset < 0 ? this.#lineOffset : 0;
    if (this.#lineOffset === 0 && this.#columnOffset === 0) {
      return runGlobalScript(withSourceURL(this.#code, this.#filename));
    }
    return withOffsetStackShift(
      this.#filename,
      1 + Math.max(0, this.#lineOffset),
      this.#columnOffset,
      negativeLineShift,
      () => runGlobalScript(withSourceURL(this.#code, this.#filename)),
    );
  }

  runInContext(contextifiedObject: Record<string, unknown>, options?: VmOptions): unknown {
    const normalized = { ...normalizeOptions(options), filename: this.#filename };
    assertSupportedScriptOptions(normalized, 'vm.Script');
    assertContextified(contextifiedObject);
    this.#assertSandboxOffsetsSupported();
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
    this.#assertSandboxOffsetsSupported();
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
