# ADR 0284: Git status entries preserve per-path classification gaps

Status: Active
Date: 2026-07
Supersedes: ADR-0179

> TL;DR: `status()` returns a per-path supported-or-gap union; tolerant SCM
> views mark only the gap path, while one strict adapter keeps shell loud.

## Context

ADR-0179 correctly placed scalar status classification in `@riftydev/git` so
shell and Playground could not drift. Review exposed two holes in that
contract. Isomorphic-git states `110` and `120` each produce two ordered real-
Git 2.50.1 porcelain rows, `D ` then `??`; one scalar cannot represent them.
An unknown future statusMatrix code must also remain explicit without erasing
supported sibling paths.

A facade-wide throw is honest for a strict CLI, but at the shared facade seam
it rejects the complete SCM snapshot. In Workbench, one future upstream code
can therefore turn a path-local display gap into owner-wide failure. The legacy
status feed has the same all-or-nothing failure. Skipping the path or inventing
porcelain is a silent lie.

The fault class is `false-fallback`: the honest outcome for interactive SCM is
degraded-but-correct and visible, while shell remains a loud-throw consumer.

## Decision

`StatusEntry` becomes a discriminated union at the `@riftydev/git` interface:

```ts
type StatusEntry =
  | {
      readonly kind: 'supported';
      readonly filepath: string;
      readonly status: GitStatusMatrixCode;
    }
  | {
      readonly kind: 'unsupported';
      readonly filepath: string;
      readonly rawStatusMatrixCode: string;
    };
```

`makeGit().status()` returns every ordered statusMatrix path. Classification is
per entry: supported codes retain their finite type; an unsupported value is
preserved only in the explicit gap branch. A gap never receives a `status`
value and never reaches `porcelainStatusLines()`.

Replace the scalar classifier with this public finite ordered mapping:

| matrix | rows |
|---|---|
| `000`, `111` | `[]` |
| `003` | `['AD']` |
| `020` | `['??']` |
| `022` | `['A ']` |
| `023` | `['AM']` |
| `100` | `['D ']` |
| `101` | `[' D']` |
| `103` | `['MD']` |
| `110`, `120` | `['D ', '??']` |
| `113`, `123` | `['MM']` |
| `121` | `[' M']` |
| `122` | `['M ']` |

Export one `requireSupportedStatusEntries(entries)` type-narrowing adapter. It
returns supported entries unchanged or throws
`NotImplementedError('git.status-matrix.<raw>')` before a strict consumer acts.
Shell obtains all status-dependent inputs through one command-local call to
this adapter; shared strict operations such as commit refusal and starter
staging use the same adapter. No strict operation partially mutates before the
gap is discovered.

Workbench and the legacy status feed handle the union directly. Supported
entries preserve all ordered porcelain rows, including duplicate paths for
`110`/`120`. An unsupported entry becomes one explicit gap row carrying its
path and raw matrix code, never a synthetic `GitPorcelainXY`. Presentation
marks it with `!`, disables semantic actions with the same directed
`NotImplementedError`, reports degraded health, and retains supported sibling
rows. The Workbench owner remains available.

This is an intentional `0.x` compile-time break. Every former direct
`entry.status` access must choose the strict adapter or exhaustively handle the
union; no compatibility alias preserves the all-or-nothing behavior.

## Consequences

- Future isomorphic-git drift is isolated to its path in interactive SCM.
- Shell, commit refusal, and mutation planning stay loud and cannot act on an
  unclassified state.
- The union and gap transport add interface surface, but make each consumer's
  honest-outcome policy explicit and statically exhaustive.
- ADR-0179's layer placement remains intact; its scalar return contract is superseded.

## Rejected

- Facade-wide throw: erases supported siblings and escalates a local gap.
- `GitStatusMatrixCode | string`: collapses to `string`, defeating narrowing.
- `status: null` plus optional raw fields: permits ambiguous invalid shapes.
- Synthetic `!!` porcelain: not real porcelain-v1; would fake Git behavior.
- Skip the unsupported row: silently reports a clean path.
- Consumer parsing of raw known codes: recreates the sibling drift that
  ADR-0179 eliminated.
