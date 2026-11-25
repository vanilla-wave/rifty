#!/usr/bin/env node
/**
 * Third-party notices gate (backlog toolchain-build/third-party-notices-in-published-files).
 * After `pnpm build:libs`, per publishable package: the packed
 * `dist/THIRD_PARTY_NOTICES.md` (`npm pack --dry-run`) equals the one derived
 * from the bundler's inputs, and every packed JS file with a counted input
 * carries the link line. Every packed dist JS file needs a bundler input list.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Packed dist files that need a bundler input list: all but maps, declarations, the notices file. */
const NEEDS_INPUTS = (p) =>
  p.startsWith('dist/') && p !== NOTICES && !/\.map$|\.d\.[cm]?ts$/u.test(p);

/**
 * @param {{ root: string, dir: string, name: string, packed: string[], read: (p: string) => string,
 *   inputs?: Record<string, string[]>, manifest?: object }} pkg
 * @returns {{ entries: number, violations: string[] }}
 */
export function checkPackage({ root, dir, name, packed, read, inputs, manifest }) {
  const all = withPackedSources(inputs ?? bundleInputs(root, dir), packed, dir);
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
  for (const p of packed)
    if (NEEDS_INPUTS(p) && !all[p]) out.push(tag(`${p}: no bundler input list`));
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
