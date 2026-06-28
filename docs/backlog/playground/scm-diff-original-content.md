---
area: playground
status: draft
title: HEAD/index original-content provider → Monaco diff (gutter + Open Changes)
created: 2026-06-27
why: The "what did I change" loop (gutter +/-/~ and side-by-side vs HEAD) is core git UX, today only available as plain-text git diff in the terminal; rifty's diff is structured-LCS so the diff UX must be blob-vs-blob, never a patch-text surface.
user_story: As a dev editing a file, I want inline gutter marks vs HEAD and a side-by-side Open Changes view, but today there is no diff UI and the page has no HEAD blob to diff against (.git is owner-only).
epic: scm-file-manager
blocked_by: [playground/git-owner-rpc-channel]
sources: [docs/backlog/epics/scm-file-manager.md, docs/backlog/playground/git-owner-rpc-channel.md, ADR-0166, ADR-0167, docs/public/compat/git.md, packages/git/src/types.ts]
code: [apps/playground/src/components/EditorHost.tsx, apps/playground/src/glue/realVite.ts, packages/git/src/git.ts]
---

## Context

Monaco's `DiffEditor` + dirty-diff gutter compute the diff from TWO FULL texts —
so rifty's structured-LCS limitation (`diff()`/`show()` hunks are NOT byte-exact
git-diff text, `compat/git.md`) never degrades the gutter/side-by-side as long as
we feed it full blobs, not hunk text. The HEAD/index blob lives ONLY in the owner
`.git`: `show(rev)→ShowObject{type:'blob',content:Uint8Array}` over the git-RPC
channel. `monaco-editor ^0.52` is bundled but the DiffEditor is NOT used today —
this is net-new wiring, not reuse.

## Scope

- **In:** a `rifty-git://<path>?ref=HEAD|index|<sha>` original-content provider
  whose read maps to owner `show(ref+':'+path)→blob`; wire it to Monaco's
  side-by-side `DiffEditor` (Open Changes) and the dirty-diff gutter (working vs
  HEAD). Over-cap/binary blobs come via the owner read (not the truncated snapshot).
- **Out:** the SCM list/actions; raw patch text (forbidden, see guardrails).

## Guardrails

- **Blob-vs-blob ONLY.** NEVER expose a raw unified-diff text surface from
  `diff()`/`show()` hunks — that is a "stub that lies" (structured-LCS labeled as
  git diff). Hard RED-check: no unified-diff text surface exists anywhere.
- Original bytes come from the owner (page has no `.git`); over-cap >128KB handled
  via the owner read, never an empty/placeholder success.
- Provider lifecycle bound to the git-RPC channel (respawn teardown, ADR-0165).

## Acceptance

- Diff editor shows byte-honest working-vs-HEAD for a modified file; gutter marks
  match; binary/large (>128KB) blobs handled via owner read. RED-check: no raw
  unified-diff text surface exists.

## Reversibility

REVERSIBLE — additive provider + editor wiring over the shipped engine + bundled
Monaco. CHANGELOG line; ADR if the `rifty-git://` scheme is stabilized as a
contract consumed beyond the playground.
