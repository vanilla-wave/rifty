/**
 * A package's installed closure for a sandbox state and an oracle dir holding the same files
 * (library tests, ADR-0568); the closure and the oracle: `closure-files.ts`.
 */
import { GUEST_DIRS, MemoryFsSync, snapshotFs } from '../src/codec.ts';
import { createSandbox } from '../src/index.ts';
import type { Outcome } from './closure-files.ts';

export { closureFiles, inNode, type Outcome } from './closure-files.ts';

export async function inSandbox(
  files: Map<string, Uint8Array>,
  gen: string,
  out: string,
): Promise<Outcome> {
  // The state as one snapshot, as a consumer ships it (one call, not one per file).
  const fs = new MemoryFsSync();
  for (const dir of GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  for (const [rel, data] of files) {
    const path = `/workspace/${rel}`;
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(path, data);
  }
  const maxFsBytes = 256 * 2 ** 20;
  const snapshot = snapshotFs(fs, { template: null, maxBytes: maxFsBytes });
  const sb = await createSandbox({ snapshot, maxFsBytes });
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
