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
import {
  type IndexFs,
  type ProjectIndex,
  loadIndex,
  resetProjectToStarter,
  resetScratchToStarter,
  rootForId,
  saveScratchAsProject,
  writeIndex,
} from './project-index.ts';
import { seedFilesForStarter, starterById } from './starter.ts';

export function projectIndexChannelUrl(port: number): string {
  return `ws://project-index.local:${port}/__rfv`;
}

type IndexRequestFrame = { readonly type: 'index-req' };
type IndexReplyFrame = { readonly type: 'index-reply'; readonly index: ProjectIndex };
type IndexDeleteFrame = { readonly type: 'index-delete'; readonly projectId: string };
/**
 * Durable scratch→project Save (ADR-0165 §7): owner runs saveScratchAsProject.
 * Carries the page's CURRENT active `starter` — the persistent owner is spawned
 * once with the boot default, so a mid-session starter pick (clean scratch,
 * no respawn) leaves the owner's synthesized scratch.starter stale; the page is
 * the authority, so the save reconciles scratch.starter from this frame before
 * the move (the saved project then records the real starter).
 */
type IndexSaveFrame = {
  readonly type: 'index-save';
  readonly id: string;
  readonly name: string;
  readonly starter: string;
};
/** Rename a named project in the index (ADR-0165 §9). */
type IndexRenameFrame = {
  readonly type: 'index-rename';
  readonly projectId: string;
  readonly name: string;
};
/**
 * Reset the ACTIVE scratch back to its starter baseline (ADR-0165 §6). Carries
 * the page's CURRENT active `starter` (same staleness reason as index-save) so
 * the re-seed re-derives the right bundle and the index records it.
 */
type IndexResetFrame = { readonly type: 'index-reset'; readonly starter: string };
/**
 * Reset a NAMED project's `/projects/<id>` back to its starter baseline
 * (ADR-0165 §6, extended to named projects). The project's `starter` is read
 * from the index (authoritative — set at Save, never drifts), so the frame only
 * needs the id. A real on-disk re-seed, not a page-mirror no-op.
 */
type IndexResetProjectFrame = { readonly type: 'index-reset-project'; readonly projectId: string };
/**
 * Establish a FRESH scratch from a starter (ADR-0165 §6 gallery pick). Distinct
 * from index-reset, which requires an existing scratch: after a Save the index is
 * `scratch:null, activeId:<projectId>`, so picking a new starter must (re)create
 * the scratch entry + re-point activeId='scratch' + re-seed `/scratch` from the
 * bundle — else the next Save throws `no scratch to save`. The owner is NOT
 * respawned on a pick (it stays rooted at /scratch), so this re-seeds the live
 * tree the next marker write + Save will move.
 */
type IndexNewScratchFrame = { readonly type: 'index-new-scratch'; readonly starter: string };
/**
 * Persist a SWITCH of the active root to the index (ADR-0165 §3). A plain switch
 * between existing roots otherwise NEVER updates the on-disk `activeId`, so the
 * respawned owner re-publishes a STALE `activeId` and the page mirror reverts the
 * switch (a race) AND a reload boots the wrong root. Posted to the CURRENT owner
 * BEFORE teardown so the index is correct when the new owner boots + publishes.
 */
type IndexSetActiveFrame = { readonly type: 'index-set-active'; readonly activeId: string };
type IndexFrame =
  | IndexRequestFrame
  | IndexReplyFrame
  | IndexDeleteFrame
  | IndexSaveFrame
  | IndexRenameFrame
  | IndexResetFrame
  | IndexResetProjectFrame
  | IndexNewScratchFrame
  | IndexSetActiveFrame;

/**
 * Owner side: replies to a page request + serves the durable on-disk
 * delete/save/rename/reset.
 *
 * `flush` (optional) drains the realm's OPFS write-through AFTER a tree-mutating
 * op (save/reset/delete), BEFORE the publish — so the move is durable on disk
 * before a SWITCH tears this owner down and respawns one that reads OPFS (else the
 * cpSync'd `/projects/<id>` tree races the teardown and the switched-in owner boots
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
  port: number,
  fs: IndexFs,
  base: string,
  flush?: () => Promise<void>,
  refresh?: () => void,
): () => void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  const publish = (): void => {
    channel.postMessage({
      type: 'index-reply',
      index: loadIndex(fs, base),
    } satisfies IndexReplyFrame);
  };
  // Drain the OPFS write-through after a tree mutation, then publish. Errors
  // surface loud (rejected promise → owner worker-entry → stderr), never swallowed.
  const flushThenPublish = async (): Promise<void> => {
    if (flush) await flush();
    publish();
  };
  // As flushThenPublish, plus a snapshot republish for an IN-PLACE re-seed so the
  // live page reflects the restored files (reset only — save/delete/new-scratch
  // mutate the active root's identity, not its content in place).
  const flushRefreshPublish = async (): Promise<void> => {
    if (flush) await flush();
    refresh?.();
    publish();
  };
  // ADR-0165 §56 durable delete: flip the index (drop the entry) → THEN rm the
  // tree — the COMMIT-FIRST ordering, the inverse of the dangerous one. A crash
  // mid-delete then leaves an orphan `/projects/<id>` tree the index no longer
  // references → recoverIndex case (A) silently rolls it back. The opposite order
  // (rm then write) would leave an indexed-but-missing tree → recoverIndex case (D)
  // THROWS on every boot = unrecoverable brick. Unknown id = idempotent no-op
  // publish (no throw): re-asserts state so a re-fired delete still reconciles.
  const deleteTree = (projectId: string): void => {
    const index = loadIndex(fs, base);
    const projects = index.projects.filter((p) => p.id !== projectId);
    // Defensive: a delete of the ACTIVE project re-points activeId — scratch if a
    // draft exists, else the first remaining project, else 'scratch' (empty).
    const activeId =
      index.activeId === projectId
        ? index.scratch
          ? 'scratch'
          : (projects[0]?.id ?? 'scratch')
        : index.activeId;
    writeIndex(fs, base, { ...index, activeId, projects }); // commit FIRST
    fs.rmSync(rootForId(projectId), { recursive: true, force: true }); // then drop the tree
    void flushThenPublish(); // durable on disk, then every page mirror reconciles
  };
  // ADR-0165 §7 durable Save: convert the active scratch into a named project
  // (copy /scratch → /projects/<id>, flip+persist the index LAST, delete the
  // source). The `!index.scratch` / duplicate-id throws inside saveScratchAsProject
  // are the LOUD signal — never swallowed; in the owner realm they propagate to
  // worker-entry → stderr, never a silent half-move. The throw is SYNCHRONOUS (the
  // unit harness asserts it on the poster call); flush+publish run async after.
  const saveScratch = (id: string, name: string, starter: string): void => {
    const index = loadIndex(fs, base);
    // Reconcile the scratch starter to the page's authority (see IndexSaveFrame).
    const reconciled = index.scratch ? { ...index, scratch: { ...index.scratch, starter } } : index;
    saveScratchAsProject(fs, reconciled, id, name);
    void flushThenPublish(); // the move MUST be durable before a switch respawns
  };
  // ADR-0165 §9 rename: load → rename that project's `name` → persist → publish.
  // Unknown id = idempotent no-op publish (mirrors deleteTree), no throw.
  const renameProject = (projectId: string, name: string): void => {
    const index = loadIndex(fs, base);
    const projects = index.projects.map((p) => (p.id === projectId ? { ...p, name } : p));
    writeIndex(fs, base, { ...index, projects });
    void flushThenPublish();
  };
  // ADR-0165 §6 reset: re-seed the ACTIVE scratch from its starter baseline
  // (whole-workspace wipe + re-derive, equivalent to re-picking the starter),
  // clear scratch.dirty, persist, refresh the live snapshot, publish. No-op
  // publish when there is no scratch.
  const resetScratch = (starter: string): void => {
    const index = loadIndex(fs, base);
    if (index.scratch) {
      // Reconcile to the page's authority (see IndexResetFrame), then re-seed.
      resetScratchToStarter(fs, seedFilesForStarter(starterById(starter), rootForId('scratch')));
      writeIndex(fs, base, {
        ...index,
        scratch: { ...index.scratch, starter, dirty: false, editedAt: 'no edits yet' },
      });
    }
    void flushRefreshPublish(); // re-seed changed the live tree → republish snapshot
  };
  // ADR-0165 §6 reset (named project): wipe + re-derive `/projects/<id>` from the
  // project's own starter (read from the index — authoritative), bump editedAt,
  // persist, refresh the live snapshot, publish. Honest on-disk restore, not a
  // page-mirror no-op. Unknown id = idempotent no-op publish (no throw).
  const resetProjectTree = (projectId: string): void => {
    const index = loadIndex(fs, base);
    const target = index.projects.find((p) => p.id === projectId);
    if (target) {
      resetProjectToStarter(
        fs,
        projectId,
        seedFilesForStarter(starterById(target.starter), rootForId(projectId)),
      );
      const projects = index.projects.map((p) =>
        p.id === projectId ? { ...p, editedAt: new Date().toISOString() } : p,
      );
      writeIndex(fs, base, { ...index, projects });
    }
    void flushRefreshPublish(); // re-seed changed the (possibly active) tree → republish
  };
  // ADR-0165 §6 fresh scratch from a starter: (re)create the scratch entry +
  // re-point activeId='scratch' + re-seed /scratch from the bundle. Unlike reset,
  // this works when index.scratch is null (post-Save), restoring the Save
  // precondition for the NEXT save. The prior project entries are untouched.
  const newScratch = (starter: string): void => {
    resetScratchToStarter(fs, seedFilesForStarter(starterById(starter), rootForId('scratch')));
    const index = loadIndex(fs, base);
    writeIndex(fs, base, {
      ...index,
      activeId: 'scratch',
      scratch: { starter, dirty: false, editedAt: 'no edits yet' },
    });
    void flushThenPublish();
  };
  // ADR-0165 §3 durable switch: persist the active root so the respawned owner
  // (and a later reload) reads the RIGHT activeId — without it the on-disk index
  // is stale and the page mirror reverts the switch on the owner's next publish.
  const setActive = (activeId: string): void => {
    const index = loadIndex(fs, base);
    writeIndex(fs, base, { ...index, activeId });
    void flushThenPublish();
  };
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as IndexFrame;
    if (frame.type === 'index-req') publish();
    else if (frame.type === 'index-delete') deleteTree(frame.projectId);
    else if (frame.type === 'index-save') saveScratch(frame.id, frame.name, frame.starter);
    else if (frame.type === 'index-rename') renameProject(frame.projectId, frame.name);
    else if (frame.type === 'index-reset') resetScratch(frame.starter);
    else if (frame.type === 'index-reset-project') resetProjectTree(frame.projectId);
    else if (frame.type === 'index-new-scratch') newScratch(frame.starter);
    else if (frame.type === 'index-set-active') setActive(frame.activeId);
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
}

/**
 * Page side: post the durable on-disk delete (ADR-0165 §56). Fire-and-forget,
 * symmetric with the index-req posters — the owner removes `/projects/<id>` then
 * re-publishes, so the live page mirror reconciles via the existing reply path.
 */
export function deleteProjectTree(port: number, projectId: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-delete', projectId } satisfies IndexDeleteFrame);
  channel.close();
}

/**
 * Page side: post the durable scratch→project Save (ADR-0165 §7). The owner
 * runs `saveScratchAsProject` (copy + flip + delete) then re-publishes, so the
 * live page mirror reconciles via the existing reply path. Fire-and-forget,
 * symmetric with the index-delete poster.
 */
export function saveProjectIndex(port: number, id: string, name: string, starter: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-save', id, name, starter } satisfies IndexSaveFrame);
  channel.close();
}

/**
 * Page side: persist a durable switch of the active root (ADR-0165 §3). Posted to
 * the CURRENT owner BEFORE teardown so the on-disk `activeId` is correct when the
 * respawned owner boots + publishes (else the page reverts to the stale activeId).
 */
export function setActiveIndex(port: number, activeId: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-set-active', activeId } satisfies IndexSetActiveFrame);
  channel.close();
}

/** Page side: post a durable project rename (ADR-0165 §9); owner re-publishes. */
export function renameProjectIndex(port: number, projectId: string, name: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-rename', projectId, name } satisfies IndexRenameFrame);
  channel.close();
}

/** Page side: post a durable scratch reset-to-starter (ADR-0165 §6); owner re-publishes. */
export function resetScratchIndex(port: number, starter: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-reset', starter } satisfies IndexResetFrame);
  channel.close();
}

/**
 * Page side: post a durable NAMED-project reset-to-starter (ADR-0165 §6); the
 * owner wipes + re-derives `/projects/<id>` from the project's starter and
 * re-publishes. The project's starter is read owner-side from the index, so the
 * frame only carries the id.
 */
export function resetProjectIndex(port: number, projectId: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-reset-project', projectId } satisfies IndexResetProjectFrame);
  channel.close();
}

/**
 * Page side: post a durable FRESH scratch from a starter (ADR-0165 §6 gallery
 * pick); owner (re)creates the scratch entry + re-seeds /scratch + re-publishes.
 * Posted on every starter pick so a pick AFTER a Save (index scratch:null) still
 * re-establishes the scratch the next Save needs.
 */
export function newScratchIndex(port: number, starter: string): void {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
  channel.postMessage({ type: 'index-new-scratch', starter } satisfies IndexNewScratchFrame);
  channel.close();
}

export interface ProjectIndexSubscription {
  dispose(): void;
}

/** Page side: requests the index on subscribe, delivers each owner reply to `cb`. */
export function subscribeProjectIndex(
  port: number,
  cb: (index: ProjectIndex) => void,
): ProjectIndexSubscription {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
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
export function bridgeProjectIndex(port: number): ProjectIndexMirror {
  const channel = new BroadcastChannel(channelNameFor(projectIndexChannelUrl(port)));
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
