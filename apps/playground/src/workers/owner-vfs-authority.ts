import {
  type FsSync,
  type PersistFailureReport,
  VfsError,
  dirname,
  isAbsolute,
  joinPath,
  normalizePath,
} from '@riftydev/vfs';
import type { InstallStampClaimIo } from '../glue/install-stamp-authority.ts';
import { installStampPath, installTreeDir, isInstallStampPath } from '../glue/install-stamp.ts';
import {
  type OwnerVfsCommitTerminal,
  encodeOwnerVfsError,
  equalOwnerVfsCommitTerminals,
} from '../glue/owner-vfs-ipc.ts';
import {
  type HostCommitAck,
  type HostCommitRequest,
  OperationIdReuseError,
  type OwnerEpoch,
  type OwnerVfsSnapshot,
  type OwnerVfsSnapshotEntry,
  type PathVersion,
  type TreeRevision,
  VfsCommitProtocolError,
  VfsVersionConflictError,
  equalHostCommitAcks,
  equalHostCommitRequests,
} from '../glue/owner-vfs-protocol.ts';

interface TrackedEntry {
  readonly kind: 'file' | 'dir';
  readonly version: PathVersion;
}

interface HostCommitRecord {
  readonly request: HostCommitRequest;
  ack: HostCommitAck | null;
  outcome: Promise<OwnerVfsCommitTerminal> | null;
  terminal: OwnerVfsCommitTerminal | null;
}

interface CopyPlanEntry {
  readonly source: string;
  readonly target: string;
  readonly kind: 'file' | 'dir';
}

export interface OwnerVfsAuthorityOptions {
  /** Tests/composition may supply the already-generated owner nonce. */
  readonly ownerEpoch?: OwnerEpoch;
  /** Logical roots visible through wrappers even when they are not children of `/`. */
  readonly initialRoots?: readonly string[];
}

/**
 * Sole owner-realm mutation adapter. The raw FsSync must not escape its
 * composition root: same-content external writes are inherently unobservable.
 */
export interface OwnerVfsAuthority extends FsSync {
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
  versionOf(path: string): PathVersion | null;
  snapshot(): OwnerVfsSnapshot;
  /** Validate idempotency + CAS without mutating. A replay returns its prior ack. */
  validateHostCommit(request: HostCommitRequest): HostCommitAck | null;
  applyHostCommit(request: HostCommitRequest): HostCommitAck;
  /** One exact request admission owns apply, publication, and the retained terminal. */
  admitHostCommit(
    request: HostCommitRequest,
    apply: (request: HostCommitRequest) => HostCommitAck | Promise<HostCommitAck>,
    publishSnapshot: () => void,
  ): Promise<OwnerVfsCommitTerminal>;
  retainHostCommitTerminal(terminal: OwnerVfsCommitTerminal): void;
  retainedHostCommitTerminal(operationId: string): OwnerVfsCommitTerminal | null;
  /** Exact release confirmation ends replay ownership; missing is idempotent. */
  cleanupHostCommitTerminal(terminal: OwnerVfsCommitTerminal): void;
  /** Preflight actual absolute ingress targets before any batch mutation. */
  assertPortablePaths(paths: readonly string[]): void;
  flush(): Promise<PersistFailureReport | undefined>;
}

export interface OwnerVfsAuthorityComposition {
  readonly authority: OwnerVfsAuthority;
  readonly installStampClaims: InstallStampClaimIo;
}

interface FlushableFsSync extends FsSync {
  flush?: () => Promise<PersistFailureReport | undefined>;
}

function normalizeOwnerPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`VFS path must be absolute (ADR-0199); got: '${path}'`);
  }
  return normalizePath(path);
}

function createOwnerEpoch(): OwnerEpoch {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('owner VFS authority requires cryptographic randomness for its epoch');
}

function cloneRequest(request: HostCommitRequest): HostCommitRequest {
  return request.kind === 'write' ? { ...request, data: request.data.slice() } : { ...request };
}

function pathDepth(path: string): number {
  return path === '/' ? 0 : path.split('/').length - 1;
}

function descendantOf(path: string, root: string): boolean {
  return root === '/' ? path !== '/' : path.startsWith(`${root}/`);
}

export function createOwnerVfsAuthority(
  fs: FsSync,
  options: OwnerVfsAuthorityOptions = {},
): OwnerVfsAuthority {
  return new OwnerVfsAuthorityImpl(fs, options);
}

/** Composition root keeps reserved-claim privilege off the ordinary FsSync surface. */
export function createOwnerVfsAuthorityComposition(
  fs: FsSync,
  options: OwnerVfsAuthorityOptions = {},
): OwnerVfsAuthorityComposition {
  let installStampClaims: InstallStampClaimIo | undefined;
  const authority = new OwnerVfsAuthorityImpl(fs, options, (claims) => {
    installStampClaims = claims;
  });
  if (!installStampClaims) throw new Error('owner VFS claim capability was not constructed');
  return Object.freeze({ authority, installStampClaims });
}

class OwnerVfsAuthorityImpl implements OwnerVfsAuthority {
  readonly #fs: FsSync;
  readonly #initialRoots: readonly string[];
  readonly #entries = new Map<string, TrackedEntry>();
  readonly #hostCommits = new Map<string, HostCommitRecord>();
  #treeRevision: TreeRevision = 0;
  #versionSequence = 0n;
  readonly ownerEpoch: OwnerEpoch;

  constructor(
    fs: FsSync,
    options: OwnerVfsAuthorityOptions,
    receiveInstallStampClaims?: (claims: InstallStampClaimIo) => void,
  ) {
    this.#fs = fs;
    this.ownerEpoch = options.ownerEpoch ?? createOwnerEpoch();
    if (this.ownerEpoch.length === 0) throw new Error('owner VFS epoch must be non-empty');
    this.#initialRoots = [...new Set((options.initialRoots ?? ['/']).map(normalizeOwnerPath))].sort(
      (left, right) => pathDepth(right) - pathDepth(left),
    );
    if (!this.#initialRoots.includes('/'))
      throw new Error('owner VFS initial roots must include /');
    const assigned = new Set<string>();
    for (const root of this.#initialRoots) {
      if (this.#fs.statSyncOrNull(root) !== null) {
        this.#assignSubtree(root, this.#treeRevision, assigned);
      }
    }
    const installStampClaims: InstallStampClaimIo = Object.freeze({
      read: (root: string) => this.#readInstallStampClaim(root),
      write: (root: string, data: Uint8Array, claimOptions: { readonly mkdirTree: boolean }) =>
        this.#writeInstallStampClaim(root, data, claimOptions),
      remove: (root: string) => this.#removeInstallStampClaim(root),
    });
    receiveInstallStampClaims?.(installStampClaims);
  }

  get treeRevision(): TreeRevision {
    return this.#treeRevision;
  }

  existsSync(path: string): boolean {
    return this.#fs.existsSync(path);
  }

  readFileBytesSync(path: string): Uint8Array {
    return this.#fs.readFileBytesSync(path).slice();
  }

  readdirSync(path: string): ReturnType<FsSync['readdirSync']> {
    return this.#fs.readdirSync(path).map((entry) => ({ ...entry }));
  }

  statSync(path: string): ReturnType<FsSync['statSync']> {
    return this.#fs.statSync(path);
  }

  statSyncOrNull(path: string): ReturnType<FsSync['statSyncOrNull']> {
    return this.#fs.statSyncOrNull(path);
  }

  async flush(): Promise<PersistFailureReport | undefined> {
    const flush = (this.#fs as FlushableFsSync).flush;
    return typeof flush === 'function' ? await flush.call(this.#fs) : undefined;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    const normalized = normalizeOwnerPath(path);
    this.assertPortablePaths([normalized]);
    this.#assertRevisionAvailable();
    this.#fs.writeFileSync(normalized, data.slice());
    this.#recordMutation([normalized]);
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    const normalized = normalizeOwnerPath(path);
    this.assertPortablePaths([normalized]);
    const missing = this.#missingDirectories(normalized);
    if (missing.length > 0) this.#assertRevisionAvailable();
    this.#fs.mkdirSync(normalized, options);
    if (missing.length > 0) this.#recordMutation(missing);
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    const normalized = normalizeOwnerPath(path);
    this.assertPortablePaths([normalized]);
    const nestedClaim = this.#firstInstallStampInSubtree(normalized);
    if (nestedClaim) throw this.#reservedClaimError(nestedClaim);
    const tracked = this.#trackedSubtree(normalized);
    if (tracked.length > 0) this.#assertRevisionAvailable();
    this.#fs.rmSync(normalized, options);
    const rootStillExists = this.#fs.statSyncOrNull(normalized) !== null;
    const removed = tracked.filter((item) => item !== normalized || !rootStillExists);
    if (removed.length > 0) {
      this.#recordMutation([this.#parentWithinRoot(normalized)], removed);
    }
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    const normalized = normalizeOwnerPath(path);
    this.assertPortablePaths([normalized]);
    if (this.#entries.has(normalized)) this.#assertRevisionAvailable();
    this.#fs.utimes(normalized, atimeMs, mtimeMs);
    this.#recordMutation([normalized]);
  }

  copyFileSync(src: string, dst: string): void {
    const source = normalizeOwnerPath(src);
    const target = normalizeOwnerPath(dst);
    this.assertPortablePaths([source, target]);
    this.#assertRevisionAvailable();
    this.#fs.copyFileSync(source, target);
    this.#recordMutation([target]);
  }

  cpSync(src: string, dst: string, options: { recursive?: boolean } = {}): void {
    const source = normalizeOwnerPath(src);
    const target = normalizeOwnerPath(dst);
    this.assertPortablePaths([source, target]);
    const sourceStat = this.#fs.statSync(source);
    if (sourceStat.isFile) {
      this.copyFileSync(source, target);
      return;
    }
    if (!options.recursive) throw new VfsError('EISDIR', src);
    if (
      target === source ||
      (this.#logicalRoot(target) === this.#logicalRoot(source) && descendantOf(target, source))
    ) {
      throw new VfsError('EINVAL', src);
    }

    const plan = this.#planRecursiveCopy(source, target);
    // Applying remains FsSync-best-effort. The complete mapping and reserved
    // exclusions are fixed before the first byte changes.
    for (const entry of plan) {
      if (entry.kind === 'dir') this.mkdirSync(entry.target, { recursive: true });
      else this.copyFileSync(entry.source, entry.target);
    }
  }

  renameSync(src: string, dst: string): void {
    const source = normalizeOwnerPath(src);
    const target = normalizeOwnerPath(dst);
    this.assertPortablePaths([source, target]);
    if (source === target) {
      this.#fs.renameSync(source, target);
      return;
    }
    const carriedClaim =
      this.#firstInstallStampInTransfer(source, target) ?? this.#firstInstallStampInSubtree(target);
    if (carriedClaim) throw this.#reservedClaimError(carriedClaim);
    this.#assertRevisionAvailable();
    const removed = [...this.#trackedSubtree(source), ...this.#trackedSubtree(target)];
    this.#fs.renameSync(source, target);
    this.#recordMutation(
      [this.#parentWithinRoot(source), this.#parentWithinRoot(target)],
      removed,
      [target],
    );
  }

  versionOf(path: string): PathVersion | null {
    return this.#entries.get(normalizeOwnerPath(path))?.version ?? null;
  }

  snapshot(): OwnerVfsSnapshot {
    const entries = [...this.#entries.keys()]
      .sort((left, right) => left.localeCompare(right))
      .map((path) => this.#snapshotEntry(path));
    return {
      ownerEpoch: this.ownerEpoch,
      treeRevision: this.#treeRevision,
      entries,
    };
  }

  assertPortablePaths(paths: readonly string[]): void {
    const normalized = paths.map(normalizeOwnerPath);
    const reserved = normalized.find(isInstallStampPath);
    if (reserved) throw this.#reservedClaimError(reserved);
  }

  validateHostCommit(request: HostCommitRequest): HostCommitAck | null {
    if (request.operationId.length === 0) throw new Error('VFS operation id must be non-empty');
    const prior = this.#hostCommits.get(request.operationId);
    if (prior) {
      if (!equalHostCommitRequests(prior.request, request)) {
        throw new OperationIdReuseError(request.operationId);
      }
      if (prior.ack) return prior.ack;
    }

    switch (request.kind) {
      case 'write':
      case 'mkdir':
      case 'remove': {
        const path = normalizeOwnerPath(request.path);
        this.assertPortablePaths([path]);
        this.#assertExpected(path, request.expectedVersion);
        break;
      }
      case 'rename': {
        const source = normalizeOwnerPath(request.sourcePath);
        const target = normalizeOwnerPath(request.targetPath);
        this.assertPortablePaths([source, target]);
        this.#assertExpected(source, request.expectedSourceVersion);
        this.#assertExpected(target, request.expectedTargetVersion);
        break;
      }
    }
    return null;
  }

  applyHostCommit(request: HostCommitRequest): HostCommitAck {
    const replay = this.validateHostCommit(request);
    if (replay) return replay;

    let versions: readonly { readonly path: string; readonly version: PathVersion | null }[];
    switch (request.kind) {
      case 'write': {
        const path = normalizeOwnerPath(request.path);
        this.writeFileSync(path, request.data);
        versions = [{ path, version: this.#requiredVersion(path) }];
        break;
      }
      case 'mkdir': {
        const path = normalizeOwnerPath(request.path);
        this.mkdirSync(path, { recursive: false });
        versions = [{ path, version: this.#requiredVersion(path) }];
        break;
      }
      case 'remove': {
        const path = normalizeOwnerPath(request.path);
        this.rmSync(path, { recursive: request.recursive ?? false, force: false });
        versions = [{ path, version: null }];
        break;
      }
      case 'rename': {
        const source = normalizeOwnerPath(request.sourcePath);
        const target = normalizeOwnerPath(request.targetPath);
        this.renameSync(source, target);
        versions =
          source === target
            ? [{ path: target, version: this.#requiredVersion(target) }]
            : [
                { path: source, version: null },
                { path: target, version: this.#requiredVersion(target) },
              ];
        break;
      }
    }

    const ack: HostCommitAck = Object.freeze({
      operationId: request.operationId,
      ownerEpoch: this.ownerEpoch,
      treeRevision: this.#treeRevision,
      versions: Object.freeze(versions.map((item) => Object.freeze({ ...item }))),
    });
    const prior = this.#hostCommits.get(request.operationId);
    if (prior) prior.ack = ack;
    else {
      this.#hostCommits.set(request.operationId, {
        request: cloneRequest(request),
        ack,
        outcome: null,
        terminal: null,
      });
    }
    return ack;
  }

  admitHostCommit(
    request: HostCommitRequest,
    apply: (request: HostCommitRequest) => HostCommitAck | Promise<HostCommitAck>,
    publishSnapshot: () => void,
  ): Promise<OwnerVfsCommitTerminal> {
    const prior = this.#hostCommits.get(request.operationId);
    if (prior) {
      if (!equalHostCommitRequests(prior.request, request)) {
        return Promise.resolve({
          type: 'rifty:owner-vfs-commit-ack',
          operationId: request.operationId,
          ok: false,
          error: encodeOwnerVfsError(new OperationIdReuseError(request.operationId)),
        });
      }
      if (prior.outcome) return prior.outcome;
    }

    const record: HostCommitRecord = prior ?? {
      request: cloneRequest(request),
      ack: null,
      outcome: null,
      terminal: null,
    };
    if (!prior) this.#hostCommits.set(request.operationId, record);

    let resolveOutcome: (terminal: OwnerVfsCommitTerminal) => void = () => {};
    const outcome = new Promise<OwnerVfsCommitTerminal>((resolve) => {
      resolveOutcome = resolve;
    });
    record.outcome = outcome;
    const finish = (terminal: OwnerVfsCommitTerminal): void => {
      if (record.terminal) return;
      record.terminal = terminal;
      resolveOutcome(terminal);
    };
    const fail = (cause: unknown, applied: HostCommitAck | null = record.ack): void => {
      finish({
        type: 'rifty:owner-vfs-commit-ack',
        operationId: request.operationId,
        ok: false,
        error: encodeOwnerVfsError(cause),
        ...(applied ? { applied } : {}),
      });
    };
    const succeed = (ack: HostCommitAck): void => {
      if (record.ack === null || !equalHostCommitAcks(record.ack, ack)) {
        fail(
          new VfsCommitProtocolError(
            `VFS commit ${request.operationId} executor returned divergent ACK evidence`,
          ),
          record.ack,
        );
        return;
      }
      try {
        publishSnapshot();
      } catch (cause) {
        fail(cause, ack);
        return;
      }
      finish({
        type: 'rifty:owner-vfs-commit-ack',
        operationId: request.operationId,
        ok: true,
        ack,
      });
    };

    let applied: HostCommitAck | Promise<HostCommitAck>;
    try {
      applied = apply(record.request);
    } catch (cause) {
      fail(cause);
      return outcome;
    }
    void Promise.resolve(applied).then(succeed, fail);
    return outcome;
  }

  retainHostCommitTerminal(terminal: OwnerVfsCommitTerminal): void {
    const prior = this.#hostCommits.get(terminal.operationId);
    if (!prior) throw new OperationIdReuseError(terminal.operationId);
    const ack = terminal.ok ? terminal.ack : terminal.applied;
    if (ack && (prior.ack === null || !equalHostCommitAcks(prior.ack, ack))) {
      throw new OperationIdReuseError(terminal.operationId);
    }
    if (prior.terminal && !equalOwnerVfsCommitTerminals(prior.terminal, terminal)) {
      throw new OperationIdReuseError(terminal.operationId);
    }
    prior.terminal = terminal;
  }

  retainedHostCommitTerminal(operationId: string): OwnerVfsCommitTerminal | null {
    return this.#hostCommits.get(operationId)?.terminal ?? null;
  }

  cleanupHostCommitTerminal(terminal: OwnerVfsCommitTerminal): void {
    const prior = this.#hostCommits.get(terminal.operationId);
    if (!prior) return;
    if (prior.terminal === null || !equalOwnerVfsCommitTerminals(prior.terminal, terminal)) {
      throw new OperationIdReuseError(terminal.operationId);
    }
    this.#hostCommits.delete(terminal.operationId);
  }

  #reservedClaimError(path: string): VfsError {
    return new VfsError(
      'EPERM',
      path,
      `EPERM: reserved install-stamp authority claim path: ${path}`,
    );
  }

  #canonicalInstallStampRoot(root: string): string {
    const canonical = normalizeOwnerPath(root);
    if (canonical !== root) {
      throw new Error(`install-stamp claim root must be canonical; got: '${root}'`);
    }
    this.#logicalRoot(canonical);
    return canonical;
  }

  #readInstallStampClaim(root: string): Uint8Array | null {
    const canonical = this.#canonicalInstallStampRoot(root);
    const path = installStampPath(canonical);
    if (!this.#fs.existsSync(path)) return null;
    return this.#fs.readFileBytesSync(path).slice();
  }

  #writeInstallStampClaim(
    root: string,
    data: Uint8Array,
    options: { readonly mkdirTree: boolean },
  ): void {
    const canonical = this.#canonicalInstallStampRoot(root);
    if (options.mkdirTree) this.mkdirSync(installTreeDir(canonical), { recursive: true });
    const path = installStampPath(canonical);
    this.#assertRevisionAvailable();
    this.#fs.writeFileSync(path, data.slice());
    this.#recordClaimMutation(path);
  }

  #removeInstallStampClaim(root: string): void {
    const canonical = this.#canonicalInstallStampRoot(root);
    const path = installStampPath(canonical);
    const tracked = this.#trackedSubtree(path);
    if (tracked.length > 0) this.#assertRevisionAvailable();
    this.#fs.rmSync(path, { recursive: true, force: true });
    if (tracked.length > 0) {
      this.#recordClaimMutation(path, tracked);
    }
  }

  #planRecursiveCopy(source: string, target: string): readonly CopyPlanEntry[] {
    const plan: CopyPlanEntry[] = [];
    const visit = (currentSource: string, currentTarget: string): void => {
      if (isInstallStampPath(currentSource)) return;
      if (isInstallStampPath(currentTarget)) throw this.#reservedClaimError(currentTarget);
      const stat = this.#fs.statSync(currentSource);
      if (stat.isFile) {
        plan.push({ source: currentSource, target: currentTarget, kind: 'file' });
        return;
      }
      plan.push({ source: currentSource, target: currentTarget, kind: 'dir' });
      const children = [...this.#fs.readdirSync(currentSource)].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const child of children) {
        visit(joinPath(currentSource, child.name), joinPath(currentTarget, child.name));
      }
    };
    visit(source, target);
    return plan;
  }

  #firstInstallStampInSubtree(root: string): string | null {
    if (isInstallStampPath(root)) return root;
    const stat = this.#fs.statSyncOrNull(root);
    if (!stat?.isDirectory) return null;
    const children = [...this.#fs.readdirSync(root)].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const child of children) {
      const found = this.#firstInstallStampInSubtree(joinPath(root, child.name));
      if (found) return found;
    }
    return null;
  }

  #firstInstallStampInTransfer(source: string, target: string): string | null {
    if (isInstallStampPath(source)) return source;
    if (isInstallStampPath(target)) return target;
    const stat = this.#fs.statSync(source);
    if (!stat.isDirectory) return null;
    const children = [...this.#fs.readdirSync(source)].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const child of children) {
      const found = this.#firstInstallStampInTransfer(
        joinPath(source, child.name),
        joinPath(target, child.name),
      );
      if (found) return found;
    }
    return null;
  }

  #assertRevisionAvailable(): void {
    if (this.#treeRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error('owner VFS tree revision exhausted');
    }
  }

  #newVersion(revision: TreeRevision): PathVersion {
    this.#versionSequence += 1n;
    return `${this.ownerEpoch}:${revision.toString(36)}:${this.#versionSequence.toString(36)}`;
  }

  #missingDirectories(path: string): string[] {
    const root = this.#logicalRoot(path);
    const missing: string[] = [];
    if (!this.#entries.has(root)) missing.push(root);
    if (path === root) return missing;
    let current = root;
    const relative = root === '/' ? path.slice(1) : path.slice(root.length + 1);
    for (const segment of relative.split('/')) {
      current = joinPath(current, segment);
      if (!this.#entries.has(current)) missing.push(current);
    }
    return missing;
  }

  #trackedSubtree(root: string): string[] {
    const logicalRoot = this.#logicalRoot(root);
    const paths: string[] = [];
    for (const path of this.#entries.keys()) {
      if (this.#logicalRoot(path) === logicalRoot && (path === root || descendantOf(path, root))) {
        paths.push(path);
      }
    }
    return paths;
  }

  #logicalRoot(path: string): string {
    const found = this.#initialRoots.find(
      (candidate) => path === candidate || descendantOf(path, candidate),
    );
    if (found === undefined) throw new Error(`VFS path has no authority root: ${path}`);
    return found;
  }

  #parentWithinRoot(path: string): string {
    const root = this.#logicalRoot(path);
    return path === root ? root : dirname(path);
  }

  #recordMutation(
    touched: readonly string[],
    removed: readonly string[] = [],
    refreshSubtrees: readonly string[] = [],
  ): void {
    this.#treeRevision += 1;
    const revision = this.#treeRevision;
    for (const path of removed) this.#entries.delete(path);

    const assigned = new Set<string>();
    for (const root of refreshSubtrees) this.#assignSubtree(root, revision, assigned);
    const paths = new Set<string>();
    for (const candidate of touched) {
      let path = normalizeOwnerPath(candidate);
      const root = this.#logicalRoot(path);
      paths.add(path);
      while (path !== root) {
        path = dirname(path);
        paths.add(path);
      }
    }
    for (const path of [...paths].sort((left, right) => pathDepth(right) - pathDepth(left))) {
      if (assigned.has(path)) continue;
      const stat = this.#fs.statSyncOrNull(path);
      if (stat === null) {
        this.#entries.delete(path);
        continue;
      }
      this.#entries.set(path, {
        kind: stat.isDirectory ? 'dir' : 'file',
        version: this.#newVersion(revision),
      });
      assigned.add(path);
    }
  }

  /** Claims are hidden authority metadata. Their revision is observable for
   * durability/reflection, but changing one must not invalidate guest CAS on
   * an otherwise byte-identical ancestor. */
  #recordClaimMutation(path: string, removed: readonly string[] = []): void {
    this.#treeRevision += 1;
    const revision = this.#treeRevision;
    for (const item of removed) this.#entries.delete(item);
    const stat = this.#fs.statSyncOrNull(path);
    if (stat === null) {
      this.#entries.delete(path);
      return;
    }
    this.#entries.set(path, {
      kind: stat.isDirectory ? 'dir' : 'file',
      version: this.#newVersion(revision),
    });
  }

  #assignSubtree(path: string, revision: TreeRevision, assigned: Set<string>): void {
    if (assigned.has(path)) return;
    const stat = this.#fs.statSync(path);
    this.#entries.set(path, {
      kind: stat.isDirectory ? 'dir' : 'file',
      version: this.#newVersion(revision),
    });
    assigned.add(path);
    if (!stat.isDirectory) return;
    const children = [...this.#fs.readdirSync(path)].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const child of children) {
      this.#assignSubtree(joinPath(path, child.name), revision, assigned);
    }
  }

  #snapshotEntry(path: string): OwnerVfsSnapshotEntry {
    const tracked = this.#entries.get(path);
    if (!tracked) throw new Error(`owner VFS version missing for ${path}`);
    const stat = this.#fs.statSync(path);
    if (tracked.kind === 'dir') {
      if (!stat.isDirectory) throw new Error(`owner VFS kind drift at ${path}`);
      return { path, kind: 'dir', size: 0, version: tracked.version };
    }
    if (!stat.isFile) throw new Error(`owner VFS kind drift at ${path}`);
    const content = this.#fs.readFileBytesSync(path).slice();
    return {
      path,
      kind: 'file',
      size: content.byteLength,
      content,
      version: tracked.version,
    };
  }

  #requiredVersion(path: string): PathVersion {
    const version = this.#entries.get(path)?.version;
    if (version === undefined) throw new Error(`owner VFS commit lost path ${path}`);
    return version;
  }

  #assertExpected(path: string, expectedVersion: PathVersion | null): void {
    const actualVersion = this.#entries.get(path)?.version ?? null;
    if (actualVersion === expectedVersion) return;
    const actualEntry = actualVersion === null ? null : this.#snapshotEntry(path);
    throw new VfsVersionConflictError({
      path,
      expectedVersion,
      actualVersion,
      actualEntry,
      ownerEpoch: this.ownerEpoch,
      treeRevision: this.#treeRevision,
    });
  }
}
