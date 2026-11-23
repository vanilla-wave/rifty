/**
 * Test embedder for the snapshot seam (ADR-0567 §6, §8): the README wiring
 * (ADR-0558) over the built `dist/guest.js` in real isolated-vm, driven by JSON
 * steps on stdin, one JSON result line per step on stdout.
 *
 *   node --no-node-snapshot snapshot-driver.mjs <isolated-vm dir> < steps.json
 *
 * Steps: {op:'isolate', memoryLimit?} · {op:'run', code, wait?: false} ·
 * {op:'settle'} (await a run started with `wait: false`) ·
 * {op:'snapshot', options} · {op:'restore', bytes (base64) | file, options}.
 * A restore `file` is read here (large blobs stay off the step JSON).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHostBridge, exitStatus } from '../dist/index.js';

const ivm = createRequire(import.meta.url)(join(process.argv[2], 'isolated-vm.js'));
const bundle = readFileSync(new URL('../dist/guest.js', import.meta.url), 'utf8');
const steps = JSON.parse(readFileSync(0, 'utf8'));

let current = null;

async function fresh(memoryLimit = 128) {
  if (current) {
    current.close();
    if (!current.isolate.isDisposed) current.isolate.dispose();
  }
  const out = { 1: [], 2: [] };
  let guest;
  const { functions, timeOrigin, close } = createHostBridge({
    write: (fd, bytes) => out[fd].push(Buffer.from(bytes)),
    fire: (id) => guest.fire.apply(undefined, [id]),
  });
  const isolate = new ivm.Isolate({ memoryLimit });
  const context = await isolate.createContext();
  const names = Object.keys(functions);
  await context.evalClosure(
    `globalThis.__riftyIsolateHost = { timeOrigin: ${timeOrigin}, ${names.map((n, i) => `${n}: $${i}`).join(', ')} };`,
    names.map((n) => new ivm.Callback(functions[n])),
  );
  await (await isolate.compileScript(bundle, { filename: 'rifty-isolate-guest.js' })).run(context);
  const entry = await context.global.get('__riftyGuest', { reference: true });
  guest = {};
  for (const name of ['run', 'fire', 'snapshot', 'restore'])
    guest[name] = await entry.get(name, { reference: true });
  await context.global.delete('__riftyGuest');
  current = { isolate, out, guest, close };
}

const failure = (error) => ({ error: String(error?.message ?? error) });

for (const step of steps) {
  let result;
  try {
    if (step.op === 'isolate') {
      await fresh(step.memoryLimit);
      result = { ok: true };
    } else if (step.op === 'run' || step.op === 'settle') {
      if (step.op === 'run') {
        current.out[1] = [];
        current.out[2] = [];
        current.pending = current.guest.run.apply(undefined, [step.code], {
          arguments: { copy: true },
          result: { promise: true, copy: true },
        });
      }
      if (step.op === 'run' && step.wait === false) result = { ok: true };
      else {
        const status = await current.pending;
        const text = (fd) => Buffer.concat(current.out[fd]).toString('utf8');
        result = { stdout: text(1), stderr: text(2), exitCode: exitStatus(status) };
      }
    } else if (step.op === 'snapshot') {
      const started = performance.now();
      const bytes = await current.guest.snapshot.apply(undefined, [step.options], {
        arguments: { copy: true },
        result: { copy: true },
      });
      result = {
        ms: performance.now() - started,
        type: Object.prototype.toString.call(bytes),
        exact: bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength,
        bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
      };
    } else if (step.op === 'restore') {
      const bytes = new Uint8Array(
        step.file === undefined ? Buffer.from(step.bytes, 'base64') : readFileSync(step.file),
      );
      const started = performance.now();
      await current.guest.restore.apply(undefined, [bytes, step.options], {
        arguments: { copy: true },
      });
      result = { ok: true, ms: performance.now() - started };
    } else throw new Error(`unknown step ${step.op}`);
  } catch (error) {
    result = failure(error);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (current) {
  current.close();
  if (!current.isolate.isDisposed) current.isolate.dispose();
}
