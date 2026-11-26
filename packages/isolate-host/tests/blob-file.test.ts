/**
 * Isolate guest `Blob`/`File` (ADR-0578; goal `isolate-guest-web-api` unit 2): `fixtures/web-api/blob-cases.cjs`
 * — the unit's pin table, Node behaviours beyond WPT, the byte store's read count, module
 * consumers — run unchanged by live `node`, a sandbox `exec` and `runCode`. Every line equals
 * Node's except the declared ones (`DECLARED`: the guest's literal, still different from Node).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSandbox, runCode } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const NAME = 'blob-cases.cjs';
const source = readFileSync(join(here, 'fixtures/web-api', NAME), 'utf8');
const GAP = '(not available in the rifty isolate host, ADR-0557)';

/** Lines where the guest is not Node, each a declared gap (compat `isolate-host.md`). */
const DECLARED: Readonly<Record<string, string>> = {
  // Web streams are outside the isolate guest (Acceptance 5).
  'blob.stream()': `throw NotImplementedError: Not implemented: isolate-host.ReadableStream ${GAP}`,
  // A static member of the `URL` ceiling (compat row "Static members of those ceiling globals").
  'URL.createObjectURL': 'throw TypeError: URL.createObjectURL is not a function',
  // rifty's eager `openAsBlob` (`runtime-js/fs-open-as-blob-eager-read`): a plain Blob, so its
  // type is lower-cased and an overwrite does not make it unreadable.
  'fs.openAsBlob': '"true 3 text/x abc"',
  'fs.openAsBlob after an overwrite': '"abc"',
  // Node quotes the value with its `inspect`, rifty with its own (every host): a long string is
  // cut earlier and a lone surrogate is not escaped (compat row `Blob`, `File`).
  'ERR_INVALID_ARG_VALUE of a long value': `throw TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.endings' is invalid. Received '${'x'.repeat(120)}…'`,
  'ERR_INVALID_ARG_VALUE of a lone surrogate':
    "throw TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.endings' is invalid. Received '\uFFFD'", // the unescaped lone surrogate, as UTF-8 output carries it
  // rifty's `stream/consumers.blob` builds the guest's global `Blob` at call time (every host).
  'stream/consumers.blob under a replaced global Blob': 'false',
  // rifty's `buffer.resolveObjectURL` as before this unit: no blob URL is ever minted here.
  'buffer.resolveObjectURL': 'throw NotImplementedError: Not implemented: buffer.resolveObjectURL',
};

const parse = (stdout: string): Map<string, string> =>
  new Map(
    stdout
      .trimEnd()
      .split('\n')
      .map((line) => {
        const tab = line.indexOf('\t');
        return [line.slice(0, tab), line.slice(tab + 1)] as const;
      }),
  );

let node: Map<string, string>;
beforeAll(() => {
  if (process.version !== 'v24.16.0')
    throw new Error(`oracle is Node v24.16.0, this is ${process.version}`);
  const dir = mkdtempSync(join(tmpdir(), 'blob-cases-'));
  try {
    writeFileSync(join(dir, NAME), source);
    const r = spawnSync(process.execPath, [NAME], { cwd: dir, env: {}, encoding: 'utf8' });
    expect({ stderr: r.stderr, status: r.status }).toEqual({ stderr: '', status: 0 });
    node = parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function compare(guest: Map<string, string>): void {
  expect([...guest.keys()]).toEqual([...node.keys()]);
  const want = new Map(node);
  for (const [id, literal] of Object.entries(DECLARED)) {
    expect(want.get(id), `${id}: declared, still a gap against Node`).not.toBe(literal);
    want.set(id, literal);
  }
  expect(Object.fromEntries(guest)).toEqual(Object.fromEntries(want));
}

describe('Blob/File in the isolate guest equal Node v24.16.0', () => {
  it('as a sandbox exec', { timeout: 120_000 }, async () => {
    const sb = await createSandbox();
    try {
      await sb.writeFile(NAME, source);
      const r = await sb.exec(NAME);
      expect({ stderr: r.stderr, exitCode: r.exitCode }).toEqual({ stderr: '', exitCode: 0 });
      compare(parse(r.stdout));
    } finally {
      await sb.destroy();
    }
  });
  it('as runCode', { timeout: 120_000 }, async () => {
    const r = await runCode(source);
    expect({ stderr: r.stderr, exitCode: r.exitCode }).toEqual({ stderr: '', exitCode: 0 });
    compare(parse(r.stdout));
  });
});
