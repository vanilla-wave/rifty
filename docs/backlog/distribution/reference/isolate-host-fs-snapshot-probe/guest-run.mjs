// Minimal README embedder (ADR-0558) over the built guest bundle: node guest-run.mjs '<code>'
import { readFileSync } from 'node:fs';
import { createHostBridge, exitStatus } from '../../../../../packages/isolate-guest/dist/index.js';
import ivm from '../../../../../packages/isolate-host/node_modules/isolated-vm/isolated-vm.js';

const bundle = readFileSync('../../../../../packages/isolate-guest/dist/guest.js', 'utf8');
export async function run(code) {
  const out = { 1: [], 2: [] };
  const guest = {};
  const { functions, timeOrigin, close } = createHostBridge({
    write: (fd, bytes) => out[fd].push(Buffer.from(bytes)),
    fire: (id) => guest.fire.apply(undefined, [id]),
  });
  const isolate = new ivm.Isolate({ memoryLimit: 256 });
  const context = await isolate.createContext();
  const names = Object.keys(functions);
  await context.evalClosure(
    `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
    names.map((n) => new ivm.Callback(functions[n])),
  );
  await (await isolate.compileScript(bundle, { filename: 'rifty-isolate-guest.js' })).run(context);
  const entry = await context.global.get('__riftyGuest', { reference: true });
  guest.fire = await entry.get('fire', { reference: true });
  const start = await entry.get('run', { reference: true });
  const status = await start.apply(undefined, [code], {
    arguments: { copy: true },
    result: { promise: true, copy: true },
  });
  close();
  isolate.dispose();
  return {
    stdout: Buffer.concat(out[1]).toString(),
    stderr: Buffer.concat(out[2]).toString(),
    exitCode: exitStatus(status),
  };
}
if (process.argv[2]) console.log(await run(process.argv[2]));
