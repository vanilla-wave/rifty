#!/usr/bin/env node
/**
 * Committed lockfiles pin package addresses only on the public npm registry. A lock generated
 * behind a mirror replays nowhere else and leaks the mirror host (PR #266, #430, #443).
 * Scope: tracked paths only (`git ls-files --cached`, staged included, never a disk walk):
 * one answer locally and in CI. Regular files only (no directories, symlinks).
 * Lock carriers — one rule, by content form, never a path list:
 * - file lock: basename in `LOCK_BASENAMES` (unparseable = red);
 * - embedded lock: in any `.json` / `.json.gz` document, at any depth, an object with
 *   `lockfileVersion`, any value under a key whose basename is in `LOCK_BASENAMES`, or a string
 *   parsing as an object with `lockfileVersion`. A `.json` with lock markers that does not
 *   parse (JSONC) is skipped and counted.
 * Address = a URL under a `resolved` / `tarball` / `resolution` / `repo` key (any depth in
 * JSON; in pnpm / yarn text the line keyed so, plus its block scalar) — never funding or
 * deprecation prose; `github:o/x#sha` and `file:` are no URL.
 * Declared limits (not read): pnpm/yarn YAML beyond that line-wise form (`yaml` is only a
 * `packages/agent` dependency); bun.lock(b), deno.lock; `.yarnrc.yml` / `.npmrc` registry settings; `.jsonl`,
 * `.zip`/`.tar`; `.tgz` fixtures (upstream bytes, none carries a lock 2026-11-25); a lock
 * encoded twice (a JSON string of a JSON string); protocol-relative `//host/` addresses.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Policy, not a fetch target (D-004 governs where rifty fetches): the one registry every
// reader of the repo reaches. A mirror belongs in the user's .npmrc, never in committed bytes.
// Also allowed: loopback and `.test` hosts (see classifyAddress).
export const ALLOWED_ORIGIN = 'https://registry.npmjs.org';

export const LOCK_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const JSON_LOCKS = new Set(['package-lock.json', 'npm-shrinkwrap.json']);
const ADDRESS_KEYS = new Set(['resolved', 'tarball', 'resolution', 'repo']);
const TEXT_ADDRESS_LINE = /^(\s*)"?(resolved|tarball|resolution|repo)"?[\s:]/u;
const ALLOWED_NOTE = '(allowed: registry.npmjs.org, loopback, *.test)';
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s"',}]+/giu;

/**
 * Declared exemptions: frozen bytes that already carry mirror addresses and must not be
 * rewritten here. A row covers one file at one sha256 of its bytes; a changed, moved or deleted
 * file fails its row (the list cannot rot or cover new bytes).
 * - Bench corpus seeds: sha256 = the case's `inputsSha256` in `tools/agent-bench/corpus/*-v1.json`
 *   (eval-v18 bytes). Kill: next corpus version or a user decision to rewrite —
 *   `docs/backlog/distribution/agent-bench-corpus-mirror-lockfiles.md`.
 * - Evidence archives: recorded runs, never rewritten. Kill: the archive's deletion.
 * @type {{ path: string, sha256: string }[]}
 */
export const EXEMPT = [
  // Bench corpus seeds, core-v1.
  {
    path: 'tools/agent-bench/corpus/cases/ms-negative/project.json',
    sha256: '8e6c3e45f53934852c5491d5c9235b74703fa2631bae6bcfc466bc3c13eeb662',
  },
  {
    path: 'tools/agent-bench/corpus/cases/ms-weeks/project.json',
    sha256: '511d5cffcc9d46f1878ba6e3c6ea1c762eb5e62a975a6ea7e3fc38e29530ee8c',
  },
  {
    path: 'tools/agent-bench/corpus/cases/stringify-boxed/project.json',
    sha256: '56435b258fa513f1b7a286e39bf859d10086c392ca63fdc96b1c2d96002c9c4f',
  },
  {
    path: 'tools/agent-bench/corpus/cases/queue-clear/project.json',
    sha256: '12926c572f5533e146262093a307c39205a0353f885e0103fe38a31ec26cb6be',
  },
  {
    path: 'tools/agent-bench/corpus/cases/csv-workflow-v5/project.json',
    sha256: '47d757f705e07a8ff71b955e01a1b515fdb3186aba247d1dc417d84149166ba7',
  },
  {
    path: 'tools/agent-bench/corpus/cases/markdown-notes-v4/project.json',
    sha256: 'c0e1cfcbc93efcd9859f716af641b5eaba8929bbb2fbb31341c4cb40c8fdd893',
  },
  // Bench corpus seeds, boundary-v1.
  {
    path: 'tools/agent-bench/corpus/cases/linked-import-1/project.json',
    sha256: 'ec57cb2619e6b821e0778a336a347fdd8a8e0c68a21afbcde28077fc7fc51927',
  },
  {
    path: 'tools/agent-bench/corpus/cases/linked-import-2/project.json',
    sha256: 'ec57cb2619e6b821e0778a336a347fdd8a8e0c68a21afbcde28077fc7fc51927',
  },
  {
    path: 'tools/agent-bench/corpus/cases/async-search-1/project.json',
    sha256: '9e3bc090bb67911cc91c6c55f1b712f3181610ce23723a10ad7267b2edab4a3e',
  },
  {
    path: 'tools/agent-bench/corpus/cases/async-search-2/project.json',
    sha256: '9e3bc090bb67911cc91c6c55f1b712f3181610ce23723a10ad7267b2edab4a3e',
  },
  {
    path: 'tools/agent-bench/corpus/cases/compiler-dependency-1/project.json',
    sha256: '0ce74bdf9dd4c11176f85cac0df3373318e1cc7f4eb2c4a3aebdc276cfb4235f',
  },
  {
    path: 'tools/agent-bench/corpus/cases/compiler-dependency-2/project.json',
    sha256: '2ee34b3d9b9f1879b6fdaf8abc75c42bc40193cb7d23d41f8c9d3c4c8ebe42e6',
  },
  {
    path: 'tools/agent-bench/corpus/cases/indexed-data-1/project.json',
    sha256: '944701a6ac9a51b857f5919d713defb7cc39dd163ee95ba612fe46a4e1e61447',
  },
  {
    path: 'tools/agent-bench/corpus/cases/indexed-data-2/project.json',
    sha256: 'e2e45d0c18730721ae08cf7533572e7719ed3222a8a04a52a24c5934f2170257',
  },
  // Evidence archives.
  {
    path: 'docs/backlog/distribution/reference/agent-bench-baseline-native.json.gz',
    sha256: '0b122fe916dfc7d24167ae3cfc1f355d24272b68da5b3d59fdab90f2fb3c4677',
  },
  {
    path: 'docs/backlog/distribution/reference/agent-eval-csv-export-controls-data.json.gz',
    sha256: 'a55d74e69cf33016fd3c1da98c0926f7c1fe3d345e72fa6b43f496d781976636',
  },
  {
    path: 'tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol/source-artifacts.json.gz',
    sha256: '501a2feccc1440c287abcb2de37362a396df41498f42ce7ccc35b7ab15bb8e8b',
  },
  {
    path: 'tools/agent-bench/reports/summaries/2026-09-27-gpt-6-luna-baseline/source-artifacts.json.gz',
    sha256: '8e82df4ea1f13d20b4c2316c4c2bf4928ba9d7d4efc4085a2aced84ea7698ebe',
  },
  {
    path: 'tools/agent-bench/reports/summaries/2026-09-28-gpt-6-luna-rerun/source-artifacts.json.gz',
    sha256: '6fab272bd4ba98758f6ff41e27acd997485f8d81cdd9c1c84fd59228fb9fcd8a',
  },
];

const basename = (/** @type {string} */ p) => p.slice(p.lastIndexOf('/') + 1);
const stripBom = (/** @type {string} */ t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/** @typedef {{ key: string, url: string }} Address */
/** @typedef {{ carrier: string, value: unknown, format: 'object' | 'json' | 'text' }} Lock */

/** @param {unknown} lock @returns {Address[]} */
function objectAddresses(lock) {
  /** @type {Address[]} */
  const out = [];
  const walk = (/** @type {unknown} */ node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (ADDRESS_KEYS.has(key) && typeof value === 'string') {
        for (const url of value.match(URL_RE) ?? []) out.push({ key, url });
      } else walk(value);
    }
  };
  walk(lock);
  return out;
}

/** Line-wise read of pnpm / yarn locks; a block scalar (`>-`, `|`) after the key is followed.
 * @param {string} text @returns {Address[]} */
function textAddresses(text) {
  /** @type {Address[]} */
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = TEXT_ADDRESS_LINE.exec(lines[i] ?? '');
    if (!match) continue;
    const [, indent = '', key = ''] = match;
    const urls = lines[i]?.match(URL_RE) ?? [];
    if (urls.length === 0 && /[>|][-+0-9]*\s*$/u.test(lines[i] ?? '')) {
      for (let k = i + 1; k < lines.length; k++) {
        const next = lines[k] ?? '';
        if (next.trim() && next.length - next.trimStart().length <= indent.length) break;
        urls.push(...(next.match(URL_RE) ?? []));
      }
    }
    for (const url of urls) {
      const before = (lines[i] ?? '').slice(0, (lines[i] ?? '').indexOf(url));
      out.push({ key: /\brepo"?\s*:\s*["']?$/u.test(before) ? 'repo' : key, url });
    }
  }
  return out;
}

/** @param {Lock} lock @returns {Address[]} */
function lockAddresses(lock) {
  if (lock.format === 'object') return objectAddresses(lock.value);
  const text = String(lock.value);
  return lock.format === 'json' ? objectAddresses(JSON.parse(text)) : textAddresses(text);
}

const ALLOWED = new URL(ALLOWED_ORIGIN);
const isLoopback = (/** @type {string} */ host) =>
  host === 'localhost' ||
  host === '[::1]' ||
  /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u.test(host);

/**
 * null = allowed. Origin compared on the parsed URL (scheme, host, port, no userinfo), never a
 * string prefix. Loopback and `.test` (RFC 6761) cannot be a mirror and disclose nothing
 * (manager decision 2026-11-26). Git dependencies are refused whatever the host: it may be internal.
 * @param {Address} address @returns {{ label: string, git: boolean } | null}
 */
export function classifyAddress({ key, url }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { label: url, git: false };
  }
  if (key === 'repo' || /^git[+:]/u.test(parsed.protocol))
    return { label: parsed.hostname || url, git: true };
  const userinfo = parsed.username !== '' || parsed.password !== '';
  if (!userinfo) {
    const { protocol, hostname, port } = parsed;
    if (protocol === ALLOWED.protocol && hostname === ALLOWED.hostname && port === '') return null;
    if (isLoopback(hostname) || hostname.endsWith('.test')) return null;
  }
  return {
    label: `${parsed.protocol}//${userinfo ? '<userinfo>@' : ''}${parsed.host}`,
    git: false,
  };
}

/**
 * Locks inside a parsed JSON document: an object with `lockfileVersion` at any depth, any value
 * under a lockfile-named key, or a string parsing as an object with `lockfileVersion`.
 * @param {unknown} doc @returns {{ pointer: string, value: unknown, format: Lock['format'] }[]}
 */
function embeddedLocks(doc) {
  /** @type {{ pointer: string, value: unknown, format: Lock['format'] }[]} */
  const out = [];
  const isLockObject = (/** @type {unknown} */ v) =>
    !!v && typeof v === 'object' && !Array.isArray(v) && 'lockfileVersion' in v;
  if (isLockObject(doc)) return [{ pointer: '', value: doc, format: 'object' }];
  const walk = (/** @type {unknown} */ node, /** @type {string} */ pointer) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const at = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      const name = basename(key);
      if (value && typeof value === 'object') {
        if (isLockObject(value) || (LOCK_BASENAMES.has(name) && !Array.isArray(value)))
          out.push({ pointer: at, value, format: 'object' });
        else walk(value, at);
      } else if (typeof value === 'string') {
        if (LOCK_BASENAMES.has(name)) {
          out.push({ pointer: at, value, format: JSON_LOCKS.has(name) ? 'json' : 'text' });
        } else if (value.trimStart().startsWith('{') && value.includes('"lockfileVersion"')) {
          try {
            const parsed = JSON.parse(value);
            if (isLockObject(parsed)) out.push({ pointer: at, value: parsed, format: 'object' });
          } catch {
            // Prose quoting a lock fragment, not a lock.
          }
        }
      }
    }
  };
  walk(doc, '');
  return out;
}

const MAYBE_EMBEDS = ['lockfileVersion', ...LOCK_BASENAMES];

/**
 * Locks of one file. `skipped`: a `.json` with lock markers that does not parse (JSONC etc.).
 * @param {string} path @param {Buffer} bytes @returns {{ locks: Lock[], skipped: boolean }}
 */
export function lockCarriers(path, bytes) {
  const name = basename(path);
  if (LOCK_BASENAMES.has(name)) {
    const value = stripBom(bytes.toString('utf8'));
    return {
      locks: [{ carrier: path, value, format: JSON_LOCKS.has(name) ? 'json' : 'text' }],
      skipped: false,
    };
  }
  let text;
  if (name.endsWith('.json')) text = bytes.toString('utf8');
  else if (name.endsWith('.json.gz')) text = gunzipSync(bytes).toString('utf8');
  else return { locks: [], skipped: false };
  text = stripBom(text);
  if (!MAYBE_EMBEDS.some((marker) => text.includes(marker))) return { locks: [], skipped: false };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { locks: [], skipped: true };
  }
  const locks = embeddedLocks(doc).map((e) => ({
    carrier: e.pointer ? `${path}#${e.pointer}` : path,
    value: e.value,
    format: e.format,
  }));
  return { locks, skipped: false };
}

/**
 * @param {string} root
 * @param {string[]} paths repo-relative
 * @param {{ path: string, sha256: string }[]} [exempt]
 * @returns {{ violations: string[], carriers: number, exempted: number, skipped: number }}
 */
export function checkLockfileRegistry(root, paths, exempt = EXEMPT) {
  /** @type {string[]} */
  const violations = [];
  const rows = new Map(exempt.map((row) => [row.path, row]));
  const present = new Set();
  let carriers = 0;
  let exempted = 0;
  let skipped = 0;
  const message = (/** @type {unknown} */ error) =>
    error instanceof Error ? error.message : String(error);
  for (const path of paths) {
    const name = basename(path);
    if (!LOCK_BASENAMES.has(name) && !name.endsWith('.json') && !name.endsWith('.json.gz'))
      continue;
    const stat = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (!stat?.isFile()) continue; // deleted in the working tree, a directory or a symlink
    present.add(path);
    const bytes = readFileSync(join(root, path));
    const row = rows.get(path);
    if (row) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 === row.sha256) {
        exempted += 1;
        continue;
      }
      violations.push(
        `${path}: exemption pinned sha256 ${row.sha256.slice(0, 12)}…, file is ${sha256.slice(0, 12)}… — changed bytes are not exempt; drop the row`,
      );
    }
    let found;
    try {
      found = lockCarriers(path, bytes);
    } catch (error) {
      violations.push(`${path}: unreadable lock carrier (${message(error)})`);
      continue;
    }
    if (found.skipped) skipped += 1;
    for (const lock of found.locks) {
      carriers += 1;
      let addresses;
      try {
        addresses = lockAddresses(lock);
      } catch (error) {
        violations.push(
          `${lock.carrier}: unparseable lock (${message(error)}) — regenerate it with its package manager; the guard cannot read its addresses`,
        );
        continue;
      }
      /** @type {Map<string, { git: boolean, count: number }>} */
      const foreign = new Map();
      for (const address of addresses) {
        const verdict = classifyAddress(address);
        if (!verdict) continue;
        const id = `${verdict.git}:${verdict.label}`;
        const entry = foreign.get(id) ?? { git: verdict.git, count: 0 };
        entry.count += 1;
        foreign.set(id, entry);
      }
      for (const [id, { git, count }] of foreign) {
        const label = id.slice(id.indexOf(':') + 1);
        violations.push(
          git
            ? `${lock.carrier}: ${count} git dependency address(es) on ${label} (git/URL dependencies are not allowed in committed locks: the host may be internal)`
            : `${lock.carrier}: ${count} address line(s) on ${label} ${ALLOWED_NOTE}`,
        );
      }
    }
  }
  for (const row of exempt)
    if (!present.has(row.path))
      violations.push(`${row.path}: exemption row for a missing file — drop the row`);
  return { violations, carriers, exempted, skipped };
}

/** Tracked paths (staged included): the same answer locally and in CI. */
export function repoPaths(root = process.cwd()) {
  return execFileSync('git', ['ls-files', '-z', '--cached'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const { violations, carriers, exempted, skipped } = checkLockfileRegistry(root, repoPaths(root));
  const summary = `${carriers} lock carrier(s) scanned; ${exempted}/${EXEMPT.length} declared exemption(s) (tools/checks/lockfile-registry.mjs EXEMPT); ${skipped} unparseable .json with lock markers skipped`;
  if (violations.length) {
    console.error(`✗ lockfile-registry: ${violations.length} violation(s); ${summary}`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      `Host fix: rewrite it to ${ALLOWED_ORIGIN}, keep \`integrity\`, verify with \`npm ci --cache <empty dir> --registry=${ALLOWED_ORIGIN}/\`.`,
    );
    process.exit(1);
  }
  console.log(`✓ lockfile-registry: ${summary}`);
}
