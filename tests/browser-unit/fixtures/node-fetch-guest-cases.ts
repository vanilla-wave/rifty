export interface FetchGuestCase {
  readonly name: string;
  readonly source: string;
}

const preamble = `const row = (key, value) => console.log('FETCH|' + key + '=' + JSON.stringify(value));
const fail = (error) => { console.error(error); process.exitCode = 1; };
`;

export const honoFetchCase = `${preamble}
const { Hono } = require('hono');
const app = new Hono();
app.post('/x', async (c) => {
  const form = await c.req.raw.formData();
  const file = form.get('file');
  return c.json({cookie:c.req.header('cookie'), field:form.get('field'), name:file.name, text:await file.text()});
});
const form = new FormData();
form.set('field', 'hello');
form.set('file', new File(['file payload'], 'a.txt', {type:'text/plain'}));
app.request('/x', {method:'POST', headers:{cookie:'a=1'}, body:form})
  .then(async (response) => {
    row('hono', [response instanceof Response, await response.json()]);
  }).catch(fail);
`;

export const fetchGuestCases: readonly FetchGuestCase[] = [
  {
    name: 'patch-method-warning',
    source: `${preamble}
// Ignore unrelated host-launch warnings; the constructor's code is the obligation.
process.on('warning',warning=>{if(warning.code === 'UNDICI-FETCH-patch') row('warning',[warning.name,warning.code,warning.message]);});
row('patch-methods',[new Request('http://example.test/',{method:'patch'}).method,new Request('http://example.test/',{method:'patch'}).method]);
`,
  },
  {
    name: 'warning-api',
    source: `${preamble}
process.removeAllListeners('warning');
const original=Object.assign(new Error('fetch-warning-error'),{name:'Given',code:'GIVEN',detail:'kept'});
process.on('warning',warning=>{if(warning.message.startsWith('fetch-warning-')) row('warning-api',[warning.name,warning.code,warning.message,warning.detail,warning === original]);});
row('warning-returns',[
 process.emitWarning('fetch-warning-plain'),
 process.emitWarning('fetch-warning-coded','Custom','CODE'),
 process.emitWarning('fetch-warning-options',{type:'Options',code:'OPT',detail:'detail'}),
 process.emitWarning(original,'Ignored','IGNORED'),
].map(value=>typeof value));
original.message='fetch-warning-mutated';
for(const args of [[undefined],[null],[1],[true],[{}],[[]],[Symbol('x')],[function named(){}],['x',1],['x',null],['x',undefined,1]]) {
 try {process.emitWarning(...args);row('warning-invalid','accepted');}
 catch(e) {row('warning-invalid',[e.name,e.code,e.message]);}
}
process.noDeprecation=true;process.emitWarning('fetch-warning-hidden','DeprecationWarning');process.noDeprecation=false;
`,
  },
  {
    name: 'custom-tee-state',
    source: `${preamble}
(async () => {
 for (const read of [false,true]) {
  const a = new ReadableStream({start(c) {c.enqueue(new Uint8Array([65]));c.close();}});
  const reader = new ReadableStreamDefaultReader(a);
  if (read) {await reader.read();reader.releaseLock();}
  const response = new Response('source');
  response.body.tee = () => [a,a];
  const copy = response.clone();
  row('custom-tee-'+read, [response.body === a,copy.body === a,copy.bodyUsed,copy.body.locked]);
  if(!read) reader.releaseLock();
 }
 const revocable = Object.getOwnPropertyDescriptor(Proxy,'revocable').value;
 const record=Object.defineProperty({visible:'yes'},'hidden',{value:'no'});
 const pair=revocable(record,{});
 row('revocable',[...new Headers(pair.proxy)]);
 pair.revoke();
 try {new Headers(pair.proxy);row('revoked','accepted');}catch(e){row('revoked',e.name);}
})().catch(fail);
`,
  },
  {
    name: 'vm-header-record',
    source: `${preamble}
const vm=require('node:vm');
const object=vm.runInNewContext('Object.defineProperty({visible:"yes"}, "hidden", {value:"also"})');
row('vm-record',[...new Headers(object)]);
const proxy=vm.runInNewContext('new Proxy(Object.defineProperty({visible:"yes"}, "hidden", {value:"also"}), {})');
row('vm-proxy',[...new Headers(proxy)]);
`,
  },
  {
    name: 'headers-and-identity',
    source: `${preamble}
const request = new Request('http://example.test/', {headers:{cookie:'a=1',host:'h'}});
const headers = new Headers([['set-cookie','a=1'], ['set-cookie','b=2']]);
row('headers', [request.headers.get('cookie'), request.headers.get('host'), headers.getSetCookie()]);
row('identity', [Headers, Request, Response, FormData].map(C => [C.name,C.length,C.prototype.constructor === C]));
row('fetch-shape',[fetch.name,fetch.length]);
row('stream-alias',ReadableStream.prototype.values === ReadableStream.prototype[Symbol.asyncIterator]);
row('wrapped-function-record',[...new Headers(Blob.prototype.stream)]);
const unicode=new FormData();unicode.set('text',String.fromCharCode(0xd800,97,0xdc00,0xd83d,0xde00,0xfeff));
// Codepoints preserve the BOM assertion through terminal display serialization.
row('usv',Array.from(unicode.get('text'),character=>character.codePointAt(0)));
const record = Object.defineProperty({visible:'yes'}, 'hidden', {value:'also'});
row('record', [...new Headers(record)]);
const calls = [];
const proxy = new Proxy(record, {ownKeys(t) { calls.push('keys'); return Reflect.ownKeys(t); },
 getOwnPropertyDescriptor(t,k) { calls.push('desc:'+String(k)); return Reflect.getOwnPropertyDescriptor(t,k); }});
row('proxy', [...new Headers(proxy)]);
row('traps', calls);
`,
  },
  {
    name: 'clone-direct-stream',
    source: `${preamble}
const original = new Response('x'.repeat(16 * 1024 * 1024));
const copy = original.clone();
const drain = async (stream) => { let bytes=0; for await (const chunk of stream) bytes += chunk.length; return bytes; };
Promise.all([drain(original.body), drain(copy.body)])
 .then(values => row('clone', [values, original.bodyUsed, copy.bodyUsed])).catch(fail);
`,
  },
  {
    name: 'multipart-request-stream',
    source: `${preamble}
const form = new FormData();
form.set('file', new File(['z'.repeat(8 * 1024 * 1024)], 'z.txt'));
const request = new Request('http://example.test/', {method:'POST', body:form});
(async () => {
 let text=''; const decoder=new TextDecoder();
 for await (const chunk of request.body) text += decoder.decode(chunk, {stream:true});
 text += decoder.decode();
 const boundary=/boundary=(.*)/.exec(request.headers.get('content-type'))[1];
 row('multipart', [text.includes('--'+boundary+'--'), text.includes('filename="z.txt"'), text.includes('z'.repeat(8 * 1024 * 1024)), request.bodyUsed]);
})().catch(fail);
`,
  },
  {
    name: 'guest-stream-and-body-state',
    source: `${preamble}
(async () => {
 const stream = new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode('hello')); c.close();}});
 const response = new Response(stream);
 const reader = response.body.getReader();
 row('locked', [response.body === stream, response.body.locked, response.bodyUsed]);
 try { await response.text(); row('locked-read', 'accepted'); } catch(e) { row('locked-read', e.name); }
 row('chunk', new TextDecoder().decode((await reader.read()).value));
 reader.releaseLock();
 row('disturbed', response.bodyUsed);
 try { response.clone(); row('clone-used','accepted'); } catch(e) { row('clone-used',e.name); }
 try { await response.text(); row('reread','accepted'); } catch(e) { row('reread',e.name); }
 const r = new Request('http://example.test/', {method:'POST',body:'copy'});
 const copied = new Request(r);
 row('request-copy', [r.bodyUsed, await copied.text(), copied.bodyUsed]);
 const errorBody = new Response(new ReadableStream({start(c) {c.error(new Error('source failed'));}}));
 try {await errorBody.text();} catch(e) {row('source-error',e.message);}
 row('source-error-used',errorBody.bodyUsed);
 try {await errorBody.text(); row('source-reread','accepted');} catch(e) {row('source-reread',e.name);}
 row('guest-text', await new Response(new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode('done'));c.close();}})).text());
})().catch(fail);
`,
  },
  {
    name: 'pending-guest-source-exits',
    source: `${preamble}
row('top', true);
new Response(new ReadableStream({pull() {return new Promise(() => {});}}))
 .text().then(value => row('unexpected',value), fail);
`,
  },
  {
    // Node: every structured-clone surface refuses Fetch instances + markAsUncloneable tags.
    name: 'clone-uncloneable',
    source: `${preamble}
const fs = require('node:fs');
const path = require('node:path');
const { Worker, markAsUncloneable } = require('node:worker_threads');
const attempt = (label, fn) => { try { row(label, ['accepted', fn()]); } catch (e) { row(label, [e.name, e.message, e.code]); } };
class H extends Headers {}
const marked = {x:1}; markAsUncloneable(marked);
attempt('clone-headers', () => structuredClone(new Headers({a:'1'})));
attempt('clone-nested-response', () => structuredClone({a:[new Response('x')]}));
attempt('clone-request', () => structuredClone(new Request('http://example.test/')));
attempt('clone-formdata', () => structuredClone(new FormData()));
attempt('clone-map-headers', () => [...structuredClone(new Map([['k', new Headers()]]))]);
attempt('clone-getter', () => structuredClone({ get a() { return new Headers(); } }));
attempt('clone-subclass', () => structuredClone(new H()));
attempt('clone-marked', () => structuredClone(marked));
attempt('clone-control', () => structuredClone({x:1}));
attempt('clone-spoofed-tag', () => structuredClone({ [Symbol.toStringTag]: 'Date', h: new Headers() }));
attempt('clone-error-cause', () => structuredClone(new Error('x', { cause: new Headers() })));
attempt('clone-error-own-prop', () => Object.keys(structuredClone(Object.assign(new Error('x'), { h: new Headers() }))));
attempt('clone-guest-class', () => structuredClone(new (class G { constructor() { this.h = new Headers(); } })()));
attempt('clone-getter-once', () => { let reads = 0; structuredClone({ get a() { reads++; return 1; } }); return reads; });
attempt('clone-transfer-nested', () => { const buf = new ArrayBuffer(8); const out = structuredClone({ deep: { buf } }, { transfer: [buf] }); return [buf.byteLength, out.deep.buf.byteLength]; });
attempt('clone-shared-cycle-holes', () => { const s = {}; const c = { a: s, b: s, list: [1, , 3] }; c.self = c; const out = structuredClone(c); return [out.a === out.b, out.self === out, out.list.length, 1 in out.list]; });
row('keys', Object.keys(new Headers({a:'1'})));
attempt('port-postmessage', () => {
 const { port1, port2 } = new MessageChannel();
 try { port1.postMessage(new Headers()); return 'posted'; } finally { port1.close(); port2.close(); }
});
attempt('broadcast-postmessage', () => {
 const channel = new BroadcastChannel('rifty-clone-probe');
 try { channel.postMessage(new FormData()); return 'posted'; } finally { channel.close(); }
});
// Worker probes parentPort.postMessage, then reports through a cloneable message.
// File entry only: { eval: true } is a separate declared ceiling
// (NotImplementedError, backlog runtime-js/worker-eval-data-url-entry), not clone admission.
const workerSource = [
 "const { parentPort } = require('node:worker_threads');",
 "let probe; try { parentPort.postMessage(new Headers()); probe = ['accepted', 'posted']; } catch (e) { probe = [e.name, e.message, e.code]; }",
 'parentPort.postMessage({ probe });',
].join('\\n');
const probeWorker = (label, create) => new Promise((resolve) => {
 let worker;
 try { worker = create(); } catch (e) { row(label + '-create', [e.name, e.message, e.code]); resolve(); return; }
 const guard = setTimeout(() => { row(label + '-timeout', true); worker.terminate().then(resolve, resolve); }, 8000);
 worker.on('message', (message) => row(label + '-message', message));
 worker.on('error', (e) => row(label + '-error', [e.name, e.message, e.code]));
 worker.on('exit', (code) => { clearTimeout(guard); row(label + '-exit', code); resolve(); });
 attempt(label + '-postmessage', () => { worker.postMessage({ deep: { arr: [1, new Headers()] } }); return 'posted'; });
});
const workerFile = path.join(__dirname, 'clone-uncloneable-worker.cjs');
fs.writeFileSync(workerFile, workerSource);
probeWorker('worker-file', () => new Worker(workerFile)).catch(fail);
`,
  },
];

export function networkFetchCase(url: string): string {
  return `${preamble}
(async () => {
 const form=new FormData(); form.set('file', new File(['upload payload'], 'upload.txt'));
 const request=new Request(${JSON.stringify(url)}, {method:'POST', body:form});
 const response=await fetch(request);
 const copy=response.clone();
 row('network', [response instanceof Response, response.headers instanceof Headers, response.status, response.type, response.url === ${JSON.stringify(url)}, response.redirected]);
 const reader=response.body.getReader();
 try {await response.text(); row('network-locked','accepted');} catch(e) {row('network-locked',e.name);}
 let text=''; const decoder=new TextDecoder();
 for (;;) {const part=await reader.read(); if(part.done) break; text+=decoder.decode(part.value,{stream:true});}
 reader.releaseLock(); text+=decoder.decode();
 row('network-body',[text,await copy.text(),response.bodyUsed,copy.bodyUsed]);
 const cancelled=await fetch(${JSON.stringify(url)});
 const surviving=Response.prototype.clone.call(cancelled);
 const cancellation=cancelled.body.cancel();
 row('cancelled-branch',await Response.prototype.text.call(surviving));
 await cancellation;
 row('cancelled-state',[cancelled.bodyUsed,surviving.bodyUsed]);
 const redirected=await fetch(${JSON.stringify(`${url}/redirect`)});
 row('redirect-metadata',[redirected.status,redirected.statusText,redirected.url === ${JSON.stringify(`${url}/metadata`)},redirected.redirected,redirected.headers.get('x-fetch-proof'),await redirected.text()]);
 for(const mode of ['normal','closed','errored','locked','cancel-reject','closed-override','errored-override','public-cancel-throws','public-cancel-returns']) {
   const abortReason=new Error('preabort'),sourceError=new Error('source'),cancelError=new Error('cancel');
   const observed=[];const listener=error=>observed.push(error===cancelError?'cancel':error===sourceError?'source':error===abortReason?'abort':'other');
   process.on('unhandledRejection',listener);
   const pre=new AbortController();pre.abort(abortReason);
   let pulls=0,stream,witness;const cancellations=[];const blob=new Blob(['x']);
   blob.stream=()=>{stream=new ReadableStream({
     start(c){if(mode.startsWith('errored'))c.error(sourceError);if(mode.startsWith('closed'))c.close();},
     pull(c){pulls++;c.enqueue(Uint8Array.of(65));c.close();},
     cancel(reason){cancellations.push(reason===abortReason);if(mode==='cancel-reject')return Promise.reject(cancelError);},
   });witness=new Response(stream);
     if(mode.endsWith('override')||mode.startsWith('public-cancel'))stream.cancel=reason=>{cancellations.push(reason===abortReason);if(mode==='public-cancel-throws')throw cancelError;if(mode==='public-cancel-returns')return undefined;return Promise.resolve();};
     if(mode==='locked')stream.getReader();return stream;};
   try {await fetch(${JSON.stringify(url)},{method:'POST',headers:{cookie:'a=1'},body:blob,signal:pre.signal});row('preabort-'+mode,'accepted');}
   catch(error){row('preabort-'+mode,[error===abortReason,error===cancelError,error.name]);}
   await new Promise(resolve=>setTimeout(resolve,20));
   row('preabort-state-'+mode,[pulls,cancellations,stream.locked,witness.bodyUsed,observed]);
   process.off('unhandledRejection',listener);
 }
 const controller=new AbortController(); controller.abort();
 try {await fetch(${JSON.stringify(url)}, {signal:controller.signal});} catch(e) {row('abort',e.name);}
 const active = new AbortController();
 const slow = await fetch(${JSON.stringify(`${url}/slow`)}, {signal:active.signal});
 const read = slow.text();
 active.abort();
 try {await read; row('active-abort','accepted');} catch(e) {row('active-abort',e.name);}
 const uploading = new AbortController();
 const blob=new Blob(['x']); let finishUpload;
 blob.stream=()=>new ReadableStream({start(c){finishUpload=()=>c.close();}});
 const upload=fetch(${JSON.stringify(url)},{method:'POST',body:blob,signal:uploading.signal});
 uploading.abort();
 const guard=setTimeout(()=>{row('upload-abort-late',true);finishUpload();},1000);guard.unref();
 try {await upload;} catch(e) {row('upload-abort',e.name);}
 clearTimeout(guard);
 {
   const controller=new AbortController(),reason=new Error('active upload');
   let pulls=0,cancels=0,finish;const finished=new Promise(resolve=>{finish=resolve;});
   const blob=new Blob([new Uint8Array(30)]);
   blob.stream=()=>new ReadableStream({async pull(c){
     await new Promise(resolve=>setTimeout(resolve,5));pulls++;
     if(pulls===4)controller.abort(reason);
     if(cancels===0){c.enqueue(Uint8Array.of(pulls));if(pulls===30){c.close();finish();}}
   },cancel(){cancels++;finish();}});
   try{await fetch(${JSON.stringify(url)},{method:'POST',body:blob,signal:controller.signal});}
   catch(error){row('active-upload-abort',error===reason);}
   await finished;row('active-upload-source',[pulls,cancels]);
 }
 const urlDescriptor=Object.getOwnPropertyDescriptor(Request.prototype,'url');
 Object.defineProperty(Request.prototype,'url',{configurable:true,get(){throw new Error('public url getter');}});
 try {row('private-request',await (await fetch(${JSON.stringify(url)})).text());}
 finally {Object.defineProperty(Request.prototype,'url',urlDescriptor);}
 try {await fetch(${JSON.stringify(`${url}/disconnect`)});} catch(e) {row('connection-error',e.name);}
})().catch(fail);
`;
}
