import { build } from 'esbuild';

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
