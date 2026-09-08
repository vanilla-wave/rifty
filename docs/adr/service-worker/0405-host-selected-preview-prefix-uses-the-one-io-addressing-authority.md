# ADR 0405: Host-selected preview prefix uses the one io addressing authority

Status: Accepted
Date: 2026-09
Refines: ADR-0036, ADR-0040, ADR-0097, ADR-0189

> TL;DR: Optional `deployment.previewPrefix` is a clone-safe pathname
> prefix; omitted keeps `/preview`; one io parse/build helper is the
> authority for SW match, registry URLs, iframe navigation, assets and HMR.

## Context

Goal self-hosted-snapshot-workbench I5. `parsePreviewPath` /
`PREVIEW_PREFIX_RE` match only `/preview/<port>`. `createPreviewRegistry`
hardcodes `/preview/${port}/`. A page under `/sandbox/` with SW scope
`/sandbox/` cannot intercept `/preview/...` (outside scope) and must not
rewrite guest source URLs. I2 copied SW is static — prefix cannot require
a rebuild. Packed-host composition stays I7.

## Decision

Public Workbench option:

```ts
deployment: {
  previewPrefix?: string;
}
```

Omitted is today's `/preview`. Present value is an absolute pathname of
one or more `/`-separated segments, each `/^[A-Za-z0-9._-]+$/` and
neither `.` nor `..`. No trailing slash, `//`, or `\`. Reject with
`TypeError` naming `deployment.previewPrefix` before SW `register`.

The resolved prefix must be contained in
`deployment.serviceWorker.scope` (scope pathname is a prefix of the
preview pathname, including the default `/`). Out-of-scope fails the
same way, before register. SW scope already must contain the Workbench
document URL.

One io authority (ADR-0036). Default prefix stays `/preview`.
`parsePreviewPath(path, prefix?)` and `previewDocumentPath(prefix, port)`
are the only builders/parsers. `PREVIEW_PREFIX_RE` remains the default
prefix regex. No second SW regex.

The controlling page's `rifty:preview:ready` may carry additive
`previewPrefix` (ADR-0031 optional; absent = `/preview`). The SW
matches with that prefix. `SW_ROUTING_VERSION` 6→7 (addressing shape,
ADR-0040). preview-registry and ADR-0189 HMR guest-port remap use the
same helpers. Guest project files are not rewritten.

Candidates: optional string prefix (selected; smallest initialize fit).
Rebuild SW per host (killed: I2). Second SW regex (killed: ADR-0036 /
sibling-drift). Rewrite guest URLs (killed: I5).

## Consequences

Embedders serve page and preview under one non-root SW scope. Existing
`/preview/<port>/` hosts stay unchanged. Packed `/sandbox/` proof stays I7.
