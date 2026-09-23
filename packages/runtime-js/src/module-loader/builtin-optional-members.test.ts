import { MemoryFsSync } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

it.each([
  ['fs', 'statfsSync'],
  ['child_process', 'spawnSync'],
  ['process', 'memoryUsage'],
])('%s.%s is callable and fails with its named ceiling', async (module, member) => {
  const loader = createModuleLoader(new MemoryFsSync(), { cwd: '/' });
  const namespace = await loader.import(`node:${module}`, '/entry.mjs');
  const builtin = namespace.default as Record<string, unknown>;
  const method = builtin[member];
  expect(method).toBeTypeOf('function');
  if (typeof method !== 'function') throw new Error(`Missing ${module}.${member}`);
  let thrown: unknown;
  try {
    method();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).toMatchObject({
    name: 'NotImplementedError',
    message: `Not implemented: ${module}.${member}`,
    feature: `${module}.${member}`,
  });
});
