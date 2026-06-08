/**
 * Conformance: our `ls` output must equal frozen GNU coreutils 9.7 (`gls`)
 * output BYTE-FOR-BYTE for the metadata-independent behaviors (listing order,
 * dotfile policy, reversal, column/single-line layout). Each fixture under
 * fixtures/ls/ carries a `#`-prefixed provenance header; we assert only the
 * BODY. We seed MemoryFsSync with the IDENTICAL tree gls saw.
 *
 * NOT fixtured (cannot match gls byte-for-byte): -l (placeholder metadata,
 * ADR-0050) and --color (our SGR helper emits `1;34` w/o gls's leading-`0m`
 * reset prefix and `01;34` zero-padded code). Those are covered structurally in
 * ls.test.ts. See the agent's `decisions` for the recorded divergence.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ls } from '../src/commands/ls.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

/** The exact tree gls listed when the fixtures were frozen. */
const TREE = {
  dirs: ['/t/adir', '/t/bdir'],
  files: ['/t/.config', '/t/.hidden', '/t/Cherry', '/t/apple.txt', '/t/banana', '/t/zebra.md'],
};

function seedTree(): void {
  const fs = new MemoryFsSync();
  for (const d of TREE.dirs) fs.mkdirSync(d, { recursive: true });
  for (const f of TREE.files) {
    fs.mkdirSync('/t', { recursive: true });
    fs.writeFileSync(f, enc.encode('x'));
  }
  setSyncMirror(fs);
}

/** Read a fixture's BODY (drop the leading `#` provenance line). */
function fixtureBody(name: string): string {
  const path = fileURLToPath(new URL(`../fixtures/ls/${name}`, import.meta.url));
  const raw = readFileSync(path, 'utf8');
  const nl = raw.indexOf('\n');
  return raw.slice(nl + 1);
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

const CASES: ReadonlyArray<{ fixture: string; flags: string[] }> = [
  { fixture: 'default.txt', flags: [] },
  { fixture: 'all.txt', flags: ['-a'] },
  { fixture: 'almost-all.txt', flags: ['-A'] },
  { fixture: 'one-per-line.txt', flags: ['-1'] },
  { fixture: 'reverse.txt', flags: ['-r'] },
];

for (const { fixture, flags } of CASES) {
  it(`matches gls ${flags.join(' ') || '(default)'} byte-for-byte`, async () => {
    seedTree();
    // Non-TTY => one-per-line, matching gls's piped output the fixtures captured.
    const { ctx, out } = makeCtx({ cwd: '/t', isTTY: false });
    const code = await ls([...flags, '/t'], ctx);
    expect(code).toBe(0);
    expect(out()).toBe(fixtureBody(fixture));
  });
}
