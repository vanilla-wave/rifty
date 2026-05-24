#!/usr/bin/env node
/**
 * Enforces D-002: no Solid imports outside apps/playground/**.
 *
 * Runs in CI alongside the lint job. We use grep so this works with or without
 * a TypeScript program — it's about textual imports, not the type system.
 */
import { execFileSync } from 'node:child_process';

const NEEDLE = ['solid', '-', 'js'].join('');
let out;
try {
  out = execFileSync(
    'grep',
    [
      '-rl',
      '--include=*.ts',
      '--include=*.tsx',
      '--include=*.js',
      '--include=*.mjs',
      '--exclude-dir=node_modules',
      '--exclude-dir=dist',
      `from '${NEEDLE}`,
      'packages/',
      'tools/',
      'tests/',
    ],
    { encoding: 'utf8' },
  );
} catch {
  out = '';
}
const offenders = out.split('\n').filter(Boolean);
if (offenders.length > 0) {
  console.error('D-002 violated: solid-js imported outside apps/playground/**');
  for (const f of offenders) console.error(`  ${f}`);
  process.exit(1);
}
console.log('D-002 ok: no Solid imports outside apps/playground/');
