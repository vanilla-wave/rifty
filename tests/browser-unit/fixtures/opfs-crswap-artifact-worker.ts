/// <reference lib="webworker" />
/**
 * Repro fixture for the `.crswap` artifact leak (fault: torn-state × Storage
 * (OPFS) read surface; observed as CI flake of opfs-parallel-drain-kill at
 * run 31942415727 — retry scan saw "unexpected: …/f001.js.crswap").
 *
 * Chromium implements `createWritable()` as an atomic swap through a sibling
 * `<name>.crswap` temp entry. A realm killed before `close()` leaves that
 * temp behind, and the raw directory iterator reports it like any file. The
 * rifty OPFS read surface must NOT surface it: no Node program ever created
 * that entry — after a crash-reload, real Node fs shows the target file
 * (complete or empty), never the platform's mid-op artifact.
 *
 * `leak` phase: writes one COMPLETE control file through the production
 * surface, then holds an UNCLOSED raw `createWritable` on `victim.js` and
 * acks — the page terminates this realm, orphaning `victim.js.crswap`.
 * `observe` phase (fresh realm): reports the RAW entry names (precondition:
 * the artifact really exists), the platform's stance on user-created
 * `*.crswap` names (probed step-by-step, recorded as fact — Chromium allows
 * them, which is why the fix pairs the filter with a loud reservation), and
 * the rifty surfaces: `OpfsVfs.readdir` + booted `OpfsFsSync`
 * (`readdirSync`, `existsSync`) — the leak's two production chokepoints.
 */
import { OpfsFsSync, OpfsVfs } from '@riftydev/vfs';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();

const COMPLETE_BYTES = 'complete-control-file\n';

interface RawDirHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<RawDirHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<{ write(d: Uint8Array): Promise<void> }> }>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

async function rawDir(nsPath: string, create: boolean): Promise<RawDirHandle> {
  const storage = (navigator as unknown as { storage: { getDirectory(): Promise<RawDirHandle> } })
    .storage;
  let dir = await storage.getDirectory();
  for (const segment of nsPath.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(segment, { create });
  }
  return dir;
}

async function rawNames(nsPath: string): Promise<string[]> {
  const dir = await rawDir(nsPath, false);
  const names: string[] = [];
  for await (const [name] of dir as unknown as AsyncIterable<[string, unknown]>) {
    names.push(name);
  }
  return names.sort();
}

/** Phase 1: complete control file + an UNCLOSED writable, then ack and hold. */
async function leak(ns: string): Promise<void> {
  const vfs = new OpfsVfs();
  await vfs.mkdir(`${ns}/dir`, { recursive: true });
  await vfs.writeFile(`${ns}/dir/complete.js`, COMPLETE_BYTES);
  const dir = await rawDir(`${ns}/dir`, false);
  const victim = await dir.getFileHandle('victim.js', { create: true });
  const writable = await victim.createWritable();
  await writable.write(encoder.encode('never-swapped-bytes'));
  scope.postMessage({ ok: true, result: { phase: 'held' } });
  await new Promise(() => {}); // hold the writable open until terminate()
}

interface ObserveResult {
  readonly rawEntries: readonly string[];
  /** Outcome of user-level `getFileHandle('probe.crswap', {create:true})`. */
  readonly platformCrswapCreate: string;
  readonly vfsReaddir: readonly string[];
  readonly syncReaddir: readonly string[];
  readonly syncCrswapExists: boolean;
  readonly completeBytesOk: boolean;
  readonly victimEmptyVisible: boolean;
  /** Reservation pins: error CODE per rifty create op targeting `*.crswap`. */
  readonly reserveVfsWrite: string;
  readonly reserveSyncWrite: string;
  readonly reserveSyncMkdir: string;
  readonly reserveSyncRename: string;
}

/** Phase 2 (fresh realm): raw truth, platform pin, then both rifty surfaces. */
async function observe(ns: string): Promise<ObserveResult> {
  const rawEntries = await rawNames(`${ns}/dir`);
  // Platform fact, not an assumption: can USER code fully write a file whose
  // name ends in `.crswap`? (getFileHandle create / createWritable / close
  // recorded step by step — the fix's honesty depends on the answer.)
  let platformCrswapCreate = 'created';
  try {
    const dir = await rawDir(`${ns}/dir`, false);
    let step = 'getFileHandle';
    try {
      const probe = await dir.getFileHandle('probe.crswap', { create: true });
      step = 'createWritable';
      const writable = (await probe.createWritable()) as {
        write(d: Uint8Array): Promise<void>;
        close(): Promise<void>;
      };
      step = 'write';
      await writable.write(encoder.encode('probe'));
      step = 'close';
      await writable.close();
    } catch (error) {
      platformCrswapCreate = `rejected@${step}: ${error instanceof Error ? error.name : String(error)}`;
    } finally {
      await dir.removeEntry('probe.crswap').catch(() => {});
    }
  } catch (error) {
    platformCrswapCreate = `probe-failed: ${error instanceof Error ? error.name : String(error)}`;
  }
  const vfs = new OpfsVfs();
  const vfsReaddir = (await vfs.readdir(`${ns}/dir`)).map((entry) => entry.name).sort();
  const fsSync = await OpfsFsSync.init(new OpfsVfs());
  const syncReaddir = fsSync
    .readdirSync(`${ns}/dir`)
    .map((entry) => entry.name)
    .sort();
  const syncCrswapExists = fsSync.existsSync(`${ns}/dir/victim.js.crswap`);
  const complete = await vfs.readFile(`${ns}/dir/complete.js`).catch(() => null);
  const completeBytesOk =
    complete !== null && new TextDecoder().decode(complete) === COMPLETE_BYTES;
  const victimEmptyVisible = vfsReaddir.includes('victim.js') && syncReaddir.includes('victim.js');
  // Reservation: every rifty create op targeting `*.crswap` refuses loudly
  // (the platform ALLOWS such user files — see platformCrswapCreate — so the
  // enumeration filter without reservation would silently hide real data).
  const code = (error: unknown): string =>
    error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'no-throw';
  const reserveVfsWrite = await vfs
    .writeFile(`${ns}/dir/user.crswap`, 'x')
    .then(() => 'no-throw', code);
  const attempt = (op: () => void): string => {
    try {
      op();
      return 'no-throw';
    } catch (error) {
      return code(error);
    }
  };
  const reserveSyncWrite = attempt(() =>
    fsSync.writeFileSync(`${ns}/dir/user.crswap`, encoder.encode('x')),
  );
  const reserveSyncMkdir = attempt(() => fsSync.mkdirSync(`${ns}/dir/sub.crswap`));
  const reserveSyncRename = attempt(() =>
    fsSync.renameSync(`${ns}/dir/complete.js`, `${ns}/dir/complete.crswap`),
  );
  return {
    rawEntries,
    platformCrswapCreate,
    vfsReaddir,
    syncReaddir,
    syncCrswapExists,
    completeBytesOk,
    victimEmptyVisible,
    reserveVfsWrite,
    reserveSyncWrite,
    reserveSyncMkdir,
    reserveSyncRename,
  };
}

async function cleanup(ns: string): Promise<void> {
  const storage = (navigator as unknown as { storage: { getDirectory(): Promise<RawDirHandle> } })
    .storage;
  const root = await storage.getDirectory();
  await root.removeEntry(ns.replace(/^\//, ''), { recursive: true }).catch(() => {});
}

scope.addEventListener('message', (event: MessageEvent<{ phase?: string; ns?: string }>) => {
  const { phase, ns } = event.data ?? {};
  const run =
    phase === 'leak' && ns !== undefined
      ? leak(ns)
      : phase === 'observe' && ns !== undefined
        ? observe(ns).then((result) => scope.postMessage({ ok: true, result }))
        : phase === 'cleanup' && ns !== undefined
          ? cleanup(ns).then(() => scope.postMessage({ ok: true, result: { phase: 'clean' } }))
          : Promise.reject(new Error(`unknown phase: ${String(phase)}`));
  void run.catch((error: unknown) => {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  });
});
