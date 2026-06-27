import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { createMemoryFs } from '@riftydev/vfs/internal';

const nodeRequire = createRequire(import.meta.url);

export function writeRealWorkspaceTypeScript(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  projectRoot: string,
): void {
  const enc = new TextEncoder();
  const packageJson = nodeRequire.resolve('typescript/package.json');
  const packageRoot = path.dirname(packageJson);
  const libDir = path.join(packageRoot, 'lib');
  const target = `${projectRoot}/node_modules/typescript`;
  fsSync.mkdirSync(`${target}/lib`, { recursive: true });
  fsSync.writeFileSync(`${target}/package.json`, enc.encode(readFileSync(packageJson, 'utf8')));
  for (const name of readdirSync(libDir)) {
    if (name !== 'typescript.js' && !/^lib(\.[^.]+)*\.d\.ts$/.test(name)) continue;
    fsSync.writeFileSync(
      `${target}/lib/${name}`,
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
