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
  }
  readdirSync(path: string): readonly VfsDirent[] {
    return this.inner.readdirSync(this.map(path));
  }
  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.inner.mkdirSync(this.map(path), options);
  }
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.inner.rmSync(this.map(path), options);
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
  }
  copyFileSync(src: string, dst: string): void {
    this.inner.copyFileSync(this.map(src), this.map(dst));
  }
  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void {
    this.inner.cpSync(this.map(src), this.map(dst), options);
  }
  renameSync(src: string, dst: string): void {
    this.inner.renameSync(this.map(src), this.map(dst));
  }
  loadFixture(files: Readonly<Record<string, string>>): void {
    const mapped: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) mapped[this.map(path)] = content;
    if (this.inner.loadFixture) {
      this.inner.loadFixture(mapped);
      return;
    }
    const enc = new TextEncoder();
    for (const [path, content] of Object.entries(mapped)) {
      this.inner.mkdirSync(dirname(path), { recursive: true });
      this.inner.writeFileSync(path, enc.encode(content));
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
  writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return this.inner.writeFile(this.map(path), data);
  }
  readdir(path: string): Promise<readonly VfsDirent[]> {
    return this.inner.readdir(this.map(path));
  }
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this.inner.mkdir(this.map(path), options);
  }
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    return this.inner.rm(this.map(path), options);
  }
  stat(path: string): Promise<VfsStat> {
    return this.inner.stat(this.map(path));
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(this.map(path));
  }
  utimes(path: string, atimeMs: number, mtimeMs: number): Promise<void> {
    return this.inner.utimes(this.map(path), atimeMs, mtimeMs);
  }
  openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    return this.inner.openReadable(this.map(path), opts);
  }
}

export function scopeActiveVfsToWorkspace(workspaceId: string): string {
  const prefix = workspaceVfsPrefix(workspaceId);
  const scopedSync = new ScopedFsSync(syncMirror(), prefix);
  const activeAsync = asyncVfs();
  const scopedAsync = activeAsync ? new ScopedVfs(activeAsync, prefix) : undefined;
  setSyncMirror(scopedSync, scopedAsync ? { async: scopedAsync } : {});
  scopedSync.mkdirSync('/', { recursive: true });
  return prefix;
}
