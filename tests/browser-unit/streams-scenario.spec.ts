import { type Page, expect, test } from '@playwright/test';
import {
  BROWSER_SKIPPED_ROWS,
  CARRIER,
  MATRICES,
  type Program,
  RELOADED,
  WORKBENCH_SKIPPED,
  entryOf,
  inNode,
  manifest,
  programFile,
  sha256Entry,
  skipArgs,
  verdict,
  workspace,
} from '../../packages/isolate-host/tests/streams-scenario.ts';
import {
  type Observed,
  type Pin,
  browserMasks,
  pinOf,
} from '../../packages/isolate-host/tests/zlib-scenario.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
} from './fixtures.ts';
import { STEP_URL, UNPACK, serveSteps } from './fixtures/zlib-scenario.ts';

// node-streams goal carrier (backlog epics/node-streams-as-in-node/map.md item 0), COI Workbench
// host (kernel child `node`, Chromium). Each case has its own page, owner and directory: the
// program's files unpacked by a guest `node` to `/tmp/s<id>` (the zlib carrier's helpers; out of
// the project tree, whose size a guest write's cost grows with), run by a rifty `node` runner that
// spawns `node <program>` with piped stdio, against live `node <program>` over the same files.
// Today's outcome pinned whole per program; the owning unit compares with Node.

/**
 * `node srun.cjs <dir> <program> [args]`: the child's stdio and exit code, then each written file (outside
 * `node_modules`, the program excepted): a reloaded one's bytes (base64), any other's sha256 by
 * the guest's `crypto` (a 16 MiB file through the terminal costs more than the run).
 */
const RUNNER = `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [dir, program, ...args] = process.argv.slice(2);
const cwd = path.resolve(dir);
const child = spawn('node', [program, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
// Echoed as it comes, so a run stopped at its cap still shows the rows it printed.
child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; process.stdout.write(c); });
child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
child.on('close', (exitCode) => {
  const files = {};
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(cwd, rel)).sort()) {
      const p = rel === '' ? name : rel + '/' + name;
      if (p === 'node_modules' || p === program) continue;
      if (fs.statSync(path.join(cwd, p)).isDirectory()) walk(p);
      else {
        const b = fs.readFileSync(path.join(cwd, p));
        files[p] = ${RELOADED}.test(p)
          ? { base64: b.toString('base64') }
          : { sha256: require('node:crypto').createHash('sha256').update(b).digest('hex') };
      }
    }
  };
  walk('');
  process.stdout.write('@@SS' + JSON.stringify({ stdout, stderr, exitCode, files }) + 'SS@@\\n');
});
`;

/** Today's outcome, measured on main d19d891b9: whole stderr under `browserMasks`. A guard has none. */
const PINS: Readonly<Record<string, Pin>> = {
  'c-xlsx-roundtrip': {
    exitCode: 0,
    stdout: `writeBuffer ok 
readFile threw TypeError: stream.close is not a function
`,
    stderr: '',
    output: `in.xlsx values [["Revenue",[[null,"Region","Revenue"],[null,"North",120],[null,"South",95]]]]
`,
  },
  'c-csv-read': {
    exitCode: 0,
    stdout: `csv threw TypeError: stream.close is not a function
`,
    stderr: '',
    output: `in.csv sha256 69e3f7d86e55a164d25cc34e15e3102daf7cd40f67b98913016cbfafcfe98d09
`,
  },
  'c-graceful-fs': {
    exitCode: 0,
    stdout: `createWriteStream threw TypeError: Class constructor FileWriteStream cannot be invoked without 'new'
`,
    stderr: '',
    output: null,
  },
  'c-unzip-stored': {
    exitCode: 0,
    stdout: `close, then listing threw Error [ENOENT]: ENOENT: no such file or directory, scandir '/tmp/sc-unzip-stored/unz'
`,
    stderr: '',
    output: `a.zip entries a.txt=eb06cb57b0a7944a5fdd77b42dc87f454b57a87c6c11d32a10edcd710d9d3d03 dir/b.txt=0f882365d720e9c4fc399ff41f81728abe2196760810a9da2f7913759d05207b
`,
  },
  'c-for-await': {
    exitCode: 0,
    stdout: `for-await threw TypeError: fs.createReadStream(...) is not a function or its return value is not async iterable
`,
    stderr: '',
    output: `in.bin sha256 d08928a168952dcd1f23061570816ee3b9d5c5c01ec65e00adbda68d328f4dbb
`,
  },
  'c-late-listener': {
    exitCode: 0,
    stdout: `exit bytes 0 end false
`,
    stderr: '',
    output: `in.txt sha256 91e3faafd322bcdf160f3f0ce886acb092b9b9e2a1e8526b40f21a8898a8700b
`,
  },
  'c-readable-read': {
    exitCode: 0,
    stdout: `exit bytes 0 end true
`,
    stderr: '',
    output: `in.txt sha256 24f3158d242f72ab36abd6ff23fa6b7c05c338c77a2666b97ac123d76b661f46
`,
  },
  'c-pipeline-asyncgen': {
    exitCode: 0,
    stdout: `pipeline threw TypeError: pipeline: argument must be a stream (index 1 received a non-stream value)
`,
    stderr: '',
    output: `in.txt sha256 dc77b5b303347f6c9ee23a7acd7f618144e8d318df793b27017c9afff9a031f5
out.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
`,
  },
  'm1-lifecycle': {
    exitCode: 0,
    stdout: `Writable _write cb twice => 
Writable _final cb twice => prefinish,prefinish,finish,close
Transform _transform cb twice => data x,data y
Writable _construct cb twice => 
Writable _destroy cb twice => close
Readable destroy(err): sync destroyed/errored => sync destroyed=true errored=undefined,error boom,close
Readable _destroy replaces error => error orig,close
Readable _construct before _read => read,end
zlibBuffer shape: end(buf) -> data/end -> close() -> _destroy => prefinish,data ab,finish,end,close,close cb
zlibOnError shape: destroy(err) inside _transform => error Z_DATA_ERROR:invalid,close
Readable to end + Writable ended: close after end/finish => W finish,W close,R end
closed/destroyed/errored after destroy(err), each class => sync Readable:undefined/true/undefined Writable:false/true/undefined Duplex:undefined/true/undefined Transform:undefined/true/undefined,later Readable:undefined/true Writable:true/true Duplex:undefined/true Transform:undefined/true
async Transform success: destroyed at end/finish/close => finish destroyed=false closed=undefined,end destroyed=false closed=undefined
prototype _destroy is a function => undefined,undefined,undefined,undefined
`,
    stderr: '',
    output: null,
  },
  'm2-core-members': {
    exitCode: 0,
    stdout: `Readable readableFlowing/isPaused: new, on(data), pause, resume => new undefined/no isPaused,on(data) undefined/no isPaused,pause undefined/no isPaused,resume undefined/no isPaused
fs.ReadStream readableFlowing/isPaused: new, on(data), pause, resume => new undefined/no isPaused,on(data) undefined/no isPaused,threw r.pause is not a function
Writable writableNeedDrain below/over hwm, after drain => start undefined,below undefined,over undefined,drain undefined
Duplex writableNeedDrain => start undefined,below undefined,over undefined,drain undefined
fs.WriteStream writableNeedDrain => start undefined,below undefined,over undefined,drain undefined
Symbol.asyncDispose / Symbol.dispose on each class prototype => Readable:undefined/undefined Writable:undefined/undefined Duplex:undefined/undefined Transform:undefined/undefined PassThrough:undefined/undefined
await r[Symbol.asyncDispose](): destroyed, errored => no asyncDispose
`,
    stderr: '',
    output: `m.out sha256 bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721
m.txt sha256 d69e68988157833272305aaf21f453c800346e8a3640db6578e260215542e5d4
`,
  },
  'm3-legacy-stream': {
    exitCode: 0,
    stdout: `prototype chain => Readable:false Writable:false Duplex:false Transform:false PassThrough:false,Stream->EE:true
instanceof Stream => false,false,false,false
fs streams instanceof Stream => false,false
Stream.prototype.pipe is the legacy pipe => undefined,true
`,
    stderr: '',
    output: `l.out sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
l.txt sha256 acac86c0e609ca906f632b0e2dacccb2b77d22b0621f20ebece1a4835b93f6f0
`,
  },
  'm4-readstream': {
    exitCode: 0,
    stdout: `instanceof Readable; prototype chain; isReadable => false,false,
member types => pause:undefined resume:undefined read:undefined setEncoding:undefined unpipe:undefined unshift:undefined wrap:undefined push:undefined iterator:undefined map:undefined filter:undefined toArray:undefined close:undefined destroy:function pipe:function _read:undefined _destroy:undefined _construct:undefined open:undefined,asyncIterator:undefined
property values at create => readable=undefined readableLength=undefined readableHighWaterMark=undefined readableEncoding=undefined readableEnded=undefined readableObjectMode=undefined destroyed=false closed=undefined errored=undefined pending=undefined bytesRead=undefined fd=undefined flags=undefined mode=undefined start=[Function: start] end=undefined autoClose=undefined
property values at end => threw rs.resume is not a function
ReadStream(path) without new => threw Class constructor FileReadStream cannot be invoked without '
graceful-fs shape: ReadStream.apply(this) + prototype open override => threw Class constructor FileReadStream cannot be invoked without '
class extends fs.ReadStream => "hello"
paused buffer: no listener 30ms, then readableLength and data => readableLength=undefined,no settle in 3s
uncaught 1 => rs.pause is not a function
pause in first data, resume after 20ms => no settle in 3s
setEncoding utf8, highWaterMark 5, split code points => threw rs.setEncoding is not a function
encoding option base64 / utf16le / latin1 with highWaterMark 4 (decoder across chunks) => base64:threw fs.createReadStream(...) is not a function or its return val,utf16le:threw fs.createReadStream(...) is not a function or its return val,latin1:threw fs.createReadStream(...) is not a function or its return val,hex:threw fs.createReadStream(...) is not a function or its return val
encoding option through 'data' (no for await): base64 / utf16le / latin1 / hex, highWaterMark 4 => base64:YQBi|AGMA|ZABlAGYA|ZwBo|AGkA|agDpAP8A|AAE9|2ADe|IQA=,utf16le:ab|cd|ef|gh|ij|éÿ|Ā�|�!,latin1:a\u0000b\u0000|c\u0000d\u0000|e\u0000f\u0000|g\u0000h\u0000|i\u0000j\u0000|é\u0000ÿ\u0000|\u0000\u0001=Ø|\u0000Þ!\u0000,hex:61006200|63006400|65006600|67006800|69006a00|e900ff00|00013dd8|00de2100
read(3) sized reads => 
for await break: destroy and close => threw rs is not async iterable,close
timers run while 16 MiB streams (for await) => threw fs.createReadStream(...) is not a function or its return val
timers run during an fs.read(fd) loop over 16 MiB (the fd source alone) => bytes=16777216,ticks>0=false
uncaught 2 => rs.close is not a function
close(cb) mid-read => 
destroy(err): error then close, errored => close errored=undefined
pipe to slow Writable: max dest writableLength => max<=128KiB=false,max=300000
missing file: error code and close => error ENOENT,close
Node's ReadStream source: fs.open + fs.read(fd) + fs.close callbacks => fd=number,read=5,"hello"
Readable.from(fs.ReadStream) / toArray => threw Readable.from: the "iterable" argument must implement Symbol
`,
    stderr: '',
    output: `r-16m.bin sha256 b70a752bfdf8d3446d286dc7562cc34093f611be1c88867c062b35b442b0bd04
r-big.txt sha256 29aa987eab9aee830fdd20595bcedef67e8674f4eeac6f017598e7ff8719da23
r-enc.bin sha256 659f67ac449bcc74051a0286790862c2b0735d381ca6a1e5cd29af7a8b3d9e32
r-enc2.bin sha256 659f67ac449bcc74051a0286790862c2b0735d381ca6a1e5cd29af7a8b3d9e32
r-utf8.txt sha256 322feef3144cd0e5187e89584c64eb82308d2e87cc08c099f30798c71bcd4bd8
r.txt sha256 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
`,
  },
  'm5-writestream': {
    exitCode: 0,
    stdout: `instanceof Writable; prototype chain; isWritable => false,false,
member types => write:function end:function cork:undefined uncork:undefined setDefaultEncoding:undefined destroy:function close:undefined destroySoon:undefined _write:undefined _writev:undefined _final:undefined _destroy:undefined _construct:undefined open:function
property values at create => writable=undefined writableLength=undefined writableHighWaterMark=undefined writableEnded=undefined writableFinished=undefined writableCorked=undefined writableObjectMode=undefined destroyed=false closed=undefined errored=undefined pending=undefined bytesWritten=undefined fd=undefined flags={ append: false, exclusive: false, truncate: true, mustExist: false } mode=undefined start=undefined pos=0 autoClose=undefined
property values after end => writable=undefined writableLength=undefined writableHighWaterMark=undefined writableEnded=undefined writableFinished=undefined writableCorked=undefined writableObjectMode=undefined destroyed=false closed=undefined errored=undefined pending=undefined bytesWritten=undefined fd=undefined flags={ append: false, exclusive: false, truncate: true, mustExist: false } mode=undefined start=undefined pos=3 autoClose=undefined
WriteStream(path) without new => threw Class constructor FileWriteStream cannot be invoked without 
graceful-fs shape: WriteStream.apply(this) + prototype open override => threw Class constructor FileWriteStream cannot be invoked without 
class extends fs.WriteStream => "cls"
write() returns false over highWaterMark, then drain => w1=true,w2=false,drain
cork/uncork: one file content => threw ws.cork is not a function
event order end(cb): finish/close/cb => open,ready,end cb,finish,close
close(cb) before end: pending writes land => threw ws.close is not a function
write after end: callback and error => cb ERR_STREAM_WRITE_AFTER_END:write after end,error ERR_STREAM_WRITE_AFTER_END:write after end
destroy(err): error, close, errored => close errored=undefined
timers run while a WriteStream writes 16 MiB in 64 KiB chunks => skipped
Readable.pipe(ws) with slow source: bytes and finish => finish,close,"123"
`,
    stderr: '',
    output: `w0.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
w1.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
w10.txt sha256 6ca7ea2feefc88ecb5ed6356ed963f47dc9137f82526fdd25d618ea626d0803f
w11.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
w12.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
w13.txt sha256 a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3
w2.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
w3.txt sha256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
w6.txt sha256 84cdb981037648c41f06dea25de7dcb2f26c5b965a47e8e2cc44b33e0412ad66
w7.txt sha256 bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721
w8.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
w9.txt sha256 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881
`,
  },
  'm6-transform-duplex': {
    exitCode: 0,
    stdout: `Transform objectMode hwm 2, 8 writes, nobody reads => true true true true true true true true,transformCalls=8,readableLength=8,writableLength=0
Transform bytes: writes of 1 KiB until write() is false (cap 1000) => acceptedBeforeFalse=1000,transformCalls=1000,readableLength=1024000
PassThrough -> slow Writable, producer honors write(): max PassThrough buffer => max<=256KiB=false,max=1048576
Transform event order end("x") => T,F,prefinish,data,finish,end
Duplex event order end("x") with readable ended => finish,data,end
Duplex writable members => undefined undefined undefined,corked=undefined
per-side objectMode options => T.writableObjectMode=false,T.writableHighWaterMark=65536,PT.readableObjectMode=false
allowHalfOpen false: readable end ends writable => end,finish
`,
    stderr: '',
    output: null,
  },
  'm7-pipeline-stages': {
    exitCode: 0,
    stdout: `promises.pipeline(Readable, async gen, Writable) => threw pipeline: argument must be a stream (index 1 received a non-
promises.pipeline(async gen source, Writable) => threw pipeline: argument must be a stream (index 0 received a non-
promises.pipeline(Readable, async fn sink) returns value => no settle in 3s
callback pipeline(Readable, async gen, Writable) => threw pipeline: argument must be a stream (index 1 received a non-
async gen stage throws: error reaches callback => threw pipeline: argument must be a stream (index 1 received a non-
pipeline(Readable, PassThrough, Writable) success cb args => w z,cb args=1 null
finished(readable) success cb args => cb args=1
finished on a Writable destroyed before any write => cb args=1 
finished on a Readable destroyed before end => cb args=1 
finished on a Transform destroyed after a write => cb args=1 
close(cb)-shape (finished + destroy) on a Transform that already errored => 
`,
    stderr: '',
    output: null,
  },
  'm8-constructor-options': {
    exitCode: 0,
    stdout: `options highWaterMark -1 => Readable:ok hwm=-1/- Writable:ok hwm=-/-1 Duplex:ok hwm=-1/-1 Transform:ok hwm=-1/-1
options highWaterMark NaN => Readable:ok hwm=NaN/- Writable:ok hwm=-/NaN Duplex:ok hwm=NaN/NaN Transform:ok hwm=NaN/NaN
options highWaterMark "16" => Readable:ok hwm=16/- Writable:ok hwm=-/16 Duplex:ok hwm=16/16 Transform:ok hwm=16/16
options highWaterMark 1.5 => Readable:ok hwm=1.5/- Writable:ok hwm=-/1.5 Duplex:ok hwm=1.5/1.5 Transform:ok hwm=1.5/1.5
options readableHighWaterMark -1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options writableHighWaterMark -1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options signal 1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options signal {} => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options encoding "nope" => Readable:ERR_UNKNOWN_ENCODING Writable:ok hwm=-/65536 Duplex:ERR_UNKNOWN_ENCODING Transform:ERR_UNKNOWN_ENCODING
options defaultEncoding "nope" => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options read 1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options write 1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options transform 1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options destroy 1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
options construct 1 => Readable:ok hwm=65536/- Writable:ok hwm=-/65536 Duplex:ok hwm=65536/65536 Transform:ok hwm=65536/65536
write(chunk, '', cb): empty encoding (zlib's flush() passes '') => threw ERR_UNKNOWN_ENCODING:Unknown encoding: 
`,
    stderr: '',
    output: null,
  },
  'm9-abort-stop-propagation': {
    exitCode: 0,
    stdout: `promises.pipeline(r, w, {signal}), abort after a stopping listener => threw TypeError
finished(r, {signal}) after a stopping listener => pending
addAbortSignal(signal, r) after a stopping listener => destroyed=false
readable.map(fn, {signal}) after a stopping listener => pending
readable.reduce(fn, init, {signal}) after a stopping listener => ABORT_ERR
`,
    stderr: '',
    output: null,
  },
  'm10-abort-order-leak': {
    exitCode: 1,
    stdout: `a guest abort listener added after pipeline sees the source destroyed => threw TypeError
listeners left on the signal after 10000 completed reduce({signal}) => listeners=n/a
`,
    stderr: `Uncaught TypeError: cb is not a function (<dev-server>/packages/io/src/streams/pipeline.ts:<line>)
`,
    output: null,
  },
  'w1-fs-windows': {
    exitCode: 0,
    stdout: `ws instanceof Writable / isWritable => false,
callback pipeline(rs, ws): cb, destroyed/closed, bytes => cb none,destroyed=false,closed=undefined,bytes=100000
callback pipeline(rs, PassThrough, ws): cb, bytes => cb none,bytes=100000
promises.pipeline(rs, async gen, ws) => threw TypeError
ws.destroy(err) mid-pipe: error event on ws => 
late finished(ws) after close => no cb
`,
    stderr: '',
    output: `win-0.out sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
win-1.out sha256 0af6d7a00b4c067cea9f902fe29603150d22434d95c503525e2db5bb625e81d2
win-2.out sha256 0af6d7a00b4c067cea9f902fe29603150d22434d95c503525e2db5bb625e81d2
win-3.out sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
win-4.out sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
win-5.out sha256 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881
win.txt sha256 0af6d7a00b4c067cea9f902fe29603150d22434d95c503525e2db5bb625e81d2
`,
  },
  'b1-bindings': {
    exitCode: 0,
    stdout: `Buffer.isEncoding per name => utf8:true UTF8:true utf-8:true UTF-8:true Utf8:true ucs2:true UCS2:true ucs-2:true utf16le:true UTF16LE:true utf-16le:true latin1:true LATIN1:true binary:true BINARY:true base64:true BASE64:true base64url:true hex:true HEX:true ascii:true ASCII:true nope:false '':false
buf.toString(name) per name => utf8:41fd00fdfd UTF8:41fd00fdfd utf-8:41fd00fdfd UTF-8:41fd00fdfd Utf8:41fd00fdfd ucs2:4100 UCS2:4100 ucs-2:4100 utf16le:4100 UTF16LE:4100 utf-16le:4100 latin1:41e900ff80 LATIN1:41e900ff80 binary:41e900ff80 BINARY:41e900ff80 base64:51656b412f34413d BASE64:51656b412f34413d base64url:51656b415f3441 hex:34316539303066663830 HEX:34316539303066663830 ascii:4169007f00 ASCII:4169007f00 nope:threw TypeError ERR_UNKNOWN_ENCODING: Unknown encoding: nope '':threw TypeError ERR_UNKNOWN_ENCODING: Unknown encoding: 
Buffer.from(str, name) per name => utf8:41c3a9 UTF8:41c3a9 utf-8:41c3a9 UTF-8:41c3a9 Utf8:41c3a9 ucs2:4100e900 UCS2:4100e900 ucs-2:4100e900 utf16le:4100e900 UTF16LE:4100e900 utf-16le:4100e900 latin1:41e9 LATIN1:41e9 binary:41e9 BINARY:41e9 base64: BASE64: base64url: hex: HEX: ascii:41e9 ASCII:41e9 nope:threw TypeError ERR_UNKNOWN_ENCODING: Unknown encoding: nope '':41c3a9
new StringDecoder(name).write+end per name => utf8:41fd00fdfd UTF8:41fd00fdfd utf-8:41fd00fdfd UTF-8:41fd00fdfd Utf8:41fd00fdfd ucs2:4100 UCS2:4100 ucs-2:4100 utf16le:4100 UTF16LE:4100 utf-16le:4100 latin1:41e900ff80 LATIN1:41e900ff80 binary:41e900ff80 BINARY:41e900ff80 base64:51656b412f34413d BASE64:51656b412f34413d base64url:51656b415f3441 hex:34316539303066663830 HEX:34316539303066663830 ascii:4169007f00 ASCII:4169007f00 nope:threw TypeError ERR_UNKNOWN_ENCODING: Unknown encoding: nope '':41fd00fdfd
events.addAbortListener => typeof=function,aborted,disposable=function
fs.writev / fs.fsync / fs.writevSync / fs.fsyncSync types => writev:undefined fsync:undefined writevSync:undefined fsyncSync:undefined fdatasync:undefined
fs.read callback vs a timer due now => timer,read cb,immediate
fs.write then fs.close in the same tick: bytes land => write cb ok,close cb ok,"data"
`,
    stderr: '',
    output: `b.txt sha256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
w.txt sha256 3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7
`,
  },
};

/** A run's cap, below the test's: a run past it fails naming the last row it printed. */
const RUN_CAP_MS = 200_000;

const root = process.cwd().replaceAll('\\', '/');

/** The program's run in a fresh Workbench on `page`, its written files read back by the runner. */
async function inWorkbench(page: Page, p: Program, args: readonly string[]): Promise<Observed> {
  await serveSteps(page, () => new Map([[p.id, { files: workspace(p) }]]));
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: `bu-streams-${p.id}`,
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await page.evaluate(
      async ({ fixtureUrl, text, url }) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        await fixture.writeProjectText('/scratch/srun.cjs', text.runner);
        await fixture.writeProjectText('/scratch/zunpack.cjs', text.unpack);
        const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
        await fixture.currentProject().files.writeFile('/s.bin', body, { expectedVersion: null });
      },
      {
        fixtureUrl: sealedWorkbenchFixtureUrl,
        text: { runner: RUNNER, unpack: UNPACK },
        url: `${STEP_URL}${p.id}`,
      },
    );
    const dir = `/tmp/s${p.id}`;
    const unpack = await execLine(page, `node zunpack.cjs s.bin ${dir}`);
    expect(unpack.exit, unpack.out).toBe(0);
    const line = [`node srun.cjs ${dir} ${programFile(p)}`, ...args].join(' ');
    const run = await page.evaluate(
      async ({ fixtureUrl, line, cap }) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        const terminal = fixture.currentProject().terminals.open();
        let out = '';
        const detach = terminal.attach((c: string) => {
          out += c;
        });
        try {
          const r = terminal.run(line);
          const first = await Promise.race([
            r.exited,
            new Promise((res) => setTimeout(() => res('cap'), cap)),
          ]);
          if (first === 'cap') await r.stop();
          await r.close();
          return { capped: first === 'cap', out };
        } finally {
          detach();
        }
      },
      { fixtureUrl: sealedWorkbenchFixtureUrl, line, cap: RUN_CAP_MS },
    );
    if (run.capped) {
      const rows = run.out.split(/\r?\n/).filter((l) => l.includes(' => ') && !l.includes('@@SS'));
      throw new Error(
        `${p.id}: no exit within ${RUN_CAP_MS / 1000} s; last row printed: ${rows.at(-1) ?? '(none)'}; the row after it did not finish`,
      );
    }
    const json = /@@SS(.*)SS@@/su.exec(run.out)?.[1];
    if (json === undefined) throw new Error(`runner printed no result\n${run.out}`);
    const r = JSON.parse(json) as {
      stdout: string;
      stderr: string;
      exitCode: number | null;
      files: Record<string, { base64: string } | { sha256: string }>;
    };
    const entries = await Promise.all(
      Object.entries(r.files).map(
        async ([path, f]) =>
          [
            path,
            'sha256' in f
              ? sha256Entry(f.sha256)
              : await entryOf(path, Buffer.from(f.base64, 'base64')),
          ] as const,
      ),
    );
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, output: manifest(entries) };
  } finally {
    await closeOwner(page);
  }
}

test.describe('node-streams goal scenario vs Node (COI Workbench)', () => {
  for (const p of [...CARRIER, ...MATRICES]) {
    const skipped = WORKBENCH_SKIPPED[p.id];
    const rows = BROWSER_SKIPPED_ROWS[p.id] ?? [];
    const title = [verdict(p), ...rows.map((r) => `row «${r.row}» skipped ${r.why}`)].join('; ');
    test(`${p.id} ${p.title} — ${skipped ?? title}`, async ({ page }) => {
      test.skip(skipped !== undefined, skipped);
      test.setTimeout(300_000);
      const args = skipArgs(rows);
      const node = pinOf(await inNode(p, args));
      const rifty = pinOf(await inWorkbench(page, p, args), browserMasks(root));
      const pin = PINS[p.id];
      expect(pin === undefined, 'a pin exactly when an owner is named').toBe(p.owners.length === 0);
      if (pin === undefined) return expect(rifty).toEqual(node);
      expect(rifty).toEqual(pin);
      expect(rifty, 'the pin is a gap against live Node').not.toEqual(node);
    });
  }
});
