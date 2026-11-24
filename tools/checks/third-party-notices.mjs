#!/usr/bin/env node
/**
 * Third-party notice gate (backlog toolchain-build/third-party-notices-in-published-files).
 *
 * Source = a `generated/` or `vendor/` dir of a publishable package holding
 * upstream code of one origin: it carries `<origin>.LICENSE` files (verbatim
 * upstream texts); a dir without one may hold only FIRST_PARTY files, so a new
 * upstream file anywhere else is red. Every file `npm pack` would ship is scanned for each source
 * artifact's fingerprint; a hit needs every one of the source's licenses in
 * that file — the notice travels with the chunk; a separate NOTICE file does not
 * count. Only a JSON artifact (no comment possible) is covered by its own packed
 * `<origin>.LICENSE` files. Run after
 * `pnpm build:libs`.
 *
 * Fingerprint: WINDOWS evenly spaced WINDOW-char slices of the artifact with
 * whitespace, JSON escapes and `/*! … *\/` legal comments removed (bundlers
 * re-print code; strings and minified bodies survive). Measured 2026-11-24,
 * esbuild 0.28.0, 2300 packed-file × artifact pairs: every copy ≥ 42/62 (0.68);
 * non-copies ≤ 2/62, except workbench `typescript-worker.js` 12/64 — it inlines
 * npm `typescript` (same upstream, other build; finding
 * bundled-npm-dependency-notices). THRESHOLD 0.5 sits between.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOW = 24;
export const WINDOWS = 64;
export const THRESHOLD = 0.5;
/** Same set `release.yml` publishes. */
export const PUBLISH_ROOTS = ['packages/*', 'tools/shadow-registry', 'services/eddy'];
/** Generated from rifty's own sources/data — no upstream license applies. */
export const FIRST_PARTY = new Set([
  // proxy bootstrap compiled from rifty source
  'packages/runtime-js/src/internal/generated/proxy-identity.js',
  'packages/runtime-js/src/internal/generated/proxy-identity.d.ts',
  'packages/workbench/src/generated/install-artifact-identity.json',
  'tools/shadow-registry/generated/shadow-substitution-catalog.json',
  'tools/shadow-registry/generated/esbuild-runtime-manifest.json', // hashes + anchors, no code
]);
const SOURCE_DIRS = new Set(['generated', 'vendor']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'fixtures', '__tests__']);
const ARTIFACT_RE = /\.(?:[cm]?js|json)$/u;
const NOT_ARTIFACT = new Set(['sources.json']);
const BINARY_EXT = new Set(['.wasm', '.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.gz']);

/** Whitespace- and escape-insensitive form: survives re-printing and JSON embedding. */
export function normalize(text) {
  return text
    .replace(/\\[nrt]/gu, '')
    .replace(/\\(["'\\])/gu, '$1')
    .replace(/\s+/gu, '');
}

/** @returns {string[]} distinct windows of the artifact's own code. */
export function fingerprint(artifact) {
  const code = normalize(
    artifact
      .replace(/\/\*![\s\S]*?\*\//gu, '')
      .split('\n')
      .filter((line) => !line.startsWith('//'))
      .join('\n'),
  );
  if (code.length < WINDOW * WINDOWS) return [];
  const windows = [];
  for (let i = 0; i < WINDOWS; i++) {
    const at = Math.floor(((code.length - WINDOW) * (i + 0.5)) / WINDOWS);
    windows.push(code.slice(at, at + WINDOW));
  }
  return [...new Set(windows)];
}

/** Share of `windows` present in a normalized file. */
export function share(windows, normalizedText) {
  if (windows.length === 0) return 0;
  return windows.filter((w) => normalizedText.includes(w)).length / windows.length;
}

/** Publishable package dirs (relative to root), non-private. */
export function publishableDirs(root) {
  const dirs = [];
  for (const pattern of PUBLISH_ROOTS) {
    const candidates = pattern.endsWith('/*')
      ? readdirSync(join(root, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => `${pattern.slice(0, -2)}/${e.name}`)
      : [pattern];
    for (const dir of candidates) {
      const manifest = join(root, dir, 'package.json');
      if (existsSync(manifest) && !JSON.parse(readFileSync(manifest, 'utf8')).private)
        dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * @typedef {{ dir: string, licenses: { name: string, text: string }[], artifacts: { path: string, windows: string[] }[] }} Source
 * @returns {{ sources: Source[], violations: string[] }}
 */
export function discoverSources(root, packageDirs) {
  /** @type {Source[]} */
  const sources = [];
  const violations = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const child = `${rel}/${e.name}`;
      if (SOURCE_DIRS.has(e.name)) inspect(child);
      walk(child);
    }
  };
  const inspect = (dir) => {
    const files = readdirSync(join(root, dir), { withFileTypes: true }).filter((e) => e.isFile());
    const licenses = files
      .filter((e) => e.name.endsWith('.LICENSE'))
      .map((e) => ({ name: e.name, text: readFileSync(join(root, dir, e.name), 'utf8') }));
    if (licenses.length === 0) {
      for (const e of files) {
        if (FIRST_PARTY.has(`${dir}/${e.name}`)) continue;
        violations.push(
          `${dir}/${e.name}: generated/vendored file without an <origin>.LICENSE in its dir and not on FIRST_PARTY`,
        );
      }
      return;
    }
    const artifacts = [];
    for (const e of files) {
      if (!ARTIFACT_RE.test(e.name) || NOT_ARTIFACT.has(e.name)) continue;
      const path = `${dir}/${e.name}`;
      const windows = fingerprint(readFileSync(join(root, path), 'utf8'));
      if (windows.length === 0) violations.push(`${path}: too small to fingerprint`);
      else artifacts.push({ path, windows });
    }
    if (artifacts.length === 0) violations.push(`${dir}: carries a license but no artifact`);
    sources.push({ dir, licenses, artifacts });
  };
  for (const dir of packageDirs) walk(dir);
  return { sources, violations };
}

/**
 * @param {Source[]} sources
 * @param {{ pkg: string, files: { path: string, text: string }[] }} tarball
 * @returns {{ hits: string[], violations: string[] }}
 */
export function evaluateTarball(sources, tarball) {
  const hits = [];
  const violations = [];
  const files = tarball.files.map((f) => ({ ...f, norm: normalize(f.text) }));
  for (const file of files) {
    for (const source of sources) {
      const found = source.artifacts
        .map((a) => ({ a, s: share(a.windows, file.norm) }))
        .filter(({ s }) => s >= THRESHOLD);
      if (found.length === 0) continue;
      const what = found
        .map(({ a, s }) => `${a.path} ${Math.round(s * a.windows.length)}/${a.windows.length}`)
        .join(', ');
      hits.push(`${tarball.pkg} ${file.path}: ${what}`);
      // A JSON artifact cannot hold a comment: its own `.LICENSE` files, packed, cover it.
      const json = found.every(({ a }) => a.path.endsWith('.json'));
      for (const license of source.licenses) {
        const n = normalize(license.text);
        if (file.norm.includes(n)) continue;
        if (json && files.some((f) => basename(f.path) === license.name && f.norm.includes(n)))
          continue;
        violations.push(
          `${tarball.pkg} ${file.path}: contains ${what} without ${source.dir}/${license.name}`,
        );
      }
    }
  }
  return { hits, violations };
}

/** Files `npm pack` would ship, read from disk. */
export function packedFiles(root, dir) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: join(root, dir),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const [report] = JSON.parse(out);
  return report.files
    .map((f) => f.path)
    .filter((p) => !BINARY_EXT.has(extname(p)))
    .map((path) => ({ path, text: readFileSync(join(root, dir, path), 'utf8') }));
}

function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dirs = publishableDirs(root);
  const { sources, violations } = discoverSources(root, dirs);
  const hits = [];
  for (const dir of dirs) {
    const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).name;
    const r = evaluateTarball(sources, { pkg, files: packedFiles(root, dir) });
    hits.push(...r.hits);
    violations.push(...r.violations);
  }
  console.log(
    `third-party-notices: ${sources.length} sources (${sources.map((s) => relative('.', s.dir)).join(', ')}), ${dirs.length} packages`,
  );
  for (const hit of hits) console.log(`  ${hit}`);
  if (violations.length) {
    console.error(`\nthird-party-notices: ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
