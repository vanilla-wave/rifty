/**
 * Regression: the terminal mirror (`data-terminal-buffer`, read by the e2e
 * suite) must reflect a FINAL write that has no trailing output — the
 * dev-server "[vite] dev server ready" marker. xterm parses `write()` on a
 * deferred macrotask, so a synchronous serialize misses the last write;
 * `snapshotBufferSettled` waits for xterm's write barrier. This was the root of
 * the CI-only "[vite] dev server ready never appears" e2e flake (a sync snapshot
 * raced xterm's parse; under CI load xterm's chunked drain lagged past the
 * mirror's refresh deadline, and being the final write nothing re-triggered it).
 *
 * Uses the REAL `@xterm/addon-serialize` (unlike terminal.test.ts which stubs
 * it), so it exercises the actual async parse→serialize path. xterm addon
 * bundles touch `self` at load, hence the shim + dynamic import.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const MARKER = '[vite] dev server ready on port 5174';
let RiftyTerminalCtor: typeof import('./terminal.ts').RiftyTerminal;

beforeAll(async () => {
  (globalThis as unknown as { self: unknown }).self = globalThis;
  RiftyTerminalCtor = (await import('./terminal.ts')).RiftyTerminal;
});

function makeTerm(): InstanceType<typeof RiftyTerminalCtor> {
  return new RiftyTerminalCtor({
    onInput: () => undefined,
    unicode11: false,
    webLinks: false,
    search: false,
    inlineImages: false,
    webgl: false,
    serialize: true,
  });
}

describe('terminal buffer settle (mirror marker flush)', () => {
  it('a synchronous snapshot can miss a final write (the race being fixed)', () => {
    const term = makeTerm();
    term.write(`${MARKER}\n`);
    // xterm has not parsed the write yet (deferred macrotask) → a sync mirror
    // refresh serializes a stale buffer. This is the bug `snapshotBufferSettled`
    // closes; asserted here so the regression is meaningful (RED without the fix).
    expect(term.snapshotBuffer()).not.toContain(MARKER);
  });

  it('snapshotBufferSettled reflects the final write', async () => {
    const term = makeTerm();
    term.write(`${MARKER}\n`);
    expect(await term.snapshotBufferSettled()).toContain(MARKER);
  });

  it('settles across multiple coalesced writes, keeping the final marker', async () => {
    const term = makeTerm();
    term.write('npm run dev\n');
    term.write('VITE v7.3.6  ready in 1200 ms\n');
    term.write(`${MARKER}\n`);
    const settled = await term.snapshotBufferSettled();
    expect(settled).toContain('VITE v7.3.6');
    expect(settled).toContain(MARKER);
  });

  it('resolves empty after dispose without hanging', async () => {
    const term = makeTerm();
    term.write(`${MARKER}\n`);
    term.dispose();
    expect(await term.snapshotBufferSettled()).toBe('');
  });
});
