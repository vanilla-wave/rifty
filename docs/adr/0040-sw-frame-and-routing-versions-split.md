# ADR 0040: SW frame and routing versions split

Status: Accepted (2026-05-27)
Date: 2026-05

## Context

ADR-0031 introduced `SW_PROTOCOL_VERSION` and the rule "every wire frame
between the SW and the controlling page carries a `version` field;
receivers validate at decode time and refuse mismatched peers". The
constant has done one job well — it pins the *shape of frame data*
(`SwPingFrame`, `SwPongFrame`, `SwPreviewReadyFrame`,
`SwPreviewGoodbyeFrame`, the `SerializedRequest` / `SerializedResponse`
pair). The 2026-05-26 service-worker audit (F2) flagged two contracts
the same constant should pin but does not:

1. **Addressing scheme.** The `/preview/<port>/...` URL convention and
   the synthetic `preview.local` host now live in
   `@rifty/io/preview-protocol` (ADR-0036). Their *shape* —
   `PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`, and the
   `synthesizePreviewUrl(path)` contract — is what the SW recognises and
   what `setupPreviewBridge` consumers depend on. Renaming the host or
   reshaping the regex would change behaviour silently because
   `SW_PROTOCOL_VERSION` only covers frame fields, not the URL contract.
2. **Owner-fallback semantics.** `FirstWindowOwnerResolver` documents a
   behavioural contract: "prefer `event.clientId`; only when both
   `resultingClientId` and `clientId` are empty, fall back to the first
   controlled window with a one-shot `console.warn` per scope". This is a
   contract between SW and host, not a frame shape. Either side could
   quietly remove the fallback (e.g. by changing the warn-dedup key
   shape) and the protocol-mismatch path would not fire because the
   constant tracks only frame data.

The audit recommended either widening `SW_PROTOCOL_VERSION` semantics
to cover the addressing and fallback rules, or splitting into two
constants — `SW_FRAME_VERSION` for the frame shapes and a new
`SW_ROUTING_VERSION` for the addressing + owner-fallback rules. The
split won because it makes the bump triggers explicit at the call site:
a change to a frame shape mentions only `SW_FRAME_VERSION`, a change to
routing or owner fallback mentions only `SW_ROUTING_VERSION`, and both
constants list their bump triggers in a comment block above the
constant.

## Decision

Two constants live in `packages/service-worker/src/protocol.ts`:

- **`SW_FRAME_VERSION` = `'1'`.** Pins wire-frame data shapes
  (`SwPingFrame`, `SwPongFrame`, `SwPreviewReadyFrame`,
  `SwPreviewGoodbyeFrame`, `SerializedRequest`, `SerializedResponse`,
  and any future frame). Bumping requires: changes to a frame's field
  set, field type, or per-field semantics. Additive optional fields with
  a documented default do NOT require a bump (per ADR-0031's SemVer-
  major rule, restated here for the frame side).
- **`SW_ROUTING_VERSION` = `'1'`.** Pins the addressing scheme exported
  from `@rifty/io/preview-protocol` (`PREVIEW_PREFIX_RE`,
  `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl`, `parsePreviewPath`)
  AND the owner-fallback rules in
  `packages/service-worker/src/owner-resolver.ts`
  (`FirstWindowOwnerResolver` — prefer `clientId`, fall back to first
  controlled window with a one-shot warn). Bumping requires: changes to
  the URL regex shape, the synthetic host literal, the
  `synthesizePreviewUrl` return shape, the resolver fallback order, or
  the one-shot-warn dedup key shape.

Both constants are stamped into every handshake frame
(`SwPingFrame`, `SwPongFrame`, `SwPreviewReadyFrame`,
`SwPreviewGoodbyeFrame`) and into the request envelope. Receivers
validate both at decode time. A mismatch on either side triggers the
existing `PROTOCOL_VERSION_MISMATCH` path with a structured error that
includes both `(expected, got)` pairs — the host can branch on which
contract drifted.

The legacy `SW_PROTOCOL_VERSION` constant is removed cleanly. The only
in-repo references were inside `@rifty/service-worker` itself (plus two
non-code mentions in `kernel/sync-rpc.ts` and `kernel/CHANGELOG.md` as
prose cross-references — those are rewritten to cite ADR-0031/ADR-0040
without naming the deleted symbol). No external consumer imports the
constant.

### Mismatch error shape

The existing `SwProtocolVersionMismatchError` grows two pairs:

```ts
{
  kind: 'PROTOCOL_VERSION_MISMATCH',
  expected: { frame: string; routing: string },
  got:      { frame: string; routing: string },
  message: string,
}
```

The host can inspect `expected.frame !== got.frame` vs
`expected.routing !== got.routing` to decide whether the drift is in
the frame shape (likely a fresh SW + an old page that did not reload)
or in routing (likely a misconfigured `@rifty/io` import). Either way
the handshake aborts cleanly with HTTP 503; the client logs and
proceeds to the no-SW fallback rather than producing cryptic
downstream errors.

### Alternatives considered

**Option A: widen the single constant.** Keep `SW_PROTOCOL_VERSION` and
re-document it as covering frames + addressing + fallback. Rejected:
a single constant hides the bump triggers. A future contributor who
adds a new frame shape and bumps the constant would silently invalidate
peers across an unrelated contract (routing), forcing every caller of
the SW package to bump in lockstep when only one contract changed.

**Option B: keep `SW_PROTOCOL_VERSION` as a deprecated alias for one
cycle.** Rejected: the only in-repo consumer is `@rifty/service-worker`
itself, and the comments in `kernel/sync-rpc.ts` reference the constant
*by name in prose*, not via import. A one-cycle alias adds clutter
without serving any external caller. The clean removal is the simpler
contract.

## Consequences

- A bump of `SW_FRAME_VERSION` invalidates only frame consumers; a bump
  of `SW_ROUTING_VERSION` invalidates only addressing/fallback
  consumers. The two contracts can evolve independently. The protocol's
  promise — "either side refuses to honour a mismatched peer" — now
  binds both contracts, not just one.
- The handshake reports drift with both `(expected, got)` pairs, so the
  diagnostic distinguishes frame-skew from routing-skew. The
  playground's existing protocol-mismatch banner can branch on which
  contract changed.
- Negative: two strings on every handshake frame instead of one.
  Negligible (one extra string comparison and one extra field).
- Negative: a new contract surface to maintain. Mitigation: both
  constants document their bump triggers in JSDoc comments above the
  declaration, and the ADR is cited from the comment so the
  forget-to-bump failure mode is loud.
- The legacy `SW_PROTOCOL_VERSION` constant is gone. Future contributors
  who reach for it find a typecheck error pointing at the two
  replacements; the JSDoc on each spells out which one to use.
- The `protocol.ts` module is the single source of truth for the two
  bump-trigger lists. ADR-0036 (addressing in `@rifty/io`) and the SW
  `owner-resolver.ts` reference back to `SW_ROUTING_VERSION` so a
  future contributor cannot change addressing or fallback without
  noticing the version pin.

## Cited ADRs and references

- **ADR-0016** — Service Worker source-of-truth in TypeScript;
  introduced `SW_PROTOCOL_VERSION`. This ADR retires the single
  constant in favour of the two-constant split.
- **ADR-0031** — Per-frame version validation. Stays in effect for the
  frame-shape side; this ADR builds on it and supersedes it in the
  sense that the constant being validated is now two constants. The
  "refuse mismatched peers" rule is unchanged.
- **ADR-0036** — Preview-protocol addressing in `@rifty/io`. The
  routing version pins the shape of the addressing primitives exported
  from there.
- **2026-05-26 service-worker audit (F2)** — recorded the gap that this
  ADR fixes. F2's specific recommendation (either widen or split) is
  resolved in favour of the split.
