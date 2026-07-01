import { describe, expect, it } from 'vitest';
import { parseTtlSeconds } from '../src/env.ts';

describe('parseTtlSeconds (EDDY_TTL_SECONDS env-config)', () => {
  it('returns undefined when unset → falls back to the default TTL', () => {
    expect(parseTtlSeconds(undefined)).toBeUndefined();
    expect(parseTtlSeconds('')).toBeUndefined();
  });

  it('parses a non-negative number of seconds', () => {
    expect(parseTtlSeconds('1800')).toBe(1800);
  });

  it('keeps 0 (always recompute) — a valid, meaningful setting', () => {
    expect(parseTtlSeconds('0')).toBe(0);
  });

  it('throws loudly on a non-numeric value instead of silently disabling the cache', () => {
    // `Number('abc')`/`Number('30s')` → NaN → `ttlMs = NaN` → both cache gates
    // (`NaN > clock`, `NaN > 0`) are false → the mutable tier is dead and every
    // request recomputes. Against the loud-failure ethos — refuse at startup.
    expect(() => parseTtlSeconds('abc')).toThrow(/EDDY_TTL_SECONDS/);
    expect(() => parseTtlSeconds('30s')).toThrow(/EDDY_TTL_SECONDS/);
  });

  it('throws on a negative value', () => {
    expect(() => parseTtlSeconds('-5')).toThrow(/EDDY_TTL_SECONDS/);
  });

  it('throws on a whitespace-only value (Number(" ") === 0 would silently disable the cache)', () => {
    // `Number(' ')`/`Number('\t')` coerce to 0, not NaN — so without an explicit
    // guard a whitespace typo passes the finite/≥0 gate and sets TTL 0 (always
    // recompute), silently killing the mutable tier. Refuse it like other junk.
    expect(() => parseTtlSeconds(' ')).toThrow(/EDDY_TTL_SECONDS/);
    expect(() => parseTtlSeconds('\t')).toThrow(/EDDY_TTL_SECONDS/);
  });
});
