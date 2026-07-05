/**
 * SYNC `closureHashOf` — `@riftydev/eddy`'s pre-existing public API returned
 * a plain `string`; when the implementation moved to `@riftydev/npm-client`
 * (async WebCrypto so the CLIENT can verify bundles in the browser, ADR-0194)
 * this Node-only sync twin stayed to keep existing consumers working. It
 * hashes the SAME shared canonical serialization (`canonicalClosureJson`) —
 * only the digest call differs (`node:crypto` vs `crypto.subtle`) — and a
 * drift tripwire test asserts sync === await async.
 */
import { createHash } from 'node:crypto';
import { type Lockfile, canonicalClosureJson } from '@riftydev/npm-client';

export function closureHashOf(lockfile: Lockfile): string {
  return `sha256-${createHash('sha256').update(canonicalClosureJson(lockfile)).digest('base64')}`;
}
