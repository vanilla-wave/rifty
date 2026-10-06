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

export function installProcessLifecycleDispatcher(): void {
  // Node: an exception inside a lifecycle handler is FATAL — the process is
  // dying; later dispatches must not re-enter any handler.
  const died = false;
  setProcessLifecycleDispatcher({
    dispatchUnhandled(reason, origin) {
      if (died) return { handled: false, hasThrownValue: true, thrownValue: reason };
      const active = activeLifecycleProcess();
      if (!isNodeProcess(active)) return { handled: false };
      const proc = active as unknown as {
        emit(event: string, ...args: unknown[]): unknown;
        listenerCount(event: string): number;
      };
      const HANDLED = Symbol('handled');
      const asOutcome = (result: typeof HANDLED | { readonly thrown: unknown }): DispatchOutcome =>
        result === HANDLED
          ? { handled: true }
          : { handled: false, hasThrownValue: true, thrownValue: result.thrown };
      const emitFor = (
        event: 'uncaughtException' | 'unhandledRejection',
      ): typeof HANDLED | { readonly thrown: unknown } => {
        try {
          if (event === 'unhandledRejection') proc.emit(event, reason, undefined);
          else proc.emit(event, reason);
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
      const preferRejectionHandler =
        origin === 'rejection' && proc.listenerCount('unhandledRejection') > 0;
      const result = preferRejectionHandler
        ? emitFor('unhandledRejection')
        : proc.listenerCount('uncaughtException') > 0
          ? emitFor('uncaughtException')
          : undefined;
      if (result === undefined) return { handled: false };
      return asOutcome(result);
    },
    emitNaturalExit() {
      const active = activeLifecycleProcess();
      if (active !== null && isNodeProcess(active)) {
        emitProcessExitEvent(active, (active as { exitCode: number }).exitCode);
      }
    },
  });
}
