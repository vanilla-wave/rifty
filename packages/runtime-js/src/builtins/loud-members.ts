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

export function execFileSync(..._args: unknown[]): never {
  throw new NotImplementedError('child_process.execFileSync');
}

export function memoryUsage(..._args: unknown[]): never {
  throw new NotImplementedError('process.memoryUsage');
}
memoryUsage.rss = function rss(): never {
  throw new NotImplementedError('process.memoryUsage.rss');
};

/**
 * Links (`fs.symlink*`, `fs.link*`): rifty's VFS has none (ADR-0050). Named-loud
 * for model-written programs in the isolate sandbox (ADR-0568), so a call names
 * the gap instead of `TypeError: … is not a function`.
 */
export function symlinkSync(..._args: unknown[]): never {
  throw new NotImplementedError('fs.symlinkSync', 'the rifty VFS has no links, ADR-0050');
}
export function linkSync(..._args: unknown[]): never {
  throw new NotImplementedError('fs.linkSync', 'the rifty VFS has no links, ADR-0050');
}
export function symlink(..._args: unknown[]): never {
  throw new NotImplementedError('fs.symlink', 'the rifty VFS has no links, ADR-0050');
}
export function link(..._args: unknown[]): never {
  throw new NotImplementedError('fs.link', 'the rifty VFS has no links, ADR-0050');
}
