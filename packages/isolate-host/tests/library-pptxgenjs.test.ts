/**
 * pptxgenjs 4.0.1 in a sandbox (unit `backlog/distribution/isolate-host-egress-modules-load`,
 * Acceptance 4): its installed closure is laid out as `/workspace/node_modules` in the state
 * and in the oracle's temp dir — the same files — and each generator runs as
 * `node <file> <out>` on both sides. `fixtures/pptx/pptx.cjs` is the library probe's
 * canonical `gen/pptx.cjs`, byte for byte; no `unhandledRejection` listener, no
 * `process.release` change. Output: every part of the package equal to Node's once
 * the ISO timestamps of `docProps/core.xml` are masked, nested packages (chart data) by part.
 */
import { spawnSync } from 'node:child_process';
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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSandbox } from '../src/index.ts';

interface ZipEntry {
  readonly dir: boolean;
  async(type: 'nodebuffer'): Promise<Buffer>;
}
interface Zip {
  readonly files: Readonly<Record<string, ZipEntry>>;
}
interface JSZipStatic {
  loadAsync(data: Uint8Array): Promise<Zip>;
}

const here = dirname(fileURLToPath(import.meta.url));
const PPTXGENJS = realpathSync(join(here, '../node_modules/pptxgenjs'));
// pptxgenjs's own JSZip: the reader the library writes with, in real Node.
const JSZip = createRequire(join(PPTXGENJS, 'package.json'))('jszip') as JSZipStatic;
// The probe's 1×1 PNG (`gen/pptx.cjs` data URI).
const DOT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

/** Where `name` resolves from package dir `from` (Node's walk up `node_modules`), real path. */
function resolvePackage(name: string, from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    try {
      return realpathSync(join(dir, 'node_modules', name));
    } catch {}
    if (dirname(dir) === dir) throw new Error(`${name} not installed for ${from}`);
  }
}

/**
 * The installed closure of `root` as an npm-style tree: `node_modules/<path>` → package dir.
 * A dependency goes to the nearest slot up its dependent's chain, or to the root when free,
 * nested under its dependent when the nearest slot holds another copy.
 */
function closureTree(root: string): Map<string, string> {
  const slots = new Map<string, string>();
  const place = (pkgDir: string, at: string): void => {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      const depDir = resolvePackage(dep, pkgDir);
      let found: string | undefined;
      for (let scope = at; ; scope = scope.slice(0, scope.lastIndexOf('/node_modules/'))) {
        const slot = `${scope}/node_modules/${dep}`;
        if (slots.has(slot)) {
          found = slot;
          break;
        }
        if (!scope.includes('/node_modules/')) break;
      }
      if (found !== undefined && slots.get(found) === depDir) continue;
      const slot =
        found === undefined && !slots.has(`/node_modules/${dep}`)
          ? `/node_modules/${dep}`
          : `${at}/node_modules/${dep}`;
      slots.set(slot, depDir);
      place(depDir, slot);
    }
  };
  slots.set('/node_modules/pptxgenjs', root);
  place(root, '/node_modules/pptxgenjs');
  return slots;
}

/** Every file of the closure: workspace-relative path → bytes (a package's own `node_modules` excluded). */
function closureFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [slot, dir] of closureTree(PPTXGENJS)) {
    const walk = (abs: string): void => {
      for (const name of readdirSync(abs).sort()) {
        const path = join(abs, name);
        if (statSync(path).isDirectory()) {
          if (!(abs === dir && name === 'node_modules')) walk(path);
        } else files.set(`${slot.slice(1)}/${relative(dir, path)}`, readFileSync(path));
      }
    };
    walk(dir);
  }
  return files;
}

const mask = (text: string): string =>
  text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>');

/** Part name → masked text (XML) or base64 (binary); a nested package as `<name>!<part>`. */
async function parts(bytes: Uint8Array, prefix = ''): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const data = await entry.async('nodebuffer');
    if (/\.(xlsx|docx|pptx|zip)$/.test(name)) Object.assign(out, await parts(data, `${name}!`));
    else if (/\.(xml|rels|vml)$/.test(name)) {
      const text = data.toString('utf8');
      out[prefix + name] = name === 'docProps/core.xml' ? mask(text) : text;
    } else out[prefix + name] = data.toString('base64');
  }
  return out;
}

interface Outcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly file?: Uint8Array;
}

function inNode(files: Map<string, Uint8Array>, gen: string, out: string): Outcome {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'isolate-host-pptx-oracle-')));
  try {
    for (const [rel, data] of files) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), data);
    }
    const r = spawnSync(process.execPath, [gen, out], {
      cwd: dir,
      env: {},
      encoding: 'utf8',
      timeout: 60_000,
    });
    let file: Uint8Array | undefined;
    try {
      file = readFileSync(join(dir, out));
    } catch {}
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status, file };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function inSandbox(
  files: Map<string, Uint8Array>,
  gen: string,
  out: string,
): Promise<Outcome> {
  const sb = await createSandbox({ maxFsBytes: 256 * 2 ** 20 });
  try {
    for (const [rel, data] of files) await sb.writeFile(rel, data);
    const r = await sb.exec(gen, { args: [out], timeoutMs: 60_000, memoryLimitMb: 512 });
    let file: Uint8Array | undefined;
    try {
      file = await sb.readFile(out);
    } catch {}
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, file };
  } finally {
    await sb.destroy();
  }
}

const closure = closureFiles();

describe('pptxgenjs 4.0.1 writes the same pptx as Node (Acceptance 4)', () => {
  for (const [gen, extra, expectedParts] of [
    ['pptx.cjs', {}, ['ppt/slides/slide3.xml', 'ppt/media/image-1-1.png']],
    [
      'pptx-image-path.cjs',
      { 'dot.png': DOT_PNG },
      ['ppt/slides/slide1.xml', 'ppt/media/image-1-1.png'],
    ],
  ] as const) {
    it(gen, { timeout: 180_000 }, async () => {
      const files = new Map(closure);
      files.set(gen, readFileSync(join(here, 'fixtures/pptx', gen)));
      for (const [rel, data] of Object.entries(extra)) files.set(rel, data);
      files.set('out/.keep', new Uint8Array());
      const out = 'out/deck.pptx';
      const oracle = inNode(files, gen, out);
      expect(oracle, oracle.stderr).toMatchObject({
        exitCode: 0,
        stdout: `wrote ${out}\n`,
        stderr: '',
      });
      const guest = await inSandbox(files, gen, out);
      expect({ stdout: guest.stdout, stderr: guest.stderr, exitCode: guest.exitCode }).toEqual({
        stdout: oracle.stdout,
        stderr: '',
        exitCode: 0,
      });
      const [want, got] = await Promise.all([
        parts(oracle.file ?? new Uint8Array()),
        parts(guest.file ?? new Uint8Array()),
      ]);
      for (const part of ['[Content_Types].xml', 'ppt/presentation.xml', ...expectedParts])
        expect(Object.keys(want)).toContain(part);
      expect(got).toEqual(want);
    });
  }
});
