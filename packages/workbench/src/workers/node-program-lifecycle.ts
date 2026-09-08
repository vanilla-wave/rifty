/**
 * Foreground node lifecycle (ADR-0385): preview follows registry changes while
 * one drain waits for listeners and runtime handles after entry return.
 * The supervised child is serve:true; this owner sends its natural exit.
 */
import { watchServedPorts } from './port-watch.ts';

interface ProcessExitLike {
  code?: unknown;
  exitCode?: unknown;
}
function exitCodeOf(err: unknown): number | null {
  const c = err as ProcessExitLike;
  return c && c.code === 'RIFTY_PROCESS_EXIT' && typeof c.exitCode === 'number' ? c.exitCode : null;
}

/**
 * Uint8-wrap a (validated) exit code to Node's 0–255 range; a non-number defaults
 * to 0 defensively. So a clean `return` after `process.exitCode = 7` exits 7
 * (ADR-0157 review D4), not the old hardcoded 0. NOTE: Node's string-coercion +
 * loud validation of an invalid exit code lives in the `process.exitCode` SETTER
 * (builtins/process.ts `coerceExitCode`); by the time a value reaches here it is
 * already a validated integer — this is only the final uint8 wrap.
 */
export function normalizeExitCode(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return ((Math.trunc(v) % 256) + 256) % 256;
}

export interface NodeLifecycleDeps {
  /** Import + run the entry through the loader (runNodeEntry, bin:false). */
  readonly runEntry: () => Promise<void>;
  /** Ports the entry registered via listen() (net registry listPorts). */
  readonly listPorts: () => number[];
  /** Subscribe to net-registry port changes (onRegistryChange); returns unsubscribe. */
  readonly onPortsChange: (cb: () => void) => () => void;
  /** Await event-loop drain (keepalive awaitDrain). */
  readonly awaitDrain: () => Promise<void>;
  /** Wire `/preview/<port>/` for a listened port; returns a teardown. */
  readonly servePreview: (port: number) => () => void;
  /** Report the CURRENT listened port set to the owner (rifty:node-listening). */
  readonly postListening: (ports: number[]) => void;
  /** Raw `process.exitCode` at natural exit (honoured per Node — ADR-0157 D4). */
  readonly readExitCode: () => unknown;
  /** Exit the worker with a code (process.exit). */
  readonly exit: (code: number) => void;
}

type EntryOutcome =
  | { readonly kind: 'returned' }
  | { readonly kind: 'threw'; readonly err: unknown };

type DrainOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'resolved' }
  | { readonly kind: 'rejected'; readonly err: unknown };

export async function runNodeProgramLifecycle(deps: NodeLifecycleDeps): Promise<void> {
  // Wake-versioned event loop: any of {entry settled, drain settled, port
  // registered/unregistered} bumps the version and releases the waiters, so the
  // decision loop re-checks state exactly when something changed — never a timer.
  let version = 0;
  const waiters: Array<() => void> = [];
  const wake = (): void => {
    version += 1;
    while (waiters.length > 0) waiters.shift()?.();
  };
  const nextWake = (seen: number): Promise<void> => {
    if (version !== seen) return Promise.resolve();
    return new Promise<void>((resolve) => waiters.push(resolve));
  };
  // Subscribe BEFORE running the entry: a synchronous listen() during import can
  // never race the subscription (the loop also re-reads listPorts each pass).
  const unsubscribePorts = deps.onPortsChange(wake);

  let stopPreview: (() => void) | undefined;
  const served = new Map<number, () => void>();
  const cleanup = (): void => {
    unsubscribePorts();
    stopPreview?.();
    for (const tear of served.values()) tear();
    served.clear();
  };
  let entryOutcome: EntryOutcome | null = null;
  const currentEntryOutcome = (): EntryOutcome | null => entryOutcome;
  void deps.runEntry().then(
    () => {
      entryOutcome = { kind: 'returned' };
      wake();
    },
    (err) => {
      entryOutcome = { kind: 'threw', err };
      wake();
    },
  );

  let drainStarted = false;
  let drainOutcome: DrainOutcome = { kind: 'pending' };
  const currentDrainOutcome = (): DrainOutcome => drainOutcome;
  const startDrain = (): void => {
    if (drainStarted) return;
    drainStarted = true;
    void deps.awaitDrain().then(
      () => {
        drainOutcome = { kind: 'resolved' };
        wake();
      },
      (err) => {
        drainOutcome = { kind: 'rejected', err };
        wake();
      },
    );
  };

  for (;;) {
    const seen = version;
    // Let a synchronously-settled entry land before inspecting ports. This
    // preserves the listen-then-throw invariant: a failing entry must not
    // publish a preview slot just because it registered one before throwing.
    await Promise.resolve();
    const outcome = currentEntryOutcome();
    if (outcome?.kind === 'threw') {
      cleanup();
      const code = exitCodeOf(outcome.err);
      if (code !== null) {
        deps.exit(code);
        return;
      }
      throw outcome.err; // surfaced by the kernel worker-entry → stderr + exit 1
    }
    const drained = currentDrainOutcome();
    if (drained.kind === 'rejected') {
      cleanup();
      throw drained.err;
    }

    const ports = deps.listPorts();
    if (ports.length > 0 && stopPreview === undefined) {
      stopPreview = watchServedPorts({
        listPorts: deps.listPorts,
        subscribe: deps.onPortsChange,
        servePreview: deps.servePreview,
        post: deps.postListening,
        served,
      });
    }

    if (outcome?.kind === 'returned') {
      startDrain();
      if (ports.length === 0 && currentDrainOutcome().kind === 'resolved') {
        cleanup();
        // Natural exit honours process.exitCode (Node parity, D4): a clean
        // return after `process.exitCode = N` exits N, not 0. A tail THROW still
        // maps to exit 1 above (uncaught wins, Node-faithful).
        deps.exit(normalizeExitCode(deps.readExitCode()));
        return;
      }
    }
    await nextWake(seen);
  }
}
