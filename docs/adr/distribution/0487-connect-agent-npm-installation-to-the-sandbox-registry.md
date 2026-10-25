# ADR-0487: Connect agent npm installation to the sandbox registry

Date: 2026-09-30. Status: accepted.

## Context

Kit I9 admits the agent's ordinary npm install through the existing Worker
installer. ADR-0418 D4 owns shell composition; ADR-0376 owns busy rejection;
ADR-0486 owns structural SDK outcomes. Native npm11.17/Node24.16 probes and
real COI installer show that the old argument glue saves raw/latest ranges,
ignores save-exact and duplicates moved dependency sections.

## Decisions

1. Optional `createSandbox({ toolchain: { workerUrl, registryUrl } })` captures
   the connection before boot effects. `sandbox.toolchain.registryConnected`
   reports configuration, not network reachability. It survives Worker restart.
   Per-call `toolchain.install({ registryUrl })` does not connect future commands.
   Commands carry the captured connection internally; no bootstrap config owner.
   Advance the strict toolchain protocol for this request-field change; SDK and
   copied Worker assets ship together.
2. Add an optional install callback to the existing npm dispatcher. The no-COI
   callback calls the same installManifest owner directly inside its existing
   command busy slot: demote, install, prepare, checked flush, promote, activate.
   No recursive RPC, FIFO, separate installer or rifty-specific agent tool.
3. Shared argument-save shaping follows actual npm: resolve requested specs,
   save installed-version ranges, preserve tilde intent, honor save-exact/dev
   and existing section/range for a bare name. Move explicit dev requests out of
   prod. Manifest and lock root dependency maps agree before stamp promotion;
   both COI and no-COI use this same shaping. Failure restores prior manifest
   under the existing rollback contract; no fabricated success for empty test
   installer results. Existing unsupported nonregistry specs remain loud.
4. No connection yields `SandboxRegistryMissingError`, classified registry-missing
   by the SDK root, before install writes/network. Ordinary shell control flow
   remains: a recovered `npm install … || …` ending zero is successful. A final
   nonzero missing-registry outcome retains the structured diagnostic. Do not
   misuse a process-ownership-loss exception to carry an ordinary install error.
5. Existing project FS policy remains the mutation owner. Validate known install
   write targets with that owner before privileged stamp work; actual installer
   writes already traverse SyncMirrorVfs→projectContext. Carry the command signal
   through the real installer; retain busy until settlement/physical Stop.
6. SDK adapter prompt notes report registry availability, without its URL.
   Remove the generic host-only dependency instruction. Default policies remain
   unrestricted; no per-model install tool or prompt policy.

## Alternatives and evidence

- Per-call-only connection: rejected; shell calls would have no stable configured
  connection and host-only install would silently change later agent behavior.
- New install tool / second installer: rejected by I9's ordinary-shell workflow
  and existing installManifest owner.
- Copy COI raw save behavior: rejected by live npm and real shared-shell RED.
- Second FS policy wrapper: rejected; InstallMirrorVfs delegates actual writes to
  the already-active projectContext. Raw FS is only the durable-byte skip probe.

Carriers: agent-npm-install.spec.ts, npm-shell-save-parity.test.ts. Native registry
serves genuine vendored ms2.0.0/2.1.3 to npm and rifty; no installer double.
