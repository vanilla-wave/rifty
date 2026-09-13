import { OpfsFsSync, initBackend, syncMirror } from '@riftydev/vfs';

interface Seed {
  readonly namespace: string;
  readonly directories: readonly string[];
  readonly files: readonly { readonly path: string; readonly content: string }[];
}
self.onmessage = ({ data }: MessageEvent<Seed>) => {
  void (async () => {
    await initBackend({ namespace: data.namespace, persistence: 'required' });
    const fs = syncMirror();
    if (!(fs instanceof OpfsFsSync)) throw new Error('Packed VFS did not select native storage');
    try {
      const root = '/.rifty/workbench/v2/projects/scratch/tree';
      for (const path of data.directories) fs.mkdirSync(`${root}/${path}`, { recursive: true });
      for (const file of data.files) {
        const path = `${root}/${file.path}`;
        fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        fs.writeFileSync(
          path,
          Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
        );
      }
      if ((await fs.flush()).total) throw new Error('Packed native orphan seed did not persist');
    } finally {
      fs.closeAll();
    }
    self.postMessage({ ok: true });
  })().catch((error: unknown) => self.postMessage({ error: String(error) }));
};
