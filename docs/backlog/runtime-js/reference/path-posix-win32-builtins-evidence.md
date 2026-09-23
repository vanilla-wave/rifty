# path/posix subpath evidence — 2026-09-23

Host Node v24.16.0. Same source shapes as the two parity cases:

```text
node -e 'const p=require("node:path");const s=require("node:path/posix");const b=require("path/posix");const m=require("node:module");console.log(JSON.stringify({nodeIdentity:s===p.posix,bareIdentity:b===s,isBuiltin:m.isBuiltin("node:path/posix"),joined:s.join("a","b")}))'
{"nodeIdentity":true,"bareIdentity":true,"isBuiltin":true,"joined":"a/b"}

node --input-type=module -e 'import p from "node:path";import s,{join} from "node:path/posix";console.log(JSON.stringify({defaultIdentity:s===p.posix,namedIdentity:join===s.join,joined:join("a","b")}))'
{"defaultIdentity":true,"namedIdentity":true,"joined":"a/b"}
```

Before product change, the exact parity cases run against real Node and rifty:

```text
node --import tsx tools/node-parity-runner/src/cli.ts posix-subpath
node-parity-runner: 2 case(s) matching 'posix-subpath'
  ✗ path/posix-subpath-cjs.case.ts
    error: ModuleLoadError: Built-in 'node:path/posix' is not implemented
  ✗ path/posix-subpath-esm.case.ts
    error: ModuleLoadError: Built-in 'node:path/posix' is not implemented
2 case(s) failed
```

Node v24.16.0: `require('node:path/win32') === require('node:path').win32` is
`true`, while `path.win32 === path.posix` is `false`. In rifty today the latter
is `true`; registering the existing win32 alias would add a misleading module.
