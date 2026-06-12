import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./kernel-worker-entry.ts', import.meta.url)),
  'utf8',
);

describe('kernel worker entry bundle wrapper', () => {
  it('uses explicit installer bindings so Vite cannot erase the worker setup chunk', () => {
    expect(source).toContain(
      "import { installNodeProcessShim } from '@riftydev/runtime-js/install-process'",
    );
    expect(source).toContain(
      "import { installWorkerEntry, setKernelPreEntryHook } from '@riftydev/kernel/worker-entry'",
    );
    expect(source).toContain('setKernelPreEntryHook(');
    expect(source).toContain('installWorkerEntry(');
    expect(source).not.toContain("import '@riftydev/kernel/worker-entry'");
  });
});
