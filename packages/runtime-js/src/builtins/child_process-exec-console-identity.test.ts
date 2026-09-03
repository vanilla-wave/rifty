import { afterEach, describe, expect, it } from 'vitest';
import './index.ts';
import { spawn } from './child_process.ts';
import { Console } from './console.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';

afterEach(() => resetSyncMirror());

describe('same-realm child console constructor identity', () => {
  it('returns the existing imported Console through both require aliases', async () => {
    const markerKey = Symbol.for('rifty.test.same-realm-console-constructor');
    const savedMarker = Object.getOwnPropertyDescriptor(Console, markerKey);
    const savedIsolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
    Object.defineProperty(Console, markerKey, {
      configurable: true,
      get(this: unknown) {
        return this === Console ? markerKey : undefined;
      },
    });
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      configurable: true,
      writable: true,
      value: false,
    });
    writeFileSync(
      '/console-identity.js',
      `
const marker = Symbol.for('rifty.test.same-realm-console-constructor');
const plain = require('console');
const node = require('node:console');
process.stdout.write(JSON.stringify({
  existing: plain.Console[marker] === marker,
  aliases: plain.Console === node.Console,
  instance: console instanceof plain.Console,
}));
`,
    );

    try {
      const child = spawn('node', ['/console-identity.js']);
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      const code = await new Promise<number | null>((resolve) => {
        child.once('close', (exitCode) => resolve(exitCode as number | null));
      });

      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ existing: true, aliases: true, instance: true });
    } finally {
      if (savedMarker) Object.defineProperty(Console, markerKey, savedMarker);
      else Reflect.deleteProperty(Console, markerKey);
      if (savedIsolation) {
        Object.defineProperty(globalThis, 'crossOriginIsolated', savedIsolation);
      } else {
        Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
      }
    }
  });
});
