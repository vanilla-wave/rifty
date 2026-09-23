import { NotImplementedError } from '@riftydev/io';
import { expect, it } from 'vitest';
import { Script, createContext } from './index.ts';
import { ensureVmEngineReady } from './quickjs-loader.ts';

it('keeps offset-bearing Script context-engine runs loud', async () => {
  await ensureVmEngineReady();
  const lineScript = new Script('1', { lineOffset: 1 });
  const columnScript = new Script('1', { columnOffset: -1 });
  expect(() => lineScript.runInContext(createContext({}))).toThrow(NotImplementedError);
  expect(() => columnScript.runInNewContext({})).toThrow(NotImplementedError);
});
