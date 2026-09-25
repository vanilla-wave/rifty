/**
 * Node process lifecycle delivery (ADR-0445). Uncaught errors and unhandled
 * rejections reach the realm's active `NodeProcess` listeners before any
 * terminal path (Node v24 `createOnGlobalUncaughtException`, `promises.js`
 * throw mode), and `exit()` keeps Node's `_exiting` state: one `'exit'`
 * emission (the process's control port sends one kernel exit request).
 *
 * Callers (realm traps, the `nextTick` drain, the entry catch) may live in
 * another bundle than the process: they reach its state through the
 * `Symbol.for` slot, never a module-local import.
 */
import { readActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';

const NODE_PROCESS_LIFECYCLE = Symbol.for('rifty.runtime-js.process-lifecycle.v1');
const UNDISPATCHED_RETHROW = Symbol.for('rifty.runtime-js.process-undispatched-rethrow.v1');
const RIFTY_PROCESS_EXIT = 'RIFTY_PROCESS_EXIT';

const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const arrayIsArray = Array.isArray;
const functionToString = Function.prototype.toString;
const symbolToString = Symbol.prototype.toString;
const bigintToString = BigInt.prototype.toString;
const objectPrototypeToString = Object.prototype.toString;
const errorPrototypeToString = Error.prototype.toString;
const dateGetTime = Date.prototype.getTime;
const regexpSourceGetter = objectGetOwnPropertyDescriptor(RegExp.prototype, 'source')?.get;
const queueMicrotaskPrimordial = globalThis.queueMicrotask.bind(globalThis);

export type UncaughtOrigin = 'uncaughtException' | 'unhandledRejection';
/**
 * `handled`: a listener took it. `unhandled`: no listener; the fatal `'exit'` ran
 * for `error`. `exited`: an `exit()`/exit-7 terminal owns it.
 */
export type LifecycleDispatch =
  | { readonly kind: 'handled' | 'no-process' }
  | { readonly kind: 'unhandled'; readonly error: unknown }
  | { readonly kind: 'exited'; readonly signal: RiftyProcessExitSignal };

const HANDLED = { kind: 'handled' } as const;
const NO_PROCESS = { kind: 'no-process' } as const;

export interface RiftyProcessExitSignal extends Error {
  readonly code: typeof RIFTY_PROCESS_EXIT;
  readonly exitCode: number;
}

export function isRiftyProcessExit(value: unknown): value is RiftyProcessExitSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly code?: unknown }).code === RIFTY_PROCESS_EXIT &&
    typeof (value as { readonly exitCode?: unknown }).exitCode === 'number'
  );
}

/** Wrap an exit code to Node's unsigned 8-bit range (e.g. 257 → 1, -1 → 255). */
export function toUint8ExitCode(n: number): number {
  return ((Math.trunc(n) % 256) + 256) % 256;
}

interface LifecycleEmitter {
  emit(event: string, ...args: unknown[]): boolean;
}

export interface NodeProcessExitHost {
  readonly process: LifecycleEmitter;
  readExitCode(): number | undefined;
  /** The validating `exitCode` setter. */
  writeExitCode(value: unknown): void;
  writeStderr(text: string): void;
  /** Request the kernel exit for `signal` (eval-owned or control port; the port sends once). */
  requestExit(signal: RiftyProcessExitSignal): void;
}

/** One process's exit state: Node's `_exiting`. */
export class NodeProcessExit {
  readonly #host: NodeProcessExitHost;
  #exiting = false;
  /** The first requested terminal: after it the process is gone for Node. */
  #terminal: RiftyProcessExitSignal | null = null;

  constructor(host: NodeProcessExitHost) {
    this.#host = host;
  }

  /** Node `process._exiting`: an `exit()` or the fatal `'exit'` has begun. */
  get exiting(): boolean {
    return this.#exiting;
  }

  /** Node `per_thread.js` `exit()`: the status is read after the listeners. */
  exit(hasCode: boolean, code: unknown): never {
    if (hasCode) this.#host.writeExitCode(code);
    if (!this.#exiting) {
      this.#exiting = true;
      this.#host.process.emit('exit', this.#host.readExitCode() ?? 0);
    }
    return this.#terminate(toUint8ExitCode(this.#host.readExitCode() ?? 0));
  }

  /** No listener: Node sets `exitCode = 1` and emits `'exit'` 1 behind `_exiting`. */
  beginFatal(): void {
    if (this.#exiting) return;
    this.#exiting = true;
    try {
      this.#host.writeExitCode(1);
      this.#host.process.emit('exit', 1);
    } catch {
      // Node: "Nothing to be done about it at this point."
    }
  }

  /**
   * After `beginFatal`, Node prints and exits with `exitCode ?? 1` inside its
   * handler — unless an `exit()` already ended it (e.g. in the fatal `'exit'`).
   */
  fatal(error: unknown): never {
    if (this.#terminal !== null) throw this.#terminal;
    this.#host.writeStderr(`${formatThrown(error)}\n`);
    return this.#terminate(toUint8ExitCode(this.#host.readExitCode() ?? 1), { cause: error });
  }

  /** A throwing `uncaughtException` listener: stderr, status 7, no `'exit'`. */
  listenerThrew(error: unknown): never {
    this.#host.writeStderr(`${formatThrown(error)}\n`);
    this.#exiting = true;
    return this.#terminate(7, { cause: error });
  }

  /** A fresh in-process invocation on a reused process (no-COI, test harness). */
  reset(): void {
    this.#host.writeExitCode(undefined);
    this.#exiting = false;
    this.#terminal = null;
  }

  /**
   * `died.cause`: the error a runtime terminal ended the process for; an
   * in-process host (no-COI runBin) reads a declared gap from it.
   */
  #terminate(status: number, died?: { readonly cause: unknown }): never {
    const signal = Object.assign(new Error(`process.exit(${status})`, died), {
      code: RIFTY_PROCESS_EXIT,
      exitCode: status,
    }) as RiftyProcessExitSignal;
    this.#host.requestExit(signal);
    this.#terminal ??= signal;
    throw signal;
  }
}

type NodeProcessExitLike = Pick<
  NodeProcessExit,
  'exiting' | 'beginFatal' | 'fatal' | 'listenerThrew' | 'reset'
>;

export function attachNodeProcessExit(process: object, exit: NodeProcessExit): void {
  Object.defineProperty(process, NODE_PROCESS_LIFECYCLE, {
    value: exit,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function exitStateOf(process: unknown): NodeProcessExitLike | null {
  if ((typeof process !== 'object' && typeof process !== 'function') || process === null) {
    return null;
  }
  const exit = Reflect.get(process, NODE_PROCESS_LIFECYCLE) as NodeProcessExitLike | undefined;
  return exit === undefined ? null : exit;
}

/** True once `process`'s exit has begun (Node `_exiting`); false for a non-runtime process. */
export function isNodeProcessExiting(process: unknown): boolean {
  return exitStateOf(process)?.exiting === true;
}

/** Reset a reused in-process `NodeProcess` to an unset, not-exiting invocation. */
export function resetNodeProcessExit(process: unknown): void {
  const exit = exitStateOf(process);
  if (exit === null)
    throw new TypeError('process exit state target is not a runtime-owned NodeProcess');
  exit.reset();
}

function lifecycleTarget(
  target: unknown,
): { readonly process: LifecycleEmitter; readonly exit: NodeProcessExitLike } | null {
  const process = target ?? readActiveNodeProcessBootstrap()?.process;
  const exit = exitStateOf(process);
  return exit === null ? null : { process: process as LifecycleEmitter, exit };
}

/**
 * Deliver an uncaught error: `uncaughtExceptionMonitor`, then `uncaughtException`
 * listeners. No listener → the fatal `'exit'` 1 and `unhandled` (the caller's
 * terminal path runs). A throwing listener → exit 7 without `'exit'`.
 */
export function dispatchUncaughtException(
  error: unknown,
  origin: UncaughtOrigin,
  target?: unknown,
): LifecycleDispatch {
  if (isRiftyProcessExit(error)) return { kind: 'exited', signal: error };
  const active = lifecycleTarget(target);
  if (active === null) return NO_PROCESS;
  try {
    active.process.emit('uncaughtExceptionMonitor', error, origin);
    if (active.process.emit('uncaughtException', error, origin)) return HANDLED;
  } catch (thrown) {
    if (isRiftyProcessExit(thrown)) return { kind: 'exited', signal: thrown };
    try {
      active.exit.listenerThrew(thrown);
    } catch (signal) {
      if (isRiftyProcessExit(signal)) return { kind: 'exited', signal };
      throw signal;
    }
  }
  active.exit.beginFatal();
  return { kind: 'unhandled', error };
}

/**
 * Deliver an unhandled rejection: `unhandledRejection(reason, promise)`, else
 * `uncaughtException` with origin `unhandledRejection` and Node's
 * `UnhandledPromiseRejection` wrap for a reason without an own `stack`.
 */
export function dispatchUnhandledRejection(
  reason: unknown,
  promise: unknown,
  target?: unknown,
): LifecycleDispatch {
  if (isRiftyProcessExit(reason)) return { kind: 'exited', signal: reason };
  const active = lifecycleTarget(target);
  if (active === null) return NO_PROCESS;
  try {
    if (active.process.emit('unhandledRejection', reason, promise)) return HANDLED;
  } catch (thrown) {
    if (isRiftyProcessExit(thrown)) return { kind: 'exited', signal: thrown };
    return dispatchUncaughtException(thrown, 'uncaughtException', target);
  }
  const error = isErrorLike(reason) ? reason : new UnhandledPromiseRejection(reason);
  return dispatchUncaughtException(error, 'unhandledRejection', target);
}

/**
 * The fatal terminal of an `unhandled` dispatch, run now: stderr, then the one
 * kernel exit request, so no later task's `exit()` overrides the status.
 */
export function terminateFatal(error: unknown, target?: unknown): RiftyProcessExitSignal | null {
  const active = lifecycleTarget(target);
  if (active === null) return null;
  try {
    return active.exit.fatal(error);
  } catch (signal) {
    if (isRiftyProcessExit(signal)) return signal;
    throw signal;
  }
}

/**
 * Run an async-API callback the way Node's event loop does: its throw is an
 * uncaught exception for the realm `error` trap, never a rejection of the
 * runtime promise that settled it.
 */
export function runNodeCallback<A extends unknown[]>(
  callback: (...args: A) => unknown,
  ...args: A
): void {
  try {
    callback(...args);
  } catch (error) {
    queueMicrotaskPrimordial(() => {
      throw error;
    });
  }
}

interface UndispatchedRethrowSlot {
  pending: { readonly error: unknown } | null;
}

function undispatchedRethrowSlot(): UndispatchedRethrowSlot {
  const realm = globalThis as typeof globalThis & {
    [UNDISPATCHED_RETHROW]?: UndispatchedRethrowSlot;
  };
  if (realm[UNDISPATCHED_RETHROW] === undefined) {
    Object.defineProperty(realm, UNDISPATCHED_RETHROW, {
      value: { pending: null } satisfies UndispatchedRethrowSlot,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return realm[UNDISPATCHED_RETHROW] as UndispatchedRethrowSlot;
}

/**
 * Hand an already-dispatched fatal error to the realm's terminal path: thrown
 * from a microtask so the realm `error` trap reports it without dispatching again.
 */
export function rethrowUndispatched(error: unknown): void {
  undispatchedRethrowSlot().pending = { error };
  queueMicrotaskPrimordial(() => {
    throw error;
  });
}

/** True once for the error `rethrowUndispatched` handed over. */
export function takeUndispatchedRethrow(error: unknown): boolean {
  const slot = undispatchedRethrowSlot();
  if (slot.pending === null || slot.pending.error !== error) return false;
  slot.pending = null;
  return true;
}

function isErrorLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && objectHasOwn(value, 'stack');
}

const UNHANDLED_REJECTION_PREFIX =
  'This error originated either by throwing inside of an async function without a catch block, ' +
  'or by rejecting a promise which was not handled with .catch(). The promise rejected with the ' +
  'reason ';

/** Node v24 `lib/internal/process/promises.js` `UnhandledPromiseRejection`. */
class UnhandledPromiseRejection extends Error {
  code = 'ERR_UNHANDLED_REJECTION';
  override name = 'UnhandledPromiseRejection';
  constructor(reason: unknown) {
    super(`${UNHANDLED_REJECTION_PREFIX}"${noSideEffectsToString(reason)}".`);
  }
}

/** `[[Get]]` restricted to data properties: accessors and proxies are never run. */
function dataProperty(value: object, key: PropertyKey): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = objectGetOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : undefined;
    current = objectGetPrototypeOf(current) as object | null;
  }
  return undefined;
}

function brandChecks(value: object, method: ((...args: never[]) => unknown) | undefined): boolean {
  if (method === undefined) return false;
  try {
    reflectApply(method, value, []);
    return true;
  } catch {
    return false;
  }
}

/** V8 `JSReceiver::class_name` for the builtins a reason can plausibly be. */
function builtinTag(value: object): string {
  if (arrayIsArray(value)) return 'Array';
  if (brandChecks(value, dateGetTime)) return 'Date';
  if (brandChecks(value, regexpSourceGetter)) return 'RegExp';
  return 'Object';
}

function errorToString(value: object): string {
  const name = dataProperty(value, 'name');
  const message = dataProperty(value, 'message');
  const nameText = typeof name === 'string' ? name : '';
  const messageText = typeof message === 'string' ? message : '';
  if (nameText === '') return messageText;
  if (messageText === '') return nameText;
  return `${nameText}: ${messageText}`;
}

/** V8 `Object::NoSideEffectsToString` (Node's rejection-reason rendering). */
function noSideEffectsToString(value: unknown): string {
  if (typeof value === 'symbol') return reflectApply(symbolToString, value, []) as string;
  if (typeof value === 'bigint') return reflectApply(bigintToString, value, []) as string;
  if (typeof value === 'function') {
    const source = reflectApply(functionToString, value, []) as string;
    return source.length > 128
      ? `${source.slice(0, 111)}...<omitted>...${source.slice(source.length - 2)}`
      : source;
  }
  if (typeof value !== 'object' || value === null) return String(value);
  const toString = dataProperty(value, 'toString');
  if (toString === errorPrototypeToString) return errorToString(value);
  if (toString === objectPrototypeToString) {
    const ctor = dataProperty(value, 'constructor');
    if (typeof ctor === 'function') {
      const name = objectGetOwnPropertyDescriptor(ctor, 'name')?.value;
      if (typeof name === 'string' && name !== '') return `#<${name}>`;
    }
  }
  const tag = dataProperty(value, Symbol.toStringTag);
  return `[object ${typeof tag === 'string' ? tag : builtinTag(value)}]`;
}

function formatThrown(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return noSideEffectsToString(error);
}
