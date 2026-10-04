# ADR-0504: Preserve named install intent and optional resolution outcomes

Status: Accepted
Date: 2026-10-05

## Context

ADR-0487/0488 save native dependency state. Named shell installs currently lose
request intent before ADR-0023 replay: ms@2.0.0 then ms replays2.0.0; npm11.17
selects2.1.3. Save also throws when the installer legitimately skips an optional.
Authority: PR357 I9 and native Node24.16.0/npm11.17.0 differential tests.

## Decision

- Add optional `InstallOptions.updateNames`: selected root requests resolve
  against registry metadata even when a retained pin satisfies their range.
  Other roots/covered descendants keep their pins; no-args install is unchanged.
  Shell passes named additions; direct manifest installs pass no update intent.
- Updating an existing lock uses incremental resolution, retaining unrelated
  pins. Eddy's whole-request protocol cannot express that partial update;
  fresh installs retain the existing Eddy path. No protocol or cache owner added.
- Return skipped root optional resolution facts in optional
  `InstallResult.skippedOptionalDependencies`: resolved name/version, or null
  when resolution failed. Facts come from the existing walk, before acquisition;
  never reconstruct a version from requested text or claim installed files.
- Shared save uses these facts. Native npm11.17 records unresolved optional
  requests with a null-name alias and its normal range rule; preserve that
  observed output, including its existing unsupported-alias ceiling on reuse.
  Required failures still reject, optional skips permit shell continuation.

## Alternatives

- Delete/rewrite the lock before installation: loses unrelated pins and rollback;
  rejected by the retained-pin native control.
- Pre-resolve in shell: duplicates registry/override/shadow resolution; rejected.
- Infer optional version from range or installed packages: unavailable after a
  genuine metadata/tarball failure; rejected by the optional fault carrier.
- Selected root intent plus existing walker facts: chosen; same installer and
  save owners, no extra acquisition or coordination.

## Proof

`tests/integration/npm-shell-update-parity.test.ts` and
`tests/no-coi/npm-update-parity.spec.ts`: same real registry archives and native
npm sequence. Evidence: `docs/backlog/distribution/reference/pr357-npm-repair-evidence.md`.
