---
area: distribution
status: draft
title: A sandbox over a template snapshots and restores only its difference from the template
created: 2026-11-25
why: Requirements §2 (diff-only snapshot, ~16 MB per conversation) — deferred by the user 2026-11-25 (no persistence between turns for now); a template sandbox's `snapshot()` / `createSandbox({ template, snapshot })` are a loud gap until this lands.
sources: [/Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md §2, ADR-0567, ADR-0572, docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md]
code: [packages/isolate-host/src/sandbox.ts, packages/isolate-guest/src/snapshot.ts]
---

## Context

The user, 2026-11-25: «И сохранение снапшота песочницы не нужно. Решили, что сохранять все это не
будем. Агент может [поработать] с песочницей и забрать из живой песочницы файл. После этого
песочницу уничтожаем. Так что все задачи про сохранение и изменение снапшота мы кладем в бэк-лог, и
пока не делаем.» (the bracket: the voice input's «подъем кто-то», the agent's reading). Until this
item lands, `snapshot()` and `createSandbox({ snapshot })` of a template sandbox throw
`NotImplementedError('isolate-host.sandbox-template-snapshot')` + compat ❌ (the template goal);
snapshots of sandboxes without a template are unchanged (ADR-0567 v1).

Designed (template refine 2026-11-24, ADR-0572 drafts), kept here for the pickup:
- Format v2 (ADR-0567 §3: v1 still read; the writer writes v2): v1's layout; with a template bound,
  entries are a layer over it, restore = template + entries; a writable template adds a record kind
  "deletion of a template path" and an "opaque directory" flag; a read-only template refuses
  entries under the mount.
- Identity `{id, version}` = `{rifty/manifest.json templateId, snapshotId}` (sha256 of the decoded
  tar, as `produceDependencySnapshot` computes it; the same for gzip and br; `installArtifactIdentity`
  is a build constant shared by every template, so it identifies none). Any rebuild that changes the
  tar (a dependency bump, replay ↔ frozen) gives a new version: a snapshot over the old one restores
  only over the old one, a named error otherwise (requirements §2).
- The README states the per-conversation budget in compressed bytes (the snapshot is not
  compressed, ADR-0567 Consequences).
- Measured: a one-file difference over T95 snapshots to 527 B – 1.6 KB (probe L, arms `views`,
  `lazy`); the whole state there is 96 MB (`full`); the library probe's four-library state 88.1 MB,
  gzip 19.7 MB.

Owner: distribution (isolate host). Trigger: the consumer persisting sandbox files between turns.

## Challenge

challenge: 2026-11-25 — none yet (user-deferred capture; the premise critic of 2026-11-24 covered its design, template goal `## Challenge`)
