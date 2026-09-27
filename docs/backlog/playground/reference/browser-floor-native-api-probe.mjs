import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
const source = `self.onmessage = async ({data}) => {
  try {
    if(data === 'eval') { self.postMessage({ ok: new Function('return 42')() }); return; }
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('contention-probe', {create:true});
    self.held = await file.createSyncAccessHandle();
    self.postMessage({ok:true});
  } catch(e) { self.postMessage({name:e.name,message:e.message}); }
};`;
const server = createServer((request, response) => {
  if (request.url.endsWith('.js')) {
    response.setHeader('content-type', 'text/javascript');
    if (request.url === '/restricted.js')
      response.setHeader('content-security-policy', "script-src 'self'");
    response.end(source);
  } else {
    response.setHeader('content-type', 'text/html');
    response.setHeader('content-security-policy', "script-src 'self'; worker-src 'self'");
    response.end('<!doctype html><title>Native browser floor probes</title>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const records = [];
try {
  for (const engine of [chromium, firefox, webkit]) {
    const profile = await mkdtemp(join(tmpdir(), 'rifty-api-probe-'));
    const context = await engine.launchPersistentContext(profile);
    try {
      const page = await context.newPage();
      await page.goto(url);
      const result = await page.evaluate(async () => {
        const ask = (worker, data) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('native probe deadline')), 10000);
            worker.onmessage = ({ data }) => {
              clearTimeout(timer);
              resolve(data);
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error(event.message));
            };
            worker.postMessage(data);
          });
        const first = new Worker('/probe.js', { type: 'module' });
        const second = new Worker('/probe.js', { type: 'module' });
        const restricted = new Worker('/restricted.js', { type: 'module' });
        try {
          return {
            documentCspWorkerEval: await ask(first, 'eval'),
            workerCspEval: await ask(restricted, 'eval'),
            firstLock: await ask(first, 'lock'),
            contendedLock: await ask(second, 'lock'),
          };
        } finally {
          first.terminate();
          second.terminate();
          restricted.terminate();
        }
      });
      records.push({
        engine: engine.name(),
        build: context.browser().version(),
        date: new Date().toISOString(),
        ...result,
      });
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(records, null, 2));
