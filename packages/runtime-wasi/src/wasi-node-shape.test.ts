import { describe, expect, it } from 'vitest';
import { Wasi } from './wasi.ts';

describe('Wasi Node-compatible shape', () => {
  it('exposes wasiImport and getImportObject aliases for node:wasi consumers', () => {
    const wasi = new Wasi({ version: 'preview1' });

    expect(wasi.wasiImport).toBe(wasi.imports.wasi_snapshot_preview1);
    expect(wasi.getImportObject()).toEqual({
      wasi_snapshot_preview1: wasi.wasiImport,
    });
  });

  it('initialize wires memory and calls _initialize without requiring _start', () => {
    const wasi = new Wasi({ version: 'preview1' });
    const memory = new WebAssembly.Memory({ initial: 1 });
    let initialized = false;

    wasi.initialize({
      exports: {
        memory,
        _initialize: () => {
          initialized = true;
        },
      },
    } as unknown as WebAssembly.Instance);

    expect(initialized).toBe(true);
  });
});
