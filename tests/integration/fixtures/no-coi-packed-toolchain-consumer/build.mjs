import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `const runtimeJs = await import('@riftydev/runtime-js');
if ('declaredGapCause' in runtimeJs) {
  throw new Error('bounded gap projection leaked from the packed runtime-js root');
}
process.exit(0);`,
  ],
  { stdio: 'inherit' },
);

await build({
  entryPoints: ['src/main.ts', 'src/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome148',
  outdir: 'dist',
  splitting: true,
  logLevel: 'info',
});
