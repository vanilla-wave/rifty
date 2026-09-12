/// <reference lib="webworker" />
import { installOpfsFs } from '@riftydev/vfs/internal';

declare const self: DedicatedWorkerGlobalScope;
interface Request {
  readonly namespace?: string;
  readonly files?: Readonly<Record<string, readonly number[]>>;
  readonly directories?: readonly string[];
  readonly paths?: readonly string[];
  readonly remove?: readonly string[];
}
async function run(input: Request) {
  const origin = await navigator.storage.getDirectory();
  const root =
    input.namespace === undefined
      ? origin
      : await origin.getDirectoryHandle(input.namespace, { create: true });
  const pair = await installOpfsFs(root, { layout: 'replica' });
  try {
    for (const path of input.remove ?? [])
      pair.fsSync.rmSync(path, { recursive: true, force: true });
    for (const path of input.directories ?? []) pair.fsSync.mkdirSync(path, { recursive: true });
    for (const [path, bytes] of Object.entries(input.files ?? {})) {
      pair.fsSync.mkdirSync(path.slice(0, path.lastIndexOf('/')) || '/', { recursive: true });
      pair.fsSync.writeFileSync(path, new Uint8Array(bytes));
    }
    if ((await pair.fsSync.flush()).total) throw new Error('Native replica seed failed');
    const result: Record<string, number[] | null> = {};
    for (const path of input.paths ?? [])
      result[path] = pair.fsSync.existsSync(path) ? [...(await pair.vfs.readFile(path))] : null;
    return result;
  } finally {
    pair.fsSync.closeAll();
  }
}
self.onmessage = ({ data }: MessageEvent<Request>) => {
  void run(data).then(
    (result) => self.postMessage({ result }),
    (error: unknown) => self.postMessage({ error: String(error) }),
  );
};
