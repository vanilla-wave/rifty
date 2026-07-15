import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerSlot = vi.hoisted(() => ({
  value: undefined as (() => Uint8Array) | undefined,
}));

vi.mock('@riftydev/net/sqlite/engine', () => ({
  setSqliteEngineSyncProvider(provider: () => Uint8Array): void {
    providerSlot.value = provider;
  },
}));

import { installSqliteWasmSyncProvider } from './sqlite-wasm-provider.ts';

class CapturingXmlHttpRequest {
  static requestedUrl: string | undefined;

  readonly status = 200;
  readonly responseText = String.fromCharCode(0, 255, 127);

  open(method: string, url: string, async: boolean): void {
    expect(method).toBe('GET');
    expect(async).toBe(false);
    CapturingXmlHttpRequest.requestedUrl = url;
  }

  overrideMimeType(_mime: string): void {}

  send(): void {}
}

beforeEach(() => {
  providerSlot.value = undefined;
  CapturingXmlHttpRequest.requestedUrl = undefined;
  vi.stubGlobal('XMLHttpRequest', CapturingXmlHttpRequest);
});

describe('SQLite WASM provider host-config provenance', () => {
  it.each([undefined, ''])(
    'rejects missing/blank inherited URL before installing a fallback (%s)',
    (url) => {
      expect(() => (installSqliteWasmSyncProvider as (value?: string) => void)(url)).toThrow(
        /sqlite wasm URL must be non-empty/i,
      );
      expect(providerSlot.value).toBeUndefined();
    },
  );

  it('fetches exactly the inherited URL when the lazy provider runs', () => {
    const inheritedUrl = 'blob:exact-host-sqlite-wasm';
    installSqliteWasmSyncProvider(inheritedUrl);

    expect(providerSlot.value?.()).toEqual(Uint8Array.from([0, 255, 127]));
    expect(CapturingXmlHttpRequest.requestedUrl).toBe(inheritedUrl);
  });
});
