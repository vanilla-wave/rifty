#!/usr/bin/env node
/**
 * Source-grep test ratchet (epic playground-testable-core).
 *
 * A "source-grep test" readFileSync's a first-party `.ts`/`.tsx` module and
 * asserts on the text (`expect(source).toContain(...)`) — it pins strings,
 * proves no behavior. This check refuses NEW ones and forces the burn-down of
 * the existing allowlist to stay recorded. Two per-file keys, BOTH exact-match:
 *  - `count` — human-readable burn-down meter (a decrease must shrink the
 *    allowlist in the same PR);
 *  - `digest` — identity of the assertion SET (hash of the normalized
 *    signature multiset). Count alone is lossy: swapping one grep for another
 *    at the same count would pass silently. The digest refuses that — ANY
 *    add/remove/replace must re-record the entry (digest + why) in the same
 *    PR, so a swapped-in grep is as loud as a brand-new one.
 *
 * Detector is a bounded regex scan, not an AST: direct bindings
 * (`const source = readFileSync('…/X.tsx')`), read-helper bindings
 * (`const read = (p) => readFileSync(…)` used as `read('./x.ts')`), plus
 * derived bindings (`const tail = source.slice(…)`), propagated to fixpoint.
 * Doc reads (`.md`) and fixture reads don't count — only `.ts`/`.tsx` sources.
 * Known under-approximation is accepted (recorded at refine, epic
 * playground-testable-core); new evasion variants get added here when seen.
 *
 * Scope = the Playground + extracted Workbench test surfaces and the
 * `tests/browser-unit` lane (`*.spec.ts` — a grep there would bypass the gate).
 * Other packages' pre-existing greps are inventoried but NOT yet ratcheted —
 * TODO(backlog: toolchain-build/source-grep-ratchet-repo-wide).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files allowed to keep source-grep assertions, with their exact counts and
 *  assertion-set digests (see {@link assertionSetDigest}; the violation message
 *  prints the expected value). Burn-down: shrink `count` + update `digest` (or
 *  delete the entry) in the PR that converts the greps to behavioral tests. At
 *  epic close every entry is gone or carries a `why` (the recorded
 *  why-behavioral-is-impossible constraint). */
export const ALLOWLIST = [
  {
    file: 'apps/playground/src/App.test.ts',
    count: 40,
    digest: 'fb6b1bc2dc0f',
    why: 'browser App imports xterm; residual pins only client JSX/composition bindings; TS boot/reinit behavior lives in diagnostics-sync contracts + browser e2e',
  },
  {
    file: 'apps/playground/src/components/BottomPanel.test.ts',
    count: 1,
    digest: '59bc8790a2a9',
    why: 'keyed <For> reconciliation is client-only (SSR renders once); the grep pins the per-session keyed slots',
  },
  {
    file: 'apps/playground/src/components/EditorHost.test.ts',
    count: 11,
    digest: 'd244a30ec98b',
    why: 'EditorHost.tsx unrenderable in node (monaco-env ?worker import); pins = widget mounts + effect→core-handler wiring + git-handler tracked scope (effects never run in node); behavioral heirs in editor-host-core.test.ts',
  },
  {
    file: 'apps/playground/src/components/PreviewPanel.test.ts',
    count: 2,
    digest: '73a454d386bb',
    why: 'keyed <Show> iframe remount + Reload retry-signal are client-only wiring (server renders once); warm-up/URL/open-tab heirs in preview-panel-core.test.ts',
  },
  {
    file: 'apps/playground/src/components/FileExplorer.source.test.ts',
    count: 9,
    digest: '2220cd513b7b',
    why: 'client-only JSX handler wiring + root-tracking createEffect (SSR emits no handlers, runs no effects); decision heirs in file-explorer-core.test.ts, render surface in FileExplorer.test.tsx',
  },
  {
    file: 'apps/playground/src/components/TerminalPanel.test.ts',
    count: 1,
    digest: '7dd54a601fb2',
    why: 'RiftyTerminal is constructed in onMount (client-only, solid server runtime) — ctor-option wiring unobservable in node; values pinned via terminal-appearance module',
  },
  {
    file: 'packages/workbench/src/workers/kernel-worker-entry.test.ts',
    count: 5,
    digest: 'ceb47c6a61e8',
    why: 'contract = emitted-bundle shape (explicit bindings keep Vite from tree-shaking the setup chunk) — unobservable at node runtime; import executes installWorkerEntry worker wiring',
  },

  {
    file: 'packages/workbench/src/workers/bundle-local-buffer.test.ts',
    count: 5,
    digest: '48a01d0768ed',
    why: 'dual-copy Buffer hazard exists only in PROD ?worker&url bundles (dev/browser-unit share one ESM instance); wiring pins on child bootstraps; behavior covered in tests/e2e-prod',
  },
];

export const SCAN_ROOTS = ['apps/playground/src', 'packages/workbench/src', 'tests/browser-unit'];
/** Window after a binding's `=` in which the readFileSync target path must
 *  appear — covers the multi-line `fileURLToPath(new URL('…', import.meta.url))`
 *  formatting without swallowing the whole file. */
const BINDING_WINDOW = 400;
const SOURCE_PATH_RE = /\.tsx?['"`]/;

/**
 * Identifiers in a test file that hold first-party source text:
 *  - direct: `const source = readFileSync('…/X.tsx', 'utf8')`
 *  - helper: `const read = (p) => readFileSync(…)` where any call site passes a
 *    `.ts`/`.tsx` path (the path lives at the call, not the binding)
 *  - derived: `const tail = source.slice(…)` — propagated to fixpoint.
 * Helper identifiers are returned separately: they taint only via `id(…)` calls.
 */
export function findSourceTextBindings(content) {
  const direct = new Set();
  const helpers = new Set();
  const bindingRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=/g;
  for (let m = bindingRe.exec(content); m; m = bindingRe.exec(content)) {
    const id = m[1];
    const window = content.slice(m.index, m.index + BINDING_WINDOW);
    if (!/\breadFileSync\s*\(/.test(window)) continue;
    const isHelper = /=>[^;]*\breadFileSync\s*\(/.test(window);
    if (isHelper) {
      // Helper qualifies only if some call site reads a .ts/.tsx source.
      const callRe = new RegExp(`\\b${id}\\s*\\(\\s*['"\`][^'"\`]*\\.tsx?['"\`]`);
      if (callRe.test(content)) helpers.add(id);
    } else if (SOURCE_PATH_RE.test(window)) {
      direct.add(id);
    }
  }
  // Propagate through derived bindings (`const x = source.slice(…)`).
  for (let pass = 0; pass < 5; pass++) {
    let grew = false;
    const derivedRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=([^;]{0,300})/g;
    for (let m = derivedRe.exec(content); m; m = derivedRe.exec(content)) {
      const [, id, rhs] = m;
      if (direct.has(id)) continue;
      if (referencesTainted(rhs, direct, helpers)) {
        direct.add(id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return { direct, helpers };
}

function referencesTainted(expr, direct, helpers) {
  for (const id of direct) {
    if (new RegExp(`\\b${id}\\b`).test(expr)) return true;
  }
  for (const id of helpers) {
    if (new RegExp(`\\b${id}\\s*\\(`).test(expr)) return true;
  }
  return false;
}

/** Consume one balanced-paren region starting AT the opening paren; returns
 *  the index just past the close (or the cap). Same 600-char bound as before —
 *  a pathological literal degrades to a truncated-but-deterministic slice. */
function balancedParenEnd(content, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  const limit = Math.min(content.length, openIndex + 1 + 600);
  while (i < limit && depth > 0) {
    const ch = content[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  return i;
}

/** Extract each `expect(` call: its balanced argument region plus the matcher
 *  chain after the close (`.not.toContain('x')`, `.toMatch(/…/)`, …). */
function* expectCalls(content) {
  const re = /\bexpect\s*\(/g;
  const chainLinkRe = /^\s*\.\s*[A-Za-z_$][\w$]*/;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    const argStart = m.index + m[0].length;
    const argEnd = balancedParenEnd(content, argStart - 1);
    const arg = content.slice(argStart, Math.max(argStart, argEnd - 1));
    // Matcher chain: `.name` links, each optionally called with balanced parens.
    let i = argEnd;
    const chainCap = Math.min(content.length, argEnd + 600);
    while (i < chainCap) {
      const link = chainLinkRe.exec(content.slice(i, chainCap));
      if (!link) break;
      i += link.index + link[0].length;
      const nextOpen = /^\s*\(/.exec(content.slice(i, chainCap));
      if (nextOpen) i = balancedParenEnd(content, i + nextOpen[0].length - 1);
    }
    yield { arg, chain: content.slice(argEnd, i) };
  }
}

const collapseWhitespace = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Normalized signature of every `expect(…)` assertion whose argument references
 * source text — `expect(<arg>)<matcher-chain>` with whitespace collapsed, so
 * formatting churn never moves the digest but any real change does.
 */
export function sourceAssertionSignatures(content) {
  const { direct, helpers } = findSourceTextBindings(content);
  if (direct.size === 0 && helpers.size === 0) return [];
  const signatures = [];
  for (const { arg, chain } of expectCalls(content)) {
    if (!referencesTainted(arg, direct, helpers)) continue;
    signatures.push(`expect(${collapseWhitespace(arg)})${collapseWhitespace(chain)}`);
  }
  return signatures;
}

/** Order-independent identity of a file's assertion multiset (sorted-join
 *  keeps test reordering digest-stable; duplicates still count twice). */
export function assertionSetDigest(signatures) {
  return createHash('sha256')
    .update([...signatures].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/** Count `expect(…)` calls whose argument references source text. */
export function countSourceAssertions(content) {
  return sourceAssertionSignatures(content).length;
}

/**
 * @param {{file:string,count:number,digest:string}[]} measured
 * @param {{file:string,count:number,digest?:string,why?:string}[]} allowlist
 * @returns {string[]} violations (empty = pass)
 */
export function compareToAllowlist(measured, allowlist) {
  const violations = [];
  const allowed = new Map(allowlist.map((e) => [e.file, e]));
  const seen = new Set();
  for (const entry of allowlist) {
    if (entry.count > 0 && !(typeof entry.why === 'string' && entry.why.trim().length > 0)) {
      violations.push(
        `${entry.file}: allowlisted at ${entry.count} without a recorded why — every residual entry carries its why-behavioral-is-impossible constraint`,
      );
    }
  }
  for (const { file, count, digest } of measured) {
    if (count === 0) continue;
    seen.add(file);
    const entry = allowed.get(file);
    if (!entry) {
      violations.push(
        `${file}: ${count} source-grep assertion(s) in a file NOT on the allowlist — write a behavioral test instead (a genuinely unobservable contract needs an ALLOWLIST entry with a recorded why)`,
      );
    } else if (count > entry.count) {
      violations.push(
        `${file}: source-grep assertions grew ${entry.count} → ${count} — write behavioral tests instead of new greps`,
      );
    } else if (count < entry.count) {
      violations.push(
        `${file}: source-grep assertions dropped ${entry.count} → ${count} — shrink the ALLOWLIST entry in this PR (burn-down must be recorded; new digest ${digest})`,
      );
    } else if (typeof entry.digest !== 'string' || entry.digest.trim().length === 0) {
      violations.push(
        `${file}: allowlisted without a digest — record digest ${digest} (identity of the assertion set; count alone lets a same-count swap through)`,
      );
    } else if (digest !== entry.digest) {
      violations.push(
        `${file}: assertion set changed at unchanged count (digest ${entry.digest} → ${digest}) — a swapped-in source grep is a NEW grep; write a behavioral test instead, or re-record the entry (digest + why) for a genuinely unobservable contract`,
      );
    }
  }
  for (const entry of allowlist) {
    if (!seen.has(entry.file) && entry.count > 0) {
      violations.push(
        `${entry.file}: allowlisted at ${entry.count} but measured 0 — delete the ALLOWLIST entry`,
      );
    }
  }
  return violations;
}

/** Unit tests (`.test.ts(x)`) and playwright lane specs (`.spec.ts(x)`) alike. */
export function* walkTestFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkTestFiles(p);
    else if (/\.(test|spec)\.tsx?$/.test(name)) yield p;
  }
}

function main() {
  const root = process.cwd();
  const measured = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const p of walkTestFiles(join(root, scanRoot))) {
      const rel = relative(root, p);
      const signatures = sourceAssertionSignatures(readFileSync(p, 'utf8'));
      measured.push({
        file: rel,
        count: signatures.length,
        digest: assertionSetDigest(signatures),
      });
    }
  }
  const violations = compareToAllowlist(measured, ALLOWLIST);
  const total = measured.reduce((n, e) => n + e.count, 0);
  const files = measured.filter((e) => e.count > 0).length;
  console.log(`source-grep-ratchet: ${total} source-grep assertion(s) across ${files} file(s)`);
  for (const e of measured.filter((e) => e.count > 0).sort((a, b) => b.count - a.count)) {
    console.log(`  ${String(e.count).padStart(4)}  ${e.file}`);
  }
  if (violations.length > 0) {
    console.error(`source-grep-ratchet: ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('source-grep-ratchet: OK (allowlist exact-match)');
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
