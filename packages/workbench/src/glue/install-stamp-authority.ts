/** One serialized owner for root-bound install-stamp claims (ADR-0261). */
import {
  type FsSync,
  type PersistFailureReport,
  type Vfs,
  isAbsolute,
  joinPath,
  normalizePath,
} from '@riftydev/vfs';
import {
  type InstallStamp,
  createInstallStamp,
  effectiveDepsFromPackageJsonText,
  installStampPath,
  installTreeDir,
  isStampedTreeDamage,
  lockfileMatchesStamp,
  lockfilePath,
  parseInstallStamp,
  readInstallStamp,
  reportHasFailure,
  sha256Hex,
  stampTrusted,
} from './install-stamp.ts';

export interface InstallStampIdentity {
  readonly root: string;
  readonly slug: string;
  /** Exact installer input; no flattened-map identity is accepted. */
  readonly packageJsonText: string;
}

export interface InstallStampClaim {
  readonly root: string;
  readonly slug: string;
  readonly epoch: string;
  /** Exact prior on-disk claim owner, sampled before this demotion. */
  readonly priorSlug?: string;
}

export interface InstallStampCheckInput {
  readonly root: string;
  readonly slug?: string;
  /** Template request which the current exact package.json must cover. */
  readonly expectedPackageJsonText?: string;
}

export type InstallStampCheck =
  | { readonly status: 'absent' }
  | { readonly status: 'pending'; readonly stamp?: InstallStamp }
  | { readonly status: 'trusted'; readonly stamp: InstallStamp };

export type InstallStampPromotionResult =
  | { readonly status: 'trusted'; readonly stamp: InstallStamp }
  | { readonly status: 'stale' }
  | {
      readonly status: 'refused';
      readonly reason:
        | 'guarded-scope-not-durable'
        | 'claim-not-durable'
        | 'identity-drift'
        | 'tree-missing'
        | 'claim-replaced'
        | 'flush-failed'
        | 'write-failed'
        | 'revocation-not-durable';
      readonly error?: string;
      readonly report?: PersistFailureReport;
    };

export interface InstallStampTransitionOptions {
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
}

export interface InstallStampPromoteOptions extends InstallStampTransitionOptions {
  readonly epoch: string;
  readonly packages: number;
}

export interface InstallStampAuthority {
  check(input: InstallStampCheckInput): Promise<InstallStampCheck>;
  checkSync(input: InstallStampCheckInput): InstallStampCheck;
  demote(
    input: Pick<InstallStampIdentity, 'root' | 'slug'>,
    options?: InstallStampTransitionOptions,
  ): Promise<InstallStampClaim>;
  /** Remove only this authority's current pending marker before an acquisition
   * mutates its ancestor tree. State and epoch stay pending; promotion must
   * re-materialize the same claim before its durability proof. */
  prepareTreeMutation(claim: InstallStampClaim): Promise<void>;
  promote(
    identity: InstallStampIdentity,
    options: InstallStampPromoteOptions,
  ): Promise<InstallStampPromotionResult>;
  revoke(input: { readonly root: string }, options?: InstallStampTransitionOptions): Promise<void>;
}

/** Construction-local privilege for the reserved claim path. */
export interface InstallStampClaimIo {
  read(root: string): Uint8Array | null;
  write(root: string, data: Uint8Array, options: { readonly mkdirTree: boolean }): void;
  remove(root: string): void;
}

export type InstallStampAuthoritySyncFs = Pick<
  FsSync,
  'existsSync' | 'readFileBytesSync' | 'writeFileSync' | 'mkdirSync' | 'rmSync'
>;

const ownerAuthorities = new WeakMap<object, InstallStampAuthority>();

/** One authority instance per concrete owner/store when composition does not
 * inject it explicitly (unit harnesses). Production should pass the shared
 * owner instance across acquisition and terminal installs. */
export function installStampAuthorityFor(
  owner: object,
  options: {
    readonly vfs: Vfs;
    readonly fsSync?: InstallStampAuthoritySyncFs;
    readonly claimIo?: InstallStampClaimIo;
  },
): InstallStampAuthority {
  let authority = ownerAuthorities.get(owner);
  if (!authority) {
    authority = createInstallStampAuthority(options);
    ownerAuthorities.set(owner, authority);
  }
  return authority;
}

export class InstallStampAuthorityError extends Error {
  readonly code:
    | 'INSTALL_STAMP_DEMOTE_UNPROVEN'
    | 'INSTALL_STAMP_MUTATION_CLAIM_STALE'
    | 'INSTALL_STAMP_REVOKE_UNPROVEN';

  constructor(
    code:
      | 'INSTALL_STAMP_DEMOTE_UNPROVEN'
      | 'INSTALL_STAMP_MUTATION_CLAIM_STALE'
      | 'INSTALL_STAMP_REVOKE_UNPROVEN',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'InstallStampAuthorityError';
    this.code = code;
  }
}

interface RootClaimState {
  phase: 'unknown' | 'absent' | 'pending' | 'trusted';
  epoch: string | null;
  slug: string | null;
  materialized: boolean;
  transition: number;
  queue: Promise<void>;
}

interface StampIo {
  readonly vfs: Vfs;
  readonly fsSync?: InstallStampAuthoritySyncFs;
  readonly claimIo?: InstallStampClaimIo;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');
let authoritySequence = 0;

function canonicalAuthorityRoot(root: string): string {
  if (!isAbsolute(root)) {
    throw new Error(`install-stamp authority root must be absolute; got: '${root}'`);
  }
  return normalizePath(root);
}

function depsInclude(
  full: Readonly<Record<string, string>>,
  subset: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(subset).every(([key, value]) => full[key] === value);
}

function pendingForInput(state: RootClaimState, input: InstallStampCheckInput): InstallStampCheck {
  return input.slug === undefined || input.slug === state.slug
    ? { status: 'pending' }
    : { status: 'absent' };
}

function isCurrentPendingClaim(
  state: RootClaimState,
  stamp: InstallStamp | null,
  epoch: string,
): boolean {
  return stamp === null
    ? !state.materialized
    : stamp.durability === 'pending' && stamp.epoch === epoch;
}

function enqueue<T>(state: RootClaimState, task: () => Promise<T>): Promise<T> {
  const run = state.queue.then(task);
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function currentPhase(state: RootClaimState): RootClaimState['phase'] {
  return state.phase;
}

function unreachable(value: never): never {
  throw new Error(`unreachable install-stamp state: ${String(value)}`);
}

function failureAt(
  report: PersistFailureReport | undefined,
  predicate: (path: string) => boolean,
): boolean {
  return report !== undefined && reportHasFailure(report, predicate);
}

function guardedScopeFailed(report: PersistFailureReport | undefined, root: string): boolean {
  return failureAt(report, (path) => isStampedTreeDamage(path, root));
}

function claimFailed(report: PersistFailureReport | undefined, root: string): boolean {
  const path = installStampPath(root);
  return failureAt(report, (candidate) => candidate === path);
}

async function readText(io: StampIo, path: string): Promise<string | null> {
  if (io.fsSync) {
    if (!io.fsSync.existsSync(path)) return null;
    try {
      return dec.decode(io.fsSync.readFileBytesSync(path));
    } catch {
      return null;
    }
  }
  if (!(await io.vfs.exists(path))) return null;
  try {
    return await io.vfs.readFileText(path);
  } catch {
    return null;
  }
}

function readTextSync(fsSync: InstallStampAuthoritySyncFs, path: string): string | null {
  if (!fsSync.existsSync(path)) return null;
  try {
    return dec.decode(fsSync.readFileBytesSync(path));
  } catch {
    return null;
  }
}

async function readStamp(io: StampIo, root: string): Promise<InstallStamp | null> {
  if (io.claimIo) {
    try {
      const bytes = io.claimIo.read(root);
      if (bytes === null) return null;
      return parseInstallStamp(JSON.parse(dec.decode(bytes)), root);
    } catch {
      return null;
    }
  }
  if (!io.fsSync) return readInstallStamp(io.vfs, root);
  const text = readTextSync(io.fsSync, installStampPath(root));
  if (text === null) return null;
  try {
    return parseInstallStamp(JSON.parse(text), root);
  } catch {
    return null;
  }
}

function readStampSync(fsSync: InstallStampAuthoritySyncFs, root: string): InstallStamp | null {
  const text = readTextSync(fsSync, installStampPath(root));
  if (text === null) return null;
  try {
    return parseInstallStamp(JSON.parse(text), root);
  } catch {
    return null;
  }
}

async function pathExists(io: StampIo, path: string): Promise<boolean> {
  return io.fsSync ? io.fsSync.existsSync(path) : io.vfs.exists(path);
}

async function writeRawStamp(
  io: StampIo,
  root: string,
  stamp: InstallStamp,
  mkdir: boolean,
): Promise<void> {
  const tree = installTreeDir(root);
  const bytes = enc.encode(`${JSON.stringify(stamp, null, 2)}\n`);
  if (io.claimIo || io.fsSync) {
    writeRawStampSync(io, root, bytes, mkdir);
    return;
  }
  if (mkdir) await io.vfs.mkdir(tree, { recursive: true });
  await io.vfs.writeFile(installStampPath(root), bytes);
}

function writeRawStampSync(io: StampIo, root: string, bytes: Uint8Array, mkdir: boolean): void {
  if (io.claimIo) {
    io.claimIo.write(root, bytes, { mkdirTree: mkdir });
    return;
  }
  if (!io.fsSync) throw new Error('install-stamp authority has no synchronous claim writer');
  if (mkdir) io.fsSync.mkdirSync(installTreeDir(root), { recursive: true });
  io.fsSync.writeFileSync(installStampPath(root), bytes);
}

async function removeStamp(io: StampIo, root: string): Promise<void> {
  if (io.claimIo) {
    io.claimIo.remove(root);
    return;
  }
  const path = installStampPath(root);
  if (io.fsSync) {
    io.fsSync.rmSync(path, { force: true });
    return;
  }
  await io.vfs.rm(path, { force: true });
}

function pendingStamp(identity: InstallStampIdentity, epoch: string, packages = 0): InstallStamp {
  const stamp = createInstallStamp(identity.root, identity.packageJsonText, {
    slug: identity.slug,
    packages,
    durability: 'pending',
    epoch,
  });
  if (!stamp) throw new Error('install stamp identity is not valid package.json');
  return stamp;
}

function trustedStamp(
  identity: InstallStampIdentity,
  packages: number,
  lockfileSha256?: string,
): InstallStamp {
  const stamp = createInstallStamp(identity.root, identity.packageJsonText, {
    slug: identity.slug,
    packages,
    ...(lockfileSha256 === undefined ? {} : { lockfileSha256 }),
  });
  if (!stamp) throw new Error('install stamp identity is not valid package.json');
  return stamp;
}

async function readLockfileBytesIo(io: StampIo, root: string): Promise<Uint8Array | null> {
  const path = lockfilePath(root);
  try {
    if (io.fsSync) return readLockfileBytesSync(io.fsSync, root);
    return (await io.vfs.exists(path)) ? await io.vfs.readFile(path) : null;
  } catch {
    return null;
  }
}

function readLockfileBytesSync(
  fsSync: Pick<InstallStampAuthoritySyncFs, 'existsSync' | 'readFileBytesSync'>,
  root: string,
): Uint8Array | null {
  const path = lockfilePath(root);
  try {
    return fsSync.existsSync(path) ? fsSync.readFileBytesSync(path) : null;
  } catch {
    return null;
  }
}

async function classifyCheck(
  io: StampIo,
  input: InstallStampCheckInput,
): Promise<{
  readonly result: InstallStampCheck;
  readonly diskPhase: RootClaimState['phase'];
  readonly stamp: InstallStamp | null;
}> {
  const stamp = await readStamp(io, input.root);
  if (!stamp) return { result: { status: 'absent' }, diskPhase: 'absent', stamp: null };
  if (!stampTrusted(stamp)) {
    const result: InstallStampCheck =
      input.slug === undefined || input.slug === stamp.slug
        ? { status: 'pending', stamp }
        : { status: 'absent' };
    return { result, diskPhase: 'pending', stamp };
  }
  const currentText = await readText(io, joinPath(input.root, 'package.json'));
  const treeExists = await pathExists(io, installTreeDir(input.root));
  let expectedCovered = true;
  if (input.expectedPackageJsonText !== undefined) {
    const expected = effectiveDepsFromPackageJsonText(input.expectedPackageJsonText);
    const current = currentText === null ? null : effectiveDepsFromPackageJsonText(currentText);
    expectedCovered = expected !== null && current !== null && depsInclude(current, expected);
  }
  const lockfileOk = lockfileMatchesStamp(stamp, await readLockfileBytesIo(io, input.root));
  const matches =
    (input.slug === undefined || input.slug === stamp.slug) &&
    treeExists &&
    currentText !== null &&
    stamp.packageJsonText === currentText &&
    lockfileOk &&
    expectedCovered;
  return {
    result: matches ? { status: 'trusted', stamp } : { status: 'absent' },
    diskPhase: 'trusted',
    stamp,
  };
}

function classifyCheckSync(
  fsSync: InstallStampAuthoritySyncFs,
  input: InstallStampCheckInput,
): {
  readonly result: InstallStampCheck;
  readonly diskPhase: RootClaimState['phase'];
  readonly stamp: InstallStamp | null;
} {
  const stamp = readStampSync(fsSync, input.root);
  if (!stamp) return { result: { status: 'absent' }, diskPhase: 'absent', stamp: null };
  if (!stampTrusted(stamp)) {
    const result: InstallStampCheck =
      input.slug === undefined || input.slug === stamp.slug
        ? { status: 'pending', stamp }
        : { status: 'absent' };
    return { result, diskPhase: 'pending', stamp };
  }
  const currentText = readTextSync(fsSync, joinPath(input.root, 'package.json'));
  let expectedCovered = true;
  if (input.expectedPackageJsonText !== undefined) {
    const expected = effectiveDepsFromPackageJsonText(input.expectedPackageJsonText);
    const current = currentText === null ? null : effectiveDepsFromPackageJsonText(currentText);
    expectedCovered = expected !== null && current !== null && depsInclude(current, expected);
  }
  const matches =
    (input.slug === undefined || input.slug === stamp.slug) &&
    fsSync.existsSync(installTreeDir(input.root)) &&
    currentText !== null &&
    stamp.packageJsonText === currentText &&
    lockfileMatchesStamp(stamp, readLockfileBytesSync(fsSync, input.root)) &&
    expectedCovered;
  return {
    result: matches ? { status: 'trusted', stamp } : { status: 'absent' },
    diskPhase: 'trusted',
    stamp,
  };
}

export function createInstallStampAuthority(options: {
  readonly vfs: Vfs;
  readonly fsSync?: InstallStampAuthoritySyncFs;
  readonly claimIo?: InstallStampClaimIo;
}): InstallStampAuthority {
  const io: StampIo = options;
  const authorityId = ++authoritySequence;
  let epochSequence = 0;
  const roots = new Map<string, RootClaimState>();

  const stateFor = (root: string): RootClaimState => {
    const canonicalRoot = normalizePath(root);
    let state = roots.get(canonicalRoot);
    if (!state) {
      state = {
        phase: 'unknown',
        epoch: null,
        slug: null,
        materialized: false,
        transition: 0,
        queue: Promise.resolve(),
      };
      roots.set(canonicalRoot, state);
    }
    return state;
  };

  const updatePhaseFromStamp = (state: RootClaimState, stamp: InstallStamp | null): void => {
    if (!stamp) {
      state.phase = 'absent';
      state.epoch = null;
      state.slug = null;
      state.materialized = false;
      return;
    }
    const trusted = stampTrusted(stamp);
    state.phase = trusted ? 'trusted' : 'pending';
    state.epoch = trusted ? null : (stamp.epoch ?? null);
    state.slug = stamp.slug;
    state.materialized = !trusted;
  };

  const restoreStampForTransition = async (
    state: RootClaimState,
    transitionId: number,
    root: string,
    stamp: InstallStamp | null,
  ): Promise<void> => {
    if (state.transition !== transitionId) return;
    if (stamp) {
      try {
        await writeRawStamp(io, root, stamp, false);
      } catch (error) {
        if (state.transition !== transitionId) return;
        throw error;
      }
    }
    if (state.transition !== transitionId) return;
    updatePhaseFromStamp(state, stamp);
  };

  const check = async (rawInput: InstallStampCheckInput): Promise<InstallStampCheck> => {
    if (!isAbsolute(rawInput.root)) return { status: 'absent' };
    const input = { ...rawInput, root: canonicalAuthorityRoot(rawInput.root) };
    const state = stateFor(input.root);
    if (state.phase === 'pending') return pendingForInput(state, input);
    if (state.phase === 'absent') return { status: 'absent' };
    const classified = await classifyCheck(io, input);
    // A demote/revoke can fence this async read after it observed trusted.
    // The in-memory transition wins; never return that stale trust verdict.
    const phaseAfterRead = currentPhase(state);
    if (phaseAfterRead === 'pending') return pendingForInput(state, input);
    if (phaseAfterRead === 'absent') return { status: 'absent' };
    if (phaseAfterRead === 'unknown') {
      updatePhaseFromStamp(state, classified.stamp);
    } else if (classified.diskPhase !== 'trusted') {
      state.phase = classified.diskPhase;
    }
    return classified.result;
  };

  const checkSync = (rawInput: InstallStampCheckInput): InstallStampCheck => {
    if (!io.fsSync) throw new Error('install-stamp authority has no synchronous VFS surface');
    if (!isAbsolute(rawInput.root)) return { status: 'absent' };
    const input = { ...rawInput, root: canonicalAuthorityRoot(rawInput.root) };
    const state = stateFor(input.root);
    if (state.phase === 'pending') return pendingForInput(state, input);
    if (state.phase === 'absent') return { status: 'absent' };
    const classified = classifyCheckSync(io.fsSync, input);
    if (state.phase === 'unknown') updatePhaseFromStamp(state, classified.stamp);
    else if (classified.diskPhase !== 'trusted') state.phase = classified.diskPhase;
    return classified.result;
  };

  const demote = (
    rawInput: Pick<InstallStampIdentity, 'root' | 'slug'>,
    options: InstallStampTransitionOptions = {},
  ): Promise<InstallStampClaim> => {
    const input = { ...rawInput, root: canonicalAuthorityRoot(rawInput.root) };
    const state = stateFor(input.root);
    const epoch = `${authorityId}:${++epochSequence}`;
    const transitionId = ++state.transition;
    state.phase = 'pending';
    state.epoch = epoch;
    state.slug = input.slug;
    state.materialized = false;

    return enqueue(state, async () => {
      const prior = await readStamp(io, input.root);
      const trustedPrior = prior && stampTrusted(prior) ? prior : null;
      const currentText = await readText(io, joinPath(input.root, 'package.json'));
      const packageJsonText = currentText ?? prior?.packageJsonText;
      const dependencyTreeExists =
        prior !== null || (await pathExists(io, installTreeDir(input.root)));
      const flush = options.flush;
      const restoreAndThrow = async (message: string, cause?: unknown): Promise<never> => {
        if (trustedPrior) {
          try {
            await restoreStampForTransition(state, transitionId, input.root, trustedPrior);
          } catch (restoreError) {
            throw new InstallStampAuthorityError(
              'INSTALL_STAMP_DEMOTE_UNPROVEN',
              `${message}; prior trusted claim could not be restored`,
              { cause: restoreError },
            );
          }
        }
        throw new InstallStampAuthorityError('INSTALL_STAMP_DEMOTE_UNPROVEN', message, {
          ...(cause === undefined ? {} : { cause }),
        });
      };
      const removeAndProve = async (message: string, cause?: unknown): Promise<void> => {
        if (!flush) return restoreAndThrow(`${message}; no durability check is available`, cause);
        try {
          await removeStamp(io, input.root);
        } catch (error) {
          return restoreAndThrow(`${message}; fallback removal failed`, error);
        }
        let removed: PersistFailureReport | undefined;
        try {
          removed = await flush();
        } catch (error) {
          return restoreAndThrow(`${message}; fallback removal durability check failed`, error);
        }
        if (claimFailed(removed, input.root)) {
          return restoreAndThrow(`${message}; fallback removal was not durable`, cause);
        }
        if (state.epoch === epoch) state.materialized = false;
      };
      let wrotePending = false;
      let pendingWriteFailed = false;
      if (packageJsonText !== undefined && dependencyTreeExists) {
        try {
          await writeRawStamp(
            io,
            input.root,
            pendingStamp({ ...input, packageJsonText }, epoch),
            true,
          );
          wrotePending = true;
        } catch (error) {
          if (!trustedPrior || !flush) throw error;
          pendingWriteFailed = true;
          await removeAndProve('install-stamp pending claim write failed', error);
        }
      }
      if (state.epoch === epoch) state.materialized = wrotePending;

      if (trustedPrior && flush && !pendingWriteFailed) {
        let report: PersistFailureReport | undefined;
        try {
          report = await flush();
        } catch (error) {
          return restoreAndThrow('install-stamp demote durability check failed', error);
        }
        if (claimFailed(report, input.root)) {
          await removeAndProve('install-stamp demote was not durable');
        }
      }
      return {
        root: input.root,
        slug: input.slug,
        epoch,
        ...(prior ? { priorSlug: prior.slug } : {}),
      };
    });
  };

  const prepareTreeMutation = (rawClaim: InstallStampClaim): Promise<void> => {
    const claim = { ...rawClaim, root: canonicalAuthorityRoot(rawClaim.root) };
    const state = stateFor(claim.root);
    return enqueue(state, async () => {
      if (state.phase !== 'pending' || state.epoch !== claim.epoch || state.slug !== claim.slug) {
        throw new InstallStampAuthorityError(
          'INSTALL_STAMP_MUTATION_CLAIM_STALE',
          `install-stamp tree mutation claim is stale for ${claim.root}`,
        );
      }
      if (!state.materialized) return;
      const stamp = await readStamp(io, claim.root);
      if (!isCurrentPendingClaim(state, stamp, claim.epoch)) {
        throw new InstallStampAuthorityError(
          'INSTALL_STAMP_MUTATION_CLAIM_STALE',
          `install-stamp tree mutation claim was replaced for ${claim.root}`,
        );
      }
      await removeStamp(io, claim.root);
      state.materialized = false;
    });
  };

  const promote = async (
    rawIdentity: InstallStampIdentity,
    transition: InstallStampPromoteOptions,
  ): Promise<InstallStampPromotionResult> => {
    const identity = { ...rawIdentity, root: canonicalAuthorityRoot(rawIdentity.root) };
    const state = stateFor(identity.root);
    const { epoch, packages, flush } = transition;
    if (state.epoch !== epoch) return { status: 'stale' };
    if (state.slug !== identity.slug) return { status: 'refused', reason: 'claim-replaced' };

    // Project restore replaces node_modules synchronously, including the
    // pending file. Re-materialise the SAME epoch before yielding to its
    // background drain: the initial demote still owns mutation-time fencing;
    // issuing a new post-mutation epoch would let an interleaved writer win by
    // wall-clock luck. The sync owner surface makes this visible immediately.
    if (
      io.fsSync &&
      readStampSync(io.fsSync, identity.root) === null &&
      io.fsSync.existsSync(installTreeDir(identity.root))
    ) {
      const pending = pendingStamp(identity, epoch, packages);
      writeRawStampSync(
        io,
        identity.root,
        enc.encode(`${JSON.stringify(pending, null, 2)}\n`),
        true,
      );
      state.materialized = true;
    }

    const admitted = await enqueue(state, async () => {
      if (state.epoch !== epoch || state.slug !== identity.slug) return false;
      let stamp = await readStamp(io, identity.root);
      const treeExists = await pathExists(io, installTreeDir(identity.root));
      if (stamp === null && treeExists) {
        await writeRawStamp(io, identity.root, pendingStamp(identity, epoch, packages), true);
        stamp = await readStamp(io, identity.root);
        state.materialized = true;
      }
      return isCurrentPendingClaim(state, stamp, epoch);
    });
    if (!admitted) {
      return state.epoch === epoch
        ? { status: 'refused', reason: 'claim-replaced' }
        : { status: 'stale' };
    }

    // One full-ledger proof while pending is sufficient. The serialized slot
    // below rechecks epoch, exact identity, tree, and claim before publishing
    // trusted as the final commit marker.
    let proofReport: PersistFailureReport | undefined;
    if (flush) {
      try {
        proofReport = await flush();
      } catch (error) {
        return {
          status: 'refused',
          reason: 'flush-failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const conclusion = await enqueue(state, async () => {
      if (state.epoch !== epoch || state.slug !== identity.slug) {
        return { kind: 'stale' as const };
      }
      if (guardedScopeFailed(proofReport, identity.root)) {
        state.phase = 'pending';
        return { kind: 'guarded-failure' as const, report: proofReport };
      }
      if (claimFailed(proofReport, identity.root) && state.materialized) {
        state.phase = 'pending';
        return { kind: 'claim-failed' as const, report: proofReport };
      }
      const currentText = await readText(io, joinPath(identity.root, 'package.json'));
      const treeExists = await pathExists(io, installTreeDir(identity.root));
      const pending = await readStamp(io, identity.root);
      if (state.epoch !== epoch || state.slug !== identity.slug) {
        return { kind: 'stale' as const };
      }
      if (currentText !== identity.packageJsonText) {
        state.phase = 'pending';
        return { kind: 'identity-drift' as const };
      }
      if (!treeExists) {
        state.phase = 'absent';
        state.epoch = null;
        state.slug = null;
        state.materialized = false;
        return { kind: 'tree-missing' as const };
      }
      if (!isCurrentPendingClaim(state, pending, epoch)) {
        return { kind: 'claim-replaced' as const };
      }
      const lockfileBytes = await readLockfileBytesIo(io, identity.root);
      if (state.epoch !== epoch || state.slug !== identity.slug) {
        return { kind: 'stale' as const };
      }
      const stamp = trustedStamp(
        identity,
        packages,
        lockfileBytes === null ? undefined : sha256Hex(lockfileBytes),
      );
      try {
        await writeRawStamp(io, identity.root, stamp, false);
      } catch (error) {
        state.phase = 'pending';
        return {
          kind: 'write-failed' as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (state.epoch !== epoch || state.slug !== identity.slug) {
        return { kind: 'stale' as const };
      }
      state.phase = 'trusted';
      state.epoch = null;
      state.slug = identity.slug;
      state.materialized = false;
      return { kind: 'trusted' as const, stamp };
    });

    if (conclusion.kind === 'stale') return { status: 'stale' };
    if (conclusion.kind === 'trusted') return { status: 'trusted', stamp: conclusion.stamp };
    if (conclusion.kind === 'claim-failed') {
      return { status: 'refused', reason: 'claim-not-durable', report: conclusion.report };
    }
    if (conclusion.kind === 'guarded-failure') {
      return {
        status: 'refused',
        reason: 'guarded-scope-not-durable',
        report: conclusion.report,
      };
    }
    if (conclusion.kind === 'identity-drift') {
      return { status: 'refused', reason: 'identity-drift' };
    }
    if (conclusion.kind === 'tree-missing') {
      return { status: 'refused', reason: 'tree-missing' };
    }
    if (conclusion.kind === 'claim-replaced') {
      return { status: 'refused', reason: 'claim-replaced' };
    }
    if (conclusion.kind === 'write-failed') {
      return { status: 'refused', reason: 'write-failed', error: conclusion.error };
    }
    return unreachable(conclusion);
  };

  const revoke = (
    rawInput: { readonly root: string },
    options: InstallStampTransitionOptions = {},
  ): Promise<void> => {
    const input = { root: canonicalAuthorityRoot(rawInput.root) };
    const state = stateFor(input.root);
    const transitionId = ++state.transition;
    state.phase = 'absent';
    state.epoch = null;
    state.slug = null;
    state.materialized = false;
    return enqueue(state, async () => {
      const prior = await readStamp(io, input.root);
      const restorePrior = (): Promise<void> =>
        restoreStampForTransition(state, transitionId, input.root, prior);
      await removeStamp(io, input.root);
      if (!options.flush) return;
      let report: PersistFailureReport | undefined;
      try {
        report = await options.flush();
      } catch (error) {
        await restorePrior();
        throw new InstallStampAuthorityError(
          'INSTALL_STAMP_REVOKE_UNPROVEN',
          'install-stamp revoke durability check failed',
          { cause: error },
        );
      }
      if (claimFailed(report, input.root)) {
        await restorePrior();
        throw new InstallStampAuthorityError(
          'INSTALL_STAMP_REVOKE_UNPROVEN',
          'install-stamp revoke was not durable',
        );
      }
    });
  };

  return { check, checkSync, demote, prepareTreeMutation, promote, revoke };
}
