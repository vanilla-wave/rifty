import { relative } from 'node:path';
import { dirname } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import {
  type EsbuildContractWorkspace,
  explicitContractRelativePath,
} from './esbuild-contract-probe.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function listFiles(fs: MemoryFsSync, path: string): readonly string[] {
  if (!fs.existsSync(path)) return [];
  if (!fs.statSync(path).isDirectory) return [path];
  return fs
    .readdirSync(path)
    .flatMap((entry) => listFiles(fs, `${path}/${entry.name}`))
    .sort();
}

export interface MemoryContractWorkspace {
  readonly fs: MemoryFsSync;
  readonly workspace: EsbuildContractWorkspace;
}

export function createMemoryContractWorkspace(): MemoryContractWorkspace {
  const fs = new MemoryFsSync();
  const cwd = process.cwd();
  const root = `${cwd}/.rifty-esbuild-contract-memory`;
  const relativeRoot = explicitContractRelativePath(relative(cwd, root).replaceAll('\\', '/'));
  fs.mkdirSync(root, { recursive: true });

  return {
    fs,
    workspace: {
      root,
      cwd,
      relativeRoot,
      rootAliases: [root],
      mkdir: async (path) => {
        fs.mkdirSync(path, { recursive: true });
      },
      writeFile: async (path, contents) => {
        fs.mkdirSync(dirname(path), { recursive: true });
        fs.writeFileSync(path, encoder.encode(contents));
      },
      readFile: async (path) => decoder.decode(fs.readFileBytesSync(path)),
      exists: (path) => fs.existsSync(path),
      listFiles: (path) => listFiles(fs, path),
    },
  };
}
