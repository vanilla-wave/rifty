import {
  type FlushOptions,
  type FsSync,
  type PersistFailureReport,
  VfsError,
  dirname,
  normalizePath,
} from '@riftydev/vfs';

export interface NoCoiProjectFsPolicy {
  readonly root: string;
  readonly readonlyPaths?: readonly string[];
}

export interface NoCoiProjectFsInner extends FsSync {
  loadFixture?(files: Readonly<Record<string, string>>): void;
  flush?(options?: FlushOptions): Promise<PersistFailureReport | undefined>;
  fence?(): Promise<void>;
}

export interface NoCoiProjectFs extends NoCoiProjectFsInner {
  loadFixture(files: Readonly<Record<string, string>>): void;
}

export interface NoCoiProjectFsController {
  readonly fs: NoCoiProjectFs;
  activate(policy: NoCoiProjectFsPolicy): () => void;
  effects(): 'no' | 'yes' | 'unknown';
}

function absolute(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) {
    throw new TypeError('VFS path must be an absolute POSIX path');
  }
  return normalizePath(path);
}

function contains(root: string, path: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

/** One permanent FS identity: ordinary guest and adapter writes share the active policy. */
export function createNoCoiProjectFs(inner: NoCoiProjectFsInner): NoCoiProjectFsController {
  let active: readonly string[] | null = null;
  let applied: 'no' | 'yes' | 'unknown' = 'no';

  function writable(path: string, destructive = false): string {
    const normalized = absolute(path);
    if (
      active?.some(
        (readonlyPath) =>
          contains(readonlyPath, normalized) || (destructive && contains(normalized, readonlyPath)),
      )
    ) {
      throw new VfsError('EROFS', normalized, `EROFS: readonly project path: ${normalized}`);
    }
    return normalized;
  }

  function mutate(apply: () => void): void {
    const recording = active !== null;
    if (recording) applied = 'unknown';
    apply();
    if (recording) applied = 'yes';
  }

  const fs: NoCoiProjectFs = {
    existsSync: (path) => inner.existsSync(absolute(path)),
    readFileBytesSync: (path) => inner.readFileBytesSync(absolute(path)).slice(),
    readdirSync: (path) => inner.readdirSync(absolute(path)).map((entry) => ({ ...entry })),
    statSync: (path) => ({ ...inner.statSync(absolute(path)) }),
    statSyncOrNull(path) {
      const stat = inner.statSyncOrNull(absolute(path));
      return stat === null ? null : { ...stat };
    },
    writeFileSync(path, data) {
      const target = writable(path);
      const bytes = new Uint8Array(data);
      mutate(() => inner.writeFileSync(target, bytes));
    },
    mkdirSync(path, options) {
      const target = writable(path);
      mutate(() => inner.mkdirSync(target, options));
    },
    rmSync(path, options) {
      const target = writable(path, true);
      mutate(() => inner.rmSync(target, options));
    },
    utimes(path, atime, mtime) {
      const target = writable(path);
      mutate(() => inner.utimes(target, atime, mtime));
    },
    copyFileSync(source, target) {
      const from = absolute(source);
      const to = writable(target);
      mutate(() => inner.copyFileSync(from, to));
    },
    cpSync(source, target, options) {
      const from = absolute(source);
      const to = writable(target, true);
      mutate(() => inner.cpSync(from, to, options));
    },
    renameSync(source, target) {
      const from = writable(source, true);
      const to = writable(target, true);
      mutate(() => inner.renameSync(from, to));
    },
    loadFixture(files) {
      const entries = Object.entries(files).map(
        ([path, content]) => [writable(path), content] as const,
      );
      const loadFixture = inner.loadFixture;
      mutate(() => {
        if (loadFixture !== undefined) {
          loadFixture.call(inner, Object.fromEntries(entries));
          return;
        }
        for (const [path, content] of entries) {
          inner.mkdirSync(dirname(path), { recursive: true });
          inner.writeFileSync(path, new TextEncoder().encode(content));
        }
      });
    },
    ...(inner.flush === undefined ? {} : { flush: inner.flush.bind(inner) }),
    ...(inner.fence === undefined ? {} : { fence: inner.fence.bind(inner) }),
  };

  return Object.freeze({
    fs,
    activate(policy: NoCoiProjectFsPolicy): () => void {
      if (active !== null) throw new Error('project filesystem policy is already active');
      if (typeof policy !== 'object' || policy === null || absolute(policy.root) !== policy.root) {
        throw new TypeError('project root must be a canonical absolute POSIX path');
      }
      if (policy.readonlyPaths !== undefined && !Array.isArray(policy.readonlyPaths)) {
        throw new TypeError('readonlyPaths must be an array of absolute POSIX paths');
      }
      active = Object.freeze([...(policy.readonlyPaths ?? [])].map(absolute));
      applied = 'no';
      let restored = false;
      return () => {
        if (restored) return;
        restored = true;
        active = null;
      };
    },
    effects: () => applied,
  });
}
