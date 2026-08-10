/// <reference lib="webworker" />

import { OpfsFsSync, OpfsVfs } from '@riftydev/vfs';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const PRODUCTION_WATCHDOG_MS = 30_000;
const TEST_WATCHDOG_MS = 1_000;
const FILE_COUNT = 12_000;

interface AcceptanceResult {
  readonly fileCount: number;
  readonly flushMs: number;
  readonly maxWriteMs: number;
  readonly persistedTail: readonly number[];
  readonly reportTotal: number;
  readonly watchdogMs: number;
  readonly watchdogTimers: number;
  readonly writes: number;
}

class MeasuredOpfsVfs extends OpfsVfs {
  maxWriteMs = 0;
  writes = 0;

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const startedAt = performance.now();
    try {
      await super.writeFile(path, data);
    } finally {
      this.maxWriteMs = Math.max(this.maxWriteMs, performance.now() - startedAt);
      this.writes++;
    }
  }
}

function installScaledWatchdogClock(): {
  readonly count: () => number;
  readonly restore: () => void;
} {
  // Scale only the production watchdog; OPFS work and its measured latency stay real.
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  let watchdogTimers = 0;
  globalThis.setTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number => {
    if (timeout === PRODUCTION_WATCHDOG_MS) watchdogTimers += 1;
    return nativeSetTimeout(
      handler,
      timeout === PRODUCTION_WATCHDOG_MS ? TEST_WATCHDOG_MS : timeout,
      ...args,
    );
  }) as typeof globalThis.setTimeout;
  return {
    count: () => watchdogTimers,
    restore() {
      globalThis.setTimeout = nativeSetTimeout as typeof globalThis.setTimeout;
    },
  };
}

async function runAcceptance(): Promise<AcceptanceResult> {
  const namespace = `/issue-247-opfs-${crypto.randomUUID()}`;
  const surface = new MeasuredOpfsVfs();
  await surface.init();
  await surface.mkdir(namespace, { recursive: true });
  const fs = await OpfsFsSync.init(surface);
  const scaledClock = installScaledWatchdogClock();
  const expectedTail = new Uint8Array([0x24, 0x70, 0x47, 0xff]);

  try {
    for (let index = 0; index < FILE_COUNT; index++) {
      const data = index === FILE_COUNT - 1 ? expectedTail : new Uint8Array([index & 0xff]);
      fs.writeFileSync(`${namespace}/entry-${index.toString().padStart(5, '0')}.bin`, data);
    }

    const flushStartedAt = performance.now();
    const report = await fs.flush();
    const flushMs = performance.now() - flushStartedAt;

    // A new backend instance has no access to the sync mirror's memory cache.
    // Reading the FIFO tail through it proves flush returned after real OPFS durability.
    const reopened = new OpfsVfs();
    await reopened.init();
    const persistedTail = await reopened.readFile(
      `${namespace}/entry-${(FILE_COUNT - 1).toString().padStart(5, '0')}.bin`,
    );

    return {
      fileCount: FILE_COUNT,
      flushMs,
      maxWriteMs: surface.maxWriteMs,
      persistedTail: [...persistedTail],
      reportTotal: report.total,
      watchdogMs: TEST_WATCHDOG_MS,
      watchdogTimers: scaledClock.count(),
      writes: surface.writes,
    };
  } finally {
    scaledClock.restore();
  }
}

scope.addEventListener('message', () => {
  void runAcceptance().then(
    (result) => scope.postMessage({ ok: true, result }),
    (error: unknown) =>
      scope.postMessage({
        ok: false,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      }),
  );
});
