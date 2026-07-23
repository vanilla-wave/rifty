import {
  type FsSync,
  type PersistFailure,
  type PersistFailureReport,
  dirname,
  normalizePath,
} from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';

export type DurableOwnerFault = 'quota-report' | 'permission-rejection';

export interface ExactFsTree {
  readonly directories: readonly string[];
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export interface DurableOwnerMutation {
  readonly kind: 'mkdir' | 'write' | 'rm' | 'copy' | 'cp' | 'rename';
  readonly source?: string;
  readonly target: string;
}

export interface DurablePersistPrimitive {
  readonly kind: 'mkdir' | 'write' | 'rm';
  readonly path: string;
  readonly bytes?: Uint8Array;
  readonly recursive?: boolean;
  readonly operation: DurableOwnerMutation;
  readonly reportOp: PersistFailure['op'];
}

export interface DurablePersistTraceEntry {
  readonly ordinal: number;
  readonly primitive: DurablePersistPrimitive;
  readonly outcome: 'success' | 'injected-failure' | 'dependent-failure';
}

export interface DurablePersistBoundary {
  readonly primitives: readonly DurablePersistPrimitive[];
  readonly trace: readonly DurablePersistTraceEntry[];
  readonly durableState: ExactFsTree;
}

type TreeEntry =
  | { readonly path: string; readonly kind: 'dir' }
  | { readonly path: string; readonly kind: 'file'; readonly bytes: Uint8Array };

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function absolute(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized.startsWith('/')) throw new TypeError(`fixture path must be absolute: ${path}`);
  return normalized;
}

function pathDepth(path: string): number {
  return path === '/' ? 0 : path.split('/').length - 1;
}

function clonePrimitive(primitive: DurablePersistPrimitive): DurablePersistPrimitive {
  return Object.freeze({
    ...primitive,
    operation: Object.freeze({ ...primitive.operation }),
    ...(primitive.bytes === undefined ? {} : { bytes: primitive.bytes.slice() }),
  });
}

function cloneTrace(entry: DurablePersistTraceEntry): DurablePersistTraceEntry {
  return Object.freeze({
    ordinal: entry.ordinal,
    primitive: clonePrimitive(entry.primitive),
    outcome: entry.outcome,
  });
}

function cloneTree(tree: ExactFsTree): ExactFsTree {
  return Object.freeze({
    directories: Object.freeze([...tree.directories]),
    files: Object.freeze(
      Object.fromEntries(Object.entries(tree.files).map(([path, bytes]) => [path, bytes.slice()])),
    ),
  });
}

export function snapshotExactFsTree(fs: FsSync): ExactFsTree {
  const directories: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = directory === '/' ? `/${entry.name}` : `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        directories.push(path);
        walk(path);
      } else {
        files[path] = fs.readFileBytesSync(path).slice();
      }
    }
  };
  walk('/');
  directories.sort(compareCodeUnits);
  return Object.freeze({
    directories: Object.freeze(directories),
    files: Object.freeze(
      Object.fromEntries(
        Object.entries(files)
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([path, bytes]) => [path, bytes.slice()]),
      ),
    ),
  });
}

export function restoreExactFsTree(tree: ExactFsTree): MemoryFsSync {
  const fs = new MemoryFsSync();
  for (const directory of tree.directories) fs.mkdirSync(directory, { recursive: true });
  for (const [path, bytes] of Object.entries(tree.files)) {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, bytes.slice());
  }
  return fs;
}

function treeEntries(fs: MemoryFsSync, root: string): readonly TreeEntry[] {
  const normalized = absolute(root);
  const stat = fs.statSync(normalized);
  if (stat.isFile) {
    return Object.freeze([
      Object.freeze({
        path: normalized,
        kind: 'file' as const,
        bytes: fs.readFileBytesSync(normalized).slice(),
      }),
    ]);
  }
  const entries: TreeEntry[] = [Object.freeze({ path: normalized, kind: 'dir' as const })];
  const walk = (directory: string): void => {
    const children = [...fs.readdirSync(directory)].sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    for (const entry of children) {
      const path = directory === '/' ? `/${entry.name}` : `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        entries.push(Object.freeze({ path, kind: 'dir' as const }));
        walk(path);
      } else {
        entries.push(
          Object.freeze({ path, kind: 'file' as const, bytes: fs.readFileBytesSync(path).slice() }),
        );
      }
    }
  };
  walk(normalized);
  return Object.freeze(entries);
}

function renameTreeEntries(fs: MemoryFsSync, root: string): readonly TreeEntry[] {
  const entries = treeEntries(fs, root);
  return Object.freeze(
    [...entries].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      return (
        pathDepth(left.path) - pathDepth(right.path) || compareCodeUnits(left.path, right.path)
      );
    }),
  );
}

function mappedPath(path: string, sourceRoot: string, targetRoot: string): string {
  return `${targetRoot}${path.slice(sourceRoot.length)}`;
}

/** OPFS-like live mirror plus independently replayed durable primitives. */
export class DurableOwnerFs extends MemoryFsSync {
  #durableFs = new MemoryFsSync();
  #pending: DurablePersistPrimitive[] = [];
  #ledger = new Map<string, PersistFailure>();
  #armed = false;
  #failAt = Number.POSITIVE_INFINITY;
  #fault: DurableOwnerFault = 'quota-report';
  #persistPrimitiveCount = 0;
  #trace: DurablePersistTraceEntry[] = [];
  #boundaries: DurablePersistBoundary[] = [];
  didInjectFailure = false;

  get pendingPrimitiveCount(): number {
    return this.#pending.length;
  }

  get persistPrimitiveCount(): number {
    return this.#persistPrimitiveCount;
  }

  get trace(): readonly DurablePersistTraceEntry[] {
    return Object.freeze(this.#trace.map(cloneTrace));
  }

  get durabilityBoundaries(): readonly DurablePersistBoundary[] {
    return Object.freeze(
      this.#boundaries.map((boundary) =>
        Object.freeze({
          primitives: Object.freeze(boundary.primitives.map(clonePrimitive)),
          trace: Object.freeze(boundary.trace.map(cloneTrace)),
          durableState: cloneTree(boundary.durableState),
        }),
      ),
    );
  }

  liveSnapshot(): ExactFsTree {
    return snapshotExactFsTree(this);
  }

  durableSnapshot(): ExactFsTree {
    return snapshotExactFsTree(this.#durableFs);
  }

  sealDurableState(): void {
    this.#durableFs = restoreExactFsTree(this.liveSnapshot());
    this.#pending = [];
    this.#ledger.clear();
  }

  armPersistFailure(ordinal: number, fault: DurableOwnerFault): void {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      throw new RangeError(`persist failure ordinal must be positive: ${String(ordinal)}`);
    }
    if (this.#pending.length > 0) {
      throw new Error('cannot arm persist failure while earlier primitives remain pending');
    }
    this.#armed = true;
    this.#failAt = ordinal;
    this.#fault = fault;
    this.#persistPrimitiveCount = 0;
    this.#trace = [];
    this.#boundaries = [];
    this.didInjectFailure = false;
  }

  disarmPersistFailure(): void {
    this.#armed = false;
  }

  restartFromDurableState(): DurableOwnerFs {
    return createDurableOwnerFsFromTree(this.durableSnapshot());
  }

  async flush(): Promise<PersistFailureReport> {
    const primitives = Object.freeze(this.#pending.map(clonePrimitive));
    this.#pending = [];
    const boundaryTrace: DurablePersistTraceEntry[] = [];
    let injectedPermission = false;

    for (const primitive of primitives) {
      if (this.#armed) this.#persistPrimitiveCount += 1;
      const ordinal = this.#persistPrimitiveCount;
      const inject = this.#armed && ordinal === this.#failAt;
      if (inject) {
        this.didInjectFailure = true;
        injectedPermission = this.#fault === 'permission-rejection';
        this.#recordFailure(
          primitive,
          this.#fault === 'permission-rejection'
            ? 'permission denied at injected durable-owner primitive'
            : 'quota exceeded at injected durable-owner primitive',
        );
        const entry = Object.freeze({
          ordinal,
          primitive: clonePrimitive(primitive),
          outcome: 'injected-failure' as const,
        });
        this.#trace.push(entry);
        boundaryTrace.push(entry);
        continue;
      }

      try {
        this.#replay(primitive);
        this.#heal(primitive);
        const entry = Object.freeze({
          ordinal,
          primitive: clonePrimitive(primitive),
          outcome: 'success' as const,
        });
        this.#trace.push(entry);
        boundaryTrace.push(entry);
      } catch (error) {
        this.#recordFailure(primitive, error instanceof Error ? error.message : String(error));
        const entry = Object.freeze({
          ordinal,
          primitive: clonePrimitive(primitive),
          outcome: 'dependent-failure' as const,
        });
        this.#trace.push(entry);
        boundaryTrace.push(entry);
      }
    }

    this.#boundaries.push(
      Object.freeze({
        primitives,
        trace: Object.freeze(boundaryTrace.map(cloneTrace)),
        durableState: this.durableSnapshot(),
      }),
    );
    if (injectedPermission) throw new Error('permission denied at durable-owner flush');
    const failures = Object.freeze([...this.#ledger.values()].map((failure) => ({ ...failure })));
    return {
      failures,
      total: failures.length,
      anyFailure: (predicate) => failures.some((failure) => predicate(failure.path)),
    };
  }

  override mkdirSync(path: string, options: { recursive?: boolean }): void {
    const normalized = absolute(path);
    super.mkdirSync(normalized, options);
    if (normalized === '/') return;
    this.#queue({
      kind: 'mkdir',
      path: normalized,
      recursive: options.recursive,
      operation: { kind: 'mkdir', target: normalized },
      reportOp: 'mkdir',
    });
  }

  override writeFileSync(path: string, data: Uint8Array): void {
    const normalized = absolute(path);
    const bytes = data.slice();
    super.writeFileSync(normalized, bytes);
    this.#queue({
      kind: 'write',
      path: normalized,
      bytes,
      operation: { kind: 'write', target: normalized },
      reportOp: 'write',
    });
  }

  override rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    const normalized = absolute(path);
    const existed = this.statSyncOrNull(normalized) !== null;
    super.rmSync(normalized, options);
    if (!existed) return;
    this.#queue({
      kind: 'rm',
      path: normalized,
      operation: { kind: 'rm', target: normalized },
      reportOp: 'rm',
    });
  }

  override utimes(path: string, atimeMs: number, mtimeMs: number): void {
    super.utimes(path, atimeMs, mtimeMs);
  }

  override copyFileSync(source: string, target: string): void {
    const normalizedSource = absolute(source);
    const normalizedTarget = absolute(target);
    const bytes = this.readFileBytesSync(normalizedSource).slice();
    super.copyFileSync(normalizedSource, normalizedTarget);
    this.#queue({
      kind: 'write',
      path: normalizedTarget,
      bytes,
      operation: { kind: 'copy', source: normalizedSource, target: normalizedTarget },
      reportOp: 'write',
    });
  }

  override cpSync(source: string, target: string, options: { recursive?: boolean } = {}): void {
    const normalizedSource = absolute(source);
    const normalizedTarget = absolute(target);
    const entries = treeEntries(this, normalizedSource);
    const rootEntry = entries[0];
    if (rootEntry === undefined)
      throw new Error(`missing fixture source entry: ${normalizedSource}`);
    super.cpSync(normalizedSource, normalizedTarget, options);
    const operation = Object.freeze({
      kind: 'cp' as const,
      source: normalizedSource,
      target: normalizedTarget,
    });
    for (const entry of entries) {
      const targetPath = mappedPath(entry.path, normalizedSource, normalizedTarget);
      if (entry.kind === 'dir') {
        this.#queue({
          kind: 'mkdir',
          path: targetPath,
          recursive: true,
          operation,
          reportOp: 'mkdir',
        });
      } else {
        this.#queue({
          kind: 'write',
          path: targetPath,
          bytes: entry.bytes.slice(),
          operation,
          reportOp: 'write',
        });
      }
    }
  }

  override renameSync(source: string, target: string): void {
    const normalizedSource = absolute(source);
    const normalizedTarget = absolute(target);
    if (normalizedSource === normalizedTarget) {
      super.renameSync(normalizedSource, normalizedTarget);
      return;
    }
    const entries = renameTreeEntries(this, normalizedSource);
    super.renameSync(normalizedSource, normalizedTarget);
    const operation = Object.freeze({
      kind: 'rename' as const,
      source: normalizedSource,
      target: normalizedTarget,
    });
    for (const entry of entries) {
      const targetPath = mappedPath(entry.path, normalizedSource, normalizedTarget);
      if (entry.kind === 'dir') {
        this.#queue({
          kind: 'mkdir',
          path: targetPath,
          recursive: true,
          operation,
          reportOp: 'rename',
        });
      } else {
        this.#queue({
          kind: 'write',
          path: targetPath,
          bytes: entry.bytes.slice(),
          operation,
          reportOp: 'rename',
        });
      }
    }
    this.#queue({ kind: 'rm', path: normalizedSource, operation, reportOp: 'rename' });
  }

  #queue(primitive: DurablePersistPrimitive): void {
    this.#pending.push(clonePrimitive(primitive));
  }

  #replay(primitive: DurablePersistPrimitive): void {
    if (primitive.kind === 'mkdir') {
      this.#durableFs.mkdirSync(primitive.path, { recursive: primitive.recursive });
      return;
    }
    if (primitive.kind === 'write') {
      if (primitive.bytes === undefined) {
        throw new Error(`missing durable bytes for ${primitive.path}`);
      }
      this.#durableFs.writeFileSync(primitive.path, primitive.bytes.slice());
      return;
    }
    this.#durableFs.rmSync(primitive.path, { recursive: true, force: true });
  }

  #recordFailure(primitive: DurablePersistPrimitive, message: string): void {
    this.#ledger.set(primitive.path, {
      path: primitive.path,
      op: primitive.reportOp,
      message,
    });
  }

  #heal(primitive: DurablePersistPrimitive): void {
    if (primitive.kind === 'rm') {
      const prefix = `${primitive.path}/`;
      for (const path of [...this.#ledger.keys()]) {
        if (path === primitive.path || path.startsWith(prefix)) this.#ledger.delete(path);
      }
      return;
    }
    this.#ledger.delete(primitive.path);
    let parent = dirname(primitive.path);
    while (parent !== '/') {
      this.#ledger.delete(parent);
      parent = dirname(parent);
    }
  }
}

/** Hard-restart fixture from any recorded durability boundary, not only the final state. */
export function createDurableOwnerFsFromTree(tree: ExactFsTree): DurableOwnerFs {
  const restarted = new DurableOwnerFs();
  for (const directory of tree.directories) {
    restarted.mkdirSync(directory, { recursive: true });
  }
  for (const [path, bytes] of Object.entries(tree.files)) {
    restarted.mkdirSync(dirname(path), { recursive: true });
    restarted.writeFileSync(path, bytes.slice());
  }
  restarted.sealDurableState();
  return restarted;
}
