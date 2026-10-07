/**
 * Process-lifecycle dispatcher (process-lifecycle-events-exit-code): the
 * keepalive traps consult the ACTIVE runtime-owned NodeProcess FIRST —
 * `uncaughtException`/`unhandledRejection` listeners take the error and the
 * loop continues, as in Node; with no listener the loud ADR-0152 path stands.
 * Lives beside NodeProcess (late binding; process.ts already imports the
 * keepalive — the reverse import would cross layers).
 */
import { setProcessLifecycleDispatcher } from '../internal/event-loop-keepalive.ts';
import { readActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';

// Realm-shared exit-event state: module graphs can carry more than one copy
// of this module (bundle/dynamic-import duplication) — key on the realm so the
// once-per-process guarantee is universal.
const EXIT_EMITTED_KEY = Symbol.for('rifty.runtime-js.process-exit-emitted.v1');

function exitEmittedSet(): WeakSet<object> {
  const realm = globalThis as { [EXIT_EMITTED_KEY]?: WeakSet<object> };
  if (realm[EXIT_EMITTED_KEY] === undefined) {
    Object.defineProperty(globalThis, EXIT_EMITTED_KEY, {
      value: new WeakSet<object>(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return realm[EXIT_EMITTED_KEY] as WeakSet<object>;
}

export function emitProcessExitEvent(proc: object, code: number): void {
  const emitted = exitEmittedSet();
  if (emitted.has(proc)) return;
  emitted.add(proc);
  (proc as { emit(event: 'exit', code: number): boolean }).emit('exit', code);
}

/** Receiver-less calls on receiver-dependent process methods (`exit`, `kill`)
 * act on the ACTIVE runtime-owned process — Node's process methods are plain
 * closures over the process, so a named import must keep working. */
export function activeDispatchReceiver(fallback: object): object {
  const active = readActiveNodeProcessBootstrap()?.process;
  if (active !== undefined && active !== null && isNodeProcess(active)) return active;
  return fallback;
}

function activeLifecycleProcess(): object | null {
  const active = readActiveNodeProcessBootstrap()?.process;
  if (active !== undefined && active !== null) return active;
  const global = (globalThis as { process?: unknown }).process;
  return global ?? null;
}

/** Trusted runtime-owned marker every seeded NodeProcess carries — survives
 * cross-bundle adoption (instanceof breaks between production bundles). */
const NODE_PROCESS_IDENTITY = Symbol.for('rifty.runtime-js.node-process-identity.v1');

/** Trusted runtime-owned marker on every spec-seeded NodeProcess (constructor
 * calls this; cross-bundle safe recognition). */
export function defineLifecycleIdentity(proc: object): void {
  Object.defineProperty(proc, NODE_PROCESS_IDENTITY, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function isNodeProcess(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[NODE_PROCESS_IDENTITY] === true
  );
}

/** `hasThrownValue` distinguishes "handler threw undefined" from "no handler
 * threw" (a bare undefined replacement would be lossy). */
export interface DispatchOutcome {
  readonly handled: boolean;
  readonly hasThrownValue?: boolean;
  readonly thrownValue?: unknown;
}

// Node: an exception inside a lifecycle handler is FATAL — the PROCESS is
// dying; later dispatches must not re-enter its handlers. Realm-shared so a
// dispatcher reinstall never resurrects a dead process.
const DIED_KEY = Symbol.for('rifty.runtime-js.process-lifecycle-died.v1');

function diedSet(): WeakSet<object> {
  const realm = globalThis as { [DIED_KEY]?: WeakSet<object> };
  if (realm[DIED_KEY] === undefined) {
    Object.defineProperty(globalThis, DIED_KEY, {
      value: new WeakSet<object>(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return realm[DIED_KEY] as WeakSet<object>;
}

export function installProcessLifecycleDispatcher(): void {
  setProcessLifecycleDispatcher({
    dispatchUnhandled(reason, origin) {
      const active0 = activeLifecycleProcess();
      if (active0 !== null && diedSet().has(active0)) {
        // The process is dying from a previous fatal handler throw — no
        // handler re-entry, no rethrow claim: the platform's default crash
        // reporting owns the error (a rethrow here would loop the trap).
        return { handled: false };
      }
      const active = activeLifecycleProcess();
      if (!isNodeProcess(active)) return { handled: false };
      const proc = active as unknown as {
        emit(event: string, ...args: unknown[]): unknown;
        listenerCount(event: string): number;
      };
      const HANDLED = Symbol('handled');
      const asOutcome = (
        result: typeof HANDLED | { readonly thrown: unknown },
      ): DispatchOutcome => {
        if (result === HANDLED) return { handled: true };
        // Fatal: the process is dying — no further handler reentry.
        diedSet().add(proc as unknown as object);
        return { handled: false, hasThrownValue: true, thrownValue: result.thrown };
      };
      const emitFor = (
        event: 'uncaughtException' | 'unhandledRejection',
      ): typeof HANDLED | { readonly thrown: unknown } => emitFor2(event, reason);

      const emitFor2 = (
        event: 'uncaughtException' | 'unhandledRejection',
        emitReason: unknown,
      ): typeof HANDLED | { readonly thrown: unknown } => {
        try {
          if (event === 'unhandledRejection') proc.emit(event, emitReason, undefined);
          else proc.emit(event, emitReason);
          return HANDLED;
        } catch (replacement) {
          // Node: an exception inside a handler is fatal with the NEW thrown
          // value — even when a handler throws null/undefined.
          return { thrown: replacement };
        }
      };
      // Node default (--unhandled-rejections=throw): a REJECTION goes to its
      // dedicated handler, else falls to uncaughtException. An uncaught ERROR
      // never falls the other way — UR handlers do not catch exceptions.
      // A THROWING UR handler routes its error to the UE handler (Node
      // semantics); only with no UE handler is it fatal.
      if (origin === 'rejection' && proc.listenerCount('unhandledRejection') > 0) {
        const urResult = emitFor('unhandledRejection');
        if (urResult === HANDLED) return { handled: true };
        if (proc.listenerCount('uncaughtException') > 0) {
          const ueResult = emitFor2('uncaughtException', urResult.thrown);
          return asOutcome(ueResult);
        }
        return asOutcome(urResult);
      }
      if (proc.listenerCount('uncaughtException') > 0) {
        return asOutcome(emitFor('uncaughtException'));
      }
      return { handled: false };
    },
    emitNaturalExit() {
      const active = activeLifecycleProcess();
      if (active !== null && isNodeProcess(active)) {
        emitProcessExitEvent(active, (active as { exitCode: number }).exitCode);
      }
    },
  });
}
