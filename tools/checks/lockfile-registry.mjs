#!/usr/bin/env node
/**
 * Committed lockfiles pin package addresses only on the public npm registry. A lock generated
 * behind a mirror replays nowhere else and leaks the mirror host (PR #266, #430, #443).
 * Scope: every tracked or untracked-unignored path (`git ls-files`, never a disk walk).
 * Lock carriers — one rule, by content form, never a path list:
 * - file lock: basename in `LOCK_BASENAMES`;
 * - embedded lock: in any `.json` / `.json.gz` document, a string value whose key basename is
 *   in `LOCK_BASENAMES`, or that parses as a JSON object with `lockfileVersion` (bench corpus
 *   seeds, baked dependency snapshots' `lockfile`, evidence archives).
 * Address = npm `resolved` (any depth); in text locks a line keyed `resolved` / `tarball` /
 * `resolution` / `repo` (yarn, pnpm) — never funding/deprecation prose. `.tgz` fixtures are
 * upstream package bytes, not locks this repo writes (none carries one, 2026-11-25): not scanned.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Policy, not a fetch target (D-004 governs where rifty fetches): the one registry every
// reader of the repo reaches. A mirror belongs in the user's .npmrc, never in committed bytes.
export const ALLOWED_ORIGIN = 'https://registry.npmjs.org';

export const LOCK_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const JSON_LOCKS = new Set(['package-lock.json', 'npm-shrinkwrap.json']);
const TEXT_ADDRESS_LINE = /^\s*"?(?:resolved|tarball|resolution|repo)"?[\s:]/u;
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

/** @param {unknown} lock @returns {string[]} */
function resolvedUrls(lock) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {unknown} */ node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'resolved' && typeof value === 'string') {
        if (value.includes('://')) out.push(value);
      } else walk(value);
    }
  };
  walk(lock);
  return out;
}

/** @param {string} text @returns {string[]} */
function textLockUrls(text) {
  return text
    .split('\n')
    .filter((line) => TEXT_ADDRESS_LINE.test(line))
    .flatMap((line) => line.match(URL_RE) ?? []);
}

/** @param {string} url */
function isAllowed(url) {
  return url.startsWith(`${ALLOWED_ORIGIN}/`);
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Foreign addresses of one lock text, grouped by host.
 * @param {string} text @param {'json' | 'text'} kind
 * @returns {Map<string, number>}
 */
export function foreignHosts(text, kind) {
  const urls = kind === 'json' ? resolvedUrls(JSON.parse(text)) : textLockUrls(text);
  /** @type {Map<string, number>} */
  const hosts = new Map();
  for (const url of urls) {
    if (isAllowed(url)) continue;
    const host = hostOf(url);
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  return hosts;
}

/**
 * Lock texts embedded in a parsed JSON document, with their JSON pointer.
 * @param {unknown} doc @returns {{ pointer: string, text: string, kind: 'json' | 'text' }[]}
 */
function embeddedLocks(doc) {
  /** @type {{ pointer: string, text: string, kind: 'json' | 'text' }[]} */
  const out = [];
  const walk = (/** @type {unknown} */ node, /** @type {string} */ pointer) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const at = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (typeof value !== 'string') {
        walk(value, at);
        continue;
      }
      const name = basename(key);
      if (LOCK_BASENAMES.has(name)) {
        out.push({ pointer: at, text: value, kind: JSON_LOCKS.has(name) ? 'json' : 'text' });
      } else if (value.trimStart().startsWith('{') && value.includes('"lockfileVersion"')) {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && 'lockfileVersion' in parsed)
            out.push({ pointer: at, text: value, kind: 'json' });
        } catch {
          // Prose quoting a lock fragment, not a lock.
        }
      }
    }
  };
  walk(doc, '');
  return out;
}

const MAYBE_EMBEDS = ['lockfileVersion', ...LOCK_BASENAMES];

/**
 * Lock carriers of one file: `{ carrier, text, kind }` per lock (file or embedded).
 * @param {string} path @param {Buffer} bytes
 * @returns {{ carrier: string, text: string, kind: 'json' | 'text' }[]}
 */
export function lockCarriers(path, bytes) {
  const name = basename(path);
  if (LOCK_BASENAMES.has(name))
    return [
      { carrier: path, text: bytes.toString('utf8'), kind: JSON_LOCKS.has(name) ? 'json' : 'text' },
    ];
  let text;
  if (name.endsWith('.json')) text = bytes.toString('utf8');
  else if (name.endsWith('.json.gz')) text = gunzipSync(bytes).toString('utf8');
  else return [];
  if (!MAYBE_EMBEDS.some((marker) => text.includes(marker))) return [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return []; // JSONC config (tsconfig etc.): not a document that carries locks
  }
  return embeddedLocks(doc).map((e) => ({
    carrier: `${path}#${e.pointer}`,
    text: e.text,
    kind: e.kind,
  }));
}

/**
 * @param {string} root
 * @param {string[]} paths repo-relative
 * @param {{ path: string, sha256: string }[]} [exempt]
 * @returns {{ violations: string[], carriers: number, exempted: number }}
 */
export function checkLockfileRegistry(root, paths, exempt = EXEMPT) {
  /** @type {string[]} */
  const violations = [];
  const rows = new Map(exempt.map((row) => [row.path, row]));
  const present = new Set();
  let carriers = 0;
  let exempted = 0;
  for (const path of paths) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue; // deleted in the working tree
    const name = basename(path);
    if (!LOCK_BASENAMES.has(name) && !name.endsWith('.json') && !name.endsWith('.json.gz'))
      continue;
    present.add(path);
    const bytes = readFileSync(abs);
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
      violations.push(
        `${path}: unreadable lock carrier (${error instanceof Error ? error.message : error})`,
      );
      continue;
    }
    for (const lock of found) {
      carriers += 1;
      let hosts;
      try {
        hosts = foreignHosts(lock.text, lock.kind);
      } catch (error) {
        violations.push(
          `${lock.carrier}: unparseable lock (${error instanceof Error ? error.message : error})`,
        );
        continue;
      }
      for (const [host, count] of hosts)
        violations.push(
          `${lock.carrier}: ${count} address line(s) on ${host} (allowed: ${ALLOWED_ORIGIN})`,
        );
    }
  }
  for (const row of exempt)
    if (!present.has(row.path))
      violations.push(`${row.path}: exemption row for a missing file — drop the row`);
  return { violations, carriers, exempted };
}

/** Tracked + untracked-unignored paths. */
export function repoPaths(root = process.cwd()) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const { violations, carriers, exempted } = checkLockfileRegistry(root, [
    ...new Set(repoPaths(root)),
  ]);
  const summary = `${carriers} lock carrier(s) scanned; ${exempted}/${EXEMPT.length} declared exemption(s) (tools/checks/lockfile-registry.mjs EXEMPT)`;
  if (violations.length) {
    console.error(`✗ lockfile-registry: ${violations.length} violation(s); ${summary}`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      `Fix: rewrite the host to ${ALLOWED_ORIGIN}, keep \`integrity\`, verify with \`npm ci --cache <empty dir> --registry=${ALLOWED_ORIGIN}/\`.`,
    );
    process.exit(1);
  }
  console.log(`✓ lockfile-registry: ${summary}`);
}
