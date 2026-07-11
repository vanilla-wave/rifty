import type { VfsDirent } from '@riftydev/vfs';
import type { FsOpsTarget } from '@riftydev/workbench';
import { render } from 'solid-js/web';
import { FileExplorer, type FileExplorerMutations } from '../components/FileExplorer.tsx';

type Entry = { readonly isDirectory: boolean; readonly data?: Uint8Array };

export function mountFileExplorerInlineEditHarness(root: HTMLElement): void {
  const enc = new TextEncoder();
  const entries = new Map<string, Entry>([
    ['/workspace', { isDirectory: true }],
    ['/workspace/main.ts', { isDirectory: false, data: enc.encode('console.log(1)\n') }],
  ]);

  const vfs: FsOpsTarget = {
    readOnly: true,
    existsSync: (path) => entries.has(path),
    readFileBytesSync: (path) => {
      const entry = entries.get(path);
      if (!entry || entry.isDirectory) throw new Error(`ENOENT ${path}`);
      return entry.data ?? new Uint8Array();
    },
    readdirSync: (path): readonly VfsDirent[] => {
      const prefix = `${path}/`;
      return [...entries.keys()]
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length))
        .filter((rest) => rest.length > 0 && !rest.includes('/'))
        .map((name) => {
          const entry = entries.get(`${prefix}${name}`);
          if (!entry) throw new Error(`missing ${prefix}${name}`);
          return { name, isDirectory: entry.isDirectory, isFile: !entry.isDirectory };
        });
    },
    statSync: (path) => {
      const entry = entries.get(path);
      if (!entry) throw new Error(`ENOENT ${path}`);
      return {
        isDirectory: entry.isDirectory,
        isFile: !entry.isDirectory,
        size: entry.data?.byteLength ?? 0,
      };
    },
    writeFileSync: () => {
      throw new Error('read-only');
    },
    mkdirSync: () => {
      throw new Error('read-only');
    },
    rmSync: () => {
      throw new Error('read-only');
    },
    renameSync: () => {
      throw new Error('read-only');
    },
  };

  const mutations: FileExplorerMutations = {
    createFile: async () => {},
    createDir: async () => {},
    deletePath: async () => {},
    renameMany: async () => {},
    copyTree: async () => {},
    writeFile: async () => {},
    writeFiles: async () => {},
    renamePath: async (from, to) => {
      const entry = entries.get(from);
      if (!entry) throw new Error(`ENOENT ${from}`);
      entries.delete(from);
      entries.set(to, entry);
    },
  };

  render(
    () =>
      FileExplorer({
        root: '/workspace',
        visible: true,
        vfs,
        mutations,
        onOpenFile: () => {},
      }),
    root,
  );
}
