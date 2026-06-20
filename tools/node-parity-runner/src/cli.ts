/**
 * Walk `cases/` for `*.case.ts`, run each in Node and in rifty, diff the
 * stdouts. Exits non-zero on any divergence so CI can fail the build.
 */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diff, normalise } from './diff.ts';
import { runInNode } from './run-in-node.ts';
import { runInRifty } from './run-in-rifty.ts';
import type { CaseRun, ParityCase } from './types.ts';

const here = new URL('..', import.meta.url);
const casesDir = new URL('cases/', here);

async function walk(dir: URL): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir);
  for (const name of entries) {
    const child = new URL(
      `${name}${(await stat(fileURLToPath(new URL(name, dir)))).isDirectory() ? '/' : ''}`,
      dir,
    );
    if (child.pathname.endsWith('/')) {
      out.push(...(await walk(child)));
    } else if (name.endsWith('.case.ts')) {
      out.push(fileURLToPath(child));
    }
  }
  return out;
}

async function runOne(file: string): Promise<CaseRun> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: ParityCase };
  if (!mod.default) {
    return {
      file,
      nodeStdout: '',
      riftyStdout: '',
      match: false,
      error: 'case file has no default export',
    };
  }
  const testCase = mod.default;
  try {
    const [nodeOut, riftyOut] = await Promise.all([runInNode(testCase), runInRifty(testCase)]);
    const a = normalise(nodeOut);
    const b = normalise(riftyOut);
    let match = a === b;
    if (match && testCase.expected !== undefined) {
      if (testCase.expected instanceof RegExp) match = testCase.expected.test(a);
      else match = a === normalise(testCase.expected);
    }
    return {
      file,
      nodeStdout: a,
      riftyStdout: b,
      match,
      diff: match ? undefined : diff(a, b),
    };
  } catch (e) {
    return {
      file,
      nodeStdout: '',
      riftyStdout: '',
      match: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

const allFiles = await walk(casesDir);
// Optional substring filter (dev ergonomics): `tsx cli.ts <substr>` runs only
// cases whose path contains <substr>. No arg = the full suite (CI path). Filters
// nothing on a non-match-all so a typo'd filter visibly runs 0 cases.
const filter = process.argv[2];
const files = filter ? allFiles.filter((f) => f.includes(filter)) : allFiles;
console.log(`node-parity-runner: ${files.length} case(s)${filter ? ` matching '${filter}'` : ''}`);

let failures = 0;
for (const file of files) {
  const rel = file.replace(`${fileURLToPath(casesDir)}`, '');
  const result = await runOne(file);
  if (result.match) {
    console.log(`  ✓ ${rel}`);
  } else {
    failures++;
    console.log(`  ✗ ${rel}`);
    if (result.error) console.log(`    error: ${result.error}`);
    if (result.diff) {
      console.log('    diff (- node / + rifty):');
      for (const line of result.diff.split('\n')) console.log(`      ${line}`);
    } else {
      console.log(`    node:   ${JSON.stringify(result.nodeStdout)}`);
      console.log(`    rifty:  ${JSON.stringify(result.riftyStdout)}`);
    }
  }
}

if (failures > 0) {
  console.log(`${failures} case(s) failed`);
  process.exit(1);
} else {
  console.log('all cases match');
  // Force exit (symmetric with the failure branch above). Running the cases
  // leaves open handles the runner doesn't own — the native esbuild service
  // spawned by `run-in-node` for TS lowering, and the WASI workers from
  // `run-in-rifty` — so without this the process never exits and CI hangs
  // (observed: ~53 min orphaned `esbuild` pid before the job was killed).
  process.exit(0);
}
