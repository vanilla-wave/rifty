import { type VfsMutationIntent, isAbsolute, normalizePath } from '@riftydev/vfs';
import type { OwnerEpoch, TreeRevision } from '../glue/owner-vfs-protocol.ts';

export type OwnerVfsAppliedMutation =
  | {
      readonly kind: 'rename';
      readonly sourcePath: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: 'remove';
      readonly path: string;
      readonly recursive: boolean;
    }
  | {
      readonly kind: 'reset';
      readonly rootPath: string;
    };

export interface OwnerVfsAppliedRevision {
  readonly ownerEpoch: OwnerEpoch;
  readonly treeRevision: TreeRevision;
  readonly mutations: readonly OwnerVfsAppliedMutation[];
}

export interface OwnerVfsAppliedCursor {
  peek(): readonly OwnerVfsAppliedRevision[];
  acknowledge(throughTreeRevision: TreeRevision): void;
  wait(): Promise<void>;
  close(): void;
}

export interface OwnerVfsAppliedMutations {
  openCursor(): OwnerVfsAppliedCursor;
  withStructuralReset<T>(rootPath: string, apply: () => T | Promise<T>): Promise<T>;
  withSemanticReplacements<T>(
    intents: readonly VfsMutationIntent[],
    apply: () => T | Promise<T>,
  ): Promise<T>;
}

interface PendingWait {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
}

interface BufferedRevision {
  readonly record: OwnerVfsAppliedRevision;
  readonly ordinary: boolean;
  readonly contentWritePaths: readonly string[];
}

interface ExplicitResetScope {
  readonly kind: 'explicit-reset';
  readonly rootPath: string;
  readonly records: BufferedRevision[];
}

interface SemanticCandidate {
  readonly kind: 'ordinary' | 'replace';
  readonly path: string;
}

interface SemanticReplacementScope {
  readonly kind: 'semantic-replacements';
  readonly candidates: readonly SemanticCandidate[];
  readonly records: BufferedRevision[];
}

type AppliedScope = ExplicitResetScope | SemanticReplacementScope;

export interface OwnerVfsAppliedJournal {
  readonly appliedMutations: OwnerVfsAppliedMutations;
  recordOrdinaryRevision(
    treeRevision: TreeRevision,
    mutations?: readonly OwnerVfsAppliedMutation[],
    contentWritePaths?: readonly string[],
  ): void;
  recordClaimRevision(treeRevision: TreeRevision): void;
}

function freezeMutation(mutation: OwnerVfsAppliedMutation): OwnerVfsAppliedMutation {
  return Object.freeze({ ...mutation });
}

function freezeRevision(
  ownerEpoch: OwnerEpoch,
  treeRevision: TreeRevision,
  mutations: readonly OwnerVfsAppliedMutation[],
): OwnerVfsAppliedRevision {
  return Object.freeze({
    ownerEpoch,
    treeRevision,
    mutations: Object.freeze(mutations.map(freezeMutation)),
  });
}

function canonicalResetRoot(rootPath: string): string {
  if (!isAbsolute(rootPath)) {
    throw new Error(`owner VFS structural reset root must be absolute; got: '${rootPath}'`);
  }
  const canonical = normalizePath(rootPath);
  if (canonical !== rootPath) {
    throw new Error(`owner VFS structural reset root must be canonical; got: '${rootPath}'`);
  }
  return canonical;
}

function containsPath(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

function canonicalSemanticPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`owner VFS semantic scope path must be absolute; got: '${path}'`);
  }
  const canonical = normalizePath(path);
  if (canonical !== path) {
    throw new Error(`owner VFS semantic scope path must be canonical; got: '${path}'`);
  }
  return canonical;
}

function semanticCandidates(intents: readonly VfsMutationIntent[]): readonly SemanticCandidate[] {
  if (intents.length === 0) throw new Error('owner VFS semantic scope requires mutation intents');
  const candidates = new Map<string, SemanticCandidate['kind']>();
  const add = (kind: SemanticCandidate['kind'], rawPath: string): void => {
    const path = canonicalSemanticPath(rawPath);
    const prior = candidates.get(path);
    if (prior !== undefined && prior !== kind) {
      throw new Error(`owner VFS conflicting semantic intents for ${path}`);
    }
    candidates.set(path, kind);
  };
  for (const intent of intents) {
    if (intent.kind === 'replace') add('replace', intent.path);
    else if (intent.kind === 'write') add('ordinary', intent.path);
    else if (intent.kind === 'copy') add('ordinary', intent.targetPath);
  }
  return Object.freeze([...candidates].map(([path, kind]) => Object.freeze({ kind, path })));
}

function semanticWinner(
  candidates: readonly SemanticCandidate[],
  contentWritePath: string,
): SemanticCandidate | null {
  let winner: SemanticCandidate | null = null;
  for (const candidate of candidates) {
    if (!containsPath(candidate.path, contentWritePath)) continue;
    if (winner === null || candidate.path.length > winner.path.length) winner = candidate;
  }
  return winner;
}

function assertTreeRevision(treeRevision: TreeRevision): void {
  if (!Number.isSafeInteger(treeRevision) || treeRevision < 0) {
    throw new Error(`owner VFS tree revision must be a non-negative safe integer: ${treeRevision}`);
  }
}

class AppliedCursor implements OwnerVfsAppliedCursor {
  readonly #journal: AppliedJournal;
  readonly #records: OwnerVfsAppliedRevision[] = [];
  #closed = false;
  #wait: PendingWait | null = null;

  constructor(journal: AppliedJournal) {
    this.#journal = journal;
  }

  peek(): readonly OwnerVfsAppliedRevision[] {
    this.#assertOpen();
    return Object.freeze(this.#records.slice());
  }

  acknowledge(throughTreeRevision: TreeRevision): void {
    this.#assertOpen();
    assertTreeRevision(throughTreeRevision);
    if (throughTreeRevision > this.#journal.latestTreeRevision) {
      throw new Error(
        `owner VFS cursor cannot acknowledge unpublished revision ${throughTreeRevision}`,
      );
    }
    let removeCount = 0;
    while (
      removeCount < this.#records.length &&
      (this.#records[removeCount]?.treeRevision ?? Number.POSITIVE_INFINITY) <= throughTreeRevision
    ) {
      removeCount += 1;
    }
    if (removeCount > 0) this.#records.splice(0, removeCount);
  }

  wait(): Promise<void> {
    if (this.#closed) return Promise.reject(this.#closedError());
    if (this.#records.length > 0) return Promise.resolve();
    if (this.#wait) return this.#wait.promise;

    let resolveWait: (() => void) | undefined;
    let rejectWait: ((reason: Error) => void) | undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    if (!resolveWait || !rejectWait) throw new Error('owner VFS cursor waiter was not constructed');
    this.#wait = { promise, resolve: resolveWait, reject: rejectWait };
    return promise;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#records.length = 0;
    const wait = this.#wait;
    this.#wait = null;
    wait?.reject(this.#closedError());
    this.#journal.release(this);
  }

  publish(record: OwnerVfsAppliedRevision): void {
    if (this.#closed) return;
    this.#records.push(record);
    const wait = this.#wait;
    this.#wait = null;
    wait?.resolve();
  }

  #assertOpen(): void {
    if (this.#closed) throw this.#closedError();
  }

  #closedError(): Error {
    return new Error('owner VFS applied mutation cursor is closed');
  }
}

class AppliedJournal implements OwnerVfsAppliedJournal {
  readonly #ownerEpoch: OwnerEpoch;
  readonly #appliedMutations: OwnerVfsAppliedMutations;
  #activeCursor: AppliedCursor | null = null;
  #latestTreeRevision: TreeRevision = 0;
  #scope: AppliedScope | null = null;

  constructor(ownerEpoch: OwnerEpoch) {
    this.#ownerEpoch = ownerEpoch;
    this.#appliedMutations = Object.freeze({
      openCursor: () => this.#openCursor(),
      withStructuralReset: <T>(rootPath: string, apply: () => T | Promise<T>) =>
        this.#withStructuralReset(rootPath, apply),
      withSemanticReplacements: <T>(
        intents: readonly VfsMutationIntent[],
        apply: () => T | Promise<T>,
      ) => this.#withSemanticReplacements(intents, apply),
    });
  }

  get appliedMutations(): OwnerVfsAppliedMutations {
    return this.#appliedMutations;
  }

  get latestTreeRevision(): TreeRevision {
    return this.#latestTreeRevision;
  }

  #openCursor(): OwnerVfsAppliedCursor {
    if (this.#activeCursor) throw new Error('owner VFS applied mutation cursor is already open');
    const cursor = new AppliedCursor(this);
    this.#activeCursor = cursor;
    return cursor;
  }

  async #withStructuralReset<T>(rootPath: string, apply: () => T | Promise<T>): Promise<T> {
    const canonicalRoot = canonicalResetRoot(rootPath);
    return this.#withScope(
      {
        kind: 'explicit-reset',
        rootPath: canonicalRoot,
        records: [],
      },
      apply,
    );
  }

  async #withSemanticReplacements<T>(
    intents: readonly VfsMutationIntent[],
    apply: () => T | Promise<T>,
  ): Promise<T> {
    return this.#withScope(
      {
        kind: 'semantic-replacements',
        candidates: semanticCandidates(intents),
        records: [],
      },
      apply,
    );
  }

  async #withScope<T>(scope: AppliedScope, apply: () => T | Promise<T>): Promise<T> {
    if (this.#scope) {
      throw new Error('owner VFS structural reset or semantic replacement scope is already active');
    }
    this.#scope = scope;
    try {
      return await apply();
    } finally {
      this.#scope = null;
      this.#publishScope(scope);
    }
  }

  #publishScope(scope: AppliedScope): void {
    const final = scope.records.at(-1);
    if (final === undefined) return;
    if (scope.kind === 'explicit-reset') {
      const sawOrdinaryRevision = scope.records.some((item) => item.ordinary);
      this.#publish(
        freezeRevision(
          this.#ownerEpoch,
          final.record.treeRevision,
          sawOrdinaryRevision ? [{ kind: 'reset', rootPath: scope.rootPath }] : [],
        ),
      );
      return;
    }

    const lastReplacementWrite = new Map<string, number>();
    for (const [index, item] of scope.records.entries()) {
      if (!item.ordinary) continue;
      for (const path of item.contentWritePaths) {
        if (semanticWinner(scope.candidates, path)?.kind === 'replace') {
          lastReplacementWrite.set(path, index);
        }
      }
    }
    // A read at an earlier write revision must stale if the scope writes again.
    const emittedReplacementPaths = new Set<string>();
    for (const [index, item] of scope.records.entries()) {
      const mutations = [...item.record.mutations];
      if (item.ordinary) {
        for (const path of item.contentWritePaths) {
          if (lastReplacementWrite.get(path) !== index || emittedReplacementPaths.has(path)) {
            continue;
          }
          emittedReplacementPaths.add(path);
          mutations.push({ kind: 'reset', rootPath: path });
        }
      }
      this.#publish(freezeRevision(this.#ownerEpoch, item.record.treeRevision, mutations));
    }
  }

  recordOrdinaryRevision(
    treeRevision: TreeRevision,
    mutations: readonly OwnerVfsAppliedMutation[] = [],
    contentWritePaths: readonly string[] = [],
  ): void {
    this.#record(
      treeRevision,
      mutations,
      true,
      Object.freeze(contentWritePaths.map(canonicalSemanticPath)),
    );
  }

  recordClaimRevision(treeRevision: TreeRevision): void {
    this.#record(treeRevision, [], false, []);
  }

  release(cursor: AppliedCursor): void {
    if (this.#activeCursor === cursor) this.#activeCursor = null;
  }

  #record(
    treeRevision: TreeRevision,
    mutations: readonly OwnerVfsAppliedMutation[],
    ordinary: boolean,
    contentWritePaths: readonly string[],
  ): void {
    assertTreeRevision(treeRevision);
    if (treeRevision !== this.#latestTreeRevision + 1) {
      throw new Error(
        `owner VFS applied journal revision gap: expected ${this.#latestTreeRevision + 1}, got ${treeRevision}`,
      );
    }
    this.#latestTreeRevision = treeRevision;
    const record = freezeRevision(this.#ownerEpoch, treeRevision, mutations);
    const scope = this.#scope;
    if (scope) {
      scope.records.push({ record, ordinary, contentWritePaths });
      return;
    }
    this.#publish(record);
  }

  #publish(record: OwnerVfsAppliedRevision): void {
    this.#activeCursor?.publish(record);
  }
}

export function createOwnerVfsAppliedJournal(ownerEpoch: OwnerEpoch): OwnerVfsAppliedJournal {
  return new AppliedJournal(ownerEpoch);
}
