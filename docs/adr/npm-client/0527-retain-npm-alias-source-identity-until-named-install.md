# ADR 0527: Retain npm alias source identity until named install

Status: Accepted
Date: 2026-10-13

> Matching retained versions keep npm's lock target; named install selects metadata and checksums from the new target.

## Context

Partially supersedes ADR-0526's target-name mismatch → metadata repair and its
same-version wrong-target guard. Alias install paths and registry identities
remain separate. ADR-0504's `updateNames` expresses named **install** intent.

Native Node v24.16.0/npm 11.17.0, original npm archives over localhost:

- Manifest-only alias→plain `4.2.3`, plain→alias, and X→Y aliases at version `3.0.0`:
  no-args `npm install` keeps old lock name/resolved/integrity, zero HTTP.
- A lock name changed to `wrong-target` also remains on no-args install.
  It is not proof that npm should repair the name from the requested target.
- `npm install root-alias@npm:ansi-regex@3.0.0` replaces is-fullwidth-code-point
  `3.0.0`; legacy metadata `dist.shasum` becomes the new SHA-1 SRI.
- `npm update root-alias` consults the new target's metadata but retains the
  old same-version target. It is not ADR-0504's named-install operation.

Initial durable RED on ec214f71b: two offline retained cases fail registry
admission; two explicit-target cases copy the old target's checksum and fail
`EINTEGRITY`. Independent DEC-2 probe repeats all retention/install/update
cases and the admitted-name case (`/tmp/pr341/decision-alias-edge`).

## Decision

No named intent: alias name mismatch alone does not invalidate a satisfying
retained version. Replay acquisition and lock output use retained `entry.name`
(or the retained placement name when absent). Existing override/shadow
policy frontiers and range checks remain active.

Named intent: existing `updateNames` selects the requested metadata target.
Prefer its `dist.integrity`; otherwise validate `dist.shasum` as exactly
40 hexadecimal digits and use SHA-1 SRI. Malformed declared checksums fail;
corrupted bytes fail before package/lock publication. A lock checksum fallback
requires equal canonical target and version.

No metadata checksum and no matching pinned proof: preserve the installer's
existing computed SHA-512 cache proof. npm omits lock SRI in this case;
record the generic metadata-writing divergence rather than claim exact LF
parity (`backlog/npm-client/npm-project-metadata`). Native package/archive
bytes still match, with an independent digest over the original archive.

Candidates:

- Resolve every target-name mismatch: rejected by Native no-args zero-HTTP
  retention and the offline failure it creates.
- Infer acquisition/cache identity from the current manifest: rejected by
  alias→plain retention with the old target archive and warm cache.
- Retained lock owns replay, selected metadata owns named installation:
  selected. No additional intent flag, resolver or cache layer.

## Proof

`tests/integration/npm-alias.parity.test.ts`: Native retention and admitted
names; explicit transitions with SHA-1/no source hashes; original cache and
installed file bytes; corrupted archive and malformed shasum guards.
`docs/backlog/npm-client/reference/pr341-npm-alias-source-authority-evidence.md`.
