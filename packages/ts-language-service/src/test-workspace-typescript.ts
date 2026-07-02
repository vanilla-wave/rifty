import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { createMemoryFs } from '@riftydev/vfs/internal';

const nodeRequire = createRequire(import.meta.url);

export interface WorkspaceTypeScriptLayout {
  /** Package-relative dir receiving typescript.js + lib*.d.ts. Default 'lib' (stock npm layout). */
  readonly entryDir?: string;
  /** Replacement package.json text (relocated-`main` / `exports` variants). Default: the real manifest. */
  readonly packageJsonText?: string;
}

export function writeRealWorkspaceTypeScript(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  projectRoot: string,
  layout: WorkspaceTypeScriptLayout = {},
): void {
  const enc = new TextEncoder();
  const packageJson = nodeRequire.resolve('typescript/package.json');
  const packageRoot = path.dirname(packageJson);
  const libDir = path.join(packageRoot, 'lib');
  const entryDir = layout.entryDir ?? 'lib';
  const target = `${projectRoot}/node_modules/typescript`;
  fsSync.mkdirSync(`${target}/${entryDir}`, { recursive: true });
  fsSync.writeFileSync(
    `${target}/package.json`,
    enc.encode(layout.packageJsonText ?? readFileSync(packageJson, 'utf8')),
  );
  for (const name of readdirSync(libDir)) {
    if (name !== 'typescript.js' && !/^lib(\.[^.]+)*\.d\.ts$/.test(name)) continue;
    fsSync.writeFileSync(
      `${target}/${entryDir}/${name}`,
      enc.encode(readFileSync(path.join(libDir, name), 'utf8')),
    );
  }
}

export function snapshotVfsFiles(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  root: string,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const visit = (dir: string) => {
    for (const entry of fsSync.readdirSync(dir)) {
      const path = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
      if (entry.isDirectory) visit(path);
      else if (entry.isFile) files.set(path, fsSync.readFileBytesSync(path));
    }
  };
  visit(root);
  return files;
}
