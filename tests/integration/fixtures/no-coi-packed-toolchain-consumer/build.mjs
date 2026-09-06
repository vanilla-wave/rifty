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
const { createNetBuiltinOverrides } = await import('@riftydev/net/register-builtins');
const overrides = createNetBuiltinOverrides(Symbol('packed identity'));
for (const [specifier, expectedServerName] of [['node:http', 'HttpServer'], ['node:net', 'Server']]) {
  const module = overrides.get(specifier);
  const server = module.createServer();
  if (module.createServer.name !== 'createServer' || module.Server.name !== expectedServerName || server.constructor !== module.Server || Object.getPrototypeOf(server) !== module.Server.prototype) {
    throw new Error('packed ' + specifier + ' factory/constructor identity drifted: ' + module.createServer.name + '/' + module.Server.name);
  }
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
