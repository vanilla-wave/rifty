# ADR-0489: Keep reference host deployment policy outside the SDK

Date: 2026-09-30. Status: accepted.

## Context

Kit scenario4/9 assigns applied snapshotId and reconciliation to the application.
ADR-0417/0420 keep explicit snapshot force and ordinary saved access; neither
adds installation admission. Real apply→npm install→force probe loses the added
package's manifest/lock entries, while untargeted installed files may survive.
Evidence: `docs/backlog/distribution/reference/agent-reference-host-evidence.md`.

## Decisions

1. Private fixture `host.ts` composes public SDK/agent APIs. Application storage
   records only applied snapshotId under a namespace/root-specific key. Matching
   ID calls open; first/new ID applies (force when a prior ID exists), then records
   the successfully applied ID immediately. No SDK identity state or merge.
2. Explicit source files and optional host install run after that branch, even
   on a same-ID reconciliation retry. Reopen omits stale initial sources. For a
   deploy, the app supplies its persisted actual post-agent manifest and sources;
   write them after apply, then use the existing installer. The applied ID never
   certifies source writes or dependency installation. Partial effects stay loud;
   no new rollback, auto retry or apply-completion protocol.
3. Benchmark imports the exact private module. Packed preparation copies both
   files with relative paths intact; bare SDK/agent imports resolve only from
   installed tarballs. Default root unrestricted, session100 calls/600s; explicit
   measurement limits and optional policy/text-only values stay caller inputs.
4. Keep commands-only reference composition; existing benchmark preview after
   the turn remains test-harness behavior. No published composition API/package.

## Alternatives and evidence

- SDK ensure/merge: rejected by user/ADR-0417; unrelated state owner.
- Blind force/open: real RED loses desired manifest/lock entries, despite a
  still-executable untargeted package. Requiring a module alone cannot prove it.
- Host manifest diff/merge: unnecessary policy. App-owned desired bytes plus
  existing install meet the accepted scenario without another merge algorithm.
- Duplicate benchmark composition: rejected by I8's explicit same-module decision.

## Corrections (active)

2026-10-01 — ADR-0490 supersedes decisions 1–2: user removed the reference host's
identity → force → reconciliation policy. Decisions 3–4 remain active.
