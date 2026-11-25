#!/usr/bin/env node
/**
 * Package notices file (docs/public/publishing.md §Third-party notices).
 *
 * Inputs = the bundler's own list per emitted file: tsup sourcemap `sources`,
 * or `.bundle-inputs.json` written by the esbuild-direct builds (metafile +
 * copied files). Counted: npm packages (license files from the package dir)
 * and whole files under `generated/`/`vendor/` dirs (MANIFEST). Rendered to
 * `dist/THIRD_PARTY_NOTICES.md`; bundles carry only LINK.
 *
 *   node tools/publishing/third-party-notices.mjs --write   (end of build:libs)
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const NOTICES = 'dist/THIRD_PARTY_NOTICES.md';
export const LINK =
  '/*! For third-party licenses see dist/THIRD_PARTY_NOTICES.md of this npm package */';
/** Written next to package.json by esbuild-direct builds; not packed. */
export const BUNDLE_INPUTS = '.bundle-inputs.json';
/** Same set `release.yml` publishes. */
export const PUBLISH_ROOTS = ['packages/*', 'tools/shadow-registry', 'services/eddy'];
const SOURCE_DIRS = new Set(['generated', 'vendor']);
const LICENSE_FILE_RE = /licen[cs]e|copying|notice/iu;

export function loadManifest(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'tools/publishing/third-party-manifest.json'), 'utf8'));
}

/** Publishable package dirs (root-relative), non-private. */
export function publishableDirs(root = ROOT) {
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

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

/**
 * Bundler inputs per emitted file of a package, root-relative.
 * @returns {Record<string, string[]>} packed path → inputs
 */
export function bundleInputs(root, pkgDir) {
  const abs = join(root, pkgDir);
  /** @type {Record<string, string[]>} */
  const out = {};
  const recorded = join(abs, BUNDLE_INPUTS);
  if (existsSync(recorded)) Object.assign(out, JSON.parse(readFileSync(recorded, 'utf8')));
  // Maps anywhere in the packed dirs (package.json `files`).
  const manifest = join(abs, 'package.json');
  const { files = ['dist'] } = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, 'utf8'))
    : {};
  for (const entry of files) {
    const top = join(abs, entry);
    if (!existsSync(top) || !statSync(top).isDirectory()) continue;
    for (const file of walk(top)) {
      if (!/\.[cm]?js\.map$/u.test(file)) continue;
      const js = relative(abs, file.slice(0, -'.map'.length));
      if (out[js]) continue;
      const { sources = [] } = JSON.parse(readFileSync(file, 'utf8'));
      out[js] = sources.map((s) => relative(root, resolve(dirname(file), s)));
    }
  }
  return out;
}

/** Package dir of a node_modules input, or null. */
function npmPackageDir(root, input) {
  const i = input.lastIndexOf('node_modules/');
  if (i < 0) return null;
  const rest = input.slice(i + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return join(root, input.slice(0, i), 'node_modules', name);
}

/** Nearest `generated`/`vendor` dir of a repo input, or null. */
function sourceDir(input) {
  const parts = input.split('/');
  for (let i = parts.length - 2; i >= 0; i--)
    if (SOURCE_DIRS.has(parts[i])) return parts.slice(0, i + 1).join('/');
  return null;
}

const readText = (root, path) => readFileSync(join(root, path), 'utf8');

/** License files in an npm package's root dir. */
function ownLicenseFiles(dir) {
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE_RE.test(f) && statSync(join(dir, f)).isFile())
    .sort();
}

/**
 * @typedef {{ id: string, license: string, from: Set<string>, texts: { name: string, text: string }[] }} Entry
 * @returns {{ entries: Entry[], counted: Set<string>, violations: string[] }}
 *   counted = packed paths with a counted input
 */
export function collect(
  root,
  pkgDir,
  manifest = loadManifest(root),
  inputs = bundleInputs(root, pkgDir),
) {
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  const counted = new Set();
  const violations = [];
  const firstParty = new Set(manifest.firstParty);
  /** Manifest keys this package used, as `<section> <key>` (see unusedRecords). */
  const used = new Set();
  const add = (id, license, from, texts) => {
    const entry = entries.get(id) ?? { id, license, from: new Set(), texts };
    entry.from.add(from);
    entries.set(id, entry);
  };
  const npm = (dir, from) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const id = `${pkg.name}@${pkg.version}`;
    const record = manifest.npm[id];
    if (record) used.add(`npm ${id}`);
    const texts = [
      ...ownLicenseFiles(dir).map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') })),
      ...(record?.licenseFiles ?? []).map((f) => ({ name: basename(f), text: readText(root, f) })),
    ];
    if (texts.length === 0)
      violations.push(`${id}: no license file and no manifest record (${from})`);
    const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license);
    add(id, license, from, texts);
  };
  for (const [packed, list] of Object.entries(inputs)) {
    for (const input of list) {
      const pkgPath = npmPackageDir(root, input);
      if (pkgPath) {
        npm(pkgPath, 'bundled npm package');
        counted.add(packed);
        continue;
      }
      const dir = sourceDir(input);
      if (!dir) continue;
      if (firstParty.has(input)) {
        used.add(`firstParty ${input}`);
        continue;
      }
      const record = manifest.generated[dir];
      if (!record?.files.includes(relative(dir, input))) {
        violations.push(
          `${input}: in ${dir} without a third-party-manifest record (${pkgDir} ${packed})`,
        );
        continue;
      }
      counted.add(packed);
      used.add(`generated ${dir}`);
      const how = `generated into ${dir}${record.changes ? ` (changed: ${record.changes})` : ''}`;
      if (!record.package) {
        // Upstream that is no npm package (e.g. Node's own lib/): texts from the record.
        const texts = record.licenseFiles.map((f) => ({
          name: basename(f),
          text: readText(root, f),
        }));
        add(`${record.name}@${record.version}`, record.license, how, texts);
        continue;
      }
      const owner = createRequire(join(root, record.resolveFrom ?? '', 'package.json'));
      const pkgDirOf = dirname(owner.resolve(`${record.package}/package.json`));
      const { version } = JSON.parse(readFileSync(join(pkgDirOf, 'package.json'), 'utf8'));
      if (version !== record.version)
        violations.push(
          `${dir}: manifest pins ${record.package}@${record.version}, installed ${version}`,
        );
      npm(pkgDirOf, how);
    }
  }
  return {
    entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)),
    counted,
    used,
    violations: [...new Set(violations)],
  };
}

/** Manifest records no package used: a renamed or stale record is red, never silently dropped. */
export function unusedRecords(manifest, usedSets) {
  const used = new Set(usedSets.flatMap((s) => [...s]));
  return [
    ...Object.keys(manifest.npm).map((k) => `npm ${k}`),
    ...Object.entries(manifest.generated)
      .filter(([, r]) => !r.unshipped)
      .map(([k]) => `generated ${k}`),
  ].filter((k) => !used.has(k));
}

/**
 * Generated records marked `unshipped` (the unit that ships them): in no package yet — and a package
 * that uses one is red until that unit drops the mark.
 */
export function shippedUnshipped(manifest, usedSets) {
  const used = new Set(usedSets.flatMap((s) => [...s]));
  return Object.entries(manifest.generated)
    .filter(([k, r]) => r.unshipped && used.has(`generated ${k}`))
    .map(([k]) => `generated ${k}`);
}

/** A packed source file (outside `dist/`) in a `vendor/`/`generated/` dir, with no recorded list, is its own input. */
export function withPackedSources(inputs, packedPaths, pkgDir) {
  const out = { ...inputs };
  for (const p of packedPaths)
    if (!out[p] && !p.startsWith('dist/') && sourceDir(p)) out[p] = [`${pkgDir}/${p}`];
  return out;
}

/** Every file of the `vendor/`/`generated/` dirs under the given package dirs (root-relative). */
function sourceDirFiles(root, pkgDirs) {
  const out = [];
  const visit = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name === 'dist') continue;
      const child = `${rel}/${e.name}`;
      if (SOURCE_DIRS.has(e.name))
        out.push(...walk(join(root, child)).map((f) => relative(root, f)));
      else visit(child);
    }
  };
  for (const d of pkgDirs) visit(d);
  return out;
}

/** `sourcesKey`: a key of sources.json, or a dotted path through own keys of plain objects. */
function pinAt(json, key) {
  let at = json;
  for (const k of key.split('.')) {
    if (at === null || typeof at !== 'object' || Array.isArray(at) || !Object.hasOwn(at, k))
      return undefined;
    at = at[k];
  }
  return at;
}

/** Static manifest faults: records name real files, add non-empty texts, cover every vendor/generated file. */
export function validateManifest(root, manifest, pkgDirs = []) {
  const out = [];
  const bad = (k, m) => out.push(`third-party-manifest ${k}: ${m}`);
  const texts = (r) =>
    (r.licenseFiles ?? []).length > 0 &&
    r.licenseFiles.every((f) => existsSync(join(root, f)) && readText(root, f).trim() !== '');
  for (const [dir, r] of Object.entries(manifest.generated)) {
    for (const f of r.files)
      if (!existsSync(join(root, dir, f)))
        bad(`generated ${dir}`, `lists ${f}, which is not in the dir`);
    if (!r.package && !texts(r)) bad(`generated ${dir}`, 'adds no license text');
    if (r.unshipped !== undefined && !existsSync(join(root, 'docs/backlog', `${r.unshipped}.md`)))
      bad(`generated ${dir}`, `unshipped names no docs/backlog/${r.unshipped}.md`);
    const sources = join(root, dir, 'sources.json');
    if (!existsSync(sources)) continue;
    const pinned = pinAt(JSON.parse(readFileSync(sources, 'utf8')), r.sourcesKey ?? '');
    if (!r.sourcesKey) bad(`generated ${dir}`, 'has sources.json but no sourcesKey');
    else if (typeof pinned !== 'string')
      bad(`generated ${dir}`, `sources.json "${r.sourcesKey}" is no string pin`);
    else if (pinned !== r.version)
      bad(
        `generated ${dir}`,
        `version ${r.version} is not sources.json "${r.sourcesKey}" (${pinned})`,
      );
  }
  for (const [id, r] of Object.entries(manifest.npm))
    if (!texts(r)) bad(`npm ${id}`, 'adds no license text');
  const listed = new Set(
    Object.entries(manifest.generated).flatMap(([dir, r]) => r.files.map((f) => `${dir}/${f}`)),
  );
  for (const f of manifest.firstParty) {
    if (listed.has(f)) bad(`firstParty ${f}`, `also listed in generated ${dirname(f)}`);
    else if (!existsSync(join(root, f))) bad(`firstParty ${f}`, 'is not a file');
  }
  const firstParty = new Set(manifest.firstParty);
  for (const f of sourceDirFiles(root, pkgDirs))
    if (!listed.has(f) && !firstParty.has(f))
      out.push(`third-party-manifest: ${f} is in no record and not firstParty`);
  return out;
}

const quote = (text) =>
  text
    .replace(/\r\n?/gu, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

/** @param {string} name @param {Entry[]} entries */
export function render(name, entries) {
  const licenses = [...new Set(entries.map((e) => e.license))].sort().join(', ');
  const head = `# Third-party licenses — ${name}

Generated by \`tools/publishing/third-party-notices.mjs\` from the bundler's input list; do not edit.
The published files of this package contain code from the packages below under: ${licenses}.
`;
  const body = entries.map(
    (e) => `## ${e.id}

License: ${e.license}
Included as: ${[...e.from].sort().join('; ')}

${e.texts.map((t) => `${t.name}:\n\n${quote(t.text)}`).join('\n\n')}
`,
  );
  return [head, ...body].join('\n---------------------------------------\n\n');
}

/** Packed paths npm would ship, from package.json `files` (dist walk) — used by --write only. */
function localPacked(root, pkgDir) {
  const { files = [] } = JSON.parse(readText(root, `${pkgDir}/package.json`));
  return files.flatMap((f) => {
    const abs = join(root, pkgDir, f);
    if (!existsSync(abs)) return [];
    return statSync(abs).isDirectory()
      ? walk(abs).map((p) => relative(join(root, pkgDir), p))
      : [f];
  });
}

function main() {
  if (process.argv[2] !== '--write' || process.argv.length !== 3)
    throw new Error('Usage: node tools/publishing/third-party-notices.mjs --write');
  const manifest = loadManifest();
  const failures = [];
  for (const dir of publishableDirs()) {
    const { name } = JSON.parse(readText(ROOT, `${dir}/package.json`));
    const inputs = withPackedSources(bundleInputs(ROOT, dir), localPacked(ROOT, dir), dir);
    const { entries, violations } = collect(ROOT, dir, manifest, inputs);
    failures.push(...violations);
    const target = join(ROOT, dir, NOTICES);
    if (entries.length) writeFileSync(target, render(name, entries));
    else rmSync(target, { force: true });
    console.log(`third-party-notices: ${name}: ${entries.length} entries`);
  }
  if (failures.length) throw new Error(`third-party-notices:\n  ${failures.join('\n  ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

/**
 * Record an esbuild build's inputs per emitted file in `<pkg>/.bundle-inputs.json`
 * (merged with what is already there for this build run).
 * @param {string} pkgAbs package dir @param {Record<string, string[]>} byOutput root-relative inputs keyed by absolute or root-relative output path
 */
export function recordBundleInputs(pkgAbs, byOutput, { reset = false } = {}) {
  const path = join(pkgAbs, BUNDLE_INPUTS);
  const current = !reset && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  for (const [output, inputs] of Object.entries(byOutput))
    current[relative(pkgAbs, resolve(ROOT, output))] = [...inputs].sort();
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
}

/** esbuild metafile → root-relative inputs per output (absWorkingDir = `cwd`). */
export function metafileInputs(metafile, cwd) {
  return Object.fromEntries(
    Object.entries(metafile.outputs).map(([out, o]) => [
      relative(ROOT, resolve(cwd, out)),
      // `(disabled):x` is esbuild's empty stub for a module a package's `browser` map turns off.
      Object.keys(o.inputs)
        .filter((i) => !i.startsWith('(disabled):'))
        .map((i) => relative(ROOT, resolve(cwd, i))),
    ]),
  );
}
