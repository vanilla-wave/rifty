# ADR 0304: Project attested package-tree runtime facts

Status: Accepted
Date: 2026-07

> TL;DR: npm-client projects one immutable shadow plan plus exact root-visible
> install-path/version evidence from the same attested lockfile; Workbench keeps
> that evidence with the installed-tree epoch and never rereads live lock bytes
> during child admission.

## Context

ADR-0249 stores only shadow-asset readiness in the installed-tree epoch. That
cannot identify the package whose finite runtime adapter may prepare a child:
Vite 8 legitimately has an empty asset plan, indistinguishable from a tree with
no Vite. Physical `node_modules` presence is also insufficient because a later
install may leave old files behind.

Reading `package-lock.json` during spawn would violate ADR-0249. Package-only
edits deliberately do not change the installed-tree epoch, and arbitrary live
bytes cannot revoke or bless the already-attested tree. Parsing npm v3 inside
Workbench would also duplicate npm-client schema ownership.

## Decision

- npm-client publicly exposes
  `packageTreeRuntimeFactsFromLockfileBytes(bytes)`. One strict v3 parse returns
  the canonical `ShadowAssetPlan` and frozen `rootPackageVersionsByInstallPath`, keyed by
  exact project-relative `node_modules/<name>` install path.
- Root evidence is bidirectionally exact: every root dependency has a matching
  top-level entry with the same version, and every top-level entry appears in
  the root map. Drift loud-throws `EBROKENLOCK`; nested-only packages never gain
  root authority.
- Fresh install results pass their installer-owned lockfile through the same
  projection before v4 promotion; projection failure leaves the epoch
  unavailable and the tree untrusted. Trusted and snapshot paths use their
  exact v4-attested bytes.
- Workbench publishes the evidence atomically with readiness and sequence,
  clears it on installed-tree mutation/unavailability, and copies it into the
  FIFO-held child reservation. Package/lock-only edits retain the prior epoch.
- Generic child admission projects only the frozen package evidence from its
  reservation. Finite adapters may query exact paths; the Vite adapter verifies the attested version
  against physical prepared bytes before minting its private temp-cache
  capability. Shadow-asset capability creation remains plan/receipt-driven.

This refines ADR-0249's private epoch shape; it does not change public
Workbench protocol, install claims, shadow plans, or storage identity.

## Consequences

- Vite 7 and Vite 8 remain distinguishable from stale physical Vite without an
  esbuild/Vite branch in package state or generic admission.
- Child admission is stable across concurrent manifest/lock edits and binds all
  runtime preparation to one installed-tree epoch.
- npm-client gains one public facts projection and validates root inventory more
  strictly than plan-only readers; callers that need only a plan keep the prior
  `shadowAssetPlanFromLockfileBytes` behavior.
- Projection serializes a fresh install's in-memory lockfile once at the
  acquisition boundary; child starts perform no parsing or hashing.
