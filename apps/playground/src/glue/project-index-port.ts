/**
 * Owner↔page project-index bridge (ADR-0165 realm split). The OPFS index is
 * worker-writable-only (sync OPFS, ADR-0135), but the launcher must render the
 * project list across owner respawns. So: the OWNER owns the on-disk index; the
 * PAGE hydrates an in-memory MIRROR. Pull-not-spray (mirrors vfs-snapshot-port /
 * workspace-archive-port): the page posts a request on subscribe, the owner
 * replies with a fresh `ProjectIndex` snapshot. Playground-local — only
 * `channelNameFor` is borrowed from `@riftydev/net`.
 */
import { channelNameFor } from '@riftydev/net';
import type { PersistFailureReport } from '@riftydev/vfs';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';
import type {
  PackageMutationExecutor,
  PackageResetPreparation,
} from './package-mutation-executor.ts';
import {
  type IndexFs,
  type ProjectIndex,
  cleanupCommittedScratchSource,
  commitScratchProjectSave,
  loadIndex,
  resetProjectToStarter,
  resetScratchToStarter,
  rootForId,
  writeIndex,
} from './project-index.ts';
import { seedFilesForStarter, starterById } from './starter.ts';
import {
  claimViteConfigSeed,
  syncViteConfigSeedStore,
  withoutViteConfigSeedFiles,
} from './vite-config-seed.ts';

export function projectIndexChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('project-index', key);
}

type IndexRequestFrame = { readonly type: 'index-req' };
type IndexReplyFrame = { readonly type: 'index-reply'; readonly index: ProjectIndex };
type IndexAppliedFrame = {
  readonly type: 'index-applied';
  readonly opId: string;
  readonly index: ProjectIndex;
};
type IndexAckFrame =
  | {
      readonly type: 'index-ack';
      readonly opId: string;
      readonly ok: true;
      readonly index: ProjectIndex;
    }
  | {
      readonly type: 'index-ack';
      readonly opId: string;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };
type IndexOp = { readonly opId?: string };
type IndexDeleteFrame = IndexOp & { readonly type: 'index-delete'; readonly projectId: string };
/**
 * Durable scratch→project Save (ADR-0165 §7): owner commits the scratch as a
 * project, then cleans the stale source after the durability ack. Carries the
 * page's CURRENT active `starter` — the persistent owner is spawned once with
 * the boot default, so a mid-session starter pick (clean scratch, no respawn)
 * leaves the owner's synthesized scratch.starter stale; the page is the
 * authority, so the save reconciles scratch.starter from this frame before the
 * commit (the saved project then records the real starter).
 */
type IndexSaveFrame = {
  readonly type: 'index-save';
  readonly id: string;
  readonly name: string;
  readonly starter: string;
} & IndexOp;
/** Rename a named project in the index (ADR-0165 §9). */
type IndexRenameFrame = {
  readonly type: 'index-rename';
  readonly projectId: string;
  readonly name: string;
} & IndexOp;
/**
 * Reset the ACTIVE scratch back to its starter baseline (ADR-0165 §6). Carries
 * the page's CURRENT active `starter` (same staleness reason as index-save) so
 * the re-seed re-derives the right bundle and the index records it.
 */
type IndexResetFrame = IndexOp & { readonly type: 'index-reset'; readonly starter: string };
/**
 * Reset a NAMED project's `/projects/<id>` back to its starter baseline
 * (ADR-0165 §6, extended to named projects). The project's `starter` is read
 * from the index (authoritative — set at Save, never drifts), so the frame only
 * needs the id. A real on-disk re-seed, not a page-mirror no-op.
 */
type IndexResetProjectFrame = IndexOp & {
  readonly type: 'index-reset-project';
  readonly projectId: string;
};
/**
 * Establish a FRESH scratch from a starter (ADR-0165 §6 gallery pick). Distinct
 * from index-reset, which requires an existing scratch: after a Save the index is
 * `scratch:null, activeId:<projectId>`, so picking a new starter must (re)create
 * the scratch entry + re-point activeId='scratch' + re-seed `/scratch` from the
 * bundle — else the next Save throws `no scratch to save`. The owner is NOT
 * respawned on a pick (it stays rooted at /scratch), so this re-seeds the live
 * tree the next marker write + Save will move.
 */
type IndexNewScratchFrame = IndexOp & {
  readonly type: 'index-new-scratch';
  readonly starter: string;
  readonly preserveDirtySameStarter?: boolean;
};
/**
 * Persist a SWITCH of the active root to the index (ADR-0165 §3). A plain switch
 * between existing roots otherwise NEVER updates the on-disk `activeId`, so the
 * respawned owner re-publishes a STALE `activeId` and the page mirror reverts the
 * switch (a race) AND a reload boots the wrong root. Posted to the CURRENT owner
 * BEFORE teardown so the index is correct when the new owner boots + publishes.
 */
type IndexSetActiveFrame = IndexOp & {
  readonly type: 'index-set-active';
  readonly activeId: string;
};
/**
 * Persist that the active scratch became a user draft (ADR-0165 §57). This is
 * deliberately separate from `index-new-scratch`: file edits must never re-seed
 * `/scratch`, only make the existing tree reload-discoverable as a dirty draft.
 */
type IndexMarkScratchDirtyFrame = IndexOp & {
  readonly type: 'index-mark-scratch-dirty';
  readonly starter: string;
};
type IndexMutationFrame =
  | IndexDeleteFrame
  | IndexSaveFrame
  | IndexRenameFrame
  | IndexResetFrame
  | IndexResetProjectFrame
  | IndexNewScratchFrame
  | IndexSetActiveFrame
  | IndexMarkScratchDirtyFrame;
type IndexFrame =
  | IndexRequestFrame
  | IndexReplyFrame
  | IndexAppliedFrame
  | IndexAckFrame
  | IndexMutationFrame;

/**
 * Owner side: replies to a page request + serves the durable on-disk
 * delete/save/rename/reset.
 *
 * `flush` (optional) drains the realm's OPFS write-through AFTER a tree-mutating
 * op (save/reset/delete), BEFORE the publish — so the move is durable on disk
 * before a SWITCH tears this owner down and respawns one that reads OPFS (else the
 * committed `/projects/<id>` tree races the teardown and the switched-in owner boots
 * an empty tree). No-op on the memory backend (and in the unit harness, which omits
 * it). Read-only ops (index-req) never flush.
 *
 * `refresh` (optional) republishes the owner's FILE snapshot (= `publishSnapshot`)
 * after an IN-PLACE re-seed (reset), so the page editor/explorer reflect the
 * restored tree — owner index writes bypass the `onVfsWrite` hook, so without
 * this a reset would change disk but leave a stale live view (ADR-0165 §6). The
 * unit harness omits it.
 */
export function serveProjectIndex(
  key: OwnerBridgeKey,
  fs: IndexFs,
  base: string,
  flush?: () => Promise<PersistFailureReport | undefined>,
  refresh?: () => void,
  initializeStarterGit?: (root: string) => Promise<void>,
  packageMutations?: Pick<PackageMutationExecutor, 'reset'>,
): () => void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(key)));
  let torn = false;
  const closedError = new Error('project index bridge is closed');
  closedError.name = 'ProjectIndexBridgeClosedError';
  const assertServing = (): void => {
    if (torn) throw closedError;
  };
  // The sync mirror can run ahead of OPFS while a mutation's flush is parked or
  // rejected. Passive readers may observe only the last index whose complete
  // operation reached its durability boundary.
  let durableIndex = loadIndex(fs, base);
  const publishDurable = (): ProjectIndex => {
    if (!torn) {
      channel.postMessage({
        type: 'index-reply',
        index: durableIndex,
      } satisfies IndexReplyFrame);
    }
    return durableIndex;
  };
  const ack = (opId: string | undefined, index: ProjectIndex): void => {
    if (opId && !torn)
      channel.postMessage({ type: 'index-ack', opId, ok: true, index } satisfies IndexAckFrame);
  };
  const nack = (opId: string | undefined, cause: unknown): void => {
    if (!opId || torn) return;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    channel.postMessage({
      type: 'index-ack',
      opId,
      ok: false,
      error: { name: error.name, message: error.message },
    } satisfies IndexAckFrame);
  };
  const applied = (opId: string | undefined, index: ProjectIndex): void => {
    if (opId && !torn)
      channel.postMessage({ type: 'index-applied', opId, index } satisfies IndexAppliedFrame);
  };
  const publishCurrentAsDurable = (opId?: string): void => {
    durableIndex = loadIndex(fs, base);
    ack(opId, publishDurable());
  };
  const viteConfigSeedStore = syncViteConfigSeedStore(fs, flush ?? (async () => undefined));
  const flushDurable = (): Promise<void> => viteConfigSeedStore.flush();
  // Drain the OPFS write-through after a tree mutation, then publish. Errors
  // surface loud (rejected promise → owner worker-entry → stderr), never swallowed.
  const flushThenPublish = async (opId?: string): Promise<void> => {
    if (flush) await flushDurable();
    publishCurrentAsDurable(opId);
  };
  // As flushThenPublish, plus a snapshot republish for an IN-PLACE re-seed so the
  // live page reflects the restored files (reset only — save/delete/new-scratch
  // mutate the active root's identity, not its content in place).
  const flushRefreshPublish = async (opId?: string): Promise<void> => {
    if (flush) await flushDurable();
    if (torn) return;
    refresh?.();
    publishCurrentAsDurable(opId);
  };
  const runPackageReset = async (root: string, prepare: PackageResetPreparation): Promise<void> => {
    if (!packageMutations) {
      throw new Error(`project-index package mutation executor missing for reset at ${root}`);
    }
    const guardedPrepare: PackageResetPreparation = async () => {
      assertServing();
      const plan = await prepare();
      assertServing();
      if (plan.status === 'noop') return plan;
      return {
        status: 'ready',
        mutate: async () => {
          assertServing();
          await plan.mutate();
          assertServing();
        },
      };
    };
    await packageMutations.reset({ root }, guardedPrepare);
  };
  // ADR-0165 §56 durable delete: flip the index (drop the entry) → THEN rm the
  // tree — the COMMIT-FIRST ordering, the inverse of the dangerous one. A crash
  // mid-delete then leaves an orphan `/projects/<id>` tree the index no longer
  // references → recoverIndex case (A) silently rolls it back. The opposite order
  // (rm then write) would leave an indexed-but-missing tree → recoverIndex case (D)
  // THROWS on every boot = unrecoverable brick. Unknown id = idempotent no-op
  // publish (no throw): re-asserts state so a re-fired delete still reconciles.
  const deleteTree = async (projectId: string, opId?: string): Promise<void> => {
    const root = rootForId(projectId);
    await runPackageReset(root, async () => {
      const index = loadIndex(fs, base);
      if (!index.projects.some((project) => project.id === projectId)) {
        await flushThenPublish(opId);
        return { status: 'noop' };
      }
      const projects = index.projects.filter((p) => p.id !== projectId);
      // Defensive: a delete of the ACTIVE project re-points activeId — scratch if a
      // draft exists, else the first remaining project, else 'scratch' (empty).
      const activeId =
        index.activeId === projectId
          ? index.scratch
            ? 'scratch'
            : (projects[0]?.id ?? 'scratch')
          : index.activeId;
      return {
        status: 'ready',
        mutate: async () => {
          writeIndex(fs, base, { ...index, activeId, projects }); // commit FIRST
          fs.rmSync(root, { recursive: true, force: true }); // then drop the tree
          await flushThenPublish(opId); // durable, then every page mirror reconciles
        },
      };
    });
  };
  // ADR-0165 §7 durable Save is one package-root mutation: FIFO preflight sees
  // the stamp before reset revokes it, then copy → index → applied → cleanup →
  // durable ack runs without an install/promoter or a fresh scratch between.
  const saveScratch = async (
    id: string,
    name: string,
    starter: string,
    opId?: string,
  ): Promise<void> => {
    const root = rootForId('scratch');
    const cleanupThenDurableAck = async (committed: ProjectIndex): Promise<void> => {
      if (flush) await flushDurable();
      assertServing();
      cleanupCommittedScratchSource(fs, committed);
      if (flush) await flushDurable();
      publishCurrentAsDurable(opId);
    };
    await runPackageReset(root, async () => {
      const index = loadIndex(fs, base);
      const existing = index.projects.find((project) => project.id === id);
      if (existing) {
        if (
          index.activeId !== id ||
          index.scratch !== null ||
          existing.name !== name ||
          existing.starter !== starter ||
          !fs.existsSync(rootForId(id))
        ) {
          throw new Error(`saveScratchAsProject: project ${id} already exists at ${rootForId(id)}`);
        }
        if (!fs.existsSync(root)) {
          const committed = loadIndex(fs, base);
          applied(opId, committed);
          await flushThenPublish(opId);
          return { status: 'noop' };
        }
        return {
          status: 'ready',
          mutate: async () => {
            const committed = loadIndex(fs, base);
            applied(opId, committed);
            await cleanupThenDurableAck(committed);
          },
        };
      }
      if (!index.scratch) throw new Error('saveScratchAsProject: no scratch to save');
      const destination = rootForId(id);
      if (fs.existsSync(destination)) {
        throw new Error(`saveScratchAsProject: project ${id} already exists at ${destination}`);
      }
      const reconciled = { ...index, scratch: { ...index.scratch, starter } };
      return {
        status: 'ready',
        mutate: async () => {
          const committed = commitScratchProjectSave(fs, reconciled, id, name);
          applied(opId, committed);
          await cleanupThenDurableAck(committed);
        },
      };
    });
  };
  // ADR-0165 §9 rename: load → rename that project's `name` → persist → publish.
  // Unknown id = idempotent no-op publish (mirrors deleteTree), no throw.
  const renameProject = async (projectId: string, name: string, opId?: string): Promise<void> => {
    const index = loadIndex(fs, base);
    const projects = index.projects.map((p) => (p.id === projectId ? { ...p, name } : p));
    writeIndex(fs, base, { ...index, projects });
    await flushThenPublish(opId);
  };
  // ADR-0165 §6 reset: re-seed the ACTIVE scratch from its starter baseline
  // (whole-workspace wipe + re-derive, equivalent to re-picking the starter),
  // clear scratch.dirty, persist, refresh the live snapshot, publish. No-op
  // publish when there is no scratch.
  const resetScratch = async (starter: string, opId?: string): Promise<void> => {
    const root = rootForId('scratch');
    await runPackageReset(root, async () => {
      const index = loadIndex(fs, base);
      if (!index.scratch) {
        await flushRefreshPublish(opId);
        return { status: 'noop' };
      }
      const starterSpec = starterById(starter);
      const seedFiles = seedFilesForStarter(starterSpec, root);
      return {
        status: 'ready',
        mutate: async () => {
          // Reconcile to the page's authority (see IndexResetFrame), then re-seed.
          resetScratchToStarter(fs, withoutViteConfigSeedFiles(root, seedFiles));
          writeIndex(fs, base, {
            ...index,
            scratch: { ...index.scratch, starter, dirty: false, editedAt: 'no edits yet' },
          });
          await claimViteConfigSeed(root, viteConfigSeedStore, {
            id: starterSpec.id,
            seedFiles,
          });
          await initializeStarterGit?.(root);
          await flushRefreshPublish(opId); // re-seed changed the live tree → republish snapshot
        },
      };
    });
  };
  // ADR-0165 §6 reset (named project): wipe + re-derive `/projects/<id>` from the
  // project's own starter (read from the index — authoritative), bump editedAt,
  // persist, refresh the live snapshot, publish. Honest on-disk restore, not a
  // page-mirror no-op. Unknown id = idempotent no-op publish (no throw).
  const resetProjectTree = async (projectId: string, opId?: string): Promise<void> => {
    const root = rootForId(projectId);
    await runPackageReset(root, async () => {
      const index = loadIndex(fs, base);
      const target = index.projects.find((p) => p.id === projectId);
      if (!target) {
        await flushRefreshPublish(opId);
        return { status: 'noop' };
      }
      const starterSpec = starterById(target.starter);
      const seedFiles = seedFilesForStarter(starterSpec, root);
      return {
        status: 'ready',
        mutate: async () => {
          resetProjectToStarter(fs, projectId, withoutViteConfigSeedFiles(root, seedFiles));
          const projects = index.projects.map((p) =>
            p.id === projectId ? { ...p, editedAt: new Date().toISOString() } : p,
          );
          writeIndex(fs, base, { ...index, projects });
          await claimViteConfigSeed(root, viteConfigSeedStore, {
            id: starterSpec.id,
            seedFiles,
          });
          await initializeStarterGit?.(root);
          await flushRefreshPublish(opId); // re-seed changed the (possibly active) tree → republish
        },
      };
    });
  };
  // ADR-0165 §6 fresh scratch from a starter: (re)create the scratch entry +
  // re-point activeId='scratch' + re-seed /scratch from the bundle. Unlike reset,
  // this works when index.scratch is null (post-Save), restoring the Save
  // precondition for the NEXT save. The prior project entries are untouched.
  const newScratch = async (
    starter: string,
    opId?: string,
    opts: { readonly preserveDirtySameStarter?: boolean } = {},
  ): Promise<void> => {
    const root = rootForId('scratch');
    await runPackageReset(root, async () => {
      const index = loadIndex(fs, base);
      if (
        opts.preserveDirtySameStarter === true &&
        index.activeId === 'scratch' &&
        index.scratch?.dirty === true &&
        index.scratch.starter === starter
      ) {
        await flushThenPublish(opId);
        return { status: 'noop' };
      }
      const starterSpec = starterById(starter);
      const seedFiles = seedFilesForStarter(starterSpec, root);
      return {
        status: 'ready',
        mutate: async () => {
          resetScratchToStarter(fs, withoutViteConfigSeedFiles(root, seedFiles));
          writeIndex(fs, base, {
            ...index,
            activeId: 'scratch',
            scratch: { starter, dirty: false, editedAt: 'no edits yet' },
          });
          await claimViteConfigSeed(root, viteConfigSeedStore, {
            id: starterSpec.id,
            seedFiles,
          });
          await initializeStarterGit?.(root);
          await flushThenPublish(opId);
        },
      };
    });
  };
  // ADR-0165 §3 durable switch: persist the active root so the respawned owner
  // (and a later reload) reads the RIGHT activeId — without it the on-disk index
  // is stale and the page mirror reverts the switch on the owner's next publish.
  const setActive = async (activeId: string, opId?: string): Promise<void> => {
    const index = loadIndex(fs, base);
    if (activeId !== 'scratch' && !index.projects.some((p) => p.id === activeId)) {
      throw new Error(`unknown active project ${activeId}`);
    }
    writeIndex(fs, base, { ...index, activeId });
    await flushThenPublish(opId);
  };
  const markScratchDirty = async (starter: string, opId?: string): Promise<void> => {
    const index = loadIndex(fs, base);
    if (index.activeId === 'scratch' && (index.scratch !== null || fs.existsSync('/scratch'))) {
      const scratch = index.scratch ?? { starter, dirty: false, editedAt: 'no edits yet' };
      writeIndex(fs, base, {
        ...index,
        scratch: { ...scratch, dirty: true, editedAt: new Date().toISOString() },
      });
    }
    await flushThenPublish(opId);
  };
  type QueuedMutation = {
    readonly opId: string | undefined;
    readonly mutate: () => Promise<void>;
  };
  const mutationQueue: QueuedMutation[] = [];
  let drainingMutations = false;
  let activeMutation: QueuedMutation | null = null;
  const drainMutations = async (): Promise<void> => {
    try {
      while (!torn && mutationQueue.length > 0) {
        const queued = mutationQueue.shift();
        if (!queued) break;
        activeMutation = queued;
        try {
          await queued.mutate();
        } catch (error) {
          nack(queued.opId, error);
        } finally {
          if (activeMutation === queued) activeMutation = null;
        }
      }
    } finally {
      drainingMutations = false;
    }
  };
  const enqueueMutation = (opId: string | undefined, mutate: () => Promise<void>): void => {
    if (torn) return;
    mutationQueue.push({ opId, mutate });
    if (drainingMutations) return;
    drainingMutations = true;
    void drainMutations();
  };
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as IndexFrame;
    if (frame.type === 'index-req') publishDurable();
    else if (frame.type === 'index-delete')
      enqueueMutation(frame.opId, () => deleteTree(frame.projectId, frame.opId));
    else if (frame.type === 'index-save')
      enqueueMutation(frame.opId, () =>
        saveScratch(frame.id, frame.name, frame.starter, frame.opId),
      );
    else if (frame.type === 'index-rename')
      enqueueMutation(frame.opId, () => renameProject(frame.projectId, frame.name, frame.opId));
    else if (frame.type === 'index-reset')
      enqueueMutation(frame.opId, () => resetScratch(frame.starter, frame.opId));
    else if (frame.type === 'index-reset-project')
      enqueueMutation(frame.opId, () => resetProjectTree(frame.projectId, frame.opId));
    else if (frame.type === 'index-new-scratch')
      enqueueMutation(frame.opId, () =>
        newScratch(frame.starter, frame.opId, {
          preserveDirtySameStarter: frame.preserveDirtySameStarter,
        }),
      );
    else if (frame.type === 'index-set-active')
      enqueueMutation(frame.opId, () => setActive(frame.activeId, frame.opId));
    else if (frame.type === 'index-mark-scratch-dirty')
      enqueueMutation(frame.opId, () => markScratchDirty(frame.starter, frame.opId));
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  return (): void => {
    if (torn) return;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    const pendingOperationIds = new Set<string>();
    if (activeMutation?.opId) pendingOperationIds.add(activeMutation.opId);
    for (const queued of mutationQueue) {
      if (queued.opId) pendingOperationIds.add(queued.opId);
    }
    for (const opId of pendingOperationIds) nack(opId, closedError);
    torn = true;
    mutationQueue.splice(0);
    // Broadcast delivery is asynchronous; match the other owner publishers and
    // release only after the already-posted close NACKs enter the delivery queue.
    queueMicrotask(() => channel.close());
  };
}

const INDEX_ACK_TIMEOUT_MS = 90_000;
const INDEX_APPLIED_RETRY_MS = 250;

function indexOpId(): string {
  return `op-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function errorFromIndexNack(frame: Extract<IndexAckFrame, { readonly ok: false }>): Error {
  const error = new Error(frame.error.message);
  error.name = frame.error.name;
  return error;
}

function postIndexMutation(
  key: OwnerBridgeKey,
  frame: IndexMutationFrame,
  match: (index: ProjectIndex) => boolean = () => true,
): Promise<ProjectIndex> {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(key)));
  const opId = indexOpId();
  const mutation = { ...frame, opId } satisfies IndexMutationFrame;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let onMessage: ((event: MessageEvent) => void) | undefined;
  const cleanup = (): void => {
    if (settled) return;
    settled = true;
    if (timeout !== undefined) clearTimeout(timeout);
    if (onMessage) channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
  const promise = new Promise<ProjectIndex>((resolve, reject) => {
    onMessage = (event: MessageEvent): void => {
      const reply = event.data as IndexFrame;
      if (reply.type !== 'index-ack' || reply.opId !== opId) return;
      if (!reply.ok) {
        cleanup();
        reject(errorFromIndexNack(reply));
        return;
      }
      if (!match(reply.index)) {
        cleanup();
        reject(new Error(`project index ${frame.type} ack did not match committed state`));
        return;
      }
      cleanup();
      resolve(reply.index);
    };
    channel.addEventListener('message', onMessage as unknown as EventListener);
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`project index ${frame.type} ack timed out`));
    }, INDEX_ACK_TIMEOUT_MS);
  });
  try {
    channel.postMessage(mutation);
  } catch (err) {
    cleanup();
    throw err;
  }
  return promise;
}

function postIndexMutationPhases(
  key: OwnerBridgeKey,
  frame: IndexMutationFrame,
  match: (index: ProjectIndex) => boolean = () => true,
): { readonly applied: Promise<ProjectIndex>; readonly durable: Promise<ProjectIndex> } {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(key)));
  const opId = indexOpId();
  const mutation = { ...frame, opId } satisfies IndexMutationFrame;
  let retryTimeout: ReturnType<typeof setTimeout> | undefined;
  let appliedSettled = false;
  let durableSettled = false;

  const cleanupIfDone = (): void => {
    if (!appliedSettled || !durableSettled) return;
    if (retryTimeout !== undefined) clearTimeout(retryTimeout);
    if (onMessage) channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
  const settleApplied = (): void => {
    appliedSettled = true;
    if (retryTimeout !== undefined) clearTimeout(retryTimeout);
    if (appliedTimeout !== undefined) clearTimeout(appliedTimeout);
    cleanupIfDone();
  };
  const settleDurable = (): void => {
    durableSettled = true;
    if (durableTimeout !== undefined) clearTimeout(durableTimeout);
    cleanupIfDone();
  };

  let resolveApplied!: (index: ProjectIndex) => void;
  let rejectApplied!: (err: Error) => void;
  let resolveDurable!: (index: ProjectIndex) => void;
  let rejectDurable!: (err: Error) => void;
  const appliedPromise = new Promise<ProjectIndex>((resolve, reject) => {
    resolveApplied = resolve;
    rejectApplied = reject;
  });
  const durablePromise = new Promise<ProjectIndex>((resolve, reject) => {
    resolveDurable = resolve;
    rejectDurable = reject;
  });

  const onMessage = (event: MessageEvent): void => {
    const reply = event.data as IndexFrame;
    if (reply.type !== 'index-applied' && reply.type !== 'index-ack') return;
    if (reply.opId !== opId) return;
    if (reply.type === 'index-ack' && !reply.ok) {
      const err = errorFromIndexNack(reply);
      if (!appliedSettled) {
        settleApplied();
        rejectApplied(err);
      }
      if (!durableSettled) {
        settleDurable();
        rejectDurable(err);
      }
      return;
    }
    if (!match(reply.index)) {
      const err = new Error(`project index ${frame.type} ack did not match committed state`);
      if (!appliedSettled) {
        settleApplied();
        rejectApplied(err);
      }
      if (!durableSettled) {
        settleDurable();
        rejectDurable(err);
      }
      return;
    }
    if (reply.type === 'index-applied' && !appliedSettled) {
      settleApplied();
      resolveApplied(reply.index);
      return;
    }
    if (reply.type === 'index-ack') {
      if (!appliedSettled) {
        settleApplied();
        resolveApplied(reply.index);
      }
      if (!durableSettled) {
        settleDurable();
        resolveDurable(reply.index);
      }
    }
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  const post = (): void => {
    channel.postMessage(mutation);
  };
  const scheduleRetry = (): void => {
    if (appliedSettled) return;
    retryTimeout = setTimeout(() => {
      post();
      scheduleRetry();
    }, INDEX_APPLIED_RETRY_MS);
  };
  const appliedTimeout = setTimeout(() => {
    if (appliedSettled) return;
    settleApplied();
    rejectApplied(new Error(`project index ${frame.type} applied ack timed out`));
  }, INDEX_ACK_TIMEOUT_MS);
  const durableTimeout = setTimeout(() => {
    if (durableSettled) return;
    settleDurable();
    rejectDurable(new Error(`project index ${frame.type} ack timed out`));
  }, INDEX_ACK_TIMEOUT_MS);
  try {
    post();
    scheduleRetry();
  } catch (err) {
    if (retryTimeout !== undefined) clearTimeout(retryTimeout);
    if (!appliedSettled) {
      settleApplied();
    }
    if (!durableSettled) {
      settleDurable();
    }
    throw err;
  }
  return { applied: appliedPromise, durable: durablePromise };
}

/**
 * Page side: post the durable on-disk delete (ADR-0165 §56). Resolves after the
 * owner flushes + publishes, so the sender channel outlives async browser
 * BroadcastChannel delivery.
 */
export function deleteProjectTree(key: OwnerBridgeKey, projectId: string): Promise<ProjectIndex> {
  return postIndexMutation(
    key,
    { type: 'index-delete', projectId } satisfies IndexDeleteFrame,
    (index) => !index.projects.some((p) => p.id === projectId) && index.activeId !== projectId,
  );
}

/**
 * Page side: post the durable scratch→project Save (ADR-0165 §7). The owner
 * commits the scratch as a project (copy + flip) then re-publishes, so the live
 * page mirror reconciles via the existing reply path. Stale source cleanup is
 * recoverable and happens after the durability ack.
 */
export function saveProjectIndex(
  key: OwnerBridgeKey,
  id: string,
  name: string,
  starter: string,
): Promise<ProjectIndex> {
  const phases = saveProjectIndexPhases(key, id, name, starter);
  void phases.applied.catch(() => undefined);
  return phases.durable;
}

export function saveProjectIndexPhases(
  key: OwnerBridgeKey,
  id: string,
  name: string,
  starter: string,
): { readonly applied: Promise<ProjectIndex>; readonly durable: Promise<ProjectIndex> } {
  return postIndexMutationPhases(
    key,
    { type: 'index-save', id, name, starter } satisfies IndexSaveFrame,
    (index) =>
      index.activeId === id &&
      index.scratch === null &&
      index.projects.some((p) => p.id === id && p.name === name && p.starter === starter),
  );
}

/**
 * Page side: persist a durable switch of the active root (ADR-0165 §3). Posted to
 * the CURRENT owner BEFORE teardown so the on-disk `activeId` is correct when the
 * respawned owner boots + publishes (else the page reverts to the stale activeId).
 */
export function setActiveIndex(key: OwnerBridgeKey, activeId: string): Promise<ProjectIndex> {
  return postIndexMutation(
    key,
    { type: 'index-set-active', activeId } satisfies IndexSetActiveFrame,
    (index) => index.activeId === activeId,
  );
}

/** Page side: post a durable project rename (ADR-0165 §9); owner re-publishes. */
export function renameProjectIndex(
  key: OwnerBridgeKey,
  projectId: string,
  name: string,
): Promise<ProjectIndex> {
  return postIndexMutation(
    key,
    { type: 'index-rename', projectId, name } satisfies IndexRenameFrame,
    (index) =>
      !index.projects.some((p) => p.id === projectId) ||
      index.projects.some((p) => p.id === projectId && p.name === name),
  );
}

/** Page side: post a durable scratch reset-to-starter (ADR-0165 §6); owner re-publishes. */
export function resetScratchIndex(key: OwnerBridgeKey, starter: string): Promise<ProjectIndex> {
  return postIndexMutation(
    key,
    { type: 'index-reset', starter } satisfies IndexResetFrame,
    (index) => index.activeId === 'scratch' && index.scratch?.starter === starter,
  );
}

/**
 * Page side: post a durable NAMED-project reset-to-starter (ADR-0165 §6); the
 * owner wipes + re-derives `/projects/<id>` from the project's starter and
 * re-publishes. The project's starter is read owner-side from the index, so the
 * frame only carries the id.
 */
export function resetProjectIndex(key: OwnerBridgeKey, projectId: string): Promise<ProjectIndex> {
  return postIndexMutation(key, {
    type: 'index-reset-project',
    projectId,
  } satisfies IndexResetProjectFrame);
}

/**
 * Page side: post a durable FRESH scratch from a starter (ADR-0165 §6 gallery
 * pick); owner (re)creates the scratch entry + re-seeds /scratch + re-publishes.
 * Posted on every starter pick so a pick AFTER a Save (index scratch:null) still
 * re-establishes the scratch the next Save needs.
 */
export function newScratchIndex(
  key: OwnerBridgeKey,
  starter: string,
  opts: { readonly preserveDirtySameStarter?: boolean } = {},
): Promise<ProjectIndex> {
  return postIndexMutation(
    key,
    {
      type: 'index-new-scratch',
      starter,
      preserveDirtySameStarter: opts.preserveDirtySameStarter,
    } satisfies IndexNewScratchFrame,
    (index) => index.activeId === 'scratch' && index.scratch?.starter === starter,
  );
}

/** Page side: persist that the active scratch has user edits (ADR-0165 §57). */
export function markScratchDirtyIndex(key: OwnerBridgeKey, starter: string): Promise<ProjectIndex> {
  return postIndexMutation(
    key,
    { type: 'index-mark-scratch-dirty', starter } satisfies IndexMarkScratchDirtyFrame,
    (index) => index.activeId !== 'scratch' || index.scratch?.dirty === true,
  );
}

export interface ProjectIndexSubscription {
  dispose(): void;
}

/** Page side: requests the index on subscribe, delivers each owner reply to `cb`. */
export function subscribeProjectIndex(
  key: OwnerBridgeKey,
  cb: (index: ProjectIndex) => void,
): ProjectIndexSubscription {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(key)));
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as IndexFrame;
    if (frame.type === 'index-reply') cb(frame.index);
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  channel.postMessage({ type: 'index-req' } satisfies IndexRequestFrame); // pull on subscribe
  let torn = false;
  return {
    dispose(): void {
      if (torn) return;
      torn = true;
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    },
  };
}

/**
 * Page-side in-memory MIRROR of the owner's project index (ADR-0165 §3 switch).
 * The launcher renders from `current()`; the switch path re-`request()`s after a
 * respawn and the mirror is replaced WHOLESALE on each owner reply (never merged)
 * so the post-respawn re-publish is authoritative. Thin layer over the
 * `subscribeProjectIndex` pull-channel — same realm split, same channel.
 */
export interface ProjectIndexMirror {
  /** Latest mirrored index, or null before the first owner reply. */
  current(): ProjectIndex | null;
  /** Observe each owner reply; if a frame already arrived, replays it immediately. */
  subscribe(cb: (index: ProjectIndex) => void): () => void;
  /** Ask the owner to re-publish (post-respawn / handshake); resolves once flushed. */
  request(): Promise<void>;
  dispose(): void;
}

/** PAGE side: hydrate + keep an in-memory mirror of the owner's project index. */
export function bridgeProjectIndex(key: OwnerBridgeKey): ProjectIndexMirror {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(key)));
  let latest: ProjectIndex | null = null;
  const subs = new Set<(index: ProjectIndex) => void>();
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as IndexFrame;
    if (frame.type !== 'index-reply') return;
    latest = frame.index; // wholesale replace — respawn re-publish is authoritative
    for (const cb of subs) cb(frame.index);
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  channel.postMessage({ type: 'index-req' } satisfies IndexRequestFrame); // pull on construct
  let torn = false;
  return {
    current: () => latest,
    subscribe(cb) {
      subs.add(cb);
      if (latest) cb(latest);
      return () => subs.delete(cb);
    },
    request() {
      channel.postMessage({ type: 'index-req' } satisfies IndexRequestFrame);
      // Resolve on the next microtask so a same-tab BroadcastChannel round-trip
      // (test + real) has flushed the synchronous publish reply.
      return new Promise<void>((resolve) => queueMicrotask(resolve));
    },
    dispose(): void {
      if (torn) return;
      torn = true;
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    },
  };
}
