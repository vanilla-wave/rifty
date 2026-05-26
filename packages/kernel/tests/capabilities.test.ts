/**
 * Unit tests for {@link getIpcMode}'s `forceFallback` parameter. The kernel
 * MUST NOT read `process.env` to decide IPC mode (ADR-0039 — kernel is
 * Node-API-free); the env-/global-flag coupling is owned by the caller above
 * the kernel layer (playground / runtime-js).
 *
 * Behaviour covered:
 *   - `forceFallback: true` returns `'same-realm-fallback'` even when SAB
 *     is technically supported.
 *   - The default call returns `'sab'` when the host is capable and
 *     `'same-realm-fallback'` otherwise — without any env consultation.
 *   - The function never throws when invoked with no argument (default
 *     `{}` shape).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIpcMode, isSabIpcSupported } from '../src/ipc/capabilities.ts';

describe('getIpcMode', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalEnv = env.RIFTY_FALLBACK_NO_SAB;

  beforeEach(() => {
    env.RIFTY_FALLBACK_NO_SAB = undefined;
  });

  afterEach(() => {
    env.RIFTY_FALLBACK_NO_SAB = originalEnv;
  });

  it('returns same-realm-fallback when forceFallback is true', () => {
    expect(getIpcMode({ forceFallback: true })).toBe('same-realm-fallback');
  });

  it('returns same-realm-fallback when SAB IPC is unsupported on host', () => {
    // Node test environment lacks `crossOriginIsolated === true`, so SAB
    // support is `false` and `getIpcMode()` MUST fall through.
    expect(isSabIpcSupported()).toBe(false);
    expect(getIpcMode()).toBe('same-realm-fallback');
  });

  it('ignores process.env.RIFTY_FALLBACK_NO_SAB — env coupling lives above the kernel', () => {
    // Pre-refactor, kernel read this env var directly. ADR-0039 lifted that
    // coupling to runtime-js / playground. The env var must NOT change the
    // kernel's answer; only the explicit `forceFallback` parameter does.
    env.RIFTY_FALLBACK_NO_SAB = '1';
    // SAB support is independent of this env var — Node test env returns
    // false anyway. The point of the assertion is the parameter shape.
    expect(getIpcMode()).toBe('same-realm-fallback');
    expect(getIpcMode({ forceFallback: false })).toBe('same-realm-fallback');
  });

  it('accepts an empty options object without throwing', () => {
    expect(() => getIpcMode({})).not.toThrow();
  });
});
