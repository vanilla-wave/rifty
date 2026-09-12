# I7 compiler pin — independent final pin review

**PASS — exact TypeScript-worker SHA approved under ADR-0391.**
Scope: pin only, not I7 Final+GREEN. Reviewer `/root/nodemon_stop_oracle_critic`,
depth1/max1, no children. No tracked/dist edits, build:libs, pack or Chromium runs.

Approved: `packages/workbench/dist/assets/typescript-worker.js`, unchanged
**10 022 664 B**, SHA-256 `cddf156d671c4b39abeae202b84cd907b6d936974e9537481da6a30773b07e58`.
Only this SHA may change; filename, size, 2 MB ceiling,
compiler/WASM/inline-lexer/generated-client exceptions remain exact.

Independent baseline `7f967cb546f51101397b99948575f18577680248` reproduced the
actual prior worker pin `388098a2582d8c679a98bcc0e0d94aa3c9b59a1fda779423e4992377c15edaf4` byte-for-byte.
Current HEAD during comparison: `1d50e17c24f6957df85627539d86385c2126f30c` plus recorded I7 source diff.

## Method and findings

- Adapted original I5 reproducer in own `/tmp`; builder declarations/options
  extracted unchanged from `tools/publishing/build-workbench-assets.mjs`.
  esbuild `0.28.0`, Node `v24.16.0`, `write:false`.
  Fresh discovery build supplies current input set; no inherited output names,
  output-set assumption, or I5 input exclusions used for correspondence.
- Snapshot actual inputs/config; rebuild current; rebuild baseline through
  `git show` overrides for changed first-party sources. All source/config hashes
  stable before/after those builds. Builder/lock/manifests/tsconfig unchanged
  from baseline. Exact build option objects equal across invocations.
- **540 inputs, 40 outputs**, unique bijection by complete input set + entrypoint.
  No added/removed emitted inputs; mapped import edges/order unchanged.
  Every current memory output byte-identical to dist. Whole-file exact graph
  reference substitution checked for all outputs; generic hash stripping alone
  does not decide equivalence.
- Worker changes: **47 bytes in six eight-character import hashes** only.
  Exact mapped references reproduce the entire baseline worker, including
  bindings/exports/compiler code. All **17** worker contributions identical;
  TypeScript5.9.3 contributes **9 937 465 B**, unchanged.
- Exactly two substantive outputs: owner **+799 B**, VFS **+459 B**. Full emitted
  hunks independently read; each follows the seven reached I7 first-party
  sources (native timer validation + boot/storage IO budgets + OPFS propagation).
  No new compiler/client source or module. Diff saved below.
- Other compiler remains exact `chunk-EMDIREKY.js`, **4 893 418 B**,
  `39be666ac003c7361e9fbcd88abdda1ed51052350ade9b57b4d2716f1e296498`.
  QuickJS/SQLite source bytes and dist copies equal existing exact pins.
  Both graphs contain one identical inline lexer literal:29 556 chars,
  22 167 decoded bytes, SHA `b40099ca01477f581bd752acc8ed6d25c14b0e8beb9a00e0dc1744a2b041a104`.
- Generated esbuild source remains SHA
  `7acc5cd6f0e111810d3505c0959ec2fb5767f25af8dd2c5919a5b36d4f4da553`,
  one emitted owner, unchanged **139 315 B** contribution; whole owner unchanged
  under actual reference mapping.
- Original inventory evaluator: exactly one TS-worker pin/2 MB violation.
  Same evaluator with only proposed SHA substituted in memory: **0 violations**.
  Gate source unchanged. No relaxed criteria or new exception.

## Source-edit window

After all builds and their snapshot passed, parent announced a diagnostic-only
fix to `workbench/internal/workbench-options.ts`. Permission to edit coordinated
at that point. Actual current and baseline graphs prove this file unreachable
from these workers. Any subsequent hash difference is explicitly recorded in
JSON (`sourceChangesAfterBuild`); it is not reported as a stable broad snapshot.
All actual worker inputs/config still match captured hashes. Final copied-byte
verification will check them again; reachable drift invalidates this comparison.

## Actual browser and copied-byte proof

Completed current-source packed consumer: `/tmp/rifty-316-i7-packed-green-kept.log`,
SHA `bf8555365606e6841c518673a99ab2975f48e8e48570b2c35515f0d4d81e03ea`. Full PASS lines and retained directory read,
carrier/copy pipeline inspected. Root registry Vite/HMR/sqlite, snapshot-only
Vite, copied no-COI `node:vm` =>42, scoped Vite build/assets/API/HMR, native SW
stop/restart/reload and public operation proof completed.

Retained consumer: `/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-workbench-packed-consumer-FzKlRF/consumer`.
All **43** actual asset filenames and bytes identical across rebuilt repository
dist, installed npm package, `public/rifty`, and served `dist/rifty`.
All **40** independent memory worker outputs match those served copies;
both WASM exact pins unchanged. Source/config/independent-dist checks repeated
successfully after parent's nonreachable diagnostic fix. Original gate still
has exactly one expected pin violation; SHA-only in-memory proposal has zero.

Reviewer did not launch Chromium; inspected actual successful log/carrier and
served copies. Carrier does not issue a direct language-service request to
`typescript-worker.js`; no new LSP semantic claim. Full I7 Final+GREEN and
remaining PR gates belong to driver, not this pin-scoped verdict.

## Reproduction

```sh
node /tmp/rifty-316-i7-independent-pin-reproducer.mjs
node /tmp/rifty-316-i7-independent-pin-enrich.mjs
node /tmp/rifty-316-i7-independent-pin-finalize.mjs
```

Artifacts: `/tmp/rifty-316-i7-independent-pin-review.json`, `-reproducer.mjs/.log`, `-enrich.mjs/.log`,
`-substantive-graph.diff`, `-current-metafile.json`, `-baseline-metafile.json`,
`-outputs/current/`, `-outputs/baseline/`. Script/source provenance hashes in JSON.
Original I5 reproducer retained untouched. Finalizer first attempted to match
copy-assets child stdout in parent log. Runner buffers successful child stdout;
only command is printed. Verified exact consumer build/copy source plus direct
three-copy inventory/byte equality instead. Initial attempt retained as
`-finalize-attempt1.mjs/.log`; no compiler/artifact assertion weakened.
Final script/log and all provenance hashes recorded in JSON.
