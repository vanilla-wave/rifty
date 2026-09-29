/**
 * Named-loud Node members (ADR-0443): a claimed consumer links them by name or
 * binds them at load (vitest 4.1.11, tinyexec 1.3.1), but their real result —
 * host filesystem statistics, a synchronous child with status/stderr/signal,
 * RSS/V8 heap numbers — has no browser-realm source. Each sits on its Node
 * owner object with Node's descriptor; every call throws, never a value.
 */
import { NotImplementedError } from '@riftydev/io';

export function statfsSync(..._args: unknown[]): never {
  throw new NotImplementedError('fs.statfsSync');
}

export function spawnSync(..._args: unknown[]): never {
  throw new NotImplementedError('child_process.spawnSync');
}

export function memoryUsage(..._args: unknown[]): never {
  throw new NotImplementedError('process.memoryUsage');
}
memoryUsage.rss = function rss(): never {
  throw new NotImplementedError('process.memoryUsage.rss');
};
