/**
 * The shared WPT harness (`tests/wpt/harness.ts`) refuses a run that did not end cleanly, on
 * either side: a file whose report is printed and that then hangs, exits non-zero or writes to
 * stderr is no result (PR #458 review), and an unclean oracle is itself a difference.
 */
import { describe, expect, it } from 'vitest';
import { differences, inGuest, inNode, wptFile } from './wpt-guest.ts';

const TEST = 'FileAPI/blob/Blob-text.any.js';
const clean = wptFile(TEST);
const EXIT = 'process.exit(0); }';
const mutant = (to: string): string => {
  if (clean.split(EXIT).length !== 2) throw new Error('harness report anchor moved');
  return clean.replace(EXIT, `${to} }`);
};
const MUTANTS: Readonly<Record<string, string>> = {
  'hangs after its report': mutant('setInterval(() => {}, 1000);'),
  'exits 17 after its report': mutant('process.exit(17);'),
  'writes stderr after its report': mutant(
    "require('fs').writeSync(2, 'junk\\n'); process.exit(0);",
  ),
};

describe('the WPT harness takes only a clean end as a result', () => {
  it('the clean file: Node and the guest agree', { timeout: 60_000 }, async () => {
    expect(differences(inNode(clean), await inGuest(clean))).toEqual([]);
  });
  for (const [name, file] of Object.entries(MUTANTS)) {
    it(name, { timeout: 60_000 }, async () => {
      const node = inNode(file, 5_000);
      const guest = await inGuest(file, 5_000);
      for (const report of [node, guest]) {
        expect(report.harness).toMatch(/^unclean end: /);
        expect(report.subtests).toEqual([]);
      }
      expect(differences(inNode(clean), guest)).not.toEqual([]);
      expect(differences(node, guest)[0]).toMatch(/^oracle: Node ended unclean end: /);
    });
  }
});
