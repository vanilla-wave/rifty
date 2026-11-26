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
 *   parse (JSONC, trailing comma, `NaN`) is red.
 * Address = the whole value of a `resolved` / `tarball` / `resolution` / `repo` key (any depth
 * in JSON; in pnpm / yarn text the keyed line or flow-mapping entry), judged by one function,
 * `classifyAddress` — never funding or deprecation prose. Text locks are accepted only in the
 * form pnpm / yarn write; any other notation around an address key (escape, tag, anchor, alias,
 * block scalar, explicit key, value off the key line, continuation) is red: regenerate the lock.
 * Threat model: locks written by package managers (the three incidents), not hand-crafted bypass.
 * Declared limits (not read): yarn berry `patch:` nested descriptors (not inspected);
 * `gitlab:` / `bitbucket:` / `gist:` shorthands red as unreadable (`github:` passes);
 * bun.lock(b), deno.lock; `.yarnrc.yml` / `.npmrc` registry
 * settings; `.jsonl`, `.zip`/`.tar`; `.tgz` fixtures (upstream bytes, none carries a lock
 * 2026-11-25); a lock encoded twice (a JSON string of a JSON string); a symlink named as a lock
 * (not followed; its target is read only if itself a carrier); size — each document is read and
 * parsed whole (a 65 MB JSON costs memory/time; past V8's string limit it fails red).
 * Bytes are read from the working tree at index paths: see trap `lockfile-mirror-host`.
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
// Text locks are read only in the form pnpm / yarn write (manager decision 2026-11-26): an address
// key leading a line (yarn v1 `resolved "…"`, YAML `key: …`) or a flow-mapping entry
// (`{…, tarball: …}`); key bare, '…' or "…". Any other notation around an address key is red.
const LINE_KEY = /^(\s*)(["']?)(resolved|tarball|resolution|repo)\2(?::(?=\s|$)|\s)\s*/u;
const FLOW_KEY = /^\s*(["']?)(resolved|tarball|resolution|repo)\1\s*:(?=\s|$)\s*/u;
// An address key behind an explicit-key `?`, a tag or an anchor.
const ODD_KEY =
  /^\s*(?:\?|![^\s]*|&\S+)\s*["']?(?:resolved|tarball|resolution|repo)["']?(?:\s|:|$)/u;
const ALLOWED_NOTE = '(allowed: registry.npmjs.org, loopback, *.test)';
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/iu;
// Declared non-network forms (no host): a value with one of these schemes, or no scheme at all
// (relative path, e.g. npm workspace `packages/foo`). Yarn berry `name@<range>` descriptors use
// the same forms plus its registry-relative `npm:` and local protocols; `rifty:` is the npm
// client's shadow-substitution identity (`packages/npm-client/src/internal/shadow/substitution.ts`).
const NON_NETWORK = new Set([
  'file',
  'link',
  'workspace',
  'github',
  'npm',
  'portal',
  'patch',
  'exec',
  'rifty',
]);
const NON_NETWORK_NOTE =
  '(neither a URL nor a declared non-network form: file:, link:, workspace:, github:, rifty:, relative path)';

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

/** @typedef {{ key: string, value: string, odd?: string }} Address — the whole value of an address key; `odd` = non-canonical notation */
/** @typedef {{ carrier: string, value: unknown, format: 'object' | 'json' | 'text' }} Lock */

/** @param {unknown} lock @returns {Address[]} */
function objectAddresses(lock) {
  /** @type {Address[]} */
  const out = [];
  const walk = (/** @type {unknown} */ node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (ADDRESS_KEYS.has(key) && typeof value === 'string') out.push({ key, value });
      else walk(value);
    }
  };
  walk(lock);
  return out;
}

/**
 * The value after an address key, only in a canonical notation: plain (not starting with
 * `! & * | > [ ' "`) or quoted without escapes (`\\` in "…", `''` in '…'), non-empty, on the key's
 * line, nothing after it but `,` / `}` (flow) or a comment (block). `{` = nested mapping (pnpm
 * `resolution: {…}`), no value of its own; an empty `resolution:` heads a block mapping.
 * @returns {{ value: string } | { odd: string } | null}
 */
function textValue(
  /** @type {string} */ key,
  /** @type {string} */ rest,
  /** @type {boolean} */ flow,
) {
  if (rest.startsWith('{')) return key === 'resolution' ? null : { odd: 'mapping as value' };
  if (rest === '' || /^#/u.test(rest))
    return key === 'resolution' ? null : { odd: 'value not on the key line' };
  const tail = flow ? /^\s*(?:[,}]|$)/u : /^\s*(?:#.*)?$/u;
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    if (end < 0) return { odd: 'unterminated quote' };
    const inner = rest.slice(1, end);
    if (quote === '"' && inner.includes('\\')) return { odd: 'escape in quotes' };
    if (!tail.test(rest.slice(end + 1))) return { odd: 'text after the quoted value' };
    return { value: inner };
  }
  if (/^[!&*|>[]/u.test(rest)) return { odd: 'tag, anchor, alias or block scalar' };
  const value = (flow ? (rest.split(/[,}]/u)[0] ?? '') : rest.replace(/\s+#.*$/u, '')).trim();
  return { value };
}

/** Address values of a pnpm / yarn text lock. @param {string} text @returns {Address[]} */
function textAddresses(text) {
  /** @type {Address[]} */
  const out = [];
  // pnpm marks a git-hosted tarball with `gitHosted: true` in the same `resolution: {…}`.
  let gitHosted = false;
  const push = (/** @type {string} */ key, /** @type {ReturnType<typeof textValue>} */ v) => {
    const as = gitHosted && key === 'tarball' ? 'repo' : key;
    if (v && 'odd' in v) out.push({ key: as, value: '', odd: v.odd });
    else if (v) out.push({ key: as, value: v.value });
  };
  const lines = text.split('\n');
  /** Indent of the last block-scalar address key: a deeper line under it is a continuation. */
  let scalarIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    gitHosted = /[{,]\s*gitHosted:\s*true\s*[,}]/u.test(line);
    const indent = line.length - line.trimStart().length;
    if (line.trim() && scalarIndent >= 0) {
      if (indent > scalarIndent) out.push({ key: '', value: '', odd: 'continuation line' });
      scalarIndent = -1;
    }
    if (ODD_KEY.test(line))
      out.push({ key: '', value: '', odd: 'explicit key, tag or anchor on the key' });
    const lead = LINE_KEY.exec(line);
    if (lead) {
      const key = lead[3] ?? '';
      const v = textValue(key, line.slice(lead[0].length), false);
      push(key, v);
      if (v && 'value' in v) scalarIndent = lead[1]?.length ?? 0;
    }
    // Flow-mapping entries: brace depth > 0, outside quotes.
    let depth = 0;
    let quote = '';
    for (let p = 0; p < line.length; p++) {
      const c = line[p];
      if (quote) {
        if (c === quote) quote = '';
      } else if (depth > 0 && (c === '"' || c === "'") && /[\s{,:]/u.test(line[p - 1] ?? ' ')) {
        quote = c;
      } else if (c === '}') depth -= 1;
      else if (c === '{' || (c === ',' && depth > 0)) {
        if (c === '{') depth += 1;
        const after = line.slice(p + 1);
        if (ODD_KEY.test(after))
          out.push({ key: '', value: '', odd: 'explicit key, tag or anchor on the key' });
        const m = FLOW_KEY.exec(after);
        if (m) push(m[2] ?? '', textValue(m[2] ?? '', after.slice(m[0].length), true));
      }
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
// WHATWG URL canonicalizes IPv4 hosts to dotted quads before this test.
const isLoopback = (/** @type {string} */ host) =>
  host === 'localhost' || host === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host);

/**
 * The one address verdict: the whole value of an address key → null (allowed) or why not.
 * Parsed by WHATWG `URL` as npm reads it, never cut by a pattern first. Allowed: the npmjs
 * origin (scheme, host, default port, no userinfo); loopback and `.test` (RFC 6761) — cannot be
 * a mirror, disclose nothing (manager decision 2026-11-26); declared non-network forms. Git
 * dependencies are refused whatever the host: it may be internal. Anything else that does not
 * parse is refused, never "not an address".
 * @param {Address} address
 * @returns {{ kind: 'host' | 'git' | 'unreadable' | 'noncanonical', label: string } | null}
 */
export function classifyAddress({ key, value: raw, odd }) {
  if (odd) return { kind: 'noncanonical', label: odd };
  let value = raw.trim();
  if (key === 'resolution' && !SCHEME_RE.test(value)) {
    const descriptor = /^(@?[^@\s]+)@(.+)$/u.exec(value); // yarn berry `name@<range>`
    if (descriptor) value = descriptor[2] ?? '';
  }
  const scheme = SCHEME_RE.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    const scp = /^[^@/\s]+@([^:/\s]+):/u.exec(value); // git scp form `git@host:o/r.git`
    if (scp) return { kind: 'git', label: scp[1] ?? value };
    return /^[\\/]{2}/u.test(value) ? { kind: 'unreadable', label: value } : null; // `//host/…`
  }
  if (NON_NETWORK.has(scheme)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { kind: 'unreadable', label: value };
  }
  // yarn berry writes a git dependency as `name@<url>.git#commit=<sha>`.
  const berryGit = key === 'resolution' && /\.git#commit=/u.test(value);
  if (key === 'repo' || scheme === 'git' || scheme.startsWith('git+') || berryGit)
    return { kind: 'git', label: parsed.hostname || value };
  const userinfo = parsed.username !== '' || parsed.password !== '';
  if (!userinfo) {
    const { protocol, hostname, port } = parsed;
    if (protocol === ALLOWED.protocol && hostname === ALLOWED.hostname && port === '') return null;
    if (isLoopback(hostname) || hostname.endsWith('.test')) return null;
  }
  if (!parsed.host) return { kind: 'unreadable', label: value };
  return {
    kind: 'host',
    label: `${parsed.protocol}//${userinfo ? '<userinfo>@' : ''}${parsed.host}`,
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

class UnparseableDocument extends Error {}

/**
 * Locks of one file. A `.json` with lock markers that does not parse (JSONC, trailing comma,
 * `NaN`) throws `UnparseableDocument`: a closed failure, never a silent pass.
 * @param {string} path @param {Buffer} bytes @returns {Lock[]}
 */
export function lockCarriers(path, bytes) {
  const name = basename(path);
  if (LOCK_BASENAMES.has(name)) {
    const value = stripBom(bytes.toString('utf8'));
    return [{ carrier: path, value, format: JSON_LOCKS.has(name) ? 'json' : 'text' }];
  }
  let text;
  if (name.endsWith('.json')) text = bytes.toString('utf8');
  else if (name.endsWith('.json.gz')) text = gunzipSync(bytes).toString('utf8');
  else return [];
  text = stripBom(text);
  if (!MAYBE_EMBEDS.some((marker) => text.includes(marker))) return [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new UnparseableDocument(error instanceof Error ? error.message : String(error));
  }
  return embeddedLocks(doc).map((e) => ({
    carrier: e.pointer ? `${path}#${e.pointer}` : path,
    value: e.value,
    format: e.format,
  }));
}

const counted = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) =>
  `${n} ${n === 1 ? one : many}`;
const HOST_ADVICE = `a registry mirror: rewrite the host to ${ALLOWED_ORIGIN} (keep integrity; npm ci verifies); a git/URL dependency: not allowed in committed locks, use a registry version`;
// Manager decision 2026-11-26: yarn v1's default registry is not a second allowed host.
const YARNPKG = 'https://registry.yarnpkg.com';
const YARNPKG_ADVICE = `yarn v1 writes registry.yarnpkg.com by default: set registry "${ALLOWED_ORIGIN}" in .yarnrc and regenerate the lock`;

/** @param {string} kind @param {string} label @param {number} count */
function refusal(kind, label, count) {
  if (kind === 'git')
    return `${counted(count, 'git dependency address', 'git dependency addresses')} on ${label} (git/URL dependencies are not allowed in committed locks: the host may be internal; use a registry version)`;
  if (kind === 'noncanonical')
    return `${counted(count, 'non-canonical address entry', 'non-canonical address entries')} (${label}) — regenerate the lock with its package manager`;
  if (kind === 'unreadable')
    return `${counted(count, 'unreadable address value', 'unreadable address values')} ${JSON.stringify(label)} ${NON_NETWORK_NOTE}`;
  return `${counted(count, 'address line', 'address lines')} on ${label} ${ALLOWED_NOTE} — ${label === YARNPKG ? YARNPKG_ADVICE : HOST_ADVICE}`;
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
      violations.push(
        error instanceof UnparseableDocument
          ? `${path}: .json with lock markers does not parse (${message(error)}) — make the file valid JSON or remove the lock`
          : `${path}: unreadable lock carrier (${message(error)})`,
      );
      continue;
    }
    for (const lock of found) {
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
      /** @type {Map<string, { kind: string, label: string, count: number }>} */
      const refused = new Map();
      for (const address of addresses) {
        const verdict = classifyAddress(address);
        if (!verdict) continue;
        const id = `${verdict.kind} ${verdict.label}`;
        const entry = refused.get(id) ?? { ...verdict, count: 0 };
        entry.count += 1;
        refused.set(id, entry);
      }
      for (const { kind, label, count } of refused.values())
        violations.push(`${lock.carrier}: ${refusal(kind, label, count)}`);
    }
  }
  for (const row of exempt)
    if (!present.has(row.path))
      violations.push(`${row.path}: exemption row for a missing file — drop the row`);
  return { violations, carriers, exempted };
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
  const { violations, carriers, exempted } = checkLockfileRegistry(root, repoPaths(root));
  const summary = `${carriers} lock carrier(s) scanned; ${exempted}/${EXEMPT.length} declared exemption(s) (tools/checks/lockfile-registry.mjs EXEMPT)`;
  if (violations.length) {
    console.error(`✗ lockfile-registry: ${violations.length} violation(s); ${summary}`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`✓ lockfile-registry: ${summary}`);
}
