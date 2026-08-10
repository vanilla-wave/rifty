#!/usr/bin/env node
/**
 * Oversized-source ratchet (AGENTS.md §Architecture).
 *
 * A source file an agent cannot read in one call gets read in sliding
 * line-number windows instead — measured on two real sessions: reads of a file
 * already in the window are 42-45% of all reads, and they are overwhelmingly
 * DIFFERENT slices (line multiplier 1.04-1.11), not repeats. The biggest file
 * alone (`installer.ts`, 3066 lines) took 213 reads = 12.5% of every read token
 * spent; top-10 files = 38%. Truncation makes it worse: a cut read is re-fetched
 * over the same range in ~2 of 3 cases, so the window is paid for twice.
 *
 * So this is a context-cost rule, not a style rule: past ~800 lines (~10k
 * tokens) one full read no longer fits the caps callers actually use, and every
 * question about the file costs another window.
 *
 * Ratchet, not a cap: existing files are grandfathered at their current size and
 * may only shrink. New files over the threshold are refused. Real burn-down must
 * be recorded so it cannot silently regrow.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THRESHOLD = 800;
/** Slack before a shrink must be re-recorded — absorbs ordinary edits, locks in
 *  real burn-down. */
export const RECORD_DELTA = 150;
export const SCAN_ROOTS = ['apps', 'packages', 'services', 'tools'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
  'tests',
  '__tests__',
  '__mocks__',
  'fixtures',
  'vendor',
  'generated',
]);
const PROD_RE = /\.(?:[cm]?[jt]sx?)$/;
const NON_PROD_RE = /\.(?:test|spec|fault|contract)\.[cm]?[jt]sx?$|\.d\.ts$/;

/** Files already over {@link THRESHOLD} when the gate landed, pinned at their
 *  then-current line count. `max` only ever goes down; an entry that reaches
 *  {@link THRESHOLD} is deleted. Burn-down plan:
 *  `docs/backlog/toolchain-build/oversized-source-burndown.md`. */
export const BASELINE = [
  { file: 'packages/npm-client/src/installer.ts', max: 3066 },
  { file: 'packages/shell/src/commands/git.ts', max: 3064 },
  { file: 'packages/runtime-js/src/module-loader/function-import-routing.ts', max: 2806 },
  { file: 'packages/workbench/src/workers/playground-project-authority.ts', max: 2697 },
  { file: 'packages/kernel/src/process-manager.ts', max: 2392 },
  { file: 'tools/node-parity-runner/src/run-in-rifty.ts', max: 2069 },
  { file: 'packages/runtime-js/src/builtins/vm/membrane.ts', max: 2058 },
  { file: 'packages/runtime-js/src/module-loader/cjs.ts', max: 2052 },
  { file: 'packages/terminal/src/terminal.ts', max: 2012 },
  { file: 'apps/playground/src/adapters/playground-app.tsx', max: 1874 },
  { file: 'tools/shadow-registry/src/esbuild-contract-probe.ts', max: 1753 },
  { file: 'packages/io/src/streams/readable.ts', max: 1667 },
  { file: 'packages/runtime-js/src/builtins/fs.ts', max: 1648 },
  { file: 'packages/runtime-js/src/module-loader/esm.ts', max: 1568 },
  { file: 'packages/workbench/src/workers/package-acquisition-authority.ts', max: 1565 },
  { file: 'apps/playground/src/glue/ts-ls-monaco-providers.ts', max: 1414 },
  { file: 'packages/ts-language-service/src/service.ts', max: 1377 },
  { file: 'packages/workbench/src/workbench/workbench-browser-owner.ts', max: 1284 },
  { file: 'apps/playground/src/components/editor-host-core.ts', max: 1270 },
  { file: 'tools/compat-matrix-generator/cli.js', max: 1269 },
  { file: 'packages/runtime-js/src/builtins/process.ts', max: 1226 },
  // Re-pinned after PR #249 (d34577d54) landed the watchdog rework at 1215 with
  // the pin unbumped — CI runs no file-size gate, so pr:check went red repo-wide.
  { file: 'packages/vfs/src/opfs-sync.ts', max: 1215 },
  {
    file: 'packages/workbench/src/workbench/internal/playground-session-tools-transport.ts',
    max: 1191,
  },
  { file: 'packages/shell/src/shell.ts', max: 1144 },
  { file: 'packages/npm-client/src/internal/shadow/planner.ts', max: 1123 },
  { file: 'packages/git/src/git.ts', max: 1118 },
  { file: 'packages/workbench/src/workbench/internal/typescript-relay-client.ts', max: 1083 },
  { file: 'apps/landing/src/explorer/explorer.ts', max: 1073 },
  { file: 'packages/net/src/cross-realm/preview-port.ts', max: 1067 },
  { file: 'apps/playground/src/components/FileExplorer.tsx', max: 1043 },
  { file: 'packages/workbench/src/glue/npm-shell-command.ts', max: 1043 },
  { file: 'packages/runtime-js/src/builtins/vm/rewrite-engine.ts', max: 1021 },
  { file: 'packages/runtime-js/src/builtins/fs-streams.ts', max: 1016 },
  { file: 'packages/workbench/src/glue/pty-client.ts', max: 1012 },
  { file: 'packages/workbench/src/workbench/open-workbench.ts', max: 1012 },
  { file: 'packages/net/src/http/server.ts', max: 1010 },
  { file: 'packages/workbench/src/glue/install-stamp-authority.ts', max: 1005 },
  { file: 'packages/net/src/http/upgrade-socket.ts', max: 976 },
  { file: 'apps/playground/src/templates/socket-lab.ts', max: 968 },
  { file: 'packages/runtime-js/src/module-loader/resolver.ts', max: 953 },
  { file: 'packages/ts-language-service/src/worker/protocol.ts', max: 890 },
  { file: 'apps/playground/public/sw.js', max: 879 },
  { file: 'packages/workbench/src/workers/workbench-project-vfs.ts', max: 875 },
  { file: 'packages/runtime-js/src/builtins/crypto.ts', max: 874 },
  { file: 'packages/workbench/src/workers/owner-package-state.ts', max: 863 },
  { file: 'packages/io/src/streams/writable.ts', max: 802 },
];

/** @returns {{ file: string, lines: number }[]} every prod source file under `rel` */
export function measureFiles(root, rel, out = []) {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const child = join(rel, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) measureFiles(root, child, out);
      continue;
    }
    if (!PROD_RE.test(e.name) || NON_PROD_RE.test(e.name)) continue;
    const abs = join(root, child);
    out.push({
      file: relative(root, abs).split('\\').join('/'),
      lines: readFileSync(abs, 'utf8').split('\n').length,
    });
  }
  return out;
}

/**
 * @param {{file:string,lines:number}[]} measured
 * @param {{file:string,max:number}[]} baseline
 * @returns {string[]} violations (empty = pass)
 */
export function evaluate(measured, baseline = BASELINE, threshold = THRESHOLD) {
  const violations = [];
  const pinned = new Map(baseline.map((e) => [e.file, e.max]));
  const seen = new Set();
  for (const { file, lines } of measured) {
    const max = pinned.get(file);
    if (max === undefined) {
      if (lines > threshold) {
        violations.push(
          `${file}: ${lines} lines — a new source file over ${threshold} cannot be read in one call, so every question about it costs another window; split it (AGENTS.md §Architecture)`,
        );
      }
      continue;
    }
    seen.add(file);
    if (lines > max) {
      violations.push(
        `${file}: grew ${max} → ${lines} lines — grandfathered files may only shrink; move the addition into a new module`,
      );
    } else if (lines <= threshold) {
      violations.push(
        `${file}: down to ${lines} lines (at or under ${threshold}) — delete its BASELINE entry in this PR`,
      );
    } else if (lines <= max - RECORD_DELTA) {
      violations.push(
        `${file}: shrank ${max} → ${lines} lines — lower its BASELINE entry to ${lines} in this PR so the burn-down cannot regrow`,
      );
    }
  }
  for (const { file } of baseline) {
    if (!seen.has(file)) {
      violations.push(`${file}: BASELINE entry for a file that no longer exists — delete it`);
    }
  }
  return violations;
}

function main() {
  const root = process.cwd();
  const measured = [];
  for (const scanRoot of SCAN_ROOTS) measureFiles(root, scanRoot, measured);
  const violations = evaluate(measured);
  const over = measured.filter((m) => m.lines > THRESHOLD).sort((a, b) => b.lines - a.lines);
  console.log(
    `file-size: ${over.length} file(s) over ${THRESHOLD} lines (${BASELINE.length} grandfathered)`,
  );
  for (const m of over.slice(0, 10)) {
    console.log(`  ${String(m.lines).padStart(5)}  ${m.file}`);
  }
  if (violations.length > 0) {
    console.error(`file-size: ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }
  console.log('file-size: OK (ratchet holds)');
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
