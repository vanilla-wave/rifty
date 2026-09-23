# Process stdio pipe evidence — 2026-09-23

Node v24.16.0 oracle, same operations as the physical parity case:

```text
node -e 'const {Readable}=require("node:stream");const out=require("node:process").stdout;Readable.from(["first|"]).pipe(out);setTimeout(()=>out.write("second\n"),5)'
first|second

node -e 'const {Readable}=require("node:stream");const err=require("node:process").stderr;Readable.from(["first|"]).pipe(err);setTimeout(()=>err.write("second\n"),5)'
first|second

node -e 'const {Readable,Writable}=require("node:stream");const sink=new Writable({write(_c,_e,cb){cb()}});sink.fd=1;sink.on("finish",()=>console.log("lookalike-finished",sink.writableEnded));Readable.from(["x"]).pipe(sink)'
lookalike-finished true

node -e 'const {Readable}=require("node:stream");const {EventEmitter}=require("node:events");const source=new Readable({read(){}});const sink=new EventEmitter();sink.fd=1;sink.write=()=>true;source.pipe(sink);try{source.emit("end");console.log("no-throw")}catch(error){console.log(error.name,error.message)}'
TypeError dest.end is not a function
```

Before product change:

```text
node --import tsx tools/node-parity-runner/src/cli.ts pipe-process-stdio
node-parity-runner: 1 case(s) matching 'pipe-process-stdio'
  ✗ stream/pipe-process-stdio.case.ts
    Node stdout: first|second\n; exit 0
    rifty stdout: first|; stderr: TypeError: dest.end is not a function
    Node stderr: first|second\n; exit 0
    rifty stderr: first|TypeError: dest.end is not a function; exit 1
    fd=1 ordinary Writable: lookalike-finished true; exit 0 in both
    fd=1 foreign sink without end: TypeError dest.end is not a function in both
1 case(s) failed
```

## Forged global defect — 2026-09-23

Node v24.16.0 and rifty, same foreign sink with no `end()`:

```text
node <<'EOF'
const real = require('node:process');
const foreign = new (require('node:events').EventEmitter)();
foreign.write = () => true;
const original = globalThis.process;
globalThis.process = { stdout: foreign };
const source = new (require('node:stream').Readable)({ read() {} });
source.pipe(foreign);
let outcome;
try { source.emit('end'); outcome = 'no-throw'; }
catch (error) { outcome = error.name + ': ' + error.message; }
globalThis.process = original;
real.stdout.write(outcome + '\n');
EOF

Node: TypeError: dest.end is not a function
rifty before repair: no-throw
```

The matching stderr variant has the same result. Under the forged global,
`Readable.from(['first|']).pipe(real.stdout)` followed by a later
`real.stdout.write('second\n')` yields `first|second\n` on Node, but rifty
before repair throws `TypeError: dest.end is not a function`. Same for stderr.

Node v24.16.0 current-owner probe (output `{"new":"no-throw","oldEnded":true}`):

```text
node <<'EOF'
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const real = require('node:process');
const fs = require('node:fs');
const descriptor = Object.getOwnPropertyDescriptor(real, 'stdout');
const old = real.stdout;
const foreign = new EventEmitter();
foreign.write = () => true;
Object.defineProperty(real, 'stdout', { value: foreign, writable: true, configurable: true });
const source = new Readable({ read() {} });
source.pipe(foreign);
let outcome;
try { source.emit('end'); outcome = 'no-throw'; }
catch (error) { outcome = error.name + ': ' + error.message; }
const staleSource = new Readable({ read() {} });
staleSource.pipe(old);
staleSource.emit('end');
Object.defineProperty(real, 'stdout', descriptor);
fs.writeSync(1, JSON.stringify({ new: outcome, oldEnded: old.writableEnded }) + '\n');
EOF
```

Thus an all-writers WeakSet is insufficient.

Physical parity RED, before source repair:

```text
node --import tsx tools/node-parity-runner/src/cli.ts pipe-process-stdio
  ✗ stream/pipe-process-stdio.case.ts
    forged-stdout: Node TypeError: dest.end is not a function; rifty no-throw
    forged-stderr: Node TypeError: dest.end is not a function; rifty no-throw
    real stdout under forged global: Node first|second; rifty first| + TypeError
    real stderr under forged global: Node first|second; rifty first| + TypeError
1 case(s) failed
```
