# Map — isolate-host-sandbox-template

Route: the template's `node_modules` as the sandbox's own files (goal Decisions 2026-11-25), on
ADR-0568 as merged. ADR-0572 (Proposed) is the deferred layer, not this goal's design.

## Items

Children are seeded when the carrier runs (README §FIT 5); planned order:

1. Acceptance carrier — `packages/isolate-host/tests/sandbox-template.test.ts`: a real
   `produceDependencySnapshot` artifact of the four libraries (repo workbench, a loopback registry
   serving npm-packed tarballs of the installed closure — `tests/integration/installed-registry.mjs`,
   no network), the scenario through the public API only; committed RED (`it.fails`) (I1–I4, I6,
   I7 rollback rows, I8; I7's other rows: the live-sandbox suites unchanged).
2. Intake, in the same PR: the envelope reader moved to `@riftydev/npm-client` internal (workbench
   unchanged in behavior, its tar tests green), `registerTemplate` + the process registry, the
   `/node_modules` mount into a new sandbox's state, the `maxFsBytes` budget refusal, the
   `snapshot` refusals, README (route + cost table from `scripts/measure-template.mjs`, public API
   only), compat rows (I1–I4, I6–I10).
3. Read-only mode (I5) — fork to the manager with its cost (below); seeded after the answer. Until
   it lands, a read-only option is what any unknown `createSandbox` option is today:
   `ERR_INVALID_ARG_VALUE` (`knownOptions`), no option name published.

## Open questions

- Read-only (I5) cost — owner: agent (reported to the manager 2026-11-25 as a fork on scheduling,
  not scope): rifty's FS has no read-only mode; it needs an `EROFS` refusal by path prefix on every
  mutating call of both guest FS surfaces (the async `Vfs` and the sync mirror while PR #437 is
  open) and the host ops, Node's semantics for calls reaching the mount through an ancestor
  (`rm -rf /`, `cpSync` onto `/`, `rename` of `/`), and a Linux read-only-mount oracle (Node
  v24.16.0, every mutating call's code/syscall/path).
- Template file times vs `npm ci` — owner: agent — settled in item 2: the tar's times (Decisions);
  compat row.
- The four libraries over the template — owner: agent — main @ 3d16cb7b8: pdf-lib, docx, pptxgenjs
  `writeFile` and exceljs `require('exceljs')` + `xlsx.writeFile` write Node's documents from a
  state (`library-*.test.ts`, compat «Document libraries…»); the carrier re-proves it from the
  artifact. Outside I3: exceljs streaming writer/reader and `read`/`readFile`
  (`epics/node-zlib-on-every-host`, `distribution/isolate-host-fs-read-stream-needs-web-readablestream`).

## Out of scope

- The template layer outside the state, per-worker template cache, binary request frame, O(write)
  host writes: `distribution/isolate-host-sandbox-template-layer` (requirements §3, deferred by the
  user 2026-11-25).
- A live isolate per agent turn: `distribution/isolate-host-sandbox-live-isolate-per-turn` (the
  user's open lifecycle question).
- Lazy template reads in the run: `distribution/isolate-host-sandbox-template-lazy-read`.
- Persisting a template sandbox: `distribution/isolate-host-sandbox-template-snapshot`.
- Keeping a killed run's writes: `distribution/isolate-host-sandbox-killed-run-partial-writes`.
- `exec`'s changed-paths report: `distribution/isolate-host-exec-changed-paths`.
- The end state taken outside the guest's realm: `distribution/isolate-host-sandbox-capture-outside-guest-realm`
  (`epics/isolate-host-live-sandbox`).
- The template's package list and the agent tool set: `epics/isolate-host-agent-tools`.
- Guest APIs beyond I3: `epics/node-zlib-on-every-host`, PRs #434 / #437; Web API shims (ROADMAP M14 E).
- Building the artifact inside the guest; a template made by anything but `produceDependencySnapshot`.
- npm publication: `epics/isolate-host-npm-delivery`.
