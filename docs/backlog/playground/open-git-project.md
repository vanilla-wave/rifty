---
area: playground
status: draft
title: Open a smart-HTTP Git URL as a rifty Project
created: 2026-07-09
why: Real smart-HTTP clone already works in the rifty shell, but first-run users cannot use a Git URL as a project source without manually cloning into an existing workspace and repairing project metadata.
user_story: As a developer evaluating a repository in rifty, I want to paste its Git URL and open the real clone as a new Project, but today the capability is discoverable only through the terminal and is not integrated with project creation.
epic: from-intent-to-running-project
blocked_by: [playground/project-ingress-transaction]
sources: [M13, ADR-0165, ADR-0167, docs/public/compat/git.md]
code: [packages/git/src/git.ts, packages/shell/src/commands/git.ts, apps/playground/src/glue/app-project-store.ts, apps/playground/src/orchestration/workspace-lifecycle.ts]
---

## Context

Reuse `@riftydev/git` and its existing smart-HTTP transport; do not implement a second clone stack. Inside the lifecycle owned by `playground/project-ingress-transaction`, the adapter checks out through the supplied root/writer and returns Git provenance; only the transaction may allocate, publish, switch, or clean up project state. Auth, CORS proxy absence, unsupported SSH/`git://`, and transport/checkout failure need source-specific fault rows before `ready`; transaction cancellation, quota, reload, and partial-root recovery stay in the shared item.

Cross-origin-without-proxy and unsupported transports stay loud ceilings from `docs/public/compat/git.md`. Project provenance/reset semantics stay exclusively with the blocking transaction.

## Reversibility

REVERSIBLE Git source adapter under the blocking transaction contract; it adds no new Git implementation.
