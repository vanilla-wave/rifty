/**
 * Tool semantics against the REAL page-side fs contracts: a real SnapshotFs
 * fed by collectSnapshot over the sync-mirror VFS, and a real OwnerRpcFs whose
 * writer applies frames like the owner would (apply + republish) — the same
 * harness owner-rpc-fs.test.ts uses. No fs fakes.
 */
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnerRpcFs } from '../../glue/owner-rpc-fs.ts';
import { SnapshotFs } from '../../glue/snapshot-fs.ts';
import { collectSnapshot } from '../../glue/vfs-snapshot-port.ts';
import { type VfsWriteFrame, applyVfsWriteFrame } from '../../glue/vfs-write-port.ts';
import type { AiAppContext } from '../app-context.ts';
import { TOOL_RESULT_CAP_BYTES } from '../truncate.ts';
import { buildFsTools, globToRegExp } from './fs-tools.ts';
import type { AiAgentTool } from './tool-def.ts';

const ROOT = '/workspace';
const enc = new TextEncoder();

function seed(path: string, text: string): void {
  const fs = syncMirror();
  const parent = path.slice(0, path.lastIndexOf('/'));
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(path, enc.encode(text));
}

interface Harness {
  ctx: AiAppContext;
  tools: Map<string, AiAgentTool>;
  writes: [string, string][];
  republish(): void;
}

function makeHarness(): Harness {
  const snapshot = new SnapshotFs(ROOT);
  const republish = (): void => snapshot.update(collectSnapshot(syncMirror(), ROOT));
  republish();
  const writer = {
    // Owner-like writer: apply the frame to the real mirror, then republish
    // the snapshot — the acked-write contract OwnerRpcFs waits on.
    writeFrameAcked(frame: VfsWriteFrame): Promise<void> {
      applyVfsWriteFrame(frame);
      republish();
      return Promise.resolve();
    },
  };
  const writes: [string, string][] = [];
  const ctx: AiAppContext = {
    root: () => ROOT,
    snapshot,
    fs: new OwnerRpcFs(snapshot, () => writer, { timeoutMs: 250 }),
    runShellLine: () => Promise.resolve({ exitCode: 0, output: '' }),
    gitDiff: () => Promise.resolve([]),
    fileWritten: (path, content) => {
      writes.push([path, content]);
    },
  };
  const tools = new Map(buildFsTools(ctx).map((d) => [d.tool.name, d.tool]));
  return { ctx, tools, writes, republish };
}

async function run(harness: Harness, name: string, params: unknown): Promise<string> {
  const tool = harness.tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.execute('t1', params as never);
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

beforeEach(() => {
  resetSyncMirror();
  syncMirror().mkdirSync(`${ROOT}/src`, { recursive: true });
  seed(`${ROOT}/src/main.js`, "console.log('hello');\nconsole.log('bye');\n");
  seed(`${ROOT}/README.md`, '# readme\n');
});
afterEach(() => resetSyncMirror());

describe('read_file / write_file', () => {
  it('reads workspace-relative paths and pages by offset/limit', async () => {
    const h = makeHarness();
    expect(await run(h, 'read_file', { path: 'src/main.js' })).toContain("console.log('hello')");
    expect(await run(h, 'read_file', { path: 'src/main.js', offset: 2, limit: 1 })).toBe(
      "console.log('bye');",
    );
  });

  it('throws loudly on a missing file and on root escape', async () => {
    const h = makeHarness();
    await expect(run(h, 'read_file', { path: 'nope.txt' })).rejects.toThrow(/ENOENT/);
    await expect(run(h, 'read_file', { path: '../etc/passwd' })).rejects.toThrow(/escapes/);
  });

  it('write_file lands in the real store (acked) and fires the dirty hook', async () => {
    const h = makeHarness();
    const out = await run(h, 'write_file', { path: 'src/new.txt', content: 'fresh\n' });
    expect(out).toContain('wrote 6 bytes to src/new.txt');
    expect(new TextDecoder().decode(h.ctx.snapshot.readFileBytesSync(`${ROOT}/src/new.txt`))).toBe(
      'fresh\n',
    );
    expect(h.writes).toEqual([[`${ROOT}/src/new.txt`, 'fresh\n']]);
  });

  it('caps oversized results with the shared 16 KiB marker', async () => {
    const h = makeHarness();
    seed(`${ROOT}/big.txt`, 'x'.repeat(TOOL_RESULT_CAP_BYTES * 2));
    h.republish();
    const out = await run(h, 'read_file', { path: 'big.txt' });
    expect(out).toContain(`[truncated ${TOOL_RESULT_CAP_BYTES} bytes]`);
    expect(enc.encode(out).byteLength).toBeLessThan(TOOL_RESULT_CAP_BYTES + 64);
  });
});

describe('edit_file semantics (exact + unique, no fuzz)', () => {
  it('replaces exactly one occurrence', async () => {
    const h = makeHarness();
    await run(h, 'edit_file', { path: 'src/main.js', old: "'hello'", new: "'bonjour'" });
    expect(await run(h, 'read_file', { path: 'src/main.js' })).toContain("'bonjour'");
  });

  it('fails loudly when the string is not found', async () => {
    const h = makeHarness();
    await expect(
      run(h, 'edit_file', { path: 'src/main.js', old: 'NOT THERE', new: 'x' }),
    ).rejects.toThrow(/string not found in src\/main\.js/);
  });

  it('fails loudly when the string is not unique', async () => {
    const h = makeHarness();
    await expect(
      run(h, 'edit_file', { path: 'src/main.js', old: 'console.log(', new: 'x' }),
    ).rejects.toThrow(/not unique in src\/main\.js/);
  });
});

describe('apply_patch tool', () => {
  it('applies a unified diff through the acked write path', async () => {
    const h = makeHarness();
    const patch = [
      '--- a/src/main.js',
      '+++ b/src/main.js',
      '@@ -1,2 +1,2 @@',
      "-console.log('hello');",
      "+console.log('patched');",
      " console.log('bye');",
      '',
    ].join('\n');
    expect(await run(h, 'apply_patch', { patch })).toContain('patched src/main.js');
    expect(await run(h, 'read_file', { path: 'src/main.js' })).toContain('patched');
  });

  it('rejects on hunk mismatch naming the hunk, writing nothing', async () => {
    const h = makeHarness();
    const patch = [
      '--- a/src/main.js',
      '+++ b/src/main.js',
      '@@ -1,1 +1,1 @@',
      '-not in file',
      '+x',
      '',
    ].join('\n');
    await expect(run(h, 'apply_patch', { patch })).rejects.toThrow(/hunk @@ -1,1 \+1,1 @@/);
    expect(await run(h, 'read_file', { path: 'src/main.js' })).toContain("'hello'");
  });
});

describe('list_files / grep / glob', () => {
  it('list_files renders the tree with dirs marked', async () => {
    const h = makeHarness();
    const out = await run(h, 'list_files', {});
    expect(out).toContain('src/');
    expect(out).toContain('src/main.js');
    expect(out).toContain('README.md');
  });

  it('grep outputs path:line: text and errors on a bad regex', async () => {
    const h = makeHarness();
    expect(await run(h, 'grep', { pattern: 'bye' })).toBe("src/main.js:2: console.log('bye');");
    expect(await run(h, 'grep', { pattern: 'BYE', ignoreCase: true })).toContain('src/main.js:2');
    expect(await run(h, 'grep', { pattern: 'zzz-none' })).toBe('(no matches)');
    await expect(run(h, 'grep', { pattern: '(' })).rejects.toThrow(/invalid pattern/);
  });

  it('glob matches ** and * over workspace-relative paths', async () => {
    const h = makeHarness();
    expect(await run(h, 'glob', { pattern: 'src/**/*.js' })).toBe('src/main.js');
    expect(await run(h, 'glob', { pattern: '*.md' })).toBe('README.md');
    expect(await run(h, 'glob', { pattern: '**/*.py' })).toBe('(no matches)');
  });
});

describe('globToRegExp', () => {
  it('segments: * stays within a segment, ** crosses, ? is one char', () => {
    expect(globToRegExp('src/*.js').test('src/a.js')).toBe(true);
    expect(globToRegExp('src/*.js').test('src/sub/a.js')).toBe(false);
    expect(globToRegExp('src/**/*.js').test('src/sub/deep/a.js')).toBe(true);
    expect(globToRegExp('**/*.js').test('a.js')).toBe(true);
    expect(globToRegExp('a?.js').test('ab.js')).toBe(true);
    expect(globToRegExp('a?.js').test('a/b.js')).toBe(false);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
});
