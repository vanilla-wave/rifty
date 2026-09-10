import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const netRequire = createRequire(new URL('../../../net/package.json', import.meta.url));
const wasm = readFileSync(netRequire.resolve('sql.js/dist/sql-wasm.wasm'));

class CapturingXmlHttpRequest {
  static requestedUrl: string | undefined;
  readonly status = 200;
  readonly responseText = wasm.toString('latin1');
  open(method: string, url: string, async: boolean): void {
    expect(method).toBe('GET');
    expect(async).toBe(false);
    CapturingXmlHttpRequest.requestedUrl = url;
  }
  overrideMimeType(_mime: string): void {}
  send(): void {}
}

beforeEach(() => {
  vi.resetModules();
  CapturingXmlHttpRequest.requestedUrl = undefined;
  vi.stubGlobal('XMLHttpRequest', CapturingXmlHttpRequest);
});
afterEach(() => vi.unstubAllGlobals());

describe('SQLite WASM provider host-config provenance', () => {
  it('omits the provider without a URL and names the missing Workbench option on use', async () => {
    const { installSqliteWasmSyncProvider } = await import('./sqlite-wasm-provider.ts');
    const engine = await import('@riftydev/net/sqlite/engine');
    expect(() =>
      (installSqliteWasmSyncProvider as (url?: string) => void)(undefined),
    ).not.toThrow();
    engine.ensureSqliteEngineFromProvider();
    expect(CapturingXmlHttpRequest.requestedUrl).toBeUndefined();
    expect(() => engine.getSqliteEngine()).toThrow(/deployment\.wasm\.sqlite/);
  });

  it.each(['', ' '])('rejects a supplied blank URL (%j)', async (url) => {
    const { installSqliteWasmSyncProvider } = await import('./sqlite-wasm-provider.ts');
    expect(() => installSqliteWasmSyncProvider(url)).toThrow(/sqlite wasm URL must be non-empty/i);
    expect(CapturingXmlHttpRequest.requestedUrl).toBeUndefined();
  });

  it('lazily initializes real SQLite from exactly the inherited URL', async () => {
    const { installSqliteWasmSyncProvider } = await import('./sqlite-wasm-provider.ts');
    const engine = await import('@riftydev/net/sqlite/engine');
    const inheritedUrl = 'blob:https://consumer.test/exact-host-sqlite-wasm';
    installSqliteWasmSyncProvider(inheritedUrl);
    expect(CapturingXmlHttpRequest.requestedUrl).toBeUndefined();
    engine.ensureSqliteEngineFromProvider();
    const db = new (engine.getSqliteEngine().Database)();
    expect(db.exec('SELECT 42 AS answer')[0]?.values).toEqual([[42]]);
    db.close();
    expect(CapturingXmlHttpRequest.requestedUrl).toBe(inheritedUrl);
  });
});
