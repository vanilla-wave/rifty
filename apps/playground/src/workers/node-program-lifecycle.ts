/**
 * Run-vs-serve lifecycle for a `node <file>` supervised child (ADR-0154). The
 * child spawns serve:true (kernel never reaps it), so the bootstrap OWNS the
 * decision the kernel drain hook would make for a run-to-completion child:
 *  - the entry listened (registered a port) → it is a SERVER: serve each port's
 *    cross-realm preview, post the ports to the owner, STAY ALIVE (return).
 *  - else → run-to-completion: await the event-loop drain (ADR-0152 — timers/
 *    imports + unhandledrejection→exit1), then process.exit(code).
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
  /** Exit the worker with a code (process.exit). */
  readonly exit: (code: number) => void;
}

export async function runNodeProgramLifecycle(deps: NodeLifecycleDeps): Promise<void> {
  try {
    await deps.runEntry();
  } catch (err) {
    const code = exitCodeOf(err);
    if (code !== null) {
      deps.exit(code);
      return;
    }
    throw err; // surfaced by the kernel worker-entry → stderr + exit 1
  }
  const ports = deps.listPorts();
  if (ports.length > 0) {
    for (const port of ports) deps.servePreview(port);
    deps.postListening(ports);
    return; // serve:true keeps the realm alive; parent kill stops it
  }
  await deps.awaitDrain();
  deps.exit(0);
}
