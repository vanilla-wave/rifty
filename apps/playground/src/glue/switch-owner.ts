/**
 * Switch = owner teardown + respawn (ADR-0165 §3). RIFTY_RFV_ROOT is frozen at
 * owner bootstrap (real-vite-bootstrap.ts:427) — there is NO live re-point, so a
 * project switch tears the owner down and respawns it with the new root. Two
 * owners on the singleton syncMirror OPFS backend = pthread crash (ADR-0165
 * rejected alt), so the sequence is STRICTLY sequential: confirm-dirty ->
 * save/discard -> close -> AWAIT exit -> spawn(new root) -> AWAIT ready -> re-wire
 * page bridges -> restart dev server -> clear terminal. No new owner spawns
 * before the old one's `closed` resolves.
 *
 * Pure orchestrator: the real owner is a Worker (not spawnable in a unit test),
 * so the worker boundary is injected as `spawn` + the `{ closed }` slice. App.tsx
 * supplies `startWorkspaceOwner` as `spawn`; the guard test injects a fake whose
 * spawn-vs-close ordering is asserted in-process (no race-dependent e2e).
 */

/** The slice of WorkspaceOwnerHandle the orchestrator awaits. */
export interface OwnerLifecycle {
  /** Resolves on worker exit (realVite.ts wires it to the worker `exit` event). */
  readonly closed: Promise<unknown>;
  /** Terminate the worker; idempotent (realVite.ts -> kill SIGTERM). */
  close(): void;
}

export interface SwitchRequest<O extends OwnerLifecycle> {
  /** The owner being torn down. */
  readonly currentOwner: O;
  /** Root to respawn at — `rootForId(nextActiveId)`. */
  readonly nextRoot: string;
  /** Install-stamp reuse key for the next owner — `nextActiveId` (projectId|'scratch'). */
  readonly nextSlug: string;
  /** Is the ACTIVE scratch dirty (real owner file-writes, ADR-0165)? Named projects autosave → false. */
  isDirty(): boolean;
  /** Prompt to discard unsaved scratch; false aborts the whole switch. */
  confirmDiscard(): Promise<boolean>;
  /** Persist the dirty scratch (caller decides save-as-project vs autosave). */
  save(): Promise<void>;
  /** Drop the dirty scratch edits. */
  discard(): Promise<void>;
  /** Spawn the new owner at `{ root, slug }`; returns its lifecycle handle. */
  spawn(opts: { root: string; slug: string }): O;
  /** Resolves when the new owner has published readiness. */
  awaitReady(owner: O): Promise<void>;
  /** Re-bind ALL page bridges (snapshot/nm/archive/index/preview) to the NEW owner. */
  rewireBridges(owner: O): void;
  /** Restart the co-resident dev server in the switched-in root. */
  restartDevServer(owner: O): Promise<void>;
  /** Clear the dev-server terminal for a fresh console. */
  clearTerminal(): void;
}

/**
 * Run one switch. Returns `false` (no-op) if a dirty scratch switch is cancelled,
 * `true` once the new owner is live + re-wired. NEVER spawns before the old owner
 * exits.
 */
export async function requestSwitch<O extends OwnerLifecycle>(
  req: SwitchRequest<O>,
): Promise<boolean> {
  // 1. Dirty-confirm — abort the WHOLE switch before any teardown if cancelled.
  if (req.isDirty()) {
    const proceed = await req.confirmDiscard();
    if (!proceed) return false;
    await req.discard();
  }
  // 2. Tear down the old owner and AWAIT its exit — no two-owner window.
  req.currentOwner.close();
  await req.currentOwner.closed;
  // 3. Spawn the new owner at the new root (RIFTY_RFV_ROOT re-baked per spawn).
  const next = req.spawn({ root: req.nextRoot, slug: req.nextSlug });
  await req.awaitReady(next);
  // 4. Re-wire bridges to the NEW owner BEFORE driving it.
  req.rewireBridges(next);
  // 5. Restart the dev server in the switched-in root, then clear the console.
  await req.restartDevServer(next);
  req.clearTerminal();
  return true;
}
