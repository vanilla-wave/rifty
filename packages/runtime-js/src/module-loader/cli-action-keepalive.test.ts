import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, trackKeepalivePromise } from '../internal/event-loop-keepalive.ts';
import { createModuleLoader } from './loader.ts';

const TRACKER = '__riftyTrackCliPromise';
const RELEASE = '__releaseCli';

afterEach(() => {
  Reflect.deleteProperty(globalThis, TRACKER);
  Reflect.deleteProperty(globalThis, RELEASE);
});

describe('unawaited cac command actions', () => {
  it('keeps the process alive until the dropped action promise settles', async () => {
    Reflect.set(globalThis, TRACKER, trackKeepalivePromise);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/cli.mjs': `
        const cli = {
          runMatchedCommand() {
            return new Promise((resolve) => { globalThis.${RELEASE} = resolve; });
          },
          parse() { this.runMatchedCommand(); },
        };
        cli.parse();
        export {};
      `,
    });
    const before = activeRefs();
    await createModuleLoader(vfs).import('/cli.mjs');
    expect(activeRefs()).toBe(before + 1);
    (globalThis as unknown as Record<string, () => void>)[RELEASE]?.();
    await Promise.resolve();
    expect(activeRefs()).toBe(before);
  });

  it('does not rewrite the call when it only appears in a string or a comment', async () => {
    Reflect.set(globalThis, TRACKER, trackKeepalivePromise);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/cli.mjs': `
        const text = "this.runMatchedCommand();";
        // this.runMatchedCommand();
        /* this.runMatchedCommand(); */
        const cli = {
          runMatchedCommand() {
            return new Promise((resolve) => { globalThis.${RELEASE} = resolve; });
          },
          parse() { this.runMatchedCommand(); },
        };
        cli.parse();
        export { text };
      `,
    });
    const before = activeRefs();
    const ns = await createModuleLoader(vfs).import('/cli.mjs');
    expect(ns.text).toBe('this.runMatchedCommand();');
    expect(activeRefs()).toBe(before + 1);
    (globalThis as unknown as Record<string, () => void>)[RELEASE]?.();
    await Promise.resolve();
    expect(activeRefs()).toBe(before);
  });
});
