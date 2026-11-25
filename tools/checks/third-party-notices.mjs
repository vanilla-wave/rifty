#!/usr/bin/env node
/**
 * Third-party notices gate (backlog toolchain-build/third-party-notices-in-published-files).
 * After `pnpm build:libs`, per publishable package: the packed
 * `dist/THIRD_PARTY_NOTICES.md` (`npm pack --dry-run`) equals the one derived
 * from the bundler's inputs, and every packed JS file with a counted input
 * carries the link line. Every packed dist JS file needs a bundler input list.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LINK,
  NOTICES,
  ROOT,
  bundleInputs,
  collect,
  loadManifest,
  publishableDirs,
  render,
  unusedRecords,
  validateManifest,
  withPackedSources,
} from '../publishing/third-party-notices.mjs';

const JS_RE = /\.[cm]?js$/u;

/** Paths `pnpm pack` would ship — the tool `pnpm publish` packs with. */
export function packedPaths(root, dir) {
  const out = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: join(root, dir),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).files.map((f) => f.path);
}

const DTS_RE = /\.d\.([cm]?)ts$/u;
const NOT_ACCOUNTED = 'not accounted — no bundler input list and not an own build output';

/**
 * Declarations tsup emitted for this package's own code: tsup must not resolve
 * dependency types (`resolve:` absent), and a declaration is own if it pairs a
 * packed JS output or an own declaration imports it.
 */
function ownDeclarations(root, dir, packed, read) {
  const config = join(root, dir, 'tsup.config.ts');
  if (!existsSync(config) || /\bresolve\s*:/u.test(readFileSync(config, 'utf8'))) return new Set();
  const set = new Set(packed);
  const js = (d) => d.replace(DTS_RE, (_, m) => `.${m}js`);
  const own = new Set(packed.filter((p) => DTS_RE.test(p) && set.has(js(p))));
  const todo = [...own];
  for (const d of todo) {
    const text = read(d);
    for (const [, spec] of text.matchAll(/(?:from|import\()\s*['"](\.\.?\/[^'"]+)['"]/gu)) {
      const target = join(dirname(d), spec).replace(/\.([cm]?)js$/u, '.d.$1ts');
      if (set.has(target) && !own.has(target)) {
        own.add(target);
        todo.push(target);
      }
    }
  }
  return own;
}

/** One rule: an input list whose every entry is a repo file, or an own build output. */
function account(root, dir, packed, all, read) {
  const own = ownDeclarations(root, dir, packed, read);
  const isFile = (i) =>
    !isAbsolute(i) &&
    !i.startsWith('..') &&
    existsSync(join(root, i)) &&
    statSync(join(root, i)).isFile();
  const out = [];
  for (const p of packed) {
    if (all[p]) {
      for (const i of all[p])
        if (!isFile(i)) out.push(`${p}: input ${i} is not a file in the repo`);
    } else if (!(p === NOTICES || (p.endsWith('.map') && all[p.slice(0, -4)]) || own.has(p))) {
      out.push(`${p}: ${NOT_ACCOUNTED}`);
    }
  }
  return out;
}

/**
 * @param {{ root: string, dir: string, name: string, packed: string[], read: (p: string) => string,
 *   inputs?: Record<string, string[]>, manifest?: object }} pkg
 * @returns {{ entries: number, violations: string[] }}
 */
export function checkPackage({ root, dir, name, packed, read, inputs, manifest }) {
  const all = withPackedSources(inputs ?? bundleInputs(root, dir), packed, dir, root);
  const { entries, counted, used, violations } = collect(
    root,
    dir,
    manifest ?? loadManifest(root),
    all,
  );
  const tag = (m) => `${name} ${m}`;
  const out = violations.map(tag);
  if (!packed.some((p) => p.startsWith('dist/')))
    return {
      entries: 0,
      used,
      violations: [`${name}: no dist/ in the tarball; run pnpm build:libs`],
    };
  out.push(...account(root, dir, packed, all, read).map(tag));
  const linked = packed.filter((p) => JS_RE.test(p) && read(p).includes(LINK));
  if (entries.length === 0) {
    if (packed.includes(NOTICES))
      out.push(tag(`${NOTICES} packed but nothing third-party is bundled`));
    for (const p of linked) out.push(tag(`${p}: links ${NOTICES}, which is not packed`));
    return { entries: 0, used, violations: out };
  }
  if (!packed.includes(NOTICES)) out.push(tag(`${NOTICES} missing from the tarball`));
  else if (read(NOTICES) !== render(name, entries))
    out.push(tag(`${NOTICES} differs from the bundler inputs; run pnpm build:libs`));
  for (const p of counted) {
    if (JS_RE.test(p) && packed.includes(p) && !read(p).includes(LINK))
      out.push(tag(`${p}: bundles third-party code without the notices link line`));
  }
  return { entries: entries.length, used, violations: out };
}

function main() {
  const violations = [];
  const usedSets = [];
  const manifest = loadManifest(ROOT);
  for (const dir of publishableDirs(ROOT)) {
    const { name } = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    const read = (p) => readFileSync(join(ROOT, dir, p), 'utf8');
    const r = checkPackage({
      root: ROOT,
      dir,
      name,
      packed: packedPaths(ROOT, dir),
      read,
      manifest,
    });
    usedSets.push(r.used);
    if (r.entries) console.log(`  ${name}: ${r.entries} entries in ${NOTICES}`);
    violations.push(...r.violations);
  }
  violations.push(...validateManifest(ROOT, manifest));
  for (const k of unusedRecords(manifest, usedSets))
    violations.push(`third-party-manifest ${k}: used by no package; remove or fix the record`);
  if (violations.length) {
    console.error(`third-party-notices: ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('third-party-notices: every packed notices file matches its bundler inputs');
}

if (process.argv[1] === fileURLToPath(import.meta.url) && existsSync(ROOT)) main();
