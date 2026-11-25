/**
 * Acceptance carrier of goal `isolate-host-sandbox-template` (simple form): a real
 * `produceDependencySnapshot` artifact of the four document libraries, through the public API
 * only, against live Node over the same tree (`tar -x` of the artifact). I5 (read-only) is not
 * here: map item 3.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { type Sandbox, createSandbox, registerTemplate } from '../src/index.ts';
import { decodeCount } from '../src/template.ts';
import { type Artifact, TEMPLATE_ID, closeRegistry, libraryArtifact } from './template-artifact.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures/template');
const LONG = { timeout: 600_000 };
const MiB = 2 ** 20;

afterAll(closeRegistry);

interface ZipEntry {
  readonly dir: boolean;
  async(type: 'nodebuffer'): Promise<Buffer>;
}
const JSZip = createRequire(realpathSync(join(here, '../node_modules/pptxgenjs/package.json')))(
  'jszip',
) as { loadAsync(data: Uint8Array): Promise<{ readonly files: Record<string, ZipEntry> }> };
const { SaxesParser } = createRequire(
  realpathSync(join(here, '../node_modules/exceljs/package.json')),
)('saxes') as {
  SaxesParser: new () => {
    on(event: 'error', fn: (e: Error) => void): void;
    write(text: string): { close(): void };
  };
};

/** The decoded tar of an artifact, as its producer hashed it. */
function tarOf(a: Artifact): Buffer {
  return a.encoding === 'gzip' ? gunzipSync(a.archive) : brotliDecompressSync(a.archive);
}

/** The oracle's root: the artifact's `payload/node_modules` at `<root>/node_modules`, by `tar -x`. */
function oracleRoot(a: Artifact): string {
  const dir = mkdtempSync(join(tmpdir(), 'template-oracle-'));
  const out = spawnSync('tar', ['-xf', '-', '-C', dir], { input: tarOf(a) });
  if (out.status !== 0) throw new Error(`tar -x: ${out.stderr}`);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'template-root-')));
  renameSync(join(dir, 'payload/node_modules'), join(root, 'node_modules'));
  for (const d of ['workspace', 'tmp']) mkdirSync(join(root, d));
  return root;
}

function inNode(root: string, file: string, args: string[] = []) {
  cpSync(join(fixtures, file), join(root, 'workspace', file));
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: join(root, 'workspace'),
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
}

/** path (under `/node_modules`) → `dir` or the file's sha256: live Node's tree. */
function nodeTree(root: string): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const p = `${rel}/${name}`;
      if (statSync(join(root, p)).isDirectory()) {
        tree.set(p, 'dir');
        walk(p);
      } else
        tree.set(
          p,
          createHash('sha256')
            .update(readFileSync(join(root, p)))
            .digest('hex'),
        );
    }
  };
  walk('/node_modules');
  return tree;
}

/** The same through the sandbox's host ops. */
async function hostTree(sb: Sandbox): Promise<Map<string, string>> {
  const tree = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await sb.list(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.type === 'directory') {
        tree.set(p, 'dir');
        await walk(p);
      } else
        tree.set(
          p,
          createHash('sha256')
            .update(await sb.readFile(p))
            .digest('hex'),
        );
    }
  };
  await walk('/node_modules');
  return tree;
}

const failure = (fn: () => Promise<unknown>): Promise<unknown> =>
  fn().then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

let registered: Promise<{ id: string; version: string }> | undefined;
const identity = (): Promise<{ id: string; version: string }> => {
  registered ??= libraryArtifact().then((a) => registerTemplate(a.archive));
  return registered;
};

/** The smallest `maxFsBytes` the four-library template takes, read from the refusal's message. */
let budget: Promise<number> | undefined;
function templateBudget(): Promise<number> {
  budget ??= identity().then(async (template) => {
    const error = (await failure(() => createSandbox({ template }))) as Error & { code: string };
    expect(error.code).toBe('ERR_OUT_OF_RANGE');
    const m = /must be at least (\d+) /.exec(error.message);
    if (m === null) throw new Error(`no budget in: ${error.message}`);
    return Number(m[1]);
  });
  return budget;
}

/** A sandbox over the four-library template with room for the agent's files. */
async function sandbox(): Promise<Sandbox> {
  return createSandbox({
    template: await identity(),
    maxFsBytes: (await templateBudget()) + 16 * MiB,
  });
}

async function inSandbox(sb: Sandbox, file: string, args: string[] = []) {
  await sb.writeFile(`/workspace/${file}`, readFileSync(join(fixtures, file)));
  return sb.exec(file, { args });
}

let oracle: string | undefined;
const nodeRoot = async (): Promise<string> => {
  oracle ??= oracleRoot(await libraryArtifact());
  return oracle;
};

describe('intake (I1)', () => {
  it.fails(
    'a gzip artifact, frozen and replay: identity = { templateId, snapshotId }',
    LONG,
    async () => {
      for (const profile of ['frozen', 'replay'] as const) {
        const a = await libraryArtifact('gzip', profile);
        expect(await registerTemplate(a.archive)).toEqual({
          id: TEMPLATE_ID,
          version: a.snapshotId,
        });
        expect(a.snapshotId).toBe(`sha256:${createHash('sha256').update(tarOf(a)).digest('hex')}`);
      }
    },
  );

  it.fails('a br artifact registers and its library loads', LONG, async () => {
    const a = await libraryArtifact('br', 'replay', { 'pdf-lib': '1.17.1' });
    expect(a.encoding).toBe('br');
    const template = await registerTemplate(a.archive);
    expect(template).toEqual({ id: TEMPLATE_ID, version: a.snapshotId });
    const sb = await createSandbox({ template, maxFsBytes: 64 * MiB });
    try {
      await sb.writeFile(
        '/workspace/main.js',
        "console.log(typeof require('pdf-lib').PDFDocument)",
      );
      expect(await sb.exec('main.js')).toMatchObject({ exitCode: 0, stdout: 'function\n' });
    } finally {
      await sb.destroy();
    }
  });

  it.fails('one artifact is decoded once per process, by bytes or by identity', LONG, async () => {
    const a = await libraryArtifact();
    const before = decodeCount();
    const id = await registerTemplate(a.archive);
    expect(await registerTemplate(new Uint8Array(a.archive))).toEqual(id);
    const maxFsBytes = (await templateBudget()) + MiB;
    await (await createSandbox({ template: a.archive, maxFsBytes })).destroy();
    await (await createSandbox({ template: id, maxFsBytes })).destroy();
    expect(decodeCount() - before).toBeLessThanOrEqual(1);
  });

  it.fails(
    'a broken, truncated or unsupported artifact is a named error before any sandbox',
    LONG,
    async () => {
      const a = await libraryArtifact();
      const tar = tarOf(a);
      const badHeader = Buffer.from(tar);
      badHeader[0] = (badHeader[0] as number) ^ 1; // the first header's checksum no longer holds
      const flipped = Buffer.from(a.archive);
      const at = flipped.length >> 1;
      flipped[at] = (flipped[at] as number) ^ 0xff;
      const cases: Record<string, Uint8Array> = {
        empty: new Uint8Array(),
        'random bytes': Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) & 0xff),
        truncated: a.archive.subarray(0, a.archive.length >> 1),
        'flipped byte': flipped,
        'gzip of a broken tar': gzipSync(badHeader),
        'gzip of no tar': gzipSync(Buffer.from('{"version":5}')),
        'a plain tar (no encoding)': tar,
      };
      for (const [name, bytes] of Object.entries(cases)) {
        for (const call of [
          () => registerTemplate(bytes),
          () => createSandbox({ template: bytes, maxFsBytes: 256 * MiB }),
        ]) {
          const error = (await failure(call)) as Error & { code?: string };
          expect({ name, code: error.code }).toEqual({
            name,
            code: 'ERR_ISOLATE_HOST_TEMPLATE_ARTIFACT',
          });
        }
      }
      const wrongType = (await failure(() =>
        registerTemplate('artifact' as unknown as Uint8Array),
      )) as Error & { code?: string };
      expect(wrongType.code).toBe('ERR_INVALID_ARG_TYPE');
    },
  );

  it.fails('an unknown identity is a named error', async () => {
    const error = (await failure(() =>
      createSandbox({ template: { id: 'nope', version: `sha256:${'0'.repeat(64)}` } }),
    )) as Error & { code?: string };
    expect(error.code).toBe('ERR_ISOLATE_HOST_TEMPLATE_UNKNOWN');
  });
});

describe('a sandbox over the four-library template', () => {
  it.fails(
    "/node_modules is the artifact's payload/node_modules, byte for byte (I2)",
    LONG,
    async () => {
      const sb = await sandbox();
      try {
        expect(await hostTree(sb)).toEqual(nodeTree(await nodeRoot()));
        expect((await sb.list('/')).map((e) => e.name)).toEqual([
          'node_modules',
          'tmp',
          'workspace',
        ]);
      } finally {
        await sb.destroy();
      }
    },
  );

  it.fails(
    'require resolves into /node_modules as in Node; nothing else is visible (I2)',
    LONG,
    async () => {
      const node = inNode(await nodeRoot(), 'resolve.cjs');
      expect(node, node.stderr).toMatchObject({ exitCode: 0, stderr: '' });
      const sb = await sandbox();
      try {
        const guest = await inSandbox(sb, 'resolve.cjs');
        expect(guest.stderr).toBe('');
        const view = (out: string) => {
          const v = JSON.parse(out) as { paths: string[] };
          return { ...v, paths: v.paths.filter((p) => p.startsWith('<root>')) };
        };
        expect(view(guest.stdout)).toEqual(view(node.stdout));
      } finally {
        await sb.destroy();
      }
    },
  );

  const masked = (text: string): string =>
    text
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>')
      .replace(/D:\d{14}Z?(\d\d'\d\d'?)?/g, '<time>')
      .replace(/\/ID \[ <[0-9A-F]+> <[0-9A-F]+> \]/g, '/ID <id>');
  const wellFormed = (name: string, xml: string): void => {
    const parser = new SaxesParser();
    parser.on('error', (e) => {
      throw new Error(`${name}: ${e.message}`);
    });
    parser.write(xml).close();
  };
  /** Part → masked XML (checked well-formed) or base64. */
  async function ooxml(bytes: Uint8Array): Promise<Record<string, string>> {
    const zip = await JSZip.loadAsync(bytes);
    const out: Record<string, string> = {};
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const data = await entry.async('nodebuffer');
      if (/\.(xml|rels|vml)$/.test(name)) {
        wellFormed(name, data.toString('utf8'));
        out[name] = masked(data.toString('utf8'));
      } else out[name] = data.toString('base64');
    }
    return out;
  }
  /** A PDF as text, Flate streams inflated, timestamps / ids / lengths / offsets masked. */
  function pdfText(bytes: Uint8Array): string {
    return masked(
      Buffer.from(bytes)
        .toString('latin1')
        .replace(/stream\r?\n([\s\S]*?)endstream/g, (all, body: string) => {
          try {
            return `stream[${inflateSync(Buffer.from(body, 'latin1')).toString('latin1')}]`;
          } catch {
            return all;
          }
        }),
    )
      .replace(/\/Length \d+/g, '/Length <n>')
      .replace(/startxref\s+\d+/g, 'startxref <n>');
  }
  const EXPECT: Record<string, (string | RegExp)[]> = {
    pptx: [
      'ppt/presentation.xml',
      'ppt/slides/slide3.xml',
      /^ppt\/charts\/chart\d+\.xml$/,
      /^ppt\/media\/.+\.png$/,
    ],
    docx: ['word/document.xml', /^word\/media\/.+\.png$/],
    xlsx: ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', /^xl\/media\/.+\.png$/],
  };

  for (const kind of ['pdf', 'docx', 'pptx', 'xlsx'] as const) {
    it.fails(
      `gen/${kind}.cjs writes the document Node writes, a valid one (I3)`,
      LONG,
      async () => {
        const out = `out.${kind}`;
        const root = await nodeRoot();
        const node = inNode(root, `${kind}.cjs`, [out]);
        expect(node, node.stderr).toMatchObject({ exitCode: 0, stderr: '' });
        const nodeFile = readFileSync(join(root, 'workspace', out));
        const sb = await sandbox();
        try {
          const guest = await inSandbox(sb, `${kind}.cjs`, [out]);
          expect({ ...guest, stateRefused: guest.stateRefused }).toMatchObject({
            exitCode: 0,
            stdout: node.stdout,
            stderr: '',
            stateRefused: undefined,
          });
          const file = await sb.readFile(`/workspace/${out}`);
          if (kind === 'pdf') {
            const doc = await PDFDocument.load(file);
            expect([doc.getPageCount(), doc.getTitle()]).toEqual([2, 'Probe PDF']);
            expect(pdfText(file)).toBe(pdfText(nodeFile));
          } else {
            const parts = await ooxml(file);
            for (const want of ['[Content_Types].xml', '_rels/.rels', ...(EXPECT[kind] ?? [])])
              expect(
                Object.keys(parts).some((n) =>
                  typeof want === 'string' ? n === want : want.test(n),
                ),
                String(want),
              ).toBe(true);
            expect(parts).toEqual(await ooxml(nodeFile));
          }
        } finally {
          await sb.destroy();
        }
      },
    );
  }

  it.fails(
    "writable: a change under /node_modules is that sandbox's alone (I4)",
    LONG,
    async () => {
      const [a, b] = [await sandbox(), await sandbox()];
      try {
        await a.writeFile(
          '/workspace/edit.js',
          [
            "const fs = require('node:fs');",
            "fs.writeFileSync('/node_modules/pdf-lib/package.json', JSON.stringify({ name: 'pdf-lib', version: '0.0.0-agent', main: 'x.js' }));",
            "fs.writeFileSync('/node_modules/pdf-lib/x.js', 'module.exports = 42;');",
            "fs.rmSync('/node_modules/docx', { recursive: true });",
          ].join('\n'),
        );
        expect(await a.exec('edit.js')).toMatchObject({ exitCode: 0, stderr: '' });
        await a.writeFile('/node_modules/exceljs/host.txt', 'host');
        await a.writeFile(
          '/workspace/see.js',
          "const fs = require('node:fs'); console.log(require('pdf-lib'), fs.existsSync('/node_modules/docx'), fs.readFileSync('/node_modules/exceljs/host.txt', 'utf8'))",
        );
        expect(await a.exec('see.js')).toMatchObject({ exitCode: 0, stdout: '42 false host\n' });
        expect(new TextDecoder().decode(await a.readFile('/node_modules/pdf-lib/x.js'))).toBe(
          'module.exports = 42;',
        );
        await expect(a.list('/node_modules/docx')).rejects.toMatchObject({ code: 'ENOENT' });
        const c = await sandbox();
        for (const other of [b, c]) {
          await other.writeFile(
            '/workspace/see.js',
            "const fs = require('node:fs'); console.log(typeof require('pdf-lib').PDFDocument, fs.existsSync('/node_modules/docx'), fs.existsSync('/node_modules/exceljs/host.txt'))",
          );
          expect(await other.exec('see.js')).toMatchObject({
            exitCode: 0,
            stdout: 'function true false\n',
          });
        }
        await c.destroy();
      } finally {
        await a.destroy();
        await b.destroy();
      }
    },
  );

  it.fails('limits: the template counts in maxFsBytes, refusals are named (I6)', LONG, async () => {
    const template = await identity();
    const least = await templateBudget();
    expect(least).toBeGreaterThan(64 * MiB);
    const tight = await createSandbox({ template, maxFsBytes: least });
    try {
      await expect(tight.writeFile('/workspace/a.bin', new Uint8Array(1024))).rejects.toMatchObject(
        {
          code: 'ERR_ISOLATE_HOST_SANDBOX_FULL',
        },
      );
      await expect(tight.list('/workspace')).resolves.toEqual([]);
    } finally {
      await tight.destroy();
    }
    const sb = await createSandbox({ template, maxFsBytes: least + MiB });
    try {
      await sb.writeFile(
        '/workspace/big.js',
        "require('node:fs').writeFileSync('/workspace/big.bin', Buffer.alloc(2 * 1024 * 1024))",
      );
      expect(await sb.exec('big.js')).toMatchObject({
        exitCode: 0,
        stateRefused: 'ERR_FS_SNAPSHOT_TOO_LARGE',
      });
      await expect(sb.list('/workspace')).resolves.toEqual([
        { name: 'big.js', type: 'file', size: expect.any(Number) },
      ]);
      await sb.writeFile('/workspace/empty.js', '');
      const small = await sb.exec('empty.js', { memoryLimitMb: 64 });
      expect(
        small.stateRefused === 'ERR_ISOLATE_HOST_SANDBOX_RESTORE' || small.termination === 'memory',
        JSON.stringify(small),
      ).toBe(true);
    } finally {
      await sb.destroy();
    }
  });

  it.fails(
    'a killed or aborted run rolls back its writes under /node_modules (I7)',
    LONG,
    async () => {
      const sb = await sandbox();
      try {
        await sb.writeFile(
          '/workspace/kill.js',
          "require('node:fs').rmSync('/node_modules/pdf-lib', { recursive: true }); for (;;);",
        );
        expect(await sb.exec('kill.js', { timeoutMs: 5_000 })).toMatchObject({
          exitCode: null,
          termination: 'timeout',
        });
        expect((await sb.list('/node_modules/pdf-lib')).length).toBeGreaterThan(0);
        const controller = new AbortController();
        const run = sb.exec('kill.js', { signal: controller.signal });
        setTimeout(() => controller.abort(), 3_000);
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        expect((await sb.list('/node_modules/pdf-lib')).length).toBeGreaterThan(0);
        await sb.writeFile(
          '/workspace/ok.js',
          "console.log(typeof require('pdf-lib').PDFDocument)",
        );
        expect(await sb.exec('ok.js')).toMatchObject({ exitCode: 0, stdout: 'function\n' });
      } finally {
        await sb.destroy();
      }
    },
  );

  it.fails('persisting a template sandbox is a loud gap (I8)', LONG, async () => {
    const sb = await sandbox();
    try {
      await expect(sb.snapshot()).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'isolate-host.sandbox-template-snapshot',
      });
    } finally {
      await sb.destroy();
    }
    const plain = await createSandbox();
    const snapshot = await plain.snapshot();
    await plain.destroy();
    await expect(createSandbox({ template: await identity(), snapshot })).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'isolate-host.sandbox-template-snapshot',
    });
  });
});
