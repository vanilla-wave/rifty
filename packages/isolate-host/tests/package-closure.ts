/**
 * A package's installed closure for a sandbox state and an oracle dir holding the same files
 * (library tests, ADR-0568); the closure and the oracle: `closure-files.ts`.
 */
import { GUEST_DIRS, MemoryFsSync, snapshotFs } from '../src/codec.ts';
import { createSandbox } from '../src/index.ts';
import type { Outcome } from './closure-files.ts';

export { closureFiles, inNode, type Outcome } from './closure-files.ts';

const MAX_FS_BYTES = 256 * 2 ** 20;
/** The state as one snapshot, as a consumer ships it (one call, not one per file). */
function snapshotOf(files: Map<string, Uint8Array>): Uint8Array {
  const fs = new MemoryFsSync();
  for (const dir of GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  for (const [rel, data] of files) {
    const path = `/workspace/${rel}`;
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(path, data);
  }
  return snapshotFs(fs, { template: null, maxBytes: MAX_FS_BYTES });
}

/** The sandbox's run of `node <gen>` over `files`; `written`: every file under `/workspace` after it that `keep` admits. */
export async function inSandboxWritten(
  files: Map<string, Uint8Array>,
  gen: string,
  keep: (path: string) => boolean,
): Promise<Omit<Outcome, 'file'> & { readonly written: Map<string, Uint8Array> }> {
  const sb = await createSandbox({ snapshot: snapshotOf(files), maxFsBytes: MAX_FS_BYTES });
  try {
    const r = await sb.exec(gen, { timeoutMs: 120_000, memoryLimitMb: 512 });
    const written = new Map<string, Uint8Array>();
    const walk = async (rel: string): Promise<void> => {
      for (const e of await sb.list(rel === '' ? '/workspace' : `/workspace/${rel}`)) {
        const path = rel === '' ? e.name : `${rel}/${e.name}`;
        if (!keep(path)) continue;
        if (e.type === 'directory') await walk(path);
        else written.set(path, await sb.readFile(path));
      }
    };
    await walk('');
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, written };
  } finally {
    await sb.destroy();
  }
}

export async function inSandbox(
  files: Map<string, Uint8Array>,
  gen: string,
  out: string,
): Promise<Outcome> {
  const sb = await createSandbox({ snapshot: snapshotOf(files), maxFsBytes: MAX_FS_BYTES });
  try {
    const r = await sb.exec(gen, { args: [out], timeoutMs: 60_000, memoryLimitMb: 512 });
    let file: Uint8Array | undefined;
    try {
      file = await sb.readFile(out);
    } catch {}
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, file };
  } finally {
    await sb.destroy();
  }
}
