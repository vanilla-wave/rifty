/**
 * Conformance for `node:os` against the contracts in ADR-0026
 * (`os.platform()` / `os.arch()` mirror `process.platform` / `process.arch`).
 */
import { describe, expect, it } from 'vitest';
import { constants, arch, platform } from './os.ts';
import { riftyProcess } from './process.ts';

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
});
