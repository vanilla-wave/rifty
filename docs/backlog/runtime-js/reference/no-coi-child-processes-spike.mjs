import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('@playwright/test');
const scripts = {
  '/probe/sw.js': `
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
 const url = new URL(e.request.url);
 if (url.pathname !== '/probe/rpc') return;
 e.respondWith((async () => {
   const clients = await self.clients.matchAll({ type: 'all', includeUncontrolled: true });
   const owner = clients.find(c => c.type === 'window');
   if (!owner) return new Response(JSON.stringify(clients.map(c=>({url:c.url,type:c.type}))), {status:503});
   const channel = new MessageChannel();
   const result = new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); });
   owner.postMessage({op:url.searchParams.get('op')}, [channel.port2]);
   return new Response(JSON.stringify(await result));
 })());
});`,
  '/probe/owner.js': `
let value = 'initial';
globalThis.parentMarker = true;
self.addEventListener('message', e => {
 if (e.data.op === 'write') value = 'child-write';
 e.ports[0].postMessage({value});
});
const worker = new Worker('/probe/child.js');
worker.onmessage = e => self.postMessage({...e.data, ownerValue:value});
worker.onerror = e => self.postMessage({error:e.message});`,
  '/probe/child.js': `
try {
 const rpc = op => {
   const xhr = new XMLHttpRequest();
   xhr.open('GET', '/probe/rpc?op='+op, false);
   xhr.send();
   if(xhr.status !== 200) throw Error('RPC '+xhr.status+': '+xhr.responseText);
   return JSON.parse(xhr.responseText);
 };
 const start=performance.now();
 const before=rpc('read');
 const after=rpc('write');
 for(let i=0;i<100;i++) rpc('read');
 self.postMessage({coi:crossOriginIsolated,sab:typeof SharedArrayBuffer, marker:typeof parentMarker,before,after,elapsedMs:performance.now()-start});
} catch(error) { self.postMessage({error:error.stack}); }`,
};
const server = createServer((req, res) => {
  const script = scripts[req.url];
  res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html');
  res.end(script ?? '<!doctype html><title>No COI probe</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/probe/`);
  const result = await page.evaluate(async () => {
    await navigator.serviceWorker.register('/probe/sw.js', { scope: '/probe/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    return await new Promise((resolve, reject) => {
      const worker = new Worker('/probe/owner.js');
      navigator.serviceWorker.addEventListener('message', (e) =>
        worker.postMessage(e.data, e.ports),
      );
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(Error(e.message));
      setTimeout(() => reject(Error('probe timed out')), 15000);
    });
  });
  console.log(
    JSON.stringify({ browser: browser.version(), node: process.version, result }, null, 2),
  );
  assert.equal(result.error, undefined);
  assert.equal(result.coi, false);
  assert.equal(result.sab, 'undefined');
  assert.equal(result.marker, 'undefined');
  assert.equal(result.before.value, 'initial');
  assert.equal(result.after.value, 'child-write');
  assert.equal(result.ownerValue, 'child-write');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
