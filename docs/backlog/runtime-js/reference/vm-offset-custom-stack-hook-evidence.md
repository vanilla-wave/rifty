# VM offsets after a custom stack hook

2026-09-23, Node v24.16.0 versus rifty after ADR-0450 implementation. From the repo root:

```sh
node --import tsx --input-type=module <<'JS'
import { runInNode } from './tools/node-parity-runner/src/run-in-node.ts';
import { runInRiftyInCurrentRealm } from './tools/node-parity-runner/src/run-in-rifty.ts';
const c = { code: `
  const vm = require('node:vm');
  const f = vm.runInThisContext('() => new Error().stack', {
    filename: '/virtual/hook.js', lineOffset: 10, columnOffset: -20,
  });
  Error.prepareStackTrace = (_error, frames) =>
    frames.map(frame => [frame.getScriptNameOrSourceURL(), frame.getLineNumber(), frame.getColumnNumber()].join(':')).join('\\n');
  console.log(f().split('\\n')[0]);
` };
console.log(process.version);
console.log('Node', (await runInNode(c)).trim());
console.log('rifty', (await runInRiftyInCurrentRealm(c)).trim());
process.exit(0);
JS
```

Output:

```text
v24.16.0
Node /virtual/hook.js:11:
rifty rifty-vm://offset/10/-20/%2Fvirtual%2Fhook.js:1:7
```

The callback reads the structured CallSites after VM evaluation. The accepted Vitest path reads ordinary string stacks without replacing `Error.prepareStackTrace`.
