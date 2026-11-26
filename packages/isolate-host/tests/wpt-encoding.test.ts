/**
 * WPT `encoding` (Node v24.16.0's vendored copy, `tests/wpt/fixtures`) through the shared
 * harness: every subtest of every `.any.js` file run gives the guest live Node's result (ADR-0577,
 * goal `isolate-guest-web-api` unit 3, PR #459), except the listed
 * ones. Not run, listed: below.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { coverageProblems, differences, runWpt } from './wpt-guest.ts';

/** big5, euc-jp, iso-2022-jp, shift_jis, euc-kr: Node decodes them by ICU, a named gap here. */
const ICU_ONLY = ['Big5', 'EUC-JP', 'ISO-2022-JP', 'Shift_JIS', 'EUC-KR'];
const groups = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/text-decoder/encodings.json', import.meta.url)),
    'utf8',
  ),
) as { encodings: { name: string; labels: string[] }[] }[];
/** `textdecoder-labels.any.js` names its subtests `<label> => <Name>`. */
const ICU_ONLY_LABELS = groups.flatMap((g) =>
  g.encodings
    .filter((e) => ICU_ONLY.includes(e.name))
    .flatMap((e) => e.labels.map((l) => `${l} => ${e.name}`)),
);

/** Files run, with the subtests excluded from the comparison (each must still differ). */
const FILES: Readonly<Record<string, readonly string[]>> = {
  'encoding/api-basics.any.js': [],
  'encoding/api-invalid-label.any.js': [],
  'encoding/api-replacement-encodings.any.js': [],
  'encoding/api-surrogates-utf8.any.js': [],
  // A `MessageChannel` port detaches the buffer (a ceiling in the isolate).
  'encoding/encodeInto.any.js': ['encodeInto() and a detached output buffer'],
  'encoding/legacy-mb-schinese/gb18030/gb18030-decoder.any.js': [],
  'encoding/legacy-mb-schinese/gbk/gbk-decoder.any.js': [],
  'encoding/textdecoder-arguments.any.js': [],
  'encoding/textdecoder-byte-order-marks.any.js': [],
  'encoding/textdecoder-copy.any.js': [],
  'encoding/textdecoder-eof.any.js': [],
  'encoding/textdecoder-fatal-single-byte.any.js': [],
  'encoding/textdecoder-fatal-streaming.any.js': [],
  'encoding/textdecoder-fatal.any.js': [],
  'encoding/textdecoder-ignorebom.any.js': [],
  'encoding/textdecoder-labels.any.js': ICU_ONLY_LABELS,
  'encoding/textdecoder-streaming.any.js': [],
  'encoding/textdecoder-utf16-surrogates.any.js': [],
  'encoding/textencoder-constructor-non-utf.any.js': ICU_ONLY.map(
    (n) => `Encoding argument supported for decode: ${n}`,
  ),
  'encoding/textencoder-utf16-surrogates.any.js': [],
};

const streamsGap =
  "try { new TextDecoderStream(); } catch (e) { if (e.feature === 'isolate-host.TextDecoderStream') console.log('gap'); }";
/**
 * `.any.js` files not run, each with the guest code that prints `gap` while its reason holds: once
 * it no longer does, the entry is stale and the file must join `FILES`. Not run either: every
 * `.html`/`.window.js`/`.worker.js` file (Node skips them).
 */
const NOT_RUN: Readonly<Record<string, { readonly why: string; readonly gap: string }>> = {
  'encoding/idlharness.any.js': {
    why: "`idlharness.js` over the `['streams']` IDL: `TextDecoderStream`/`TextEncoderStream`",
    gap: streamsGap,
  },
  'encoding/iso-2022-jp-decoder.any.js': {
    why: 'iso-2022-jp: decoded by ICU in Node, the named gap here',
    gap: "try { new TextDecoder('iso-2022-jp'); } catch (e) { if (e.feature === 'isolate-host.TextDecoder(iso-2022-jp)') console.log('gap'); }",
  },
  ...Object.fromEntries(
    ['replacement-encodings', 'unsupported-encodings'].map((f) => [
      `encoding/${f}.any.js`,
      {
        why: '`XMLHttpRequest` decoding (Node has none: every subtest fails there too)',
        gap: "if (typeof XMLHttpRequest === 'undefined') console.log('gap');",
      },
    ]),
  ),
  ...Object.fromEntries(
    [
      'backpressure',
      'decode-attributes',
      'decode-bad-chunks',
      'decode-ignore-bom',
      'decode-incomplete-input',
      'decode-non-utf8',
      'decode-split-character',
      'decode-utf8',
      'encode-bad-chunks',
      'encode-utf8',
      'readable-writable-properties',
    ].map((f) => [
      `encoding/streams/${f}.any.js`,
      {
        why: '`TextDecoderStream`/`TextEncoderStream`: the isolate-host web streams gap',
        gap: streamsGap,
      },
    ]),
  ),
};

describe("WPT encoding: the guest gives every subtest live Node's result", () => {
  for (const [test, excluded] of Object.entries(FILES)) {
    it(test, { timeout: 180_000 }, async () => {
      const { node, guest } = await runWpt(test);
      expect(node.harness, 'Node completes the file').toBe('OK');
      expect(node.subtests.length).toBeGreaterThan(0);
      expect(differences(node, guest, excluded)).toEqual([]);
    });
  }
});

it('every vendored encoding test file is run or listed as not run', () => {
  expect(coverageProblems('encoding/', Object.keys(FILES), Object.keys(NOT_RUN))).toEqual([]);
});

describe('WPT encoding files not run still have their reason', () => {
  for (const [test, { why, gap }] of Object.entries(NOT_RUN)) {
    it(`${test}: ${why}`, async () => {
      expect(await runCode(gap)).toEqual({ stdout: 'gap\n', stderr: '', exitCode: 0 });
    });
  }
});
