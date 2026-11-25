#!/usr/bin/env node
/**
 * Lifecycle probe — what a host op adds when the sandbox's files live in a worker (variants 2/3):
 * one consumer → worker → consumer round trip over the pool's transport shape (a JSON line on the
 * child's stdin, a reply on a pipe), payload base64 in the line as today's protocol carries bytes.
 *   node ipc.mjs
 */
import { spawn } from 'node:child_process';
import { loadavg } from 'node:os';

if (process.argv[2] === 'child') {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const req = JSON.parse(line);
      const bytes = Buffer.from(req.data ?? '', 'base64');
      process.stdout.write(
        `${JSON.stringify({ id: req.id, n: bytes.length, data: req.echo ? req.data : '' })}\n`,
      );
    }
  });
} else {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'child'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiting = new Map();
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const r = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      waiting.get(r.id)(r);
      waiting.delete(r.id);
    }
  });
  let id = 0;
  const call = (req) =>
    new Promise((res) => {
      const i = ++id;
      waiting.set(i, res);
      child.stdin.write(`${JSON.stringify({ id: i, ...req })}\n`);
    });
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const rows = {};
  for (const [name, size, echo] of [
    ['empty', 0, false],
    ['write 10 KiB', 10 * 1024, false],
    ['read 1.4 KiB (pdf)', 1369, true],
    ['read 1 MiB', 1 << 20, true],
  ]) {
    const data = Buffer.alloc(size, 7).toString('base64');
    const xs = [];
    for (let k = 0; k < 501; k++) {
      const t = performance.now();
      await call({ data, echo });
      xs.push(performance.now() - t);
    }
    rows[name] = Math.round(median(xs) * 1000) / 1000;
  }
  console.log(JSON.stringify({ sec: 'ipc', load: loadavg()[0].toFixed(1), roundTripMs: rows }));
  child.kill();
}
