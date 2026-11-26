// Shared steps of the pinned-Node-source generators (ADR-0574 pipeline: generate-url-legacy.mjs,
// generate-node-blob.mjs, generate-node-streams.mjs): CLI mode, sha256-pinned vendored reads,
// upstream input checks, Node's own LICENSE part, --write/--check of the generated files.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { version as esbuildVersion } from 'esbuild';

export const NODE = 'v24.16.0';
export { esbuildVersion };

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** `--write|--check`, the only argument; esbuild pinned (its output is committed). */
export function cliMode(argv, script, adr) {
  const mode = argv[2];
  if (!['--write', '--check'].includes(mode) || argv.length !== 3)
    throw new Error(`Usage: ${script} --write|--check`);
  if (esbuildVersion !== '0.28.0') throw new Error(`esbuild drift: re-probe ${adr}`);
  return mode;
}

/** Reads vendored files by path, each checked against its sha256 pin; `sources` records the reads. */
export function vendorReader(vendor, pins, adr) {
  const sources = {};
  async function vendored(path) {
    const text = await readFile(join(vendor, path), 'utf8');
    const sha = sha256(text);
    if (sha !== pins[path]) throw new Error(`Node source drift: ${path} (${sha}); re-probe ${adr}`);
    sources[path] = sha;
    return text;
  }
  return { vendored, sources, digest: () => sha256(JSON.stringify(sources)) };
}

/** The sorted distinct `require('…')`/`internalBinding('…')` calls of an upstream text. */
export const loadsOf = (text) =>
  [...new Set(text.match(/\b(?:require|internalBinding)\('[^']+'\)/g) ?? [])].sort();

/** Names of every `const { … } = primordials;` header. */
export const primordialHeaders = (text) =>
  [...text.matchAll(/const \{([^}]*)\} = primordials;/g)].map((block) =>
    block[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  );

/** Node's own part of its LICENSE (before the bundled-dependency licenses). */
export const nodeLicensePart = (license) =>
  license.slice(0, license.indexOf('The Node.js license applies to all parts'));

/** `--write` writes `files` into `out`; `--check` fails on the first file that differs. */
export async function emit(mode, out, files, label, regenerate) {
  for (const [name, text] of Object.entries(files)) {
    if (mode === '--write') {
      await mkdir(out, { recursive: true });
      await writeFile(join(out, name), text);
    } else if ((await readFile(join(out, name), 'utf8').catch(() => '')) !== text) {
      throw new Error(`${label} drift: ${name}; run ${regenerate}`);
    }
  }
}
