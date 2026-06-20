# ADR 0040: SW frame and routing versions split

Status: Accepted (2026-05-27)
Date: 2026-05

> TL;DR: `SW_PROTOCOL_VERSION` splits into `SW_FRAME_VERSION` (frame data shapes) + `SW_ROUTING_VERSION` (addressing + owner-fallback), both stamped per frame and validated at decode

## Context

ADR-0031 introduced `SW_PROTOCOL_VERSION` and the rule "every wire frame between the SW and controlling page carries a `version`; receivers validate at decode time and refuse mismatched peers". It pins the *shape of frame data* only (`SwPingFrame`, `SwPongFrame`, `SwPreviewReadyFrame`, `SwPreviewGoodbyeFrame`, `SerializedRequest`/`SerializedResponse`). The 2026-05-26 service-worker audit (F2) flagged two contracts the constant *should* pin but does not:

1. **Addressing scheme.** The `/preview/<port>/...` URL convention and synthetic `preview.local` host now live in `@riftydev/io/preview-protocol` (ADR-0036): `PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl(path)`. Renaming the host or reshaping the regex changes behaviour silently — `SW_PROTOCOL_VERSION` covers frame fields, not the URL contract.
2. **Owner-fallback semantics.** `FirstWindowOwnerResolver`'s contract: "prefer `event.clientId`; only when both `resultingClientId` and `clientId` are empty, fall back to first controlled window with a one-shot `console.warn` per scope". Either side could quietly drop the fallback (e.g. changing the warn-dedup key shape) without firing the mismatch path, since the constant tracks only frame data.

The audit recommended either widening `SW_PROTOCOL_VERSION` or splitting into two constants. The split won: it makes bump triggers explicit at the call site — a frame-shape change mentions only `SW_FRAME_VERSION`, a routing/owner-fallback change mentions only `SW_ROUTING_VERSION`, each documenting its triggers in a comment block.

## Decision

Two constants in `packages/service-worker/src/protocol.ts`:

- **`SW_FRAME_VERSION` = `'1'`** — pins wire-frame data shapes (`SwPingFrame`, `SwPongFrame`, `SwPreviewReadyFrame`, `SwPreviewGoodbyeFrame`, `SerializedRequest`, `SerializedResponse`, any future frame). Bump on: changes to a frame's field set, field type, or per-field semantics. Additive optional fields with a documented default do NOT bump (per ADR-0031's SemVer-major rule).
- **`SW_ROUTING_VERSION` = `'1'`** — pins the addressing scheme from `@riftydev/io/preview-protocol` (`PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl`, `parsePreviewPath`) AND the owner-fallback rules in `packages/service-worker/src/owner-resolver.ts` (`FirstWindowOwnerResolver`). Bump on: changes to the URL regex shape, the synthetic host literal, the `synthesizePreviewUrl` return shape, the resolver fallback order, or the one-shot-warn dedup key shape.

Both constants are stamped into every handshake frame and the request envelope; receivers validate both at decode time. A mismatch triggers the existing `PROTOCOL_VERSION_MISMATCH` path with a structured error carrying both `(expected, got)` pairs, so the host can branch on which contract drifted.

The legacy `SW_PROTOCOL_VERSION` is removed cleanly. Only in-repo references were inside `@riftydev/service-worker` itself, plus two non-code prose mentions in `kernel/sync-rpc.ts` and `kernel/CHANGELOG.md` (rewritten to cite ADR-0031/ADR-0040 without the deleted symbol). No external consumer imports it.

### Mismatch error shape

`SwProtocolVersionMismatchError` grows two pairs:

```ts
{
  kind: 'PROTOCOL_VERSION_MISMATCH',
  expected: { frame: string; routing: string },
  got:      { frame: string; routing: string },
  message: string,
}
```

The host inspects `expected.frame !== got.frame` vs `expected.routing !== got.routing` to tell frame-skew (likely fresh SW + old un-reloaded page) from routing-skew (likely a misconfigured `@riftydev/io` import). Either way the handshake aborts with HTTP 503; the client logs and falls back to no-SW rather than producing cryptic downstream errors.

### Alternatives considered

**Option A: widen the single constant** — keep `SW_PROTOCOL_VERSION`, re-document it as covering frames + addressing + fallback. Rejected: hides bump triggers. Adding a new frame shape and bumping would silently invalidate peers across an unrelated contract (routing), forcing every SW-package caller to bump in lockstep when only one contract changed.

**Option B: keep `SW_PROTOCOL_VERSION` as a deprecated alias for one cycle.** Rejected: the only in-repo consumer is `@riftydev/service-worker` itself, and `kernel/sync-rpc.ts` references it *by name in prose*, not via import. An alias adds clutter with no external caller; clean removal is simpler.

## Consequences

- A `SW_FRAME_VERSION` bump invalidates only frame consumers; a `SW_ROUTING_VERSION` bump only addressing/fallback consumers. The two contracts evolve independently. The "either side refuses a mismatched peer" promise now binds both.
- Drift is reported with both `(expected, got)` pairs, distinguishing frame-skew from routing-skew. The playground's protocol-mismatch banner can branch on which contract changed.
- Negative: two strings per handshake frame instead of one. Negligible (one extra comparison and field).
- Negative: a new contract surface to maintain. Mitigation: both constants document bump triggers in JSDoc above the declaration and cite this ADR, so forget-to-bump fails loudly.
- Legacy `SW_PROTOCOL_VERSION` is gone; reaching for it yields a typecheck error pointing at the two replacements, with JSDoc naming which to use.
- `protocol.ts` is the single source of truth for both bump-trigger lists. ADR-0036 (addressing in `@riftydev/io`) and the SW `owner-resolver.ts` reference back to `SW_ROUTING_VERSION` so addressing/fallback cannot change unnoticed.

## Cited ADRs and references

- **ADR-0016** — SW source-of-truth in TypeScript; introduced `SW_PROTOCOL_VERSION`. This ADR retires the single constant for the two-constant split.
- **ADR-0031** — Per-frame version validation. Stays in effect for the frame-shape side; this ADR builds on it (the validated constant is now two). The "refuse mismatched peers" rule is unchanged.
- **ADR-0036** — Preview-protocol addressing in `@riftydev/io`. The routing version pins the shape of its addressing primitives.
- **2026-05-26 service-worker audit (F2)** — recorded the gap this ADR fixes; F2's widen-or-split recommendation is resolved in favour of the split.

### Cited by

- **ADR-0160** extends the routing version to window port-keying + anti-hijack ready frames (`SW_ROUTING_VERSION` `3`→`4`).
