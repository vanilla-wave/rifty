# ADR 0443: Named-loud builtin members for linked, unsuppliable Node edges

Status: Accepted
Date: 2026-09-23

## Context

ADR-0348 §2 takes builtin ESM names from the runtime object's enumerable keys
and forbids link-only placeholders: Vite's called `execFile` edge landed only
with its real contract. vitest 4.1.11 (goal `vitest-run-in-browser` I6) links
`statfsSync` from `node:fs` and `spawnSync` from `node:child_process` (tinyexec
1.3.1), and binds `process.memoryUsage` when its pool workers load. Rifty lacks all
three, so linking fails with a `SyntaxError` and the bind with a `TypeError`. Under Node
v24.16.0 the claimed scenario calls none of them on either pool. Host
filesystem statistics and RSS/V8 heap statistics have no browser-realm source;
a synchronous child with status/stderr/signal needs a sync-child protocol rifty
lacks (the `execSync` RPC carries `node <script>` stdout only, evidence O4;
tracked in `runtime-js/node-builtins-loud-stub-capability-gaps`). Evidence:
`docs/backlog/runtime-js/reference/absent-builtin-members-loud-throws-evidence.md`
(O1–O5, V1).

## Decision

1. A Node-own builtin member that a claimed consumer links by name or reads at
   load, and whose real behavior rifty cannot supply, ships with Node's
   descriptor on the same owner object. Every call throws
   `NotImplementedError('<module>.<member>')`. A function-valued own property
   Node puts on that member (`memoryUsage.rss`) follows the same rule with its
   own feature id. It never returns a value, never no-ops and never returns a
   partial value. Each such member gets a compat ❌ row.
2. Admission is per observed edge, cited by evidence. Members that no claimed
   consumer links or reads at load stay absent (a named import of one is a
   link-time miss, ADR-0348 §2): no speculative export table and no
   loader-synthesized exports.
3. A member the claimed path calls needs its real contract (ADR-0348 §2's
   `execFile` rule stands). A loud member never stands in for a called edge.
4. Admitted: `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage`
   (+ `rss`).

This partially supersedes ADR-0348 §2's "link-only placeholders are
forbidden" for members admitted under 1–2. The rest of ADR-0348 stays active.

Independent DEC-2 decision review, 2026-09-25: justified-with-fixes (evidence
I6 + O1/O2/O3/O5 + R2); §Context's sync-child reason, §2's read-at-load reach
and the ADR-0348 note/README row admission wording fixed in place.

## Alternatives and evidence

| Candidate | Disposition |
|---|---|
| Named-loud own member per observed edge | Selected: links and binds like Node, fails loudly on call, fabricates nothing; shape parity + ceiling unit test |
| Keep the link-time miss (ADR-0348 §2 as written) | Rejected: violates I6 — vitest CLI and pool workers fail to link / `undefined.bind` (evidence R2) |
| Browser-derived values (`navigator.storage.estimate()`, `performance.memory`) | Rejected: quota/usage and bucketed JS heap are not block/inode stats or rss/external/arrayBuffers — a fabricated value (AGENTS.md §Fidelity) |
| Real `spawnSync` over the `execSync` sync RPC | Rejected here: the RPC carries `node <script>` stdout only (evidence O4); a status/stderr/signal child protocol is new machinery for a call the claimed path never makes (`REV-7`) — `runtime-js/node-builtins-loud-stub-capability-gaps` |
| Loader synthesizes a throwing export for any missing builtin name | Rejected: Node rejects names it lacks at link time; turning every miss into a runtime throw is the speculative export table ADR-0348 §2 rejects |

## Consequences

- The vitest 4.1.11 CLI and both pool workers link and bind the three members; an
  unclaimed call (browser-mode GC, tinyexec `xSync`, vm pools, `logHeapUsage`)
  fails loudly with the member's feature id.
- The `docs/public/compat/modules.md` rule "an unimplemented Node method remains a link-time
  miss" gains this exception.
- A later real implementation replaces the loud member and its ❌ row.
