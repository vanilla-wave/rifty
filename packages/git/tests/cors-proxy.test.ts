/**
 * getGitCorsProxyUrl — D-004 (ADR-0028) tiered env-config resolver, mirroring
 * npm-client's getRegistryBaseUrl. Asserts tier precedence (bootstrap global >
 * Vite import.meta.env > process.env) and the empty-string default ("no proxy
 * configured"). NEVER a hardcoded URL.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGitCorsProxyUrl } from '../src/cors-proxy.ts';

const g = globalThis as Record<string, unknown>;

describe('getGitCorsProxyUrl', () => {
  const savedBootstrap = g.__RIFTY_GIT_CORS_PROXY__;
  const savedImport = g.import;
  const savedEnv = process.env.RIFTY_GIT_CORS_PROXY;

  beforeEach(() => {
    g.__RIFTY_GIT_CORS_PROXY__ = undefined;
    g.import = undefined;
    // biome-ignore lint/performance/noDelete: process.env coerces assignments to strings; only delete truly unsets the key, which the empty-default test requires.
    delete process.env.RIFTY_GIT_CORS_PROXY;
  });

  afterEach(() => {
    g.__RIFTY_GIT_CORS_PROXY__ = savedBootstrap;
    g.import = savedImport;
    if (savedEnv === undefined) {
      // biome-ignore lint/performance/noDelete: restoring "not set" requires delete, not = undefined (which would leave the literal "undefined" string).
      delete process.env.RIFTY_GIT_CORS_PROXY;
    } else {
      process.env.RIFTY_GIT_CORS_PROXY = savedEnv;
    }
  });

  it('defaults to "" (no proxy configured) when nothing is set', () => {
    expect(getGitCorsProxyUrl()).toBe('');
  });

  it('reads process.env.RIFTY_GIT_CORS_PROXY (Node/test tier)', () => {
    process.env.RIFTY_GIT_CORS_PROXY = 'https://proxy.env.example/git';
    expect(getGitCorsProxyUrl()).toBe('https://proxy.env.example/git');
  });

  it('reads globalThis.import.meta.env.RIFTY_GIT_CORS_PROXY (Vite tier)', () => {
    g.import = { meta: { env: { RIFTY_GIT_CORS_PROXY: 'https://proxy.vite.example/git' } } };
    expect(getGitCorsProxyUrl()).toBe('https://proxy.vite.example/git');
  });

  it('reads globalThis.__RIFTY_GIT_CORS_PROXY__ (bootstrap tier)', () => {
    g.__RIFTY_GIT_CORS_PROXY__ = 'https://proxy.bootstrap.example/git';
    expect(getGitCorsProxyUrl()).toBe('https://proxy.bootstrap.example/git');
  });

  it('bootstrap global wins over Vite env and process.env', () => {
    g.__RIFTY_GIT_CORS_PROXY__ = 'https://bootstrap/git';
    g.import = { meta: { env: { RIFTY_GIT_CORS_PROXY: 'https://vite/git' } } };
    process.env.RIFTY_GIT_CORS_PROXY = 'https://node/git';
    expect(getGitCorsProxyUrl()).toBe('https://bootstrap/git');
  });

  it('Vite env wins over process.env', () => {
    g.import = { meta: { env: { RIFTY_GIT_CORS_PROXY: 'https://vite/git' } } };
    process.env.RIFTY_GIT_CORS_PROXY = 'https://node/git';
    expect(getGitCorsProxyUrl()).toBe('https://vite/git');
  });

  it('empty values fall through to the next tier', () => {
    g.__RIFTY_GIT_CORS_PROXY__ = '';
    g.import = { meta: { env: { RIFTY_GIT_CORS_PROXY: '' } } };
    process.env.RIFTY_GIT_CORS_PROXY = 'https://node/git';
    expect(getGitCorsProxyUrl()).toBe('https://node/git');
  });
});
