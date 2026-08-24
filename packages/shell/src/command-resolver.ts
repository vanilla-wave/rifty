/**
 * One command-selection authority for execution and live discovery (ADR-0362).
 *
 * Registered commands win. Explicit paths address regular VFS files directly;
 * bare names walk ancestor `node_modules/.bin` directories. Every lookup reads
 * the current filesystem — installs and cwd changes are visible immediately.
 */

import { type FsSync, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import type { ShellCommand } from './types.ts';

export type CommandResolution =
  | { readonly kind: 'registered'; readonly command: ShellCommand }
  | { readonly kind: 'file'; readonly path: string; readonly source: 'direct' | 'bin' }
  | {
      readonly kind: 'miss';
      readonly reason: 'bare' | 'missing-path' | 'not-directory' | 'directory';
    };

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

export class CommandResolver {
  constructor(
    private readonly registered: ReadonlyMap<string, ShellCommand>,
    private readonly fileSystem: () => FsSync,
  ) {}

  resolve(name: string, cwd: string): CommandResolution {
    const command = this.registered.get(name);
    if (command) return { kind: 'registered', command };

    if (name.includes('/')) return this.resolveDirect(name, cwd);
    if (name === '') return { kind: 'miss', reason: 'bare' };

    const fs = this.fileSystem();
    let dir = normalizePath(cwd);
    for (;;) {
      const candidate = joinPath(dir, 'node_modules', '.bin', name);
      try {
        if (fs.statSync(candidate).isFile) {
          return { kind: 'file', path: candidate, source: 'bin' };
        }
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
      if (dir === '/') return { kind: 'miss', reason: 'bare' };
      dir = parentPath(dir);
    }
  }

  names(cwd: string): readonly string[] {
    const names = new Set(this.registered.keys());
    const fs = this.fileSystem();
    let dir = normalizePath(cwd);
    for (;;) {
      const binDir = joinPath(dir, 'node_modules', '.bin');
      try {
        for (const entry of fs.readdirSync(binDir)) {
          if (entry.isFile) names.add(entry.name);
        }
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
      if (dir === '/') return [...names].sort();
      dir = parentPath(dir);
    }
  }

  private resolveDirect(name: string, cwd: string): CommandResolution {
    const path = normalizePath(isAbsolute(name) ? name : joinPath(cwd, name));
    try {
      const stat = this.fileSystem().statSync(path);
      if (stat.isFile) return { kind: 'file', path, source: 'direct' };
      if (stat.isDirectory) return { kind: 'miss', reason: 'directory' };
      throw new Error(`Unsupported VFS entry type: ${path}`);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') return { kind: 'miss', reason: 'missing-path' };
      if (code === 'ENOTDIR') return { kind: 'miss', reason: 'not-directory' };
      throw error;
    }
  }
}
