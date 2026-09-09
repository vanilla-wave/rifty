export const recoveryNamespace = ' recovery-A ';
export const orphanRoot = '/.rifty/workbench/v1/projects/scratch/tree';
export const retainedRoot = '/.rifty/workbench/playground/retained-scratch';
export const catalogPath = '/.rifty/workbench/playground/catalog.json';
export const originalBytes = [0, 1, 2, 127, 128, 254, 255, 13, 10];
const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
export const ordinaryFiles: Readonly<Record<string, readonly number[]>> = {
  'user.bin': originalBytes,
  'src/main.ts': bytes('console.log("retained source");\n'),
  'node_modules/pkg/index.js': bytes('module.exports = 42;\n'),
  'dist/bundle.js': bytes('console.log("retained build");\n'),
  '.git/HEAD': bytes('ref: refs/heads/main\n'),
  '.rifty-install-stamp.json': bytes('ordinary filename outside node_modules\n'),
  '.vite/cache.bin': [4, 0, 255],
  'src/.rifty/note.txt': bytes('nested user metadata\n'),
  '雪.txt': bytes('literal unicode\n'),
  'percent%2Fname.txt': bytes('literal percent\n'),
  'empty.bin': [],
};
export const ordinaryDirectories = [
  '.git',
  '.vite',
  'dist',
  'empty-dir',
  'nested',
  'nested/node_modules',
  'node_modules',
  'node_modules/pkg',
  'node_modules/pkg/empty',
  'src',
  'src/.rifty',
  'src/.rifty/empty',
].sort();
export const excludedFiles: Readonly<Record<string, readonly number[]>> = {
  '.rifty/private.bin': [16, 17],
  'node_modules/.rifty-install-stamp.json': [255, 0, 1],
  'nested/node_modules/.rifty-install-stamp.json/child.bin': [18, 19],
};

export interface RetainedCatalog {
  listRetainedScratch(): Promise<readonly { readonly id: string }[]>;
  exportRetainedScratch(id: string): Promise<string>;
}

export async function seedNativeOrphan(): Promise<void> {
  const origin = await navigator.storage.getDirectory();
  async function directory(path: string) {
    let dir = origin;
    for (const part of path.split('/').filter(Boolean))
      dir = await dir.getDirectoryHandle(part, { create: true });
    return dir;
  }
  const source = `${recoveryNamespace}${orphanRoot}`;
  for (const path of ordinaryDirectories) await directory(`${source}/${path}`);
  const files = {
    ...Object.fromEntries(
      Object.entries({ ...ordinaryFiles, ...excludedFiles }).map(([path, content]) => [
        `${source}/${path}`,
        content,
      ]),
    ),
    'default-sentinel.bin': [91, 0, 255],
    [`${orphanRoot.slice(1)}/default.bin`]: [92, 128, 1],
    'recovery-B/sibling.bin': [93, 255, 2],
  };
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    const name = parts.pop();
    if (name === undefined) throw new Error('Missing seed file name');
    const writer = await (
      await (
        await directory(parts.join('/'))
      )
        .getFileHandle(name, { create: true })
        .catch((error: unknown) => {
          throw new Error(`Native seed refused ${JSON.stringify(path)}: ${String(error)}`, {
            cause: error,
          });
        })
    ).createWritable();
    await writer.write(new Uint8Array(content));
    await writer.close();
  }
}

export interface NativeTree {
  readonly directories: readonly string[];
  readonly files: Readonly<Record<string, readonly number[]>>;
}

export async function nativeTree(path: string): Promise<NativeTree | null> {
  let root = await navigator.storage.getDirectory();
  try {
    for (const part of path.split('/').filter(Boolean)) root = await root.getDirectoryHandle(part);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
  const files: Record<string, number[]> = {};
  const directories: string[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, entry] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      const relative = `${prefix}${name}`;
      if (entry.kind === 'directory') {
        directories.push(relative);
        await walk(entry as FileSystemDirectoryHandle, `${relative}/`);
      } else {
        files[relative] = Array.from(
          new Uint8Array(await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer()),
        );
      }
    }
  };
  await walk(root, '');
  return { directories: directories.sort(), files };
}

export async function nativeCatalog(): Promise<{
  readonly raw: readonly number[] | null;
  readonly value: Record<string, unknown> | null;
}> {
  const tree = await nativeTree(`${recoveryNamespace}/.rifty/workbench/playground`);
  const raw = tree?.files['catalog.json'] ?? null;
  // Native getFileHandle creates a zero-byte placeholder before the first atomic close.
  // Preserve that observation separately; production recovery still sees the real bytes.
  if (raw === null || raw.length === 0) return { raw, value: null };
  return {
    raw,
    value: JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as Record<string, unknown>,
  };
}
