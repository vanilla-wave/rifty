/// <reference lib="webworker" />
/**
 * ADR-0358 — bounded per-path parallel OPFS write-through drain. Internal
 * lane scheduler of `OpfsFsSync`, the SINGLE OPFS write-through owner; this
 * module is that owner's mechanism, never a second write-through owner.
 *
 * Contract (replacement pins in opfs-sync.test.ts):
 * - At most {@link MAX_ACTIVE_PERSIST_LANES} ops ACTIVE at once; admission is
 *   FIFO among ready ops. Unrelated ops drain in parallel.
 * - Op B waits for every earlier PENDING op A it relates to: A registered on
 *   any prefix of one of B's scope paths (same-path order + ancestor-chain
 *   gating); A last-registered in B's immediate parent dir, root excluded
 *   (sibling link — per-directory enqueue order, main's trace, which the
 *   row-f differential pins bind); for structural B (rm/rename) any A
 *   registered strictly under one of B's scope subtrees (subtree fences: no
 *   overtake, no straddle); and for a create-chain B (mkdir/rename —
 *   `{ create: true }` can RE-create a chain dir a foreign realm removed) the
 *   last A registered inside each dir on B's chain. Unrelated paths — in
 *   particular root-level siblings — drain in parallel. The full cross-realm
 *   class stays owned by `vfs/opfs-sync-cross-realm-mirror-coherence`. B
 *   starts only after all its deps REALLY settle (success or failure), never
 *   on a reporting release.
 * - Per-lane watchdog: the report bound starts at ADMISSION — capacity/fence
 *   queue wait is not I/O time. A timed-out op keeps its lane and its fences
 *   (the browser op cannot be cancelled); only its reporting is released, and
 *   its transitively-fenced QUEUED dependents get bounded blocked reporting
 *   so flush() stays bounded. Full-wedge saturation is bounded too: while a
 *   TIMED-OUT holder occupies a lane and every lane is held, capacity-starved
 *   READY ops (no fence, no lane, no watchdog of their own) get the same
 *   bounded blocked reporting — healed on later success. Healthy saturation
 *   (no holder timed out) never blocked-reports a queued op.
 * - Drain-scoped dir-handle cache: cleared when the drain goes idle and on
 *   every structural REGISTRATION; generation-guarded so an in-flight walk
 *   never re-inserts a pre-clear handle.
 */

import { dirnameNormalized } from './path.ts';

export type PersistOperationKind = 'write' | 'mkdir' | 'rm' | 'rename';

export interface PersistOperation {
  readonly paths: readonly string[];
  readonly op: PersistOperationKind;
  readonly sequence: number;
}

export interface DrainSchedulerHooks {
  /** Active op crossed the report bound — record its ledger failure. */
  onReportTimeout(operation: PersistOperation): void;
  /** Queued op is transitively fenced behind a timed-out op, or capacity-starved
   * while a timed-out holder wedges a full lane window — record + release. */
  onBlockedBehindTimeout(operation: PersistOperation, blocker: PersistOperation): void;
}

/** Reporting bound for one ACTIVE OPFS side effect. Starts at lane admission
 * — capacity/fence queue wait is not I/O time (ADR-0358). Only `flush()`
 * reporting is released on timeout so durability callers fail loudly instead
 * of hanging; the operation itself keeps its lane and fences. */
export const PERSIST_OPERATION_REPORT_TIMEOUT_MS = 30_000;

/** Measured saturation of the per-origin OPFS backend (ADR-0358 Context). */
const MAX_ACTIVE_PERSIST_LANES = 16;

interface ScheduledOp {
  readonly operation: PersistOperation;
  readonly structural: boolean;
  readonly run: (operation: PersistOperation) => Promise<void>;
  phase: 'queued' | 'active';
  timedOut: boolean;
  /** While QUEUED: the timed-out op this one was blocked-reported behind. */
  blockedBehind: PersistOperation | null;
  pendingDeps: number;
  readonly dependents: Set<ScheduledOp>;
  reporting: Promise<void>;
  reportingSettled: boolean;
  settleReporting: () => void;
  readonly settled: Promise<void>;
  readonly settleOp: () => void;
}

function resetReporting(op: ScheduledOp): void {
  op.reportingSettled = false;
  op.reporting = new Promise<void>((resolve) => {
    op.settleReporting = () => {
      if (op.reportingSettled) return;
      op.reportingSettled = true;
      resolve();
    };
  });
}

/** Yields '/a', '/a/b', … up to and including `path` itself ('/' yields '/'). */
function* pathPrefixes(path: string): Generator<string> {
  if (path === '/') {
    yield '/';
    return;
  }
  let index = 0;
  for (;;) {
    const next = path.indexOf('/', index + 1);
    if (next === -1) {
      yield path;
      return;
    }
    yield path.slice(0, next);
    index = next;
  }
}

/**
 * Drain-scoped OPFS dir-handle cache (ADR-0358). Keys are normalized dir
 * paths; values are in-flight/settled `getDirectoryHandle` promises so
 * concurrent lanes share one resolution per dir. Rejected resolutions evict
 * themselves. `clear()` bumps the generation: a walk started before the clear
 * neither reads nor re-inserts afterwards — a cached handle never survives a
 * structural op or the drain that warmed it.
 */
export class DrainDirHandleCache {
  private generation = 0;
  private readonly handles = new Map<string, Promise<FileSystemDirectoryHandle>>();

  clear(): void {
    this.generation += 1;
    this.handles.clear();
  }

  /** Walks `parts` from `root`, caching every chain node. `create(index)`
   * mirrors the caller's per-segment `{ create }` option. `reuse: false`
   * still POPULATES the cache but never consumes it: a create-chain walk
   * (mkdir / rename dir-create) must hit the LIVE tree exactly like main's
   * fresh resolution — a cached handle a foreign realm detached would
   * silently re-create the subtree in the dead node (row-f differential). */
  async resolveDir(
    root: FileSystemDirectoryHandle,
    parts: readonly string[],
    create: (index: number) => boolean,
    reuse = true,
  ): Promise<FileSystemDirectoryHandle> {
    const generation = this.generation;
    let dir = root;
    let prefix = '';
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] as string;
      prefix = `${prefix}/${part}`;
      dir = await this.step(dir, part, prefix, create(index), generation, reuse);
    }
    return dir;
  }

  /** Returns the raw handle promise synchronously — no async-adoption hop —
   * so a fresh resolution keeps the pre-cache microtask timing. */
  private step(
    parent: FileSystemDirectoryHandle,
    name: string,
    path: string,
    create: boolean,
    generation: number,
    reuse: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    if (reuse && generation === this.generation) {
      const cached = this.handles.get(path);
      if (cached) {
        if (!create) return cached;
        // Cached non-creating resolution may have failed; retry creating.
        return cached.catch(() => this.freshStep(parent, name, path, true, generation));
      }
    }
    return this.freshStep(parent, name, path, create, generation);
  }

  private freshStep(
    parent: FileSystemDirectoryHandle,
    name: string,
    path: string,
    create: boolean,
    generation: number,
  ): Promise<FileSystemDirectoryHandle> {
    const fresh = parent.getDirectoryHandle(name, { create });
    if (generation === this.generation) {
      this.handles.set(path, fresh);
      void fresh.catch(() => {
        if (this.handles.get(path) === fresh) this.handles.delete(path);
      });
    }
    return fresh;
  }
}

export class OpfsDrainScheduler {
  private sequence = 0;
  private activeCount = 0;
  /** Unsettled ops keyed by sequence — the flush/fence watermark universe. */
  private readonly pending = new Map<number, ScheduledOp>();
  /** Last PENDING op registered on each exact scope path. Same-path chains
   * make depending on `last` sufficient — transitivity covers the rest. */
  private readonly registry = new Map<string, ScheduledOp>();
  /** Last PENDING op registered on an IMMEDIATE child path of each dir (root
   * excluded — '/' can never be re-created). Feeds the create-chain fence. */
  private readonly lastChildIn = new Map<string, ScheduledOp>();
  /** Ready (all deps settled), awaiting a lane — FIFO admission. */
  private readonly ready: ScheduledOp[] = [];
  /** ACTIVE ops past their report bound — still holding lanes (the browser op
   * cannot be cancelled). Non-empty + full window ⇒ capacity-starved READY
   * ops need bounded blocked reporting or flush() parks forever. */
  private readonly timedOutHolders = new Set<ScheduledOp>();
  private readonly hooks: DrainSchedulerHooks;
  readonly dirHandles = new DrainDirHandleCache();

  constructor(hooks: DrainSchedulerHooks) {
    this.hooks = hooks;
  }

  /** Enqueues one persist op. A ready op with a free lane starts
   * SYNCHRONOUSLY (its task must capture already-copied bytes before the
   * caller can reuse a buffer). */
  enqueue(
    kind: PersistOperationKind,
    paths: readonly string[],
    run: (operation: PersistOperation) => Promise<void>,
  ): void {
    const structural = kind === 'rm' || kind === 'rename';
    // Structural REGISTRATION invalidates the whole dir-handle cache: no
    // later resolution may serve a pre-rm/pre-rename handle. Whole-clear is
    // the smallest honest scope (subtree bookkeeping buys nothing the pins
    // observe; extra fresh resolutions are always admissible).
    if (structural) this.dirHandles.clear();
    this.sequence += 1;
    const operation: PersistOperation = { paths, op: kind, sequence: this.sequence };
    let settleOp: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settleOp = resolve;
    });
    const op: ScheduledOp = {
      operation,
      structural,
      run,
      phase: 'queued',
      timedOut: false,
      blockedBehind: null,
      pendingDeps: 0,
      dependents: new Set(),
      reporting: Promise.resolve(),
      reportingSettled: true,
      settleReporting: () => {},
      settled,
      settleOp,
    };
    resetReporting(op);
    this.pending.set(operation.sequence, op);
    const deps = this.collectDependencies(op);
    for (const dep of deps) dep.dependents.add(op);
    op.pendingDeps = deps.size;
    for (const path of paths) {
      this.registry.set(path, op);
      const parent = dirnameNormalized(path);
      if (parent !== '/') this.lastChildIn.set(parent, op);
    }
    // Fenced behind an already-timed-out op (directly or transitively):
    // bounded blocked reporting immediately, so flush() never parks on it.
    for (const dep of deps) {
      const wedge = dep.timedOut
        ? dep.operation
        : dep.phase === 'queued'
          ? dep.blockedBehind
          : null;
      if (wedge) {
        this.reportBlocked(op, wedge);
        break;
      }
    }
    if (op.pendingDeps === 0) {
      this.ready.push(op);
      this.admit();
    }
  }

  /** Bounded reporting barrier over every op enqueued so far — the flush()
   * contract (never rejects; timed-out lanes release reporting only). */
  reportingBarrier(): Promise<void> {
    const barriers: Promise<void>[] = [];
    for (const op of this.pending.values()) barriers.push(op.reporting);
    return Promise.allSettled(barriers).then(() => undefined);
  }

  /** REAL-settle barrier over every op enqueued so far (ADR-0358 stamp full
   * fence): resolves only when each has settled at the OPFS surface —
   * cap-queued and past-report-timeout ops included. Never rejects. */
  settledBarrier(): Promise<void> {
    const barriers: Promise<void>[] = [];
    for (const op of this.pending.values()) barriers.push(op.settled);
    return Promise.all(barriers).then(() => undefined);
  }

  private collectDependencies(op: ScheduledOp): Set<ScheduledOp> {
    const deps = new Set<ScheduledOp>();
    const createChain = op.operation.op === 'mkdir' || op.operation.op === 'rename';
    for (const path of op.operation.paths) {
      // Sibling link: ops sharing an immediate parent dir (non-root) drain in
      // enqueue order — main's per-directory trace, which the row-f
      // differential pins bind (a same-dir successor must observe, loudly,
      // what a foreign realm did to the dir after its predecessor's persist).
      const sibling = this.lastChildIn.get(dirnameNormalized(path));
      if (sibling) deps.add(sibling);
      for (const prefix of pathPrefixes(path)) {
        const last = this.registry.get(prefix);
        if (last) deps.add(last);
        if (createChain) {
          const lastChild = this.lastChildIn.get(prefix);
          if (lastChild) deps.add(lastChild);
        }
      }
      if (op.structural) {
        const subtree = path === '/' ? '/' : `${path}/`;
        for (const [registered, last] of this.registry) {
          if (registered.startsWith(subtree)) deps.add(last);
        }
      }
    }
    return deps;
  }

  private admit(): void {
    while (this.activeCount < MAX_ACTIVE_PERSIST_LANES) {
      const op = this.ready.shift();
      if (!op) return;
      this.activate(op);
    }
    // Lanes full with ready ops left over: if a holder already timed out,
    // the leftovers are starved behind an uncancellable wedge — bound them.
    this.reportCapacityStarved();
  }

  private activate(op: ScheduledOp): void {
    this.activeCount += 1;
    op.phase = 'active';
    op.blockedBehind = null;
    // A blocker timeout may have released this op's reporting while queued.
    // Active now: later flushes get a fresh active-I/O barrier; earlier
    // flushes keep their bounded dirty result.
    if (op.reportingSettled) resetReporting(op);
    const timer = setTimeout(() => {
      op.timedOut = true;
      this.timedOutHolders.add(op);
      this.hooks.onReportTimeout(op.operation);
      op.settleReporting();
      this.reportBlockedDependents(op);
      this.reportCapacityStarved();
    }, PERSIST_OPERATION_REPORT_TIMEOUT_MS);
    const finish = (): void => {
      clearTimeout(timer);
      this.settle(op);
    };
    let outcome: Promise<void>;
    try {
      outcome = op.run(op.operation);
    } catch {
      // Tasks record their own failures; a synchronous throw still settles.
      outcome = Promise.resolve();
    }
    outcome.then(finish, finish);
  }

  private settle(op: ScheduledOp): void {
    op.settleReporting();
    op.settleOp();
    this.timedOutHolders.delete(op);
    this.pending.delete(op.operation.sequence);
    for (const path of op.operation.paths) {
      if (this.registry.get(path) === op) this.registry.delete(path);
      const parent = dirnameNormalized(path);
      if (this.lastChildIn.get(parent) === op) this.lastChildIn.delete(parent);
    }
    this.activeCount -= 1;
    for (const dependent of op.dependents) {
      dependent.pendingDeps -= 1;
      if (dependent.pendingDeps === 0) this.ready.push(dependent);
    }
    op.dependents.clear();
    // Drain idle — the dir-handle cache dies with its drain (ADR-0358).
    if (this.pending.size === 0) this.dirHandles.clear();
    this.admit();
  }

  /** A timed-out op RETAINS its fences; its transitively-fenced QUEUED
   * dependents get blocked reporting so flush() stays bounded. Active
   * dependents run under their own watchdog and are never touched.
   * `blocker` defaults to `from` itself (watchdog path); the starvation
   * cascade passes the WEDGE — the honest root cause. */
  private reportBlockedDependents(from: ScheduledOp, blocker?: PersistOperation): void {
    const rootBlocker = blocker ?? from.operation;
    const queue = [...from.dependents];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      if (next.phase !== 'queued' || next.blockedBehind !== null) continue;
      this.reportBlocked(next, rootBlocker);
      queue.push(...next.dependents);
    }
  }

  /** Full-wedge starvation bound: a READY op behind a full lane window whose
   * holders include a TIMED-OUT wedge has no fence blocker and no watchdog of
   * its own — without this its reporting never settles and flush() parks
   * forever. Cascades transitively: ops FENCED behind a starved ready op
   * (same-path successors, sibling chains, child writes) are just as starved
   * and must report boundedly too. Reporting only (heals on later success,
   * like fence dependents); scheduling is untouched — the op still admits
   * when a lane REALLY frees. Healthy saturation never sweeps: capacity wait
   * is not I/O time. */
  private reportCapacityStarved(): void {
    if (this.activeCount < MAX_ACTIVE_PERSIST_LANES) return;
    const wedge: ScheduledOp | undefined = this.timedOutHolders.values().next().value;
    if (!wedge) return;
    for (const op of this.ready) {
      if (op.blockedBehind === null) this.reportBlocked(op, wedge.operation);
      this.reportBlockedDependents(op, wedge.operation);
    }
  }

  private reportBlocked(op: ScheduledOp, blocker: PersistOperation): void {
    op.blockedBehind = blocker;
    this.hooks.onBlockedBehindTimeout(op.operation, blocker);
    op.settleReporting();
  }
}
