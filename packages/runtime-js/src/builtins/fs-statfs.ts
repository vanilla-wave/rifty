/**
 * `fs.statfsSync` — named-loud member (vitest-run-in-browser). Split from
 * `fs.ts` under the 800-line ratchet (same pattern as `fs-watch.ts`).
 *
 * Node returns real volume statistics (bsize/blocks/bfree/…); the Memory VFS
 * has no volume, so any number would be fabricated — the member links/binds
 * (vitest's cli-api imports it), the CALL is the loud gap. Declared compat
 * ❌ row in `docs/public/compat/fs.md` (generator inventory).
 */
import { NotImplementedError } from '@riftydev/io';

export function statfsSync(p: string): never {
  throw new NotImplementedError('fs.statfsSync');
}
