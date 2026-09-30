# ADR 0484: Separate agent file and shell project policies

Status: Accepted
Date: 2026-09-30
Supersedes: ADR-0426 D1 only in its one-project-handle requirement.

## Context

PR357 goal I4: one agent host accepts distinct files/shell policy values.
SDK project handles already validate/copy/enforce policies over one Worker owner.
Independent DEC-2 review: `policy_decision`, 2026-09-30; source evidence
`host-project-inputs.ts`, `sandbox-project.ts`, `no-coi-project-fs.ts`.

## Decision

- Keep `project` as the common root/defaults. Add optional
  `policies: {files?: Omit<SandboxProjectOptions, 'root'>, shell?: ...}`.
- Absent field inherits common value. Present fields replace, never union;
  explicit undefined removes the common restriction. Empty readonlyPaths allows
  writes; empty allowedCommands denies commands, exactly as SDK policy.
- One public SDK project handle per capability, same root. Capability policy
  cannot introduce a root. SDK alone validates and enforces values. Capture notes
  at creation so later caller array mutation changes neither enforcement nor notes.
- Unconfigured reference host is unrestricted. Explicit command allowlists still
  apply to every nested npm script stage. No adapter bypass or separate policy engine.
- Other ADR-0426 decisions remain: root-bounded file tools, ordinary writes,
  caller-owned mode/sandbox, existing stop semantics. Shell is no hostile-code jail.

## Alternatives

- Two SDK handles: selected; no new owner, lifetime, scheduler or enforcement.
- Nested replacement project shape: unnecessary breaking configuration.
- Caller-provided handles: leaves capability composition with every embedder.
- Undefined always inherits: needs a new sentinel to remove common allowlist.
