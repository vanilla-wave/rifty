import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { serializeNodeIpcMessage } from './node-ipc-serialization.ts';

it.each(['absent', 'accessor', 'readonly-configurable', 'sealed-writable'])(
  'rejects local/foreign erased Promise with %s constructor without guest reads',
  (kind) => {
    for (const foreign of [false, true]) {
      const value: object = foreign ? runInNewContext('Promise.resolve(1)') : Promise.resolve(1);
      Object.setPrototypeOf(value, null);
      let reads = 0;
      const getter = () => {
        reads++;
        throw new Error('guest read');
      };
      Object.defineProperty(value, 'then', { get: getter, enumerable: true });
      if (kind === 'accessor')
        Object.defineProperty(value, 'constructor', {
          get: getter,
          enumerable: true,
          configurable: true,
        });
      if (kind === 'readonly-configurable')
        Object.defineProperty(value, 'constructor', {
          value: 7,
          writable: false,
          configurable: true,
        });
      if (kind === 'sealed-writable') {
        Object.defineProperty(value, 'constructor', { value: 7, writable: true, enumerable: true });
        Object.preventExtensions(value);
      }
      const before = Object.getOwnPropertyDescriptors(value);
      expect(() => serializeNodeIpcMessage({ bad: value }, 'advanced')).toThrow(
        /could not be cloned/,
      );
      expect(reads).toBe(0);
      expect(Object.getOwnPropertyDescriptors(value)).toEqual(before);
    }
  },
);

it('restores ordinary constructor before the one real snapshot getter', () => {
  let reads = 0;
  const value = {
    get constructor() {
      reads++;
      return 'guest constructor';
    },
    data: 7,
  };
  const before = Object.getOwnPropertyDescriptors(value);
  serializeNodeIpcMessage(value, 'advanced');
  expect(reads).toBe(1);
  expect(Object.getOwnPropertyDescriptors(value)).toEqual(before);
});

it('does not mark a rejected erased Promise as handled', () => {
  const codec = new URL('./node-ipc-serialization.ts', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { serializeNodeIpcMessage } from ${JSON.stringify(codec)};
    const pending = Promise.reject('original');
    Object.setPrototypeOf(pending, null);
    process.on('unhandledRejection', (reason, promise) => {
      console.log(JSON.stringify({ reason, same: promise === pending }));
    });
    try { serializeNodeIpcMessage({ pending }, 'advanced'); }
    catch (error) { if (!/could not be cloned/.test(error.message)) throw error; }
    setTimeout(() => {}, 10);
  `,
    ],
    { encoding: 'utf8' },
  );
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout.trim()).toBe('{"reason":"original","same":true}');
});
