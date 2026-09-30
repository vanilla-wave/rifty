---
kind: epic
status: ready
title: Agent reads a persistent filesystem archive across sessions and projects
created: 2026-09-30
value: A new browser agent session can recover earlier decisions from any project, including a deleted project, by reading the original conversations.
user_story: As a developer using rifty agents, I want to say what we did in previous sessions, but today history is host-managed and the Playground conversation disappears on close.
tier: production
---

## Outcome

Automatically archive agent conversations in a folder in rifty's filesystem.
New sessions can discover and read earlier conversations on request across
projects sharing that local archive. Deliver through public SDK and Workbench
integration; Playground may consume it but is not required for closure.
This preserves the decisions behind real Node application work across browser
sessions, without requiring the user to export or paste earlier chats.

## User scenario

1. An embedding application uses the public rifty agent with an SDK sandbox or
   Workbench project and the persistent archive. In a shop project, the user
   discusses and implements authentication in several separate agent sessions.
2. Close/reopen the host, start a new session in a blog project, and ask:
   «Сделай авторизацию как вчера в магазине». The agent discovers and reads
   the relevant archived conversation, with its source project/session identity.
   The user does not supply the old transcript or its filename.
3. Reset a conversation, compact a long conversation, rename or delete the shop
   project. Its archived messages remain available from the blog. Project
   export/import still concerns that project's files, not the global archive.
4. Repeat through both public host paths in fresh Chromium. Read actual saved
   files after a reload; interrupt a write and verify the last acknowledged
   archive state survives, with any incomplete tail explicitly identified.

## Invariants

<!-- False on origin/main = 7e695a25059c850e35cca55a64d1e3e472866a3d.
     Source evidence and limits: distribution/reference/agent-session-archive-refine.md.
     I1: no automatic archive; I2: project-rooted file tools only;
     I3: no durable archive acknowledgement/recovery;
     I4: neither public host supplies archive integration. -->

1. I1. Every new conversation using the archive is automatically recorded as
   filesystem files with session/project provenance and original messages,
   including tool calls/results. New-session/reset/close and context compaction
   do not erase earlier messages or replace them with only a summary.
2. I2. From a new session in another project sharing the archive, the agent can
   discover and read the relevant prior conversation on a natural-language
   request, without manual export, transcript injection or a supplied filename.
   Renaming or deleting its source project does not remove the conversation.
3. I3. Archived messages acknowledged as durable survive host teardown,
   reload and interrupted writes. Storage failures are visible; partial or
   corrupt data is never reported as a complete saved conversation. No automatic
   replay of historical tool actions is required to read the archive.
4. I4. The same archive behavior is usable via public SDK sandbox and Workbench
   project hosts, demonstrated by installed-package browser consumers over real
   filesystem/storage implementations. No Playground-private adapter or app-owned
   reimplementation of archiving is needed by an embedder.

## Challenge

challenge: 2026-09-30 — clear

«Ответы пользователя закрыли найденные развилки: ФС rifty; поиск по запросу
между проектами; “sdk и workbench, но если сразу появился в playground, то ок”;
“История остаётся после удаления проекта”.»

Fresh read-only critic `/root/history_premise`; complete verdict and original
answers: `docs/backlog/distribution/reference/agent-session-archive-refine.md`.
final-check: 2026-09-30 — PASS — fresh read-only `/root/archive_final_review`
at `7790a94de6174aeb03ff79ff1e25c94de495d11a`; record:
`docs/backlog/distribution/reference/agent-session-archive-final-green.json`.
No product implementation claimed.

## Decisions

- User, round 1: rifty filesystem; agent finds/reads previous sessions on request; no history-picker/resume UI required.
- User, shop/blog example: «второй вариант» — cross-project recall, not only sessions of the active project.
- User, round 2: «sdk и workbench, но если сразу появился в playground, то ок» — both public host paths required; Playground optional.
- User, round 2: «История остаётся после удаления проекта» — archive lifetime is independent of source-project lifetime.
- tier: production — durable history across reload requires crash/reload consistency and real browser fault proof; does not promise recovery of never-saved bytes.
- Agent boundary: one shared local archive selected by the embedding application; no new account/cloud/device synchronization or automatic access to other applications' storage.
- Agent baseline: existing project import/export remains project-scoped; it neither imports nor overwrites the common archive.
- Agent preservation: archive original retained message content, including images and tool payloads admitted by the existing agent; keep existing credential handling, never start persisting provider configuration secrets.
- Agent preparation: choose public API, storage owner, on-disk format and durability acknowledgement at PICKUP with an ADR and discriminating probes; no carrier is prescribed here.
- ADR-0466 host-owned storage and ADR-0474 context projection remain authorities; if Playground adopts automatic archive, supersede ADR-0427 export-only clauses explicitly before its implementation.
- rejected route: restore only the latest conversation — violates I1 and I2 across all sessions/projects.
- rejected route: manual export or archive inside the deleted project's tree — violates I1 and I2.
- rejected route: Playground-only history implementation — violates I4.
