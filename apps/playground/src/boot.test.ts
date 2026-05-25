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
import { backendLabel, bootstrap, reasonOf, swErrorBannerMessage } from './boot.ts';

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
  it('reports OPFS as persisted', () => {
    expect(backendLabel({ backend: 'opfs' })).toBe('Storage: OPFS (persisted)');
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
    // Mirror the flow App.onMount runs: registerServiceWorker rejects, the
    // catch arm pulls a reason out via reasonOf, and the banner template
    // calls swErrorBannerMessage with that reason. A test for the banner
    // _state_ rather than the rendered DOM (jsdom is not available here),
    // but locks in that the message users see equals what tests assert.
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
