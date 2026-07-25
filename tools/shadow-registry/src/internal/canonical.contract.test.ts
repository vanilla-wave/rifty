import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalShadowJson, shadowSha256 } from './canonical.ts';

const canonicalJsonVectors = [
  {
    name: 'nested unsorted objects and arrays',
    input: {
      zebra: [{ omega: 2, alpha: 1 }, ['tail', { delta: 4, charlie: 3 }]],
      alpha: { yes: true, nil: null },
    },
    canonical:
      '{"alpha":{"nil":null,"yes":true},"zebra":[{"alpha":1,"omega":2},["tail",{"charlie":3,"delta":4}]]}',
    utf8Hex:
      '7b22616c706861223a7b226e696c223a6e756c6c2c22796573223a747275657d2c227a65627261223a5b7b22616c706861223a312c226f6d656761223a327d2c5b227461696c222c7b22636861726c6965223a332c2264656c7461223a347d5d5d7d',
    sha256: '4add05ecae0d35b3ac0639039111ec3ae10618f65fab1ebe46add8e5ac781f67',
  },
  {
    name: 'Unicode and control escapes',
    input: { z: 'é雪💩', a: '\u0000\b\t\n\f\r"\\' },
    canonical: '{"a":"\\u0000\\b\\t\\n\\f\\r\\"\\\\","z":"é雪💩"}',
    utf8Hex:
      '7b2261223a225c75303030305c625c745c6e5c665c725c225c5c222c227a223a22c3a9e99baaf09f92a9227d',
    sha256: 'a6e9809e7e00106109dc4c4a5b0d5340ae08d76dce827404bc1d0214f54a5336',
  },
  {
    name: 'zero and maximum safe integer',
    input: { zero: 0, nested: [9_007_199_254_740_991, 0], max: 9_007_199_254_740_991 },
    canonical: '{"max":9007199254740991,"nested":[9007199254740991,0],"zero":0}',
    utf8Hex:
      '7b226d6178223a393030373139393235343734303939312c226e6573746564223a5b393030373139393235343734303939312c305d2c227a65726f223a307d',
    sha256: 'f8cb49e7769d4e98ec64a82cf6aea7d3848c1b1ea1942d88f313dc9d39c24d52',
  },
] as const;

describe('shadow canonical JSON contract', () => {
  it('matches independent UTF-8 and Node crypto SHA-256 vectors', () => {
    for (const vector of canonicalJsonVectors) {
      const canonical = canonicalShadowJson(vector.input);
      expect(canonical, vector.name).toBe(vector.canonical);
      expect(
        Array.from(new TextEncoder().encode(canonical), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        `${vector.name} UTF-8`,
      ).toBe(vector.utf8Hex);
      expect(
        createHash('sha256').update(vector.canonical, 'utf8').digest('hex'),
        `${vector.name} Node crypto oracle`,
      ).toBe(vector.sha256);
      expect(shadowSha256(canonical), `${vector.name} shadow SHA-256`).toBe(vector.sha256);
    }
  });
});
