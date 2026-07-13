import { type PersistFailureReport, syncMirror } from '@riftydev/vfs';

/** Drain this realm's OPFS write-through; memory/remote mirrors are no-ops. */
export async function flushSyncMirror(): Promise<PersistFailureReport | undefined> {
  const mirror = syncMirror() as { flush?: () => Promise<PersistFailureReport | undefined> };
  return typeof mirror.flush === 'function' ? await mirror.flush() : undefined;
}
