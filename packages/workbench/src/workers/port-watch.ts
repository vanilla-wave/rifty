/**
 * Continuous listening-port lifecycle for a served child realm (backlog:
 * playground/generic-dev-server-lifecycle). After the initial listen, the net
 * registry's register/unregister events drive: wire `/preview/<port>/` for a
 * newly-listened port, tear a closed one, and repost the FULL current set to
 * the owner (`[]` included — that is how `server.close()` reads as stopped
 * without a process exit). Event-sourced — no polling.
 */
export interface PortWatchDeps {
  readonly listPorts: () => number[];
  /** Subscribe to net-registry changes (onRegistryChange); returns unsubscribe. */
  readonly subscribe: (cb: () => void) => () => void;
  /** Wire `/preview/<port>/` for a newly-listened port; returns a teardown. */
  readonly servePreview: (port: number) => () => void;
  /** Post the FULL current port set to the owner. */
  readonly post: (ports: number[]) => void;
  /**
   * Bridges already wired before the watch began (initial listen). A no-op
   * teardown marks a bridge owned elsewhere (e.g. the dev-boot stop handle).
   */
  readonly served?: Map<number, () => void>;
}

export function watchServedPorts(deps: PortWatchDeps): () => void {
  const served = deps.served ?? new Map<number, () => void>();
  const reconcile = (): void => {
    const current = deps.listPorts();
    const live = new Set(current);
    for (const [port, tear] of served) {
      if (live.has(port)) continue;
      tear();
      served.delete(port);
    }
    for (const port of current) {
      if (!served.has(port)) served.set(port, deps.servePreview(port));
    }
    deps.post([...current]);
  };
  const unsubscribe = deps.subscribe(reconcile);
  // Initial reconcile: ports opened BEFORE the watch began (a multi-port entry
  // listening beyond the seeded boot port) must be served now, not on the next
  // unrelated registry change.
  reconcile();
  return unsubscribe;
}
