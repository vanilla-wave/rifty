# vm script offsets — Node oracle and RED

- 2026-09-23, Node v24.16.0: `node --import tsx -e 'const c=await import("./tools/node-parity-runner/cases/vm/script-offsets.case.ts"); const r=await import("./tools/node-parity-runner/src/run-in-node.ts"); console.log(process.version, await r.runInNode(c.default));'` → `v24.16.0 {"run":"/virtual/run.js:11:28","script":"/virtual/script.js:11:8","literal":"first\\nsecond"}`. Both stack strings are read after `runInThisContext` returns. Negative column offset clamps to 1 before the Error expression's own column.
- RED on origin/main 0c4c1b070: `node --import tsx tools/node-parity-runner/src/cli.ts script-offsets` → `NotImplementedError: Not implemented: vm.runInThisContext.lineOffset` (1/1 fail).
