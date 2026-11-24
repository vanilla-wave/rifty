/**
 * `syncMirror()` is the FS substitution point of a sync-only host (the isolate guest; the
 * sync-only overlay proposed in PR #429 installs one per run): runtime-js `fs` captures no FS
 * instance, so a mirror swapped between two runs is all the second run's reads and writes see.
 */
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import * as fs from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

function mirrorWith(content: string): MemoryFsSync {
  const mirror = new MemoryFsSync();
  mirror.writeFileSync('/f.txt', new TextEncoder().encode(content));
  return mirror;
}

function streamText(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    fs.default
      .createReadStream(path, { encoding: 'utf8', highWaterMark: 2 })
      .on('data', (c: string) => {
        text += c;
      })
      .on('error', reject)
      .on('end', () => resolve(text));
  });
}

async function run(written: string): Promise<string[]> {
  const ws = fs.default.createWriteStream('/out.txt');
  await new Promise((resolve) => ws.end(written, resolve));
  return [
    await streamText('/f.txt'),
    fs.default.readFileSync('/f.txt', 'utf8'),
    await fs.default.promises.readFile('/f.txt', 'utf8'),
    fs.default.readFileSync('/out.txt', 'utf8'),
  ];
}

it('a mirror swapped between runs is the one every fs surface of the next run sees', async () => {
  const first = mirrorWith('first');
  setSyncMirror(first);
  expect(await run('w1')).toEqual(['first', 'first', 'first', 'w1']);

  const second = mirrorWith('second');
  setSyncMirror(second);
  expect(await run('w2')).toEqual(['second', 'second', 'second', 'w2']);
  expect(new TextDecoder().decode(first.readFileBytesSync('/out.txt'))).toBe('w1');
});
