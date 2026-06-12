/**
 * Unit tests for the playground bootstrap helpers (ADR-0013).
 *
 * The Solid render path itself isn't exercised here — that's e2e territory.
 * What we lock in is the contract every shipping `main.tsx` depends on:
 *
 *   1. `bootstrap` always awaits the backend installer.
 *   2. `bootstrap` never throws — failures degrade to memory + reason.
 *   3. `backendLabel` produces the user-facing string the badge renders.
 *
 * Together these guarantee that the UI receives a well-formed descriptor and
 * that `main.tsx`'s `await bootstrap()` is doing real work — not a stub that
 * resolves synchronously to a default.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  COI_FATAL_MESSAGE,
  assertCrossOriginIsolated,
  backendLabel,
  bootstrap,
  bootstrapPlayground,
  reasonOf,
  swErrorBannerMessage,
} from './boot.ts';

describe('bootstrap', () => {
  it('awaits initBackend before resolving', async () => {
    const order: string[] = [];
    const impl = async () => {
      order.push('init:start');
      // Force a microtask boundary so a non-awaited call would race.
      await Promise.resolve();
      order.push('init:end');
      return 'memory' as const;
    };

    const pending = bootstrap(impl, { warn: () => {} });
    order.push('after-call');
    const result = await pending;
    order.push('awaited');

    expect(result.backend).toBe('memory');
    expect(order).toEqual(['init:start', 'after-call', 'init:end', 'awaited']);
  });

  it('surfaces the OPFS choice when initBackend resolves to opfs', async () => {
    const impl = vi.fn(async () => 'opfs' as const);
    const result = await bootstrap(impl, { warn: () => {} });
    expect(impl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ backend: 'opfs' });
  });

  it('falls back to memory and surfaces the cause when initBackend throws', async () => {
    const warn = vi.fn();
    const impl = vi.fn(async () => {
      throw new Error('OPFS quota exceeded');
    });
    const result = await bootstrap(impl, { warn });
    expect(result.backend).toBe('memory');
    expect(result.reason).toBe('OPFS quota exceeded');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/OPFS quota exceeded/);
  });

  it('falls back to memory when initBackend throws a non-Error value', async () => {
    const warn = vi.fn();
    const impl = vi.fn(async () => {
      throw 'plain string failure';
    });
    const result = await bootstrap(impl, { warn });
    expect(result.backend).toBe('memory');
    expect(result.reason).toBe('plain string failure');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('backendLabel', () => {
  it('reports OPFS without implying persistence', () => {
    expect(backendLabel({ backend: 'opfs' })).toBe('Storage: OPFS');
  });

  it('reports memory backend as non-persistent', () => {
    expect(backendLabel({ backend: 'memory' })).toBe('Storage: in-memory (will not persist)');
  });

  it('flags memory-after-failure separately from clean memory selection', () => {
    expect(backendLabel({ backend: 'memory', reason: 'denied' })).toBe(
      'Storage: in-memory (will not persist) — OPFS init failed',
    );
  });
});

describe('reasonOf', () => {
  it('extracts message from Error', () => {
    expect(reasonOf(new Error('boom'))).toBe('boom');
  });

  it('extracts message from TypeError', () => {
    expect(reasonOf(new TypeError('bad type'))).toBe('bad type');
  });

  it('stringifies non-Error rejections', () => {
    expect(reasonOf('plain string')).toBe('plain string');
    expect(reasonOf(42)).toBe('42');
    expect(reasonOf(null)).toBe('null');
    expect(reasonOf(undefined)).toBe('undefined');
  });
});

describe('swErrorBannerMessage', () => {
  it('formats a SW registration failure into the banner copy', () => {
    expect(swErrorBannerMessage('SecurityError')).toBe(
      'Preview unavailable — service worker registration failed: SecurityError. Reload to retry.',
    );
  });

  it('is the exact string the banner template renders for a rejected registration', async () => {
    // Mirror the flow `bootstrapPlayground` runs: registerServiceWorker
    // rejects, the catch arm pulls a reason out via reasonOf, and the banner
    // template calls swErrorBannerMessage with that reason. A test for the
    // banner _state_ rather than the rendered DOM (jsdom is not available
    // here), but locks in that the message users see equals what tests
    // assert.
    const registerServiceWorker = vi.fn(async () => {
      throw new Error('sw script unreachable');
    });
    let swError: string | null = null;
    try {
      await registerServiceWorker();
    } catch (err) {
      swError = reasonOf(err);
    }
    expect(swError).toBe('sw script unreachable');
    expect(swErrorBannerMessage(swError ?? '')).toBe(
      'Preview unavailable — service worker registration failed: sw script unreachable. Reload to retry.',
    );
  });
});

describe('assertCrossOriginIsolated', () => {
  it('is a no-op when the realm is isolated', () => {
    const renderFatal = vi.fn();
    const logger = { error: vi.fn() };
    expect(() =>
      assertCrossOriginIsolated({ check: () => true, renderFatal, logger }),
    ).not.toThrow();
    expect(renderFatal).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('throws, paints the DOM, and logs when the realm is NOT isolated', () => {
    const renderFatal = vi.fn();
    const logger = { error: vi.fn() };
    expect(() =>
      assertCrossOriginIsolated({ check: () => false, renderFatal, logger }),
    ).toThrowError(COI_FATAL_MESSAGE);
    expect(renderFatal).toHaveBeenCalledTimes(1);
    expect(renderFatal.mock.calls[0]?.[0]).toBe(COI_FATAL_MESSAGE);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toBe(COI_FATAL_MESSAGE);
  });

  it('produces an actionable message that mentions COOP and COEP', () => {
    // The user-facing copy must point at the headers — that's the actionable
    // remediation. Locking it in so a refactor that strips the headers from
    // the message body trips this test.
    expect(COI_FATAL_MESSAGE).toMatch(/Cross-Origin-Opener-Policy/);
    expect(COI_FATAL_MESSAGE).toMatch(/Cross-Origin-Embedder-Policy/);
    expect(COI_FATAL_MESSAGE).toMatch(/SharedArrayBuffer/);
  });

  it('explains embedded iframe requirements when isolation is unavailable', () => {
    expect(COI_FATAL_MESSAGE).toMatch(/embedded/i);
    expect(COI_FATAL_MESSAGE).toMatch(/iframe/i);
    expect(COI_FATAL_MESSAGE).toContain('allow="cross-origin-isolated"');
  });
});

describe('bootstrapPlayground', () => {
  it('asserts COI, initialises the VFS, registers the SW, then resolves', async () => {
    const order: string[] = [];
    const assertCoi = vi.fn(() => {
      order.push('coi');
    });
    const initVfs = vi.fn(async () => {
      order.push('vfs');
      return 'opfs' as const;
    });
    const registerSw = vi.fn(async (url: string) => {
      order.push(`sw:${url}`);
      return { registration: {}, active: {} };
    });
    const probeStorage = vi.fn(async () => {
      order.push('storage');
      return {
        available: true as const,
        persistedBefore: false,
        persistedAfter: true,
        usage: 10,
        quota: 100,
      };
    });

    const result = await bootstrapPlayground({
      assertCoi,
      initVfs,
      registerSw,
      probeStorage,
      logger: { warn: () => {}, error: () => {} },
    });

    expect(order).toEqual(['coi', 'vfs', 'storage', 'sw:/sw.js']);
    expect(assertCoi).toHaveBeenCalledTimes(1);
    expect(initVfs).toHaveBeenCalledTimes(1);
    expect(probeStorage).toHaveBeenCalledTimes(1);
    expect(registerSw).toHaveBeenCalledWith('/sw.js');
    expect(result).toEqual({
      vfsBoot: { backend: 'opfs' },
      storage: {
        available: true,
        persistedBefore: false,
        persistedAfter: true,
        usage: 10,
        quota: 100,
      },
    });
  });

  it('propagates a COI failure without touching VFS or SW', async () => {
    const initVfs = vi.fn();
    const registerSw = vi.fn();
    const assertCoi = vi.fn(() => {
      throw new Error(COI_FATAL_MESSAGE);
    });
    await expect(
      bootstrapPlayground({
        assertCoi,
        initVfs,
        registerSw,
        logger: { warn: () => {}, error: () => {} },
      }),
    ).rejects.toThrowError(COI_FATAL_MESSAGE);
    expect(initVfs).not.toHaveBeenCalled();
    expect(registerSw).not.toHaveBeenCalled();
  });

  it('captures SW failures into swError without failing the bootstrap', async () => {
    const warn = vi.fn();
    const result = await bootstrapPlayground({
      assertCoi: () => {},
      initVfs: async () => 'memory' as const,
      registerSw: async () => {
        throw new Error('sw 404');
      },
      logger: { warn, error: () => {} },
    });
    expect(result.vfsBoot).toEqual({ backend: 'memory' });
    expect(result.swError).toBe('sw 404');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/sw 404/);
  });

  it('VFS failure degrades to memory but still registers the SW', async () => {
    const warn = vi.fn();
    const registerSw = vi.fn(async () => ({ registration: {}, active: {} }));
    const result = await bootstrapPlayground({
      assertCoi: () => {},
      initVfs: async () => {
        throw new Error('OPFS denied');
      },
      registerSw,
      logger: { warn, error: () => {} },
    });
    expect(result.vfsBoot).toEqual({ backend: 'memory', reason: 'OPFS denied' });
    expect(registerSw).toHaveBeenCalledWith('/sw.js');
    expect(result.swError).toBeUndefined();
  });
});
