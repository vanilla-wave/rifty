import { MemoryFsSync } from '@riftydev/vfs/internal';

export const NODE_CLI_EVAL_VFS_CARRIER_COMPLETE = 'parity.node-cli-eval.vfs-carrier-complete';

export type NodeCliEvalVfsProvenance = 'carrier' | 'guest';

export type NodeCliEvalVfsContentEntry =
  | {
      readonly kind: 'directory';
      readonly path: string;
    }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly bytesHex: string;
    };

type NodeCliEvalVfsContent = readonly NodeCliEvalVfsContentEntry[];

export type NodeCliEvalVfsMutation =
  | {
      readonly kind: 'write';
      readonly provenance: NodeCliEvalVfsProvenance;
      readonly path: string;
      readonly content: NodeCliEvalVfsContent;
    }
  | {
      readonly kind: 'mkdir';
      readonly provenance: NodeCliEvalVfsProvenance;
      readonly path: string;
      readonly recursive: boolean;
    }
  | {
      readonly kind: 'rm';
      readonly provenance: NodeCliEvalVfsProvenance;
      readonly path: string;
      readonly recursive: boolean;
      readonly force: boolean;
    }
  | {
      readonly kind: 'utimes';
      readonly provenance: NodeCliEvalVfsProvenance;
      readonly path: string;
      readonly atimeMs: number;
      readonly mtimeMs: number;
    }
  | {
      readonly kind: 'copy';
      readonly provenance: NodeCliEvalVfsProvenance;
      readonly operation: 'copyFileSync' | 'cpSync';
      readonly path: string;
      readonly targetPath: string;
      readonly recursive: boolean;
      readonly content: NodeCliEvalVfsContent;
    }
  | {
      readonly kind: 'rename';
      readonly provenance: NodeCliEvalVfsProvenance;
      readonly path: string;
      readonly targetPath: string;
      readonly content: NodeCliEvalVfsContent;
    };

export interface NodeCliEvalVfsAudit {
  readonly missing: readonly NodeCliEvalVfsMutation[];
  readonly unexpected: readonly NodeCliEvalVfsMutation[];
}

function cloneMutation(mutation: NodeCliEvalVfsMutation): NodeCliEvalVfsMutation {
  if (mutation.kind === 'write' || mutation.kind === 'copy' || mutation.kind === 'rename') {
    return {
      ...mutation,
      content: mutation.content.map((entry) => ({ ...entry })),
    };
  }
  return { ...mutation };
}

function equalContent(left: NodeCliEvalVfsContent, right: NodeCliEvalVfsContent): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      if (
        candidate === undefined ||
        entry.kind !== candidate.kind ||
        entry.path !== candidate.path
      ) {
        return false;
      }
      return (
        entry.kind === 'directory' ||
        (candidate.kind === 'file' && entry.bytesHex === candidate.bytesHex)
      );
    })
  );
}

function equalMutation(left: NodeCliEvalVfsMutation, right: NodeCliEvalVfsMutation): boolean {
  if (
    left.kind !== right.kind ||
    left.provenance !== right.provenance ||
    left.path !== right.path
  ) {
    return false;
  }
  switch (left.kind) {
    case 'write':
      return right.kind === 'write' && equalContent(left.content, right.content);
    case 'mkdir':
      return right.kind === 'mkdir' && left.recursive === right.recursive;
    case 'rm':
      return (
        right.kind === 'rm' && left.recursive === right.recursive && left.force === right.force
      );
    case 'utimes':
      return (
        right.kind === 'utimes' && left.atimeMs === right.atimeMs && left.mtimeMs === right.mtimeMs
      );
    case 'copy':
      return (
        right.kind === 'copy' &&
        left.operation === right.operation &&
        left.targetPath === right.targetPath &&
        left.recursive === right.recursive &&
        equalContent(left.content, right.content)
      );
    case 'rename':
      return (
        right.kind === 'rename' &&
        left.targetPath === right.targetPath &&
        equalContent(left.content, right.content)
      );
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function nodeCliEvalVfsFileContent(
  path: string,
  data: string | Uint8Array,
): NodeCliEvalVfsContent {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return [{ kind: 'file', path, bytesHex: bytesToHex(bytes) }];
}

/**
 * Real in-memory parity VFS with an append-only mutation history. Observation
 * starts after fixture setup, so a write-then-delete carrier cannot hide behind
 * an unchanged final tree.
 */
export class NodeCliEvalVfsObserver extends MemoryFsSync {
  readonly #mutations: NodeCliEvalVfsMutation[] = [];
  #observing = false;
  #provenance: NodeCliEvalVfsProvenance = 'guest';

  startObservation(): void {
    this.#mutations.length = 0;
    this.#observing = true;
    this.#provenance = 'guest';
  }

  beginCarrierObservation(): void {
    if (!this.#observing || this.#provenance !== 'guest') {
      throw new Error('node-cli-eval VFS carrier observation cannot begin');
    }
    this.#provenance = 'carrier';
  }

  endCarrierObservation(): void {
    if (!this.#observing || this.#provenance !== 'carrier') {
      throw new Error('node-cli-eval VFS carrier observation cannot end');
    }
    this.#provenance = 'guest';
  }

  mutations(): readonly NodeCliEvalVfsMutation[] {
    return this.#mutations.map(cloneMutation);
  }

  /**
   * Remove each declared guest effect exactly once, including written bytes.
   * Missing declarations and every remaining mutation stay visible; this is
   * not a path allowlist.
   */
  audit(expectedGuestMutations: readonly NodeCliEvalVfsMutation[]): NodeCliEvalVfsAudit {
    if (this.#provenance !== 'guest') {
      throw new Error('node-cli-eval VFS carrier observation did not reach its physical boundary');
    }
    if (expectedGuestMutations.some((mutation) => mutation.provenance !== 'guest')) {
      throw new TypeError('node-cli-eval expected mutations must have guest provenance');
    }
    const unexpected = [...this.mutations()];
    const missing: NodeCliEvalVfsMutation[] = [];
    for (const expected of expectedGuestMutations) {
      const match = unexpected.findIndex((actual) => equalMutation(actual, expected));
      if (match === -1) missing.push(cloneMutation(expected));
      else unexpected.splice(match, 1);
    }
    return { missing, unexpected };
  }

  override writeFileSync(path: string, data: Uint8Array): void {
    super.writeFileSync(path, data);
    this.record({
      kind: 'write',
      provenance: this.#provenance,
      path,
      content: nodeCliEvalVfsFileContent(path, data),
    });
  }

  override mkdirSync(path: string, options: { recursive?: boolean }): void {
    super.mkdirSync(path, options);
    this.record({
      kind: 'mkdir',
      provenance: this.#provenance,
      path,
      recursive: options.recursive === true,
    });
  }

  override rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    super.rmSync(path, options);
    this.record({
      kind: 'rm',
      provenance: this.#provenance,
      path,
      recursive: options.recursive === true,
      force: options.force === true,
    });
  }

  override utimes(path: string, atimeMs: number, mtimeMs: number): void {
    super.utimes(path, atimeMs, mtimeMs);
    this.record({ kind: 'utimes', provenance: this.#provenance, path, atimeMs, mtimeMs });
  }

  override copyFileSync(sourcePath: string, targetPath: string): void {
    super.copyFileSync(sourcePath, targetPath);
    this.record({
      kind: 'copy',
      provenance: this.#provenance,
      operation: 'copyFileSync',
      path: sourcePath,
      targetPath,
      recursive: false,
      content: this.contentAt(targetPath),
    });
  }

  override cpSync(
    sourcePath: string,
    targetPath: string,
    options: { recursive?: boolean } = {},
  ): void {
    super.cpSync(sourcePath, targetPath, options);
    this.record({
      kind: 'copy',
      provenance: this.#provenance,
      operation: 'cpSync',
      path: sourcePath,
      targetPath,
      recursive: options.recursive === true,
      content: this.contentAt(targetPath),
    });
  }

  override renameSync(sourcePath: string, targetPath: string): void {
    super.renameSync(sourcePath, targetPath);
    this.record({
      kind: 'rename',
      provenance: this.#provenance,
      path: sourcePath,
      targetPath,
      content: this.contentAt(targetPath),
    });
  }

  private record(mutation: NodeCliEvalVfsMutation): void {
    if (this.#observing) this.#mutations.push(mutation);
  }

  private contentAt(path: string): NodeCliEvalVfsContent {
    const entries: NodeCliEvalVfsContentEntry[] = [];
    const visit = (entryPath: string): void => {
      const stat = super.statSync(entryPath);
      if (stat.isFile) {
        entries.push({
          kind: 'file',
          path: entryPath,
          bytesHex: bytesToHex(super.readFileBytesSync(entryPath)),
        });
        return;
      }
      entries.push({ kind: 'directory', path: entryPath });
      for (const entry of super.readdirSync(entryPath)) {
        visit(entryPath === '/' ? `/${entry.name}` : `${entryPath}/${entry.name}`);
      }
    };
    visit(path);
    return entries;
  }
}
