import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Buffer as RuntimeJsBuffer } from '@riftydev/runtime-js/builtins/buffer';
import { getProcessCwd, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { afterEach, describe, expect, it } from 'vitest';
import { installBundleLocalBuffer, installBundleLocalCwd } from './worker-runtime-globals.ts';

/**
 * Regression guard for the dual-copy `Buffer` etag crash (express + sqlite preset:
 * `res.json` → `TypeError: argument entity must be string, Buffer, or fs.Stats`).
 *
 * ROOT: in a PRODUCTION build every `?worker&url` child entry is self-contained, so
 * each carries its OWN `@riftydev/io` `Buffer` copy. The kernel pre-entry hook
 * (kernel-worker-entry.ts) sets `globalThis.Buffer` from the kernel-worker-entry
 * bundle's copy; a child's `import()` runs AFTER that and never realigned the global,
 * so etag (reads the GLOBAL Buffer) and express (`require('buffer')` = the child copy)
 * disagreed → `Buffer.isBuffer` false. DEV hid it (one shared ESM module instance).
 *
 * The fix: each child bootstrap calls `installBundleLocalBuffer()` to pin the global
 * to ITS bundle's copy. These tests pin BOTH the helper behaviour AND the wiring —
 * the wiring assertion is the one that would have caught the original miss (the
 * dev-mode e2e cannot; it never sees the duplicated copies).
 */

const dir = new URL('.', import.meta.url);
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, dir)), 'utf8');

describe('installBundleLocalBuffer — dual-copy Buffer realignment', () => {
  const saved = (globalThis as { Buffer?: unknown }).Buffer;
  afterEach(() => {
    (globalThis as { Buffer?: unknown }).Buffer = saved;
  });

  it('realigns globalThis.Buffer to the module loader Buffer even over a foreign copy', () => {
    // Simulate the pre-entry hook having installed a DIFFERENT Buffer class (the
    // kernel-worker-entry bundle copy): a foreign global whose isBuffer rejects a
    // loader-built buffer, exactly as the etag throw observed.
    class ForeignBuffer extends Uint8Array {
      static isBuffer(_v: unknown): boolean {
        return false;
      }
    }
    (globalThis as { Buffer: unknown }).Buffer = ForeignBuffer;
    const loaderBuffer = RuntimeJsBuffer.from('hello', 'utf8');
    const foreignRejects = (
      globalThis as unknown as { Buffer: typeof ForeignBuffer }
    ).Buffer.isBuffer(loaderBuffer);

    installBundleLocalBuffer();

    // Capture results, then restore the global BEFORE asserting — a broken global
    // Buffer wrecks vitest's own IPC serialization on assertion failure.
    const realignedGlobal = (globalThis as { Buffer: unknown }).Buffer;
    const realignedAcceptsLoaderBuffer = (
      globalThis as unknown as { Buffer: typeof RuntimeJsBuffer }
    ).Buffer.isBuffer(loaderBuffer);
    (globalThis as { Buffer?: unknown }).Buffer = saved;

    expect(foreignRejects).toBe(false);
    // After realignment the GLOBAL Buffer is the loader's Buffer, so etag's
    // `Buffer.isBuffer(chunk)` (chunk built by the same loader) is true again.
    expect(realignedGlobal).toBe(RuntimeJsBuffer);
    expect(realignedAcceptsLoaderBuffer).toBe(true);
  });
});

describe('installBundleLocalCwd — dual-copy process cwd realignment', () => {
  const savedCwd = getProcessCwd();

  afterEach(() => {
    setProcessCwd(savedCwd);
  });

  it('seeds this bundle fs/path cell from the installed process cwd', () => {
    setProcessCwd('/workspace');

    installBundleLocalCwd('/');

    expect(getProcessCwd()).toBe('/');
  });

  it('is wired before the node entry probes relative paths', () => {
    const src = read('node-entry-bootstrap.ts');
    expect(src).toContain('installBundleLocalCwd');
    expect(src).toMatch(/installBundleLocalCwd\(proc\.cwd\(\)\)/);
  });
});

describe('kind:url child bootstraps reinstall the bundle-local global Buffer', () => {
  // Each child entry is `import()`ed into the kernel worker realm AFTER the pre-entry
  // hook set a foreign-bundle Buffer global; it MUST reinstall its own copy or a
  // package reading the global Buffer (etag) crashes in a production build.
  //
  // residual source pin: every listed file is a worker-only `kind:'url'` entry
  // (top-level await / kernel process shim / worker boot at import) — node
  // cannot import one to observe the call, and the dual-copy hazard only
  // exists in PRODUCTION worker bundles (dev shares one ESM instance), so
  // even a browser-unit run can't fail without a prod build (tests/e2e-prod
  // covers the symptom end-to-end; this pins the per-entry wiring).
  for (const file of [
    'dev-server-child-bootstrap.ts',
    'node-entry-bootstrap.ts',
    'ts-lsp-worker-entry.ts',
  ]) {
    it(`${file} imports and calls installBundleLocalBuffer`, () => {
      const src = read(file);
      expect(src).toContain('installBundleLocalBuffer');
      expect(src).toMatch(/installBundleLocalBuffer\(\)/);
    });
  }
});

describe('ts-lsp worker bootstrap keeps the package endpoint in production bundles', () => {
  it('imports and calls the package worker boot explicitly', () => {
    // residual source pin: emitted-bundle shape (explicit binding + call so the
    // ?worker chunk keeps the endpoint) on a worker-only entry that boots the
    // LS at import — unobservable from node; browser-unit/prod lane material.
    const src = read('ts-lsp-worker-entry.ts');
    expect(src).toMatch(
      /import\s+\{\s*bootTsLanguageServiceWorker\s*\}\s+from\s+['"]@riftydev\/ts-language-service\/worker\/entry['"]/,
    );
    expect(src).toMatch(/\bbootTsLanguageServiceWorker\(\)/);
    expect(src).not.toMatch(/\bvoid\s+bootTsLanguageServiceWorker\b/);
  });
});
