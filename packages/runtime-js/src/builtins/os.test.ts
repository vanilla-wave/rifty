/**
 * Conformance for `node:os` against the contracts in ADR-0026
 * (`os.platform()` / `os.arch()` mirror `process.platform` / `process.arch`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  constants,
  arch,
  availableParallelism,
  cpus,
  devNull,
  machine,
  platform,
  release,
  type,
  version,
} from './os.ts';
import { riftyProcess } from './process.ts';

const TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');

afterEach(() => {
  Reflect.deleteProperty(globalThis, TOOLCHAIN_REALM);
  vi.unstubAllGlobals();
});

describe('node:os ABI (ADR-0026)', () => {
  it('platform() returns the public ABI value', () => {
    expect(platform()).toBe('rifty');
  });

  it('arch() returns the public ABI value', () => {
    expect(arch()).toBe('wasm');
  });

  it('platform() matches process.platform exactly', () => {
    expect(platform()).toBe(riftyProcess.platform);
  });

  it('arch() matches process.arch exactly', () => {
    expect(arch()).toBe(riftyProcess.arch);
  });

  it('machine() mirrors arch() (fictional wasm ABI); version()/devNull are consistent', () => {
    // Host-divergent in real Node (returns the host's machine/version), so these
    // are pinned here rather than via the parity runner.
    expect(machine()).toBe('wasm');
    expect(machine()).toBe(arch());
    expect(devNull).toBe('/dev/null'); // type()==='Linux' → posix path
    expect(type()).toBe('Linux');
    expect(typeof version()).toBe('string');
    expect(version()).toContain(release());
  });

  it('exposes scoped signal and errno integer constants', () => {
    expect(constants.signals).toMatchObject({
      SIGTERM: 15,
      SIGINT: 2,
      SIGHUP: 1,
    });
    expect(constants.errno).toMatchObject({
      ENOENT: 2,
      EEXIST: 17,
      EINVAL: 22,
    });
  });

  it('reports one CPU only in the selected toolchain Worker realm', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    vi.stubGlobal('crossOriginIsolated', false);

    expect(cpus()).toHaveLength(8);
    expect(availableParallelism()).toBe(8);

    Object.defineProperty(globalThis, TOOLCHAIN_REALM, { value: true, configurable: true });
    expect(cpus()).toHaveLength(1);
    expect(availableParallelism()).toBe(1);
  });
});
