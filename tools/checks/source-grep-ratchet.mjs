#!/usr/bin/env node
/**
 * Source-grep test ratchet (epic playground-testable-core).
 *
 * A "source-grep test" readFileSync's a first-party `.ts`/`.tsx` module and
 * asserts on the text (`expect(source).toContain(...)`) — it pins strings,
 * proves no behavior. This check refuses NEW ones and forces the burn-down of
 * the existing allowlist to stay recorded: per-file assertion counts must match
 * the allowlist EXACTLY (a decrease must shrink the allowlist in the same PR).
 *
 * Detector is a bounded regex scan, not an AST: direct bindings
 * (`const source = readFileSync('…/X.tsx')`), read-helper bindings
 * (`const read = (p) => readFileSync(…)` used as `read('./x.ts')`), plus
 * derived bindings (`const tail = source.slice(…)`), propagated to fixpoint.
 * Doc reads (`.md`) and fixture reads don't count — only `.ts`/`.tsx` sources.
 * Known under-approximation is accepted (recorded at refine, epic
 * playground-testable-core); new evasion variants get added here when seen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files allowed to keep source-grep assertions, with their exact counts.
 *  Burn-down: shrink `count` (or delete the entry) in the PR that converts the
 *  greps to behavioral tests. At epic close every entry is gone or carries a
 *  `why` (the recorded why-behavioral-is-impossible constraint). */
export const ALLOWLIST = [
  {
    file: 'apps/playground/src/App.test.ts',
    count: 87,
    why: 'App.tsx unrenderable in node (xterm import); residual = negative architectural invariants + one binding pin per wiring surface; behavior heirs in orchestration/*.test.ts + glue tests + e2e',
  },
  {
    file: 'apps/playground/src/components/BottomPanel.test.ts',
    count: 1,
    why: 'keyed <For> reconciliation is client-only (SSR renders once); the grep pins the per-session keyed slots',
  },
  {
    file: 'apps/playground/src/components/EditorHost.test.ts',
    count: 10,
    why: 'EditorHost.tsx unrenderable in node (monaco-env ?worker import); pins = widget mounts + effect→core-handler wiring; behavioral heirs in editor-host-core.test.ts',
  },
  {
    file: 'apps/playground/src/components/PreviewPanel.test.ts',
    count: 2,
    why: 'keyed <Show> iframe remount + Reload retry-signal are client-only wiring (server renders once); warm-up/URL/open-tab heirs in preview-panel-core.test.ts',
  },
  {
    file: 'apps/playground/src/components/FileExplorer.source.test.ts',
    count: 9,
    why: 'client-only JSX handler wiring + root-tracking createEffect (SSR emits no handlers, runs no effects); decision heirs in file-explorer-core.test.ts, render surface in FileExplorer.test.tsx',
  },
  {
    file: 'apps/playground/src/components/TerminalPanel.test.ts',
    count: 1,
    why: 'RiftyTerminal is constructed in onMount (client-only, solid server runtime) — ctor-option wiring unobservable in node; values pinned via terminal-appearance module',
  },
  {
    file: 'apps/playground/src/workers/node-entry-bootstrap.test.ts',
    count: 6,
    why: 'worker-only kind:url entry (top-level await runs the program on import); residual = serve/bin branch, prepareViteCli call-site, file-change bridge wiring; env-decoder heirs in vite-cli-prep.test.ts',
  },
  {
    file: 'apps/playground/src/workers/kernel-worker-entry.test.ts',
    count: 5,
    why: 'contract = emitted-bundle shape (explicit bindings keep Vite from tree-shaking the setup chunk) — unobservable at node runtime; import executes installWorkerEntry worker wiring',
  },

  {
    file: 'apps/playground/src/workers/dev-server-boot.test.ts',
    count: 1,
    why: 'ADR-0161 hmr flag is vite8-opt-in only (no default-lane seam); boot behavior heirs = in-file node tests + tests/browser-unit + e2e m7/generic-dev-server-lifecycle',
  },
  {
    file: 'apps/playground/src/workers/real-vite-bootstrap.test.ts',
    count: 13,
    why: 'worker-only owner entry; residual = ADR-0161 hmr-off env (vite8 opt-in), prod-bundle registrar pins, ready-vs-bridge ORDER + setProcessCwd (not page-observable); heirs in tests/browser-unit + e2e',
  },
  {
    file: 'apps/playground/src/workers/bundle-local-buffer.test.ts',
    count: 5,
    why: 'dual-copy Buffer hazard exists only in PROD ?worker&url bundles (dev/browser-unit share one ESM instance); wiring pins on child bootstraps; behavior covered in tests/e2e-prod',
  },
];

const SCAN_ROOT = 'apps/playground/src';
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

/** Extract the balanced-paren argument region of each `expect(` call. */
function* expectArguments(content) {
  const re = /\bexpect\s*\(/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    const limit = Math.min(content.length, start + 600);
    while (i < limit && depth > 0) {
      const ch = content[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    yield content.slice(start, depth === 0 ? i - 1 : limit);
  }
}

/** Count `expect(…)` calls whose argument references source text. */
export function countSourceAssertions(content) {
  const { direct, helpers } = findSourceTextBindings(content);
  if (direct.size === 0 && helpers.size === 0) return 0;
  let count = 0;
  for (const arg of expectArguments(content)) {
    if (referencesTainted(arg, direct, helpers)) count++;
  }
  return count;
}

/**
 * @param {{file:string,count:number}[]} measured
 * @param {{file:string,count:number,why?:string}[]} allowlist
 * @returns {string[]} violations (empty = pass)
 */
export function compareToAllowlist(measured, allowlist) {
  const violations = [];
  const allowed = new Map(allowlist.map((e) => [e.file, e]));
  const seen = new Set();
  for (const { file, count } of measured) {
    if (count === 0) continue;
    seen.add(file);
    const entry = allowed.get(file);
    if (!entry) {
      violations.push(
        `${file}: ${count} source-grep assertion(s) in a file NOT on the allowlist — write a behavioral test instead (epic playground-testable-core)`,
      );
    } else if (count > entry.count) {
      violations.push(
        `${file}: source-grep assertions grew ${entry.count} → ${count} — write behavioral tests instead of new greps`,
      );
    } else if (count < entry.count) {
      violations.push(
        `${file}: source-grep assertions dropped ${entry.count} → ${count} — shrink the ALLOWLIST entry in this PR (burn-down must be recorded)`,
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

function* walkTestFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkTestFiles(p);
    else if (/\.test\.tsx?$/.test(name)) yield p;
  }
}

function main() {
  const root = process.cwd();
  const measured = [];
  for (const p of walkTestFiles(join(root, SCAN_ROOT))) {
    const rel = relative(root, p);
    measured.push({ file: rel, count: countSourceAssertions(readFileSync(p, 'utf8')) });
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
