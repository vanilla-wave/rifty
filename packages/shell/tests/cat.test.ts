import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cat } from '../src/commands/cat.ts';
import { makeCtx } from './_ctx.ts';

const enc = new TextEncoder();

/** Install a fresh in-memory mirror seeded with `files` before each test. */
function seed(files: Record<string, string>): void {
  const fs = new MemoryFsSync();
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
}

function allBytes(): Uint8Array {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i;
  return bytes;
}

function fixtureBody(name: string): string {
  const path = fileURLToPath(new URL(`../fixtures/cat/${name}`, import.meta.url));
  const raw = readFileSync(path, 'utf8');
  const nl = raw.indexOf('\n');
  return raw.slice(nl + 1).trim();
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('concatenates file contents verbatim to stdout, exit 0', async () => {
  seed({ '/a.txt': 'hello\n', '/b.txt': 'world\n' });
  const { ctx, out, err } = makeCtx();
  const code = await cat(['/a.txt', '/b.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('hello\nworld\n');
  expect(err()).toBe('');
});

it('plain cat emits binary bytes byte-for-byte against frozen GNU coreutils 9.7 fixture', async () => {
  const fs = new MemoryFsSync();
  fs.writeFileSync('/bin.dat', allBytes());
  setSyncMirror(fs);
  const chunks: Uint8Array[] = [];
  const ctx = {
    cwd: '/',
    env: {},
    stdout: {
      write(chunk: string | Uint8Array): void {
        chunks.push(typeof chunk === 'string' ? enc.encode(chunk) : chunk);
      },
    },
    stderr: {
      write(): void {},
    },
  };
  const code = await cat(['/bin.dat'], ctx);
  expect(code).toBe(0);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.byteLength;
  }
  expect(hex(out)).toBe(fixtureBody('binary-all-bytes.hex'));
});

it('-n numbers ALL lines, GNU 6-wide right-justified number + tab', async () => {
  seed({ '/f.txt': 'one\ntwo\n\nfour\n' });
  const { ctx, out } = makeCtx();
  const code = await cat(['-n', '/f.txt'], ctx);
  expect(code).toBe(0);
  // 6-wide field: 5 spaces + digit + tab. Blank line still numbered.
  expect(out()).toBe('     1\tone\n     2\ttwo\n     3\t\n     4\tfour\n');
});

it('-b numbers only NON-blank lines (blank lines unnumbered)', async () => {
  seed({ '/f.txt': 'one\n\ntwo\n' });
  const { ctx, out } = makeCtx();
  const code = await cat(['-b', '/f.txt'], ctx);
  expect(code).toBe(0);
  // Blank line gets no number and no tab; counter only advances on non-blank.
  expect(out()).toBe('     1\tone\n\n     2\ttwo\n');
});

it('-E appends $ at each end-of-line', async () => {
  seed({ '/f.txt': 'a\nb\n' });
  const { ctx, out } = makeCtx();
  const code = await cat(['-E', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('a$\nb$\n');
});

it('-A renders tab as ^I and EOL as $', async () => {
  seed({ '/f.txt': 'a\tb\nc\n' });
  const { ctx, out } = makeCtx();
  const code = await cat(['-A', '/f.txt'], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('a^Ib$\nc$\n');
});

it('missing file: stderr "cat: <f>: <msg>", exit 1, no stdout', async () => {
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await cat(['/nope.txt'], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe('cat: /nope.txt: No such file or directory\n');
});

it('no file argument: "cat: missing argument", exit 1', async () => {
  seed({});
  const { ctx, out, err } = makeCtx();
  const code = await cat([], ctx);
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toBe('cat: missing argument\n');
});

it('continues past a missing file but still exits 1', async () => {
  seed({ '/ok.txt': 'data\n' });
  const { ctx, out, err } = makeCtx();
  const code = await cat(['/nope.txt', '/ok.txt'], ctx);
  expect(code).toBe(1);
  // Good file still printed; bad file reported to stderr.
  expect(out()).toBe('data\n');
  expect(err()).toBe('cat: /nope.txt: No such file or directory\n');
});

it('-s (and any unlisted flag) throws NotImplementedError', async () => {
  seed({ '/f.txt': 'x\n' });
  const { ctx } = makeCtx();
  await expect(cat(['-s', '/f.txt'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
