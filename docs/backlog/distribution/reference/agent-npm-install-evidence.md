# Agent npm install — I9 evidence

BASE8f5516e070d7fd918309f0a9de5379c51351b462 (accepted SDK lifecycle).
Native Node24.16.0/npm11.17.0, genuine vendored ms2.0.0/2.1.3, HTTP registry
shared by native npm and rifty. No mocked installer/VFS/Worker/Pi.

- Browser RED12: ten native save cases, real Pi shell and missing registry;
  actual old script-only dispatcher returns NotImplementedError text/exit1.
  `/tmp/rifty-pr357-install-red1.log`.
- Fault RED2: install never reaches registry, readonly command has no install
  policy route. `/tmp/rifty-pr357-install-fault-red.log`.
- Shared COI RED8/control2: actual Shell/PackageAcquisitionAuthority/MemoryVfs/
  installer succeeds but saves raw/latest instead of resolved ranges, ignores
  save-exact and duplicates moved sections. Native tilde/no-args controls pass.
  `/tmp/rifty-pr357-install-shared-red.log`.
- Native probes and expanded section matrix: `/tmp/rifty-pr357-native-install*
  .{mjs,json}`, `/tmp/rifty-pr357-coi-install-probe.{mts,json}`. Live committed
  tests regenerate native expected dependency state, not self-derived goldens.

Mechanism sweep: no-coi-toolchain-worker.installManifest already owns demotion,
checked flush/promotion and activation. runNoCoiProjectCommand already owns the
same busy slot and Stop signal. InstallMirrorVfs actual writes resolve current
syncMirror (projectContext); raw FS is only a clean durable-byte skip predicate.
The callback must reuse these owners, not install recursively through RPC.

Other baseline observations from broader native probes: whole-lock descriptive
metadata (root name/license), missing-manifest initialization differ in the
existing installer/COI glue. I9's carrier is an opened project with package.json;
full npm CLI/lock serialization is not claimed by this slice. Contract review
must check this boundary against the accepted goal rather than infer exact-byte
conformance from “change as npm would”. No source repair has started yet.

Native persistence carrier separately RED1 (missing persistence kind because
script-only install never runs), `/tmp/rifty-pr357-install-persistence-red.log`.

Contract+RED accepted8121fb14e,11/11 coverage, no blockers. Broader metadata
observations captured in `../../npm-client/npm-project-metadata.md`; real same-HTTP
probe confirms them, public compat row marks ❌. No I9 dependency-state exemption.
