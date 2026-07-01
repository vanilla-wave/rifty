/**
 * Run-vs-serve lifecycle for a `node <file>` supervised child (ADR-0155). The
 * child spawns serve:true (kernel never reaps it), so the bootstrap OWNS the
 * decision the kernel drain hook would make for a run-to-completion child:
 *  - the entry listened (registered a port) → it is a SERVER: serve each port's
 *    cross-realm preview, post the ports to the owner, STAY ALIVE (return).
 *  - else → run-to-completion: await the event-loop drain (ADR-0152 — timers/
 *    imports + unhandledrejection→exit1), then process.exit(code).
 *
 * Real CLIs such as Vite may call listen() and then keep their top-level promise
 * pending. So the lifecycle watches registered ports while the entry is still
 * running; a port wins the branch without waiting for top-level return.
 * Pure + dep-injected so both branches unit-test without a Worker.
 */
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
  /** Await event-loop drain (keepalive awaitDrain). */
  readonly awaitDrain: () => Promise<void>;
  /** Wire `/preview/<port>/` for a listened port; returns a teardown. */
  readonly servePreview: (port: number) => () => void;
  /** Report the listened ports to the owner (rifty:node-listening). */
  readonly postListening: (ports: number[]) => void;
  /** Raw `process.exitCode` at natural exit (honoured per Node — ADR-0157 D4). */
  readonly readExitCode: () => unknown;
  /** Exit the worker with a code (process.exit). */
  readonly exit: (code: number) => void;
  /** Test seam for the port-poll loop; production uses setTimeout. */
  readonly wait?: (ms: number) => Promise<void>;
}

type EntryOutcome =
  | { readonly kind: 'returned' }
  | { readonly kind: 'threw'; readonly err: unknown };

const DEFAULT_LISTEN_POLL_MS = 25;
const activePreviewTeardowns = new Set<() => void>();

interface UnrefHandle {
  unref?: () => unknown;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms) as unknown as UnrefHandle;
    handle.unref?.();
  });
}

function servePorts(deps: NodeLifecycleDeps, ports: readonly number[]): void {
  for (const port of ports) activePreviewTeardowns.add(deps.servePreview(port));
  deps.postListening([...ports]);
}

type DrainOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'resolved' }
  | {
      readonly kind: 'rejected';
      readonly err: unknown;
    };

async function waitForListenOrDrain(
  deps: NodeLifecycleDeps,
  waitForPoll: (ms: number) => Promise<void>,
): Promise<'served' | 'drained'> {
  let drainOutcome: DrainOutcome = { kind: 'pending' };
  const currentDrainOutcome = (): DrainOutcome => drainOutcome;
  void deps.awaitDrain().then(
    () => {
      drainOutcome = { kind: 'resolved' };
    },
    (err) => {
      drainOutcome = { kind: 'rejected', err };
    },
  );

  for (;;) {
    const ports = deps.listPorts();
    if (ports.length > 0) {
      servePorts(deps, ports);
      return 'served';
    }
    const outcome = currentDrainOutcome();
    if (outcome.kind === 'rejected') throw outcome.err;
    if (outcome.kind === 'resolved') return 'drained';
    await waitForPoll(DEFAULT_LISTEN_POLL_MS);
  }
}

export async function runNodeProgramLifecycle(deps: NodeLifecycleDeps): Promise<void> {
  const waitForPoll = deps.wait ?? wait;
  let lateErrorsShouldSurface = false;
  let entryOutcome: EntryOutcome | null = null;
  const currentEntryOutcome = (): EntryOutcome | null => entryOutcome;
  void deps.runEntry().then(
    () => {
      entryOutcome = { kind: 'returned' };
    },
    (err) => {
      entryOutcome = { kind: 'threw', err };
      if (!lateErrorsShouldSurface) return;
      const code = exitCodeOf(err);
      if (code !== null) deps.exit(code);
      else
        queueMicrotask(() => {
          throw err;
        });
    },
  );

  for (;;) {
    // Let a synchronously-returned/rejected entry settle before inspecting ports.
    // This preserves the listen-then-throw invariant: a failing entry must not
    // publish a preview slot just because it registered one before throwing.
    await Promise.resolve();
    const outcome = currentEntryOutcome();
    if (outcome?.kind === 'threw') {
      const code = exitCodeOf(outcome.err);
      if (code !== null) {
        deps.exit(code);
        return;
      }
      throw outcome.err; // surfaced by the kernel worker-entry → stderr + exit 1
    }

    const ports = deps.listPorts();
    if (ports.length > 0) {
      servePorts(deps, ports);
      lateErrorsShouldSurface = true;
      return; // serve:true keeps the realm alive; parent kill stops it
    }

    if (outcome?.kind === 'returned') break;
    await waitForPoll(DEFAULT_LISTEN_POLL_MS);
  }

  const drainResult = await waitForListenOrDrain(deps, waitForPoll);
  if (drainResult === 'served') {
    lateErrorsShouldSurface = true;
    return; // serve:true keeps the realm alive; parent kill stops it
  }
  // Natural exit honours process.exitCode (Node parity, D4): a clean return after
  // `process.exitCode = N` exits N, not 0. A tail THROW still maps to exit 1 above
  // (uncaught wins, Node-faithful).
  deps.exit(normalizeExitCode(deps.readExitCode()));
}
