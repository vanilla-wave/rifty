/**
 * Runs for the stream-core differential (`../node-streams-differential.test.ts`): one program or
 * parity case, three ways — live Node, the generated core on Node's bindings (`node-core.cjs`), the
 * generated core on rifty's bindings (`rifty-core.mts`) — each as a whole outcome.
 */
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const TSX = join(repo, 'node_modules/tsx/dist/loader.mjs');

export interface Outcome {
  readonly exitCode: number | string;
  readonly stdout: string;
  readonly stderr: string;
  /** Files written under the cwd (outside `node_modules`, the entry excepted), by path. */
  readonly written: ReadonlyMap<string, Uint8Array>;
}
export type Column = 'node' | 'node-core' | 'rifty-core';
export const COLUMNS: readonly Column[] = ['node', 'node-core', 'rifty-core'];
/** A column's bound; a run past it fails by name, never as a pass. */
export const RUN_TIMEOUT_MS = 120_000;

/** A run's files: relative to the cwd (`cwdFiles`) and next to the entry (`entryFiles`). */
export interface Run {
  readonly entry: string;
  readonly entryFiles: ReadonlyMap<string, Uint8Array>;
  readonly cwdFiles: ReadonlyMap<string, Uint8Array>;
  /** The cwd under the run's root (a parity case's `cwd`); '' = the root. */
  readonly cwd: string;
  /** The entry directory is the cwd (a program), else its own directory (a parity case). */
  readonly entryInCwd: boolean;
  /** The entry's arguments. */
  readonly args?: readonly string[];
}

function spawnRun(cmd: string, args: string[], cwd: string): Promise<Omit<Outcome, 'written'>> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      stdout += c;
    });
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      stderr += c;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${args.at(-1)}: no exit in ${RUN_TIMEOUT_MS} ms`));
    }, RUN_TIMEOUT_MS);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? `signal ${signal}`, stdout, stderr });
    });
  });
}

const write = (dir: string, files: ReadonlyMap<string, Uint8Array>) => {
  for (const [rel, data] of files) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), data);
  }
};
const isWritten = (rel: string) => rel !== 'node_modules' && !rel.startsWith('node_modules/');

/** `node` (live) or `node --expose-internals --require node-core.cjs` in a fresh directory. */
async function inNodeColumn(run: Run, core: boolean): Promise<Outcome> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nsd-')));
  try {
    const cwd = join(root, 'cwd', run.cwd);
    const entryDir = run.entryInCwd ? cwd : join(root, 'entry');
    mkdirSync(cwd, { recursive: true });
    write(join(root, 'cwd'), run.cwdFiles);
    write(entryDir, run.entryFiles);
    const argv = core
      ? ['--expose-internals', '--require', join(here, 'node-core.cjs'), join(entryDir, run.entry)]
      : [join(entryDir, run.entry)];
    argv.push(...(run.args ?? []));
    const r = await spawnRun(process.execPath, argv, cwd);
    const written = new Map<string, Uint8Array>();
    const walk = (abs: string): void => {
      for (const name of readdirSync(abs)) {
        const path = join(abs, name);
        const rel = relative(cwd, path).split('\\').join('/');
        if (!isWritten(rel) || (run.entryInCwd && rel === run.entry)) continue;
        if (run.cwdFiles.has(rel) || (run.entryInCwd && run.entryFiles.has(rel))) continue;
        if (statSync(path).isDirectory()) walk(path);
        else written.set(rel, readFileSync(path));
      }
    };
    walk(cwd);
    return { ...r, ...masks(r, [entryDir, cwd, root]), written };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The generated core on rifty's bindings, rifty's modules on a memory VFS, in a Node child. */
async function inRiftyColumn(run: Run): Promise<Outcome> {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'nsd-rifty-')));
  try {
    const cwd = run.cwd === '' ? '/workspace' : `/workspace/${run.cwd}`;
    const entryDir = run.entryInCwd ? cwd : '/entry';
    const files: Record<string, string> = {};
    for (const [rel, data] of run.cwdFiles)
      files[`/workspace/${rel}`] = Buffer.from(data).toString('base64');
    for (const [rel, data] of run.entryFiles)
      files[`${entryDir}/${rel}`] = Buffer.from(data).toString('base64');
    const dump = join(tmp, 'written.json');
    const spec = join(tmp, 'spec.json');
    writeFileSync(
      spec,
      JSON.stringify({ files, entry: `${entryDir}/${run.entry}`, cwd, dump, args: run.args ?? [] }),
    );
    const r = await spawnRun(
      process.execPath,
      ['--import', TSX, join(here, 'rifty-core.mts'), spec],
      tmp,
    );
    const dumped = JSON.parse(
      (() => {
        try {
          return readFileSync(dump, 'utf8');
        } catch {
          return JSON.stringify({ '(no dump: the exit handler did not run)': '' });
        }
      })(),
    ) as Record<string, string>;
    const written = new Map<string, Uint8Array>();
    for (const [rel, b64] of Object.entries(dumped))
      if (!run.cwdFiles.has(rel) && !(run.entryInCwd && run.entryFiles.has(rel)))
        written.set(rel, Buffer.from(b64, 'base64'));
    return { ...r, ...masks(r, [entryDir, cwd, '/workspace', tmp]), written };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Paths a run prints: `<entry>`, `<cwd>`, `<root>`, `<repo>`; longest first. */
function masks(r: { stdout: string; stderr: string }, dirs: string[]) {
  const names = ['<entry>', '<cwd>', '<root>', '<tmp>'];
  const pairs = dirs.map((d, i) => [d, names[i] ?? '<tmp>'] as const).concat([[repo, '<repo>']]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  const mask = (s: string) => pairs.reduce((t, [d, n]) => t.split(d).join(n), s);
  return { stdout: mask(r.stdout), stderr: mask(r.stderr) };
}

export function runColumn(column: Column, run: Run): Promise<Outcome> {
  if (column === 'rifty-core') return inRiftyColumn(run);
  return inNodeColumn(run, column === 'node-core');
}
