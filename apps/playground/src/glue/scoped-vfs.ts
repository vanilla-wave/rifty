import {
  type FsSync,
  type PersistFailureReport,
  type Vfs,
  type VfsDirent,
  type VfsStat,
  asyncVfs,
  dirname,
  normalizePath,
  syncMirror,
} from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';

export type WorkspaceMutationOp = 'write' | 'mkdir' | 'rm' | 'utimes' | 'copy' | 'rename';

/** Successful owner-store mutation, expressed in public (unscoped) paths. */
export interface WorkspaceMutation {
  readonly op: WorkspaceMutationOp;
  readonly paths: readonly string[];
}

export type WorkspaceMutationObserver = (mutation: WorkspaceMutation) => void;

function workspaceSlug(workspaceId: string): string {
  const slug = workspaceId.replace(/[^A-Za-z0-9._-]/g, '_');
  return slug || 'default';
}

export function workspaceVfsPrefix(workspaceId: string): string {
  return `/workspaces/${workspaceSlug(workspaceId)}`;
}

function scopePath(prefix: string, path: string): string {
  const normalized = normalizePath(path);
  // Profile-wide owner metadata; project trees stay workspace-scoped.
  if (normalized === '/.rifty' || normalized.startsWith('/.rifty/')) return normalized;
  return normalized === '/' ? prefix : normalizePath(`${prefix}${normalized}`);
}

function unscopePath(prefix: string, path: string): string {
  const normalized = normalizePath(path);
  if (normalized === prefix) return '/';
  if (normalized.startsWith(`${prefix}/`)) return normalizePath(normalized.slice(prefix.length));
  return normalized;
}

export class ScopedFsSync implements FsSync {
  constructor(
    private readonly inner: FsSync & {
      flush?: () => Promise<PersistFailureReport | undefined>;
      loadFixture?: (files: Readonly<Record<string, string>>) => void;
    },
    private readonly prefix: string,
    private readonly onMutation?: WorkspaceMutationObserver,
  ) {}

  private map(path: string): string {
    return scopePath(this.prefix, path);
  }

  existsSync(path: string): boolean {
    return this.inner.existsSync(this.map(path));
  }
  readFileBytesSync(path: string): Uint8Array {
    return this.inner.readFileBytesSync(this.map(path));
  }
  writeFileSync(path: string, data: Uint8Array): void {
    this.inner.writeFileSync(this.map(path), data);
    this.onMutation?.({ op: 'write', paths: [normalizePath(path)] });
  }
  readdirSync(path: string): readonly VfsDirent[] {
    return this.inner.readdirSync(this.map(path));
  }
  mkdirSync(path: string, options: { recursive?: boolean }): void {
    const mapped = this.map(path);
    const existed = this.inner.existsSync(mapped);
    this.inner.mkdirSync(mapped, options);
    if (!existed) this.onMutation?.({ op: 'mkdir', paths: [normalizePath(path)] });
  }
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    const mapped = this.map(path);
    const existed = this.inner.existsSync(mapped);
    this.inner.rmSync(mapped, options);
    if (existed) this.onMutation?.({ op: 'rm', paths: [normalizePath(path)] });
  }
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    return this.inner.statSync(this.map(path));
  }
  statSyncOrNull(
    path: string,
  ): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } | null {
    return this.inner.statSyncOrNull(this.map(path));
  }
  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.inner.utimes(this.map(path), atimeMs, mtimeMs);
    this.onMutation?.({ op: 'utimes', paths: [normalizePath(path)] });
  }
  copyFileSync(src: string, dst: string): void {
    this.inner.copyFileSync(this.map(src), this.map(dst));
    this.onMutation?.({ op: 'copy', paths: [normalizePath(dst)] });
  }
  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void {
    this.inner.cpSync(this.map(src), this.map(dst), options);
    this.onMutation?.({ op: 'copy', paths: [normalizePath(dst)] });
  }
  renameSync(src: string, dst: string): void {
    const mappedSrc = this.map(src);
    const mappedDst = this.map(dst);
    this.inner.renameSync(mappedSrc, mappedDst);
    if (mappedSrc !== mappedDst) {
      this.onMutation?.({
        op: 'rename',
        paths: [normalizePath(src), normalizePath(dst)],
      });
    }
  }
  loadFixture(files: Readonly<Record<string, string>>): void {
    const mapped: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) mapped[this.map(path)] = content;
    if (this.inner.loadFixture) {
      this.inner.loadFixture(mapped);
      for (const path of Object.keys(files)) {
        this.onMutation?.({ op: 'write', paths: [normalizePath(path)] });
      }
      return;
    }
    const enc = new TextEncoder();
    for (const [path, content] of Object.entries(mapped)) {
      this.inner.mkdirSync(dirname(path), { recursive: true });
      this.inner.writeFileSync(path, enc.encode(content));
      this.onMutation?.({ op: 'write', paths: [unscopePath(this.prefix, path)] });
    }
  }
  async flush(): Promise<PersistFailureReport | undefined> {
    const report = await this.inner.flush?.();
    if (!report) return undefined;
    const failures = report.failures.map((failure) => ({
      ...failure,
      path: unscopePath(this.prefix, failure.path),
    }));
    return {
      failures,
      total: report.total,
      anyFailure: (predicate) => {
        const mappedPredicate = (path: string): boolean =>
          predicate(unscopePath(this.prefix, path));
        if (report.anyFailure) return report.anyFailure(mappedPredicate);
        return report.failures.some((failure) => mappedPredicate(failure.path));
      },
    };
  }
}

export class ScopedVfs implements Vfs {
  constructor(
    private readonly inner: Vfs,
    private readonly prefix: string,
    private readonly onMutation?: WorkspaceMutationObserver,
  ) {}

  private map(path: string): string {
    return scopePath(this.prefix, path);
  }

  readFile(path: string): Promise<Uint8Array> {
    return this.inner.readFile(this.map(path));
  }
  readFileText(path: string, encoding?: 'utf8'): Promise<string> {
    return this.inner.readFileText(this.map(path), encoding);
  }
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await this.inner.writeFile(this.map(path), data);
    this.onMutation?.({ op: 'write', paths: [normalizePath(path)] });
  }
  readdir(path: string): Promise<readonly VfsDirent[]> {
    return this.inner.readdir(this.map(path));
  }
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const mapped = this.map(path);
    const existed = await this.inner.exists(mapped);
    await this.inner.mkdir(mapped, options);
    if (!existed) this.onMutation?.({ op: 'mkdir', paths: [normalizePath(path)] });
  }
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const mapped = this.map(path);
    const existed = await this.inner.exists(mapped);
    await this.inner.rm(mapped, options);
    if (existed) this.onMutation?.({ op: 'rm', paths: [normalizePath(path)] });
  }
  stat(path: string): Promise<VfsStat> {
    return this.inner.stat(this.map(path));
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(this.map(path));
  }
  async utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    await this.inner.utimes(this.map(path), atimeMs, mtimeMs);
    this.onMutation?.({ op: 'utimes', paths: [normalizePath(path)] });
  }
  openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    return this.inner.openReadable(this.map(path), opts);
  }
}

export function scopeActiveVfsToWorkspace(
  workspaceId: string,
  onMutation?: WorkspaceMutationObserver,
): string {
  const prefix = workspaceVfsPrefix(workspaceId);
  const scopedSync = new ScopedFsSync(syncMirror(), prefix, onMutation);
  const activeAsync = asyncVfs();
  const scopedAsync = activeAsync ? new ScopedVfs(activeAsync, prefix, onMutation) : undefined;
  setSyncMirror(scopedSync, scopedAsync ? { async: scopedAsync } : {});
  scopedSync.mkdirSync('/', { recursive: true });
  return prefix;
}
