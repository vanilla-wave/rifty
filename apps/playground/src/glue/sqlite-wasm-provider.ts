/**
 * Sync sql.js wasm-bytes provider for the `node:sqlite` builtin (backlog:
 * net/sqlite-lazy-engine). Installed at worker-realm boot: the engine is paid
 * for ONLY at the first `require('node:sqlite')` (the builtin factory calls the
 * provider → sync bring-up), never eagerly and never gated on a preset flag.
 *
 * Bytes arrive via SYNC XHR — legal in workers; the binary-through-text hack
 * (x-user-defined + charCodeAt & 0xff) is required because a sync XHR cannot
 * set responseType. The wasm URL is a bundled same-origin asset (D-004: no
 * hardcoded external URLs), HTTP-cached after the first realm's fetch.
 */
import { setSqliteEngineSyncProvider } from '@riftydev/net/sqlite/engine';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export function fetchWasmBytesSync(url: string): Uint8Array {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send();
  // status 0 = opaque success in some worker/file contexts; anything else non-200 is a real miss.
  if (xhr.status !== 200 && xhr.status !== 0) {
    throw new Error(`node:sqlite wasm fetch failed: HTTP ${xhr.status} for ${url}`);
  }
  const text = xhr.responseText;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

export function installSqliteWasmSyncProvider(url: string = sqlWasmUrl): void {
  setSqliteEngineSyncProvider(() => fetchWasmBytesSync(url));
}
