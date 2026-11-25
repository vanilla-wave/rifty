/**
 * WPT `FileAPI/blob` and `FileAPI/file` (Node v24.16.0's vendored copy, `tests/wpt/fixtures`)
 * through the shared harness: every subtest of every `.any.js` file Node's `test/wpt/test-blob.js`
 * and `test-file.js` run gives the guest live Node's result (unit
 * `runtime-js/isolate-guest-blob-file` Acceptance 1). Not run, listed: below.
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { differences, runWpt } from './wpt-guest.ts';

/** Files run, with the subtests excluded from the comparison (each must still differ). */
const FILES: Readonly<Record<string, readonly string[]>> = {
  'FileAPI/blob/Blob-array-buffer.any.js': [],
  'FileAPI/blob/Blob-bytes.any.js': [],
  // l. 389–396: a `MessageChannel` port (a ceiling in the isolate) as a blob part.
  'FileAPI/blob/Blob-constructor.any.js': [
    'Passing a FrozenArray as the blobParts array should work (FrozenArray<MessagePort>).',
  ],
  // `stream()`: the isolate-host.ReadableStream gap (Acceptance 5).
  'FileAPI/blob/Blob-newobject.any.js': ['Blob.stream() returns [NewObject]'],
  'FileAPI/blob/Blob-slice-overflow.any.js': [],
  'FileAPI/blob/Blob-slice.any.js': [],
  'FileAPI/blob/Blob-text.any.js': [],
  'FileAPI/file/File-constructor.any.js': [],
};
/**
 * `.any.js` files not run, each with the guest code that prints `gap` while its reason holds: once
 * it no longer does, the entry is stale and the file must join `FILES`. Not run either: every
 * `.html`/`.window.js`/`.worker.js` file (Node skips them).
 */
const NOT_RUN: Readonly<Record<string, { readonly why: string; readonly gap: string }>> = {
  'FileAPI/blob/Blob-stream.any.js': {
    why: '`stream()` is the isolate-host.ReadableStream gap; `garbageCollect`',
    gap: "try { new Blob().stream(); } catch (e) { if (e.feature === 'isolate-host.ReadableStream') console.log('gap'); }",
  },
  ...Object.fromEntries(
    ['', '-controls', '-punctuation', '-utf-8'].map((s) => [
      `FileAPI/file/send-file-formdata${s}.any.js`,
      {
        why: '`FormData` + `fetch` to the WPT server echo endpoint (Node skips it)',
        gap: "try { new FormData(); } catch (e) { if (e.feature === 'isolate-host.FormData') console.log('gap'); }",
      },
    ]),
  ),
};

describe("WPT FileAPI: the guest gives every subtest live Node's result", () => {
  for (const [test, excluded] of Object.entries(FILES)) {
    it(test, { timeout: 180_000 }, async () => {
      const { node, guest } = await runWpt(test);
      expect(node.harness, 'Node completes the file').toBe('OK');
      expect(node.subtests.length).toBeGreaterThan(0);
      expect(differences(node, guest, excluded)).toEqual([]);
    });
  }
});

describe('WPT FileAPI files not run still have their reason', () => {
  for (const [test, { why, gap }] of Object.entries(NOT_RUN)) {
    it(`${test}: ${why}`, async () => {
      expect(await runCode(gap)).toEqual({ stdout: 'gap\n', stderr: '', exitCode: 0 });
    });
  }
});
