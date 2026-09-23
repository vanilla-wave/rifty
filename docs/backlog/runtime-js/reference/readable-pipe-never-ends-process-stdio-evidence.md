# Process stdio pipe evidence — 2026-09-23

Node v24.16.0 oracle, same operations as the physical parity case:

```text
node -e 'const {Readable}=require("node:stream");const out=require("node:process").stdout;Readable.from(["first|"]).pipe(out);setTimeout(()=>out.write("second\n"),5)'
first|second

node -e 'const {Readable}=require("node:stream");const err=require("node:process").stderr;Readable.from(["first|"]).pipe(err);setTimeout(()=>err.write("second\n"),5)'
first|second

node -e 'const {Readable,Writable}=require("node:stream");const sink=new Writable({write(_c,_e,cb){cb()}});sink.fd=1;sink.on("finish",()=>console.log("lookalike-finished",sink.writableEnded));Readable.from(["x"]).pipe(sink)'
lookalike-finished true
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
1 case(s) failed
```
