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

export interface NodeLifecycleDeps {
  /** Import + run the entry through the loader (runNodeEntry, bin:false). */
  readonly runEntry: () => Promise<void>;
  /** Ports the entry registered via listen() (net registry listPorts). */
  readonly listPorts: () => number[];
  /** Subscribe to net-registry port changes (onRegistryChange); returns unsubscribe. */
  readonly onPortsChange: (cb: () => void) => () => void;
  /** Await event-loop drain (keepalive awaitDrain). */
  readonly awaitDrain: (hasPendingEntry?: () => boolean) => Promise<void>;
  /** Wire `/preview/<port>/` for a listened port; returns a teardown. */
  readonly servePreview: (port: number) => () => void;
  /** Report the CURRENT listened port set to the owner (rifty:node-listening). */
  readonly postListening: (ports: number[]) => void;
  /** Raw `process.exitCode` at natural exit (honoured per Node — ADR-0157 D4). */
  readonly readExitCode: () => unknown;
  /** Exit the worker with a code (process.exit). */
  readonly exit: (code: number) => void;
  /** Captured process stderr writer; failure diagnostics precede termination. */
  readonly writeStderr: (chunk: string) => void;
}

export function terminateNodeProgramFailure(
  error: unknown,
  deps: Pick<NodeLifecycleDeps, 'writeStderr' | 'exit'>,
): never {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    deps.writeStderr(`${message}\n`);
  } catch {
    /* A closed stderr does not suppress process termination. */
  }
  deps.exit(1);
  throw error;
}

type EntryOutcome =
  | { readonly kind: 'returned' }
  | { readonly kind: 'threw'; readonly err: unknown };

type DrainOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'resolved' }
  | { readonly kind: 'rejected'; readonly err: unknown };

export async function runNodeProgramToCompletion(
  deps: Pick<NodeLifecycleDeps, 'runEntry' | 'readExitCode' | 'exit' | 'writeStderr'> & {
    readonly awaitDrain: () => Promise<void>;
  },
): Promise<void> {
  try {
    await deps.runEntry();
    await deps.awaitDrain();
  } catch (error) {
    if (exitCodeOf(error) !== null) throw error;
    terminateNodeProgramFailure(error, deps);
  }
  const code = deps.readExitCode();
  deps.exit(typeof code === 'number' && Number.isFinite(code) ? code : 0);
}

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
    void deps
      .awaitDrain(() => currentEntryOutcome() === null)
      .then(
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
      terminateNodeProgramFailure(outcome.err, deps);
    }
    const drained = currentDrainOutcome();
    if (drained.kind === 'rejected') {
      cleanup();
      const code = exitCodeOf(drained.err);
      if (code !== null) {
        deps.exit(code);
        return;
      }
      terminateNodeProgramFailure(drained.err, deps);
    }

    // Fatal tasks must reach the same drain while top-level evaluation waits.
    startDrain();
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
      if (ports.length === 0 && currentDrainOutcome().kind === 'resolved') {
        cleanup();
        // Natural exit honours process.exitCode (Node parity, D4): a clean
        // return after `process.exitCode = N` exits N, not 0. A tail THROW still
        // maps to exit 1 above (uncaught wins, Node-faithful).
        // NodeProcess emits the raw code; only its terminal status is uint8.
        const code = deps.readExitCode();
        deps.exit(typeof code === 'number' && Number.isFinite(code) ? code : 0);
        return;
      }
    }
    await nextWake(seen);
  }
}
