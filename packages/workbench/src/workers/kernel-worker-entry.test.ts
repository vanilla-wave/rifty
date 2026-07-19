import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./kernel-worker-entry.ts', import.meta.url)),
  'utf8',
);

describe('kernel worker entry bundle wrapper', () => {
  it('uses explicit installer bindings so Vite cannot erase the worker setup chunk', () => {
    // residual source pin: the contract is EMITTED-BUNDLE shape — explicit
    // binding imports + calls keep the setup chunk when a package marks itself
    // side-effect-free. Node cannot observe bundler output, and importing the
    // entry executes installWorkerEntry's worker-realm wiring. Behavioral heir
    // would assert on the BUILT worker chunk (browser-unit/prod lane).
    expect(source).toContain(
      "import { installNodeRuntime } from '@riftydev/runtime-js/install-process'",
    );
    expect(source).toContain(
      "import { installWorkerEntry, setKernelPreEntryHook } from '@riftydev/kernel/worker-entry'",
    );
    expect(source).toContain('setKernelPreEntryHook(');
    expect(source).toContain('installWorkerEntry(');
    expect(source).not.toContain("import '@riftydev/kernel/worker-entry'");
  });
});
