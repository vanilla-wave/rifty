# Map — isolate-guest-embed

## Items

1. `distribution/isolate-guest-embed-acceptance` — **acceptance carrier** —
   the `## User scenario` as executable tests (packed export install, the
   README embedder over the parity corpus, hostile bridge arguments, host
   bundle identity), committed RED before the export exists.

Wall hypotheses the carrier is expected to hit (cut into units only when the
run hits them): new package `packages/isolate-guest` (guest sources moved
from isolate-host, bundle build, asset subpath, publish/arch/vitest wiring);
an embedder-neutral validating bridge wrapper with a close step; isolate-host
child on the export, bundle copied into its `dist`; README custom-integration
section + ADR (public API, unstable) + compat/trust-model lines.

## Open questions

- Whether isolated-vm `evalClosure` with `ivm.Callback` arguments behaves the
  same in 7.0.2 as in the 6.2.0 probe — owner: agent — the carrier run.

## Out of scope

- A worker pool or any topology change of the built-in host (separate goal).
- New Web APIs in the guest; any change of `runCode` behavior or signature.
- npm publication (`DEC-3`).
- An isolated-vm adapter in the export (the README example shows the wiring).
